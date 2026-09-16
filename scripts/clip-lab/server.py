#!/usr/bin/env python3
"""Clip Lab: a local page for testing the clip engine on long-form footage.

Upload a video (or point at a file on this Mac), watch the deployed worker's
OpenShortsRenderer clip it segment by segment, review the output, and
optionally save a clip to Postiz as a draft. Drafts never publish.

Run from the repository root: python3 scripts/clip-lab/server.py
AI mode needs GEMINI_API_KEY in the environment; local mode is free.
Binds to 127.0.0.1 only. Job files live in .runtime/clip-lab/.
"""
from __future__ import annotations

import csv
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

ROOT = Path(__file__).resolve().parents[2]
# Optional local secrets such as GEMINI_API_KEY=...; .runtime/ is git-ignored
# and values already set in the shell win.
LOCAL_ENV = ROOT / '.runtime/clip-lab.env'
if LOCAL_ENV.exists():
    for entry in LOCAL_ENV.read_text().splitlines():
        name, sep, value = entry.partition('=')
        if sep and name.strip() and not name.lstrip().startswith('#'):
            os.environ.setdefault(name.strip(), value.strip().strip('"\''))
# Homebrew's default ffmpeg lacks libass, so OpenShorts cannot burn captions with
# it. Prefer the keg-only ffmpeg-full (brew install ffmpeg-full) when present;
# renders inherit this PATH.
FFMPEG_FULL = Path('/opt/homebrew/opt/ffmpeg-full/bin')
if (FFMPEG_FULL / 'ffmpeg').exists():
    os.environ['PATH'] = f'{FFMPEG_FULL}{os.pathsep}{os.environ.get("PATH", "")}'
sys.path.insert(0, str(ROOT / 'engine-worker'))
from contentstation_worker import (  # noqa: E402
    PINNED_COMMIT, LeaseLost, OpenShortsRenderer, RenderError, Settings,
)
from gemini_cli_bridge import start_bridge  # noqa: E402

HERE = Path(__file__).resolve().parent
DATA = Path(os.environ.get('CLIP_LAB_DIR', ROOT / '.runtime/clip-lab')).resolve()
PORT = int(os.environ.get('CLIP_LAB_PORT', '4320'))
OPENSHORTS_HOME = Path(os.environ.get('OPENSHORTS_HOME', ROOT / '.runtime/openshorts')).resolve()
OPENSHORTS_PYTHON = os.environ.get('OPENSHORTS_PYTHON', str(OPENSHORTS_HOME / '.venv/bin/python'))
# AI mode prefers a Gemini API key (it also covers silent footage); otherwise
# the Gemini CLI's own sign-in answers OpenShorts through a local bridge.
if os.environ.get('GEMINI_API_KEY') and os.environ.get('CLIP_LAB_AI') != 'gemini-cli':
    AI_BACKEND = 'gemini-api'
elif shutil.which('gemini'):
    AI_BACKEND = 'gemini-cli'
else:
    AI_BACKEND = None
AI_AVAILABLE = AI_BACKEND is not None
MAX_UPLOAD = 20 * 1024 ** 3
# The camera uploads five-minute segments and the worker refuses inputs over ten.
SEGMENT_CHOICES = (120, 300, 540)
CLIP_CHOICES = (15, 30, 45, 60)
VIDEO_EXT = {'.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi'}
MEDIA_TYPES = {'.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
               '.webm': 'video/webm', '.avi': 'video/x-msvideo', '.jpg': 'image/jpeg'}
JOB_ID = r'(\d{8}-\d{6}-[0-9a-f]{4})'
ANSI = re.compile(r'\x1b\[[0-9;?]*[A-Za-z]')
STEPS = [(re.compile(pattern), label) for pattern, label in [
    (r'Transcribing', 'Transcribing speech'),
    (r'Analyzing with (Gemini|local LLM)', 'AI is choosing the best moments'),
    (r'Silent video', 'AI is watching silent footage'),
    (r'Kept the \d+ best', 'Ranking candidate clips'),
    (r'Skipping analysis', 'Reframing the chosen window'),
    (r'Step 1: Detecting scenes', 'Detecting scene cuts'),
    (r'Step 2: Preparing Active Tracking', 'Tracking people in frame'),
    (r'Step 3: Analyzing Scenes', 'Choosing framing per scene'),
    (r'Step 4: Processing video frames', 'Reframing frames to 9:16'),
    (r'Step 5: Extracting audio', 'Extracting audio'),
    (r'Step 6: Merging', 'Merging audio and video'),
]]

LOCK = threading.RLock()
JOBS: dict[str, dict] = {}
CANCEL: dict[str, threading.Event] = {}
QUEUE: queue.Queue[str] = queue.Queue()
CHANNELS: dict = {'at': 0.0, 'items': None}


class HttpError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status, self.message = status, message


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def job_dir(job_id):
    return DATA / job_id


def save(job):
    path = job_dir(job['id']) / 'job.json'
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(job, indent=2))
    tmp.replace(path)


def update(job_id, **fields):
    with LOCK:
        JOBS[job_id].update(fields)
        save(JOBS[job_id])


def set_segment(job_id, index, **fields):
    with LOCK:
        JOBS[job_id]['segments'][index].update(fields)
        save(JOBS[job_id])


def get_job(job_id):
    with LOCK:
        job = JOBS.get(job_id)
        if not job:
            raise HttpError(404, 'No such run.')
        return job


def snapshot(job):
    with LOCK:
        return json.loads(json.dumps(job))


def load_jobs():
    DATA.mkdir(parents=True, exist_ok=True)
    for path in sorted(DATA.glob('*/job.json')):
        try:
            job = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        if job.get('status') in ('queued', 'running'):
            job.update(status='failed', error='Clip Lab restarted while this run was in progress.', current=None)
            save(job)
        JOBS[job['id']] = job
        CANCEL[job['id']] = threading.Event()


# ---------------------------------------------------------------- media work

def probe_source(path):
    result = subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)],
                            capture_output=True, timeout=120, check=False)
    if result.returncode:
        raise RenderError('ffprobe could not read this file')
    doc = json.loads(result.stdout)
    video = next((s for s in doc.get('streams', []) if s.get('codec_type') == 'video'), None)
    if not video:
        raise RenderError('No video stream found')
    duration = float(doc.get('format', {}).get('duration') or video.get('duration') or 0)
    if duration <= 0:
        raise RenderError('Could not determine the video duration')
    return {'duration': duration, 'width': int(video['width']), 'height': int(video['height']),
            'codec': video.get('codec_name'),
            'has_audio': any(s.get('codec_type') == 'audio' for s in doc['streams'])}


def split(source, directory, seconds):
    """Stream-copy into camera-sized pieces; MP4 first (keeps rotation), Matroska for odd codecs."""
    directory.mkdir(exist_ok=True)
    listing = directory / 'segments.csv'
    for ext in ('mp4', 'mkv'):
        for old in directory.glob('seg-*'):
            old.unlink()
        result = subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(source), '-map', '0:v:0', '-map', '0:a?',
                                 '-c', 'copy', '-f', 'segment', '-segment_time', str(seconds),
                                 '-reset_timestamps', '1', '-segment_list', str(listing),
                                 '-segment_list_type', 'csv', str(directory / f'seg-%03d.{ext}')],
                                capture_output=True, text=True, timeout=3600, check=False)
        if result.returncode == 0 and listing.exists():
            pieces = [(directory / row[0], float(row[1]), float(row[2]))
                      for row in csv.reader(listing.read_text().splitlines()) if len(row) >= 3]
            if pieces:
                return pieces
    raise RenderError('ffmpeg could not split this video into segments')


def tail(path, limit=256 * 1024):
    with path.open('rb') as stream:
        stream.seek(0, 2)
        stream.seek(max(0, stream.tell() - limit))
        text = stream.read().decode('utf-8', 'replace')
    lines = []
    for raw in re.split(r'[\r\n]+', text):
        line = ANSI.sub('', raw).rstrip()
        if not line.strip():
            continue
        # tqdm redraws one bar many times; keep only its latest state.
        if '%|' in line and lines and '%|' in lines[-1]:
            lines[-1] = line
        else:
            lines.append(line)
    return lines


def latest_log(work):
    logs = sorted(work.glob('*.log'), key=lambda p: p.stat().st_mtime) if work.exists() else []
    return logs[-1] if logs else None


def openshorts_stage(lines):
    clip = step = None
    for line in lines:
        if match := re.search(r'Processing Clip (\d+)', line):
            clip, step = f'Clip {match[1]}', None
        elif match := re.search(r'Found (\d+) clips', line):
            step = f'Found {match[1]} candidate clips'
        else:
            step = next((label for pattern, label in STEPS if pattern.search(line)), step)
    return ' · '.join(x for x in (clip, step) if x)


def live(job):
    index = job.get('current')
    if index is None:
        return None
    log = latest_log(job_dir(job['id']) / f'work-{index:03d}')
    if log is None:
        first = 'Measuring motion at 2 fps' if job['mode'] == 'local' else 'Starting OpenShorts'
        return {'step': first, 'log': [], 'log_name': None}
    lines = tail(log)
    step = {'select.log': 'Cutting the highest-motion window', 'thumbnail.log': 'Making thumbnails'}.get(log.name)
    if log.name == 'openshorts.log':
        step = openshorts_stage(lines) or 'OpenShorts is starting'
    return {'step': step, 'log': lines[-60:], 'log_name': log.name}


def manifest_extras(work, segment_path):
    """AI mode: pick up the title and score OpenShorts wrote beside each clip."""
    manifest = work / 'ai' / f'{segment_path.stem}_metadata.json'
    if not manifest.exists():
        return {}
    try:
        shorts = json.loads(manifest.read_text()).get('shorts', [])
    except (OSError, ValueError):
        return {}
    extras = {}
    for clip in shorts:
        try:
            key = (round(float(clip['start']), 2), round(float(clip['end']), 2))
        except (KeyError, TypeError, ValueError):
            continue
        score = next((clip[k] for k in ('virality_score', 'viral_score', 'score') if k in clip), None)
        extras[key] = {'title': clip.get('video_title_for_youtube_short'), 'score': score}
    return extras


def ai_cost(work):
    log = work / 'openshorts.log'
    if not log.exists():
        return 0.0
    # Transcript passes log "Total cost"; the silent-footage vision pass logs "Vision cost".
    found = re.findall(r'(?:Total|Vision) cost \([^)]*\): \$([0-9.]+)', log.read_text(errors='replace'))
    return sum(float(x) for x in found)


def describe(error):
    if isinstance(error, (RenderError, ValueError)):
        return str(error)
    if isinstance(error, subprocess.CalledProcessError):
        return f'{Path(str(error.cmd[0])).name} failed (exit {error.returncode})'
    if isinstance(error, subprocess.TimeoutExpired):
        return 'A processing step timed out'
    return f'{type(error).__name__}: {error}'


def run_job(job_id):
    cancel = CANCEL[job_id]
    job = JOBS[job_id]
    directory = job_dir(job_id)
    source = Path(job['source']['path'])
    try:
        update(job_id, status='running', started_at=now(), error=None)
        info = probe_source(source)
        with LOCK:
            job['source'].update(info)
            save(job)
        if max(info['width'], info['height']) > 4096:
            raise RenderError('The engine accepts at most 4096 pixels per side; downscale this video first.')
        seconds = job['segment_seconds']
        if info['duration'] <= seconds + 1:
            pieces = [(source, 0.0, info['duration'])]
        else:
            update(job_id, splitting=True)
            pieces = split(source, directory / 'segments', seconds)
        with LOCK:
            job['splitting'] = False
            job['segments'] = [{'index': i, 'start': round(s, 2), 'end': round(e, 2), 'status': 'queued',
                                'clips': 0, 'error': None, 'error_log': [], 'seconds': None}
                               for i, (_, s, e) in enumerate(pieces)]
            save(job)
        renderer = OpenShortsRenderer(Settings(
            'http://127.0.0.1', 'x' * 32, OPENSHORTS_HOME, OPENSHORTS_PYTHON, directory,
            mode=job['mode'], clip_seconds=job['clip_seconds']))
        for index, (path, start, end) in enumerate(pieces):
            if cancel.is_set():
                raise LeaseLost('cancelled')
            if end - start < 5:
                set_segment(job_id, index, status='skipped', error='Shorter than five seconds')
                continue
            work = directory / f'work-{index:03d}'
            work.mkdir(exist_ok=True)
            update(job_id, current=index)
            set_segment(job_id, index, status='running', started=time.time())
            began = time.monotonic()
            try:
                artifacts = renderer(path, work, cancel)
            except LeaseLost:
                raise
            except Exception as error:  # one bad segment should not sink a long video
                log = latest_log(work)
                set_segment(job_id, index, status='failed', error=describe(error),
                            error_log=tail(log)[-15:] if log else [], seconds=round(time.monotonic() - began, 1))
                continue
            extras = manifest_extras(work, path)
            clips = []
            for n, artifact in enumerate(artifacts):
                extra = extras.get((round(artifact.start, 2), round(artifact.end, 2)), {})
                clips.append({
                    'id': f'{index:03d}-{n}', 'segment': index,
                    'video': artifact.video.relative_to(directory).as_posix(),
                    'thumb': artifact.thumb.relative_to(directory).as_posix(),
                    'start': round(start + artifact.start, 2), 'end': round(start + artifact.end, 2),
                    'duration': round(artifact.duration, 2), 'caption': artifact.caption,
                    'title': extra.get('title'), 'score': extra.get('score'), 'drafts': []})
            with LOCK:
                job['clips'].extend(clips)
                job['ai_cost_usd'] = round(job.get('ai_cost_usd', 0) + ai_cost(work), 6)
                save(job)
            set_segment(job_id, index, status='done', clips=len(clips), seconds=round(time.monotonic() - began, 1))
        if job['clips']:
            update(job_id, status='done')
        else:
            update(job_id, status='failed', error='No segment produced a clip.')
    except LeaseLost:
        update(job_id, status='cancelled')
    except Exception as error:
        update(job_id, status='failed', error=describe(error))
    finally:
        with LOCK:
            for segment in job.get('segments', []):
                if segment['status'] in ('queued', 'running') and job['status'] != 'done':
                    segment['status'] = 'cancelled' if job['status'] == 'cancelled' else 'skipped'
            job.update(current=None, splitting=False, finished_at=now())
            save(job)


def worker_loop():
    while True:
        job_id = QUEUE.get()
        with LOCK:
            ready = JOBS.get(job_id, {}).get('status') == 'queued'
        if ready:
            run_job(job_id)


# ---------------------------------------------------------------- jobs

def options(raw):
    mode = raw.get('mode', 'local')
    if mode not in ('local', 'ai'):
        raise HttpError(400, 'Mode must be local or ai.')
    if mode == 'ai' and not AI_AVAILABLE:
        raise HttpError(400, 'AI mode needs the Gemini CLI or GEMINI_API_KEY; add one and restart Clip Lab.')
    try:
        segment, clip = int(raw.get('segment_seconds', 300)), int(raw.get('clip_seconds', 30))
    except (TypeError, ValueError):
        raise HttpError(400, 'Segment and clip lengths must be whole seconds.')
    if segment not in SEGMENT_CHOICES or clip not in CLIP_CHOICES:
        raise HttpError(400, 'Unsupported segment or clip length.')
    return {'mode': mode, 'segment_seconds': segment, 'clip_seconds': clip}


def new_job(name, opts, source):
    job_id = datetime.now().strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:4]
    job_dir(job_id).mkdir(parents=True)
    job = {'id': job_id, 'name': name, 'created_at': now(), 'status': 'queued', 'error': None,
           **opts, 'source': source, 'segments': [], 'clips': [], 'current': None, 'splitting': False,
           'ai_cost_usd': 0.0}
    with LOCK:
        JOBS[job_id] = job
        CANCEL[job_id] = threading.Event()
        save(job)
    return job


def summary(job):
    segments = job.get('segments', [])
    return {'id': job['id'], 'name': job['name'], 'status': job['status'], 'mode': job['mode'],
            'created_at': job['created_at'], 'duration': job['source'].get('duration'),
            'clips': len(job['clips']), 'segments': len(segments),
            'segments_finished': sum(s['status'] not in ('queued', 'running') for s in segments)}


def find_clip(job, clip_id):
    clip = next((c for c in job['clips'] if c['id'] == clip_id), None)
    if not clip:
        raise HttpError(404, 'No such clip.')
    return clip


# ---------------------------------------------------------------- Postiz (drafts only)

def postiz(*args, timeout=300):
    exe = shutil.which('postiz')
    if not exe:
        raise HttpError(503, 'The Postiz CLI is not installed on this Mac.')
    result = subprocess.run([exe, *args], capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode:
        detail = (result.stderr.strip() or result.stdout.strip()).splitlines()
        raise HttpError(502, f'postiz {args[0]} failed: ' + (detail[-1] if detail else f'exit {result.returncode}'))
    return result.stdout


def channels(refresh=False):
    if refresh or CHANNELS['items'] is None or time.time() - CHANNELS['at'] > 300:
        raw = postiz('integrations:list', timeout=60)
        try:
            items = json.loads(raw[raw.index('['):])
        except ValueError:
            raise HttpError(502, 'Could not read the Postiz channel list.')
        CHANNELS.update(at=time.time(), items=[
            {'id': i.get('id'), 'provider': i.get('providerIdentifier') or i.get('identifier') or '',
             'name': i.get('name') or '', 'disabled': bool(i.get('disabled'))} for i in items])
    return CHANNELS['items']


def draft_settings(provider, title, caption):
    # Conservative defaults: nothing here can go live without a person scheduling it in Postiz.
    if provider == 'tiktok':
        settings = {'privacy_level': 'SELF_ONLY', 'duet': False, 'stitch': False, 'comment': True,
                    'autoAddMusic': 'no', 'brand_content_toggle': False, 'brand_organic_toggle': False,
                    'content_posting_method': 'UPLOAD'}
        if title:
            settings['title'] = title[:90]
        return settings
    if provider == 'youtube':
        name = (title or caption or '').strip()[:100]
        return {'title': name if len(name) >= 2 else 'Short clip', 'type': 'private'}
    if provider.startswith('instagram'):
        return {'post_type': 'post'}
    return None


def uploaded_url(output):
    try:
        data = json.loads(output[output.index('{'):])
        for key in ('path', 'url', 'location'):
            if isinstance(data.get(key), str) and data[key].startswith('http'):
                return data[key]
    except ValueError:
        pass
    match = re.search(r'https://\S+?\.(?:mp4|mov)\b', output) or re.search(r'https://\S+', output)
    if not match:
        raise HttpError(502, 'Postiz upload returned no media URL.')
    return match[0].rstrip('",\'')


# ---------------------------------------------------------------- HTTP

ROUTES = []


def route(method, pattern):
    def register(handler):
        ROUTES.append((method, re.compile(pattern + '$'), handler))
        return handler
    return register


@route('GET', '/')
def index(req, query):
    req.send_bytes((HERE / 'index.html').read_bytes(), 'text/html; charset=utf-8')


@route('GET', '/api/state')
def state(req, query):
    with LOCK:
        jobs = [summary(j) for j in sorted(JOBS.values(), key=lambda j: j['id'], reverse=True)]
    req.json({'engine': {'openshorts': PINNED_COMMIT[:7], 'ai_available': AI_AVAILABLE, 'ai_backend': AI_BACKEND,
                         'gemini_model': os.environ.get('GEMINI_MODEL') or 'OpenShorts default',
                         'postiz_cli': bool(shutil.which('postiz')), 'data_dir': str(DATA),
                         'segment_choices': SEGMENT_CHOICES, 'clip_choices': CLIP_CHOICES},
              'jobs': jobs})


@route('GET', f'/api/jobs/{JOB_ID}')
def job_detail(req, job_id, query):
    job = snapshot(get_job(job_id))
    job['live'] = live(job) if job['status'] == 'running' else None
    req.json(job)


@route('POST', '/api/upload')
def upload(req, query):
    name = Path(unquote(query.get('name', ['video.mp4'])[0])).name[:200] or 'video.mp4'
    ext = Path(name).suffix.lower()
    if ext not in VIDEO_EXT:
        raise HttpError(400, 'Upload an MP4, MOV, M4V, MKV, WebM or AVI file.')
    length = int(req.headers.get('Content-Length') or 0)
    if not 0 < length <= MAX_UPLOAD:
        raise HttpError(413, 'Uploads must be between 1 byte and 20 GB; use a local path for bigger files.')
    opts = options({k: v[0] for k, v in query.items()})
    job = new_job(name, opts, {'name': name, 'bytes': length, 'uploaded': True})
    dest = job_dir(job['id']) / f'source{ext}'
    remaining = length
    try:
        with dest.open('wb') as out:
            while remaining:
                chunk = req.rfile.read(min(4 * 1024 * 1024, remaining))
                if not chunk:
                    raise ConnectionResetError('upload interrupted')
                out.write(chunk)
                remaining -= len(chunk)
    except (OSError, ConnectionResetError):
        with LOCK:
            JOBS.pop(job['id'], None)
        shutil.rmtree(job_dir(job['id']), ignore_errors=True)
        raise
    with LOCK:
        job['source']['path'] = str(dest)
        save(job)
    QUEUE.put(job['id'])
    req.json(summary(job), 201)


@route('POST', '/api/jobs')
def from_path(req, query):
    body = req.body_json()
    path = Path(str(body.get('path', ''))).expanduser()
    if not path.is_absolute() or not path.is_file():
        raise HttpError(400, 'Give the full path to a video file on this Mac.')
    if path.suffix.lower() not in VIDEO_EXT:
        raise HttpError(400, 'Use an MP4, MOV, M4V, MKV, WebM or AVI file.')
    job = new_job(path.name, options(body), {'name': path.name, 'bytes': path.stat().st_size,
                                             'uploaded': False, 'path': str(path.resolve())})
    QUEUE.put(job['id'])
    req.json(summary(job), 201)


@route('POST', f'/api/jobs/{JOB_ID}/cancel')
def cancel(req, job_id, query):
    job = get_job(job_id)
    with LOCK:
        if job['status'] == 'queued':
            job.update(status='cancelled', finished_at=now())
            save(job)
    CANCEL[job_id].set()
    req.json({'ok': True})


@route('DELETE', f'/api/jobs/{JOB_ID}')
def delete(req, job_id, query):
    job = get_job(job_id)
    with LOCK:
        if job['status'] == 'running':
            raise HttpError(409, 'Cancel this run before deleting it.')
        JOBS.pop(job_id, None)
    # Removes Clip Lab's own copies only; a file used in place by path is left alone.
    shutil.rmtree(job_dir(job_id), ignore_errors=True)
    req.json({'ok': True})


@route('PATCH', f'/api/jobs/{JOB_ID}/clips/([0-9]+-[0-9]+)')
def edit_clip(req, job_id, clip_id, query):
    caption = str(req.body_json().get('caption', ''))[:2200]
    job = get_job(job_id)
    with LOCK:
        find_clip(job, clip_id)['caption'] = caption
        save(job)
    req.json({'ok': True})


@route('POST', f'/api/jobs/{JOB_ID}/clips/([0-9]+-[0-9]+)/reveal')
def reveal(req, job_id, clip_id, query):
    job = get_job(job_id)
    subprocess.run(['open', '-R', str(job_dir(job_id) / find_clip(job, clip_id)['video'])], check=False)
    req.json({'ok': True})


@route('GET', '/api/postiz/channels')
def list_channels(req, query):
    req.json({'channels': channels(refresh='refresh' in query)})


@route('POST', f'/api/jobs/{JOB_ID}/clips/([0-9]+-[0-9]+)/postiz')
def postiz_draft(req, job_id, clip_id, query):
    body = req.body_json()
    job = get_job(job_id)
    with LOCK:
        clip = dict(find_clip(job, clip_id))
    channel = next((c for c in channels() if c['id'] == body.get('channel')), None)
    if not channel:
        raise HttpError(400, 'Choose one of your connected Postiz channels.')
    limit = 2000 if channel['provider'] == 'tiktok' else 2200
    caption = str(body.get('caption') or clip['caption'])[:limit]
    media = uploaded_url(postiz('upload', str(job_dir(job_id) / clip['video'])))
    date = (datetime.now(timezone.utc) + timedelta(days=1)).strftime('%Y-%m-%dT%H:%M:%SZ')
    # --key=value keeps a caption that starts with "-" from being read as a flag.
    args = ['posts:create', f'--content={caption}', f'--media={media}', f'--integrations={channel["id"]}',
            f'--date={date}', '--type=draft']
    settings = draft_settings(channel['provider'], clip.get('title'), caption)
    if settings:
        args.append('--settings=' + json.dumps(settings))
    output = postiz(*args)
    found = re.search(r'"?(?:postId|id)"?\s*[:=]\s*"?([A-Za-z0-9_-]{6,})', output)
    draft = {'channel': channel['name'], 'provider': channel['provider'], 'channel_id': channel['id'],
             'post_id': found[1] if found else None, 'media_url': media, 'at': now()}
    with LOCK:
        find_clip(job, clip_id).setdefault('drafts', []).append(draft)
        save(job)
    req.json({'draft': draft})


@route('GET', f'/files/{JOB_ID}/(.+)')
def files(req, job_id, relative, query):
    job = get_job(job_id)
    base = job_dir(job_id).resolve()
    if relative == 'source':
        target = Path(job['source'].get('path', ''))
    else:
        target = (base / unquote(relative)).resolve()
        if base not in target.parents:
            raise HttpError(404, 'Not found')
    if not target.is_file() or target.suffix.lower() not in MEDIA_TYPES:
        raise HttpError(404, 'Not found')
    req.send_file(target, MEDIA_TYPES[target.suffix.lower()])


class Handler(BaseHTTPRequestHandler):
    server_version = 'ClipLab'

    def log_message(self, fmt, *args):
        if args and str(args[1] if len(args) > 1 else '').startswith(('4', '5')):
            sys.stderr.write('%s %s\n' % (self.command, fmt % args))

    def json(self, payload, status=200):
        self.send_bytes(json.dumps(payload).encode(), 'application/json', status)

    def send_bytes(self, data, content_type, status=200):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def send_file(self, path, content_type):
        size = path.stat().st_size
        start, end, status = 0, size - 1, 200
        match = re.fullmatch(r'bytes=(\d*)-(\d*)', self.headers.get('Range', ''))
        if match and (match[1] or match[2]):
            if match[1]:
                start, end = int(match[1]), int(match[2]) if match[2] else size - 1
            else:
                start = max(0, size - int(match[2]))
            end = min(end, size - 1)
            if start > end:
                self.send_response(416)
                self.send_header('Content-Range', f'bytes */{size}')
                self.end_headers()
                return
            status = 206
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(end - start + 1))
        if status == 206:
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.end_headers()
        with path.open('rb') as stream:
            stream.seek(start)
            remaining = end - start + 1
            while remaining and (chunk := stream.read(min(1024 * 1024, remaining))):
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def body_json(self):
        length = int(self.headers.get('Content-Length') or 0)
        if length > 1024 * 1024:
            raise HttpError(413, 'Request too large.')
        try:
            data = json.loads(self.rfile.read(length) or b'{}')
        except ValueError:
            raise HttpError(400, 'Send a JSON body.')
        if not isinstance(data, dict):
            raise HttpError(400, 'Send a JSON object.')
        return data

    def dispatch(self, method):
        parts = urlsplit(self.path)
        try:
            # Host check blocks DNS rebinding; the custom header forces a CORS
            # preflight, which this server never answers, for cross-site writes.
            host = (self.headers.get('Host') or '').rsplit(':', 1)[0]
            if host not in ('127.0.0.1', 'localhost', '[::1]'):
                raise HttpError(403, 'Clip Lab only answers on localhost.')
            if method != 'GET' and self.headers.get('X-Clip-Lab') != '1':
                raise HttpError(403, 'Missing X-Clip-Lab header.')
            for verb, pattern, handler in ROUTES:
                if verb == method and (match := pattern.match(parts.path)):
                    return handler(self, *match.groups(), query=parse_qs(parts.query))
            raise HttpError(404, 'Not found')
        except HttpError as error:
            self.json({'error': error.message}, error.status)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as error:
            sys.stderr.write(f'{method} {parts.path}: {type(error).__name__}: {error}\n')
            self.json({'error': describe(error)}, 500)

    def do_GET(self):
        self.dispatch('GET')

    def do_POST(self):
        self.dispatch('POST')

    def do_PATCH(self):
        self.dispatch('PATCH')

    def do_DELETE(self):
        self.dispatch('DELETE')


def main():
    try:
        OpenShortsRenderer(Settings('http://127.0.0.1', 'x' * 32, OPENSHORTS_HOME, OPENSHORTS_PYTHON, DATA)).verify()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(f'Clip Lab cannot start: {error}')
    load_jobs()
    if AI_BACKEND == 'gemini-cli':
        # OpenShorts' llm_backend sends transcript ranking here instead of the Gemini SDK.
        start_bridge(PORT + 1)
        os.environ.update(LLM_BASE_URL=f'http://127.0.0.1:{PORT + 1}/v1', LLM_MODEL='gemini-cli')
    threading.Thread(target=worker_loop, daemon=True).start()
    server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    server.daemon_threads = True
    ai = {'gemini-api': 'Gemini API key', 'gemini-cli': f'Gemini CLI via bridge on {PORT + 1}'}.get(
        AI_BACKEND, 'off (install the Gemini CLI or set GEMINI_API_KEY)')
    print(f'Clip Lab ready on http://127.0.0.1:{PORT}  OpenShorts {PINNED_COMMIT[:7]}  AI mode: {ai}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        for event in CANCEL.values():
            event.set()


if __name__ == '__main__':
    main()
