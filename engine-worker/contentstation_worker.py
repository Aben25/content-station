"""Leased Firebase job worker using the pinned upstream OpenShorts renderer.

Run with Python 3.11+: python contentstation_worker.py [--once]
No Firebase administrator credentials or direct database access are needed.
"""
from __future__ import annotations

import argparse
import http.client
import json
import logging
import math
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

PINNED_COMMIT = '5a6f42807576eda572673b32f8c7625cb6d82a3c'
LOG = logging.getLogger('contentstation.worker')


class ApiError(RuntimeError):
    def __init__(self, status, message='API request failed'):
        super().__init__(message)
        self.status = status


class LeaseLost(RuntimeError):
    pass


class RenderError(RuntimeError):
    pass


@dataclass
class Settings:
    api_url: str
    engine_key: str
    openshorts_home: Path
    python: str
    work_dir: Path
    mode: str = 'local'
    clip_seconds: float = 30
    heartbeat_seconds: float = 30
    max_source_bytes: int = 512 * 1024 * 1024
    render_timeout: int = 1800

    @classmethod
    def from_env(cls):
        home = Path(os.environ.get('OPENSHORTS_HOME', '.runtime/openshorts')).resolve()
        key = os.environ.get('ENGINE_API_KEY', '')
        if len(key) < 32:
            raise ValueError('Set ENGINE_API_KEY to the shared backend engine secret (32+ characters).')
        mode = os.environ.get('ENGINE_MODE', 'local')
        if mode not in ('local', 'ai'):
            raise ValueError('ENGINE_MODE must be local or ai.')
        if mode == 'ai' and not os.environ.get('GEMINI_API_KEY'):
            raise ValueError('AI analysis requires GEMINI_API_KEY, including for silent footage.')
        duration = float(os.environ.get('CLIP_SECONDS', '30'))
        if not math.isfinite(duration) or not 4 <= duration <= 60:
            raise ValueError('CLIP_SECONDS must be between 4 and 60.')
        python = os.environ.get('OPENSHORTS_PYTHON', str(home / '.venv/bin/python'))
        return cls(os.environ.get('API_BASE_URL', 'http://127.0.0.1:4310').rstrip('/'), key,
                   home, python, Path(os.environ.get('ENGINE_WORK_DIR', '.runtime/jobs')).resolve(),
                   mode=mode, clip_seconds=duration)


class ApiClient:
    """Same-origin capability transport. Never follows redirects or logs credentials."""
    def __init__(self, base, key):
        self.base = base.rstrip('/')
        self.key = key
        self.origin = urlsplit(self.base)
        if self.origin.scheme not in ('http', 'https') or not self.origin.hostname:
            raise ValueError('API_BASE_URL must be an HTTP(S) URL.')
        if self.origin.username or self.origin.password or self.origin.query or self.origin.fragment:
            raise ValueError('API_BASE_URL must not contain credentials, query or fragment.')
        if self.origin.scheme != 'https' and self.origin.hostname not in ('127.0.0.1', 'localhost', '::1'):
            raise ValueError('Use HTTPS outside localhost.')

    def _connection(self, url):
        target = urlsplit(url)
        if (target.scheme, target.netloc) != (self.origin.scheme, self.origin.netloc):
            raise ValueError('Media capability must belong to the configured API origin.')
        connection = http.client.HTTPSConnection if target.scheme == 'https' else http.client.HTTPConnection
        conn = connection(target.hostname, target.port, timeout=60)
        path = target.path or '/'
        if target.query:
            path += '?' + target.query
        return conn, path

    def post(self, path, payload):
        conn, target = self._connection(self.base + path)
        try:
            data = json.dumps(payload).encode()
            conn.request('POST', target, body=data, headers={
                'Content-Type': 'application/json', 'x-engine-key': self.key})
            response = conn.getresponse()
            body = response.read(2 * 1024 * 1024)
            if response.status == 409:
                raise LeaseLost('Job lease is no longer current.')
            if response.status >= 300:
                raise ApiError(response.status, f'API returned HTTP {response.status}')
            return json.loads(body) if body else {}
        except (OSError, http.client.HTTPException) as error:
            raise ApiError(503, 'API connection interrupted') from error
        finally:
            conn.close()

    def download(self, url, dest, maximum):
        conn, path = self._connection(url)
        try:
            conn.request('GET', path)
            response = conn.getresponse()
            if response.status != 200:
                raise ApiError(response.status, 'Input download failed')
            declared = response.getheader('Content-Length')
            if declared and int(declared) > maximum:
                raise RenderError('Input exceeds the configured size limit')
            total = 0
            with dest.open('wb') as output:
                while chunk := response.read(1024 * 1024):
                    total += len(chunk)
                    if total > maximum:
                        raise RenderError('Input exceeds the configured size limit')
                    output.write(chunk)
            if total == 0:
                raise RenderError('Input is empty')
        finally:
            conn.close()

    def upload(self, url, path, content_type):
        conn, target = self._connection(url)
        try:
            with path.open('rb') as stream:
                conn.request('PUT', target, body=stream, headers={
                    'Content-Type': content_type, 'Content-Length': str(path.stat().st_size)})
                response = conn.getresponse()
                response.read(1024 * 1024)
                if response.status >= 300:
                    raise ApiError(response.status, 'Output upload failed')
        finally:
            conn.close()


@dataclass
class Artifact:
    video: Path
    thumb: Path
    duration: float
    start: float
    end: float
    caption: str


def media_info(document):
    videos = [s for s in document.get('streams', []) if s.get('codec_type') == 'video']
    if not videos:
        raise RenderError('No usable video stream')
    stream = videos[0]
    try:
        duration = float(document.get('format', {}).get('duration', stream.get('duration', 0)))
        width, height = int(stream['width']), int(stream['height'])
    except (KeyError, ValueError, TypeError) as error:
        raise RenderError('Invalid video metadata') from error
    if not math.isfinite(duration) or not 0 < duration <= 600 or not 1 <= width <= 4096 or not 1 <= height <= 4096:
        raise RenderError('Video must be at most ten minutes and 4096 pixels per side')
    return duration, width, height


def probe(path):
    result = subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)],
                            capture_output=True, timeout=60, check=False)
    if result.returncode:
        raise RenderError('Video could not be decoded')
    return media_info(json.loads(result.stdout))


def choose_window(scores, duration, length, sample_fps=2):
    """Choose a bounded high-motion window. This is a heuristic, not semantic AI."""
    length = min(length, duration)
    count = max(1, round(length * sample_fps))
    if duration <= length or len(scores) <= count:
        return 0, duration
    total = sum(scores[:count])
    best, index = total, 0
    for end in range(count, len(scores)):
        total += scores[end] - scores[end - count]
        if total > best:
            best, index = total, end - count + 1
    start = min(index / sample_fps, duration - length)
    return start, start + length


def ready_clips(log, directory):
    """Use upstream's final rendered/captioned artifact, never an intermediate."""
    clips = {}
    for line in log.splitlines():
        match = re.match(r'^CLIP_READY (\d+) (.+)$', line)
        if not match:
            continue
        index, name = int(match[1]), match[2].strip()
        candidate = directory / name
        if Path(name).name != name or candidate.resolve().parent != directory.resolve():
            raise RenderError('OpenShorts returned an invalid output path')
        if candidate.is_file() and candidate.suffix == '.mp4':
            clips[index] = candidate
    return clips


class OpenShortsRenderer:
    def __init__(self, settings):
        self.settings = settings

    def verify(self):
        home = self.settings.openshorts_home
        if not (home / 'main.py').is_file():
            raise ValueError('Install the pinned OpenShorts checkout with scripts/setup-openshorts.sh.')
        revision = subprocess.check_output(['git', '-C', str(home), 'rev-parse', 'HEAD'], text=True).strip()
        if revision != PINNED_COMMIT:
            raise ValueError('OpenShorts checkout does not match the tested pinned revision.')
        for tool in ('ffmpeg', 'ffprobe'):
            if not shutil.which(tool):
                raise ValueError(f'{tool} must be installed.')

    def _run(self, command, directory, cancel, *, env=None, cwd=None, name='render'):
        with (directory / f'{name}.log').open('ab') as log:
            process = subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=log,
                                       start_new_session=True)
            deadline = time.monotonic() + self.settings.render_timeout
            try:
                while process.poll() is None:
                    if cancel.wait(0.25):
                        raise LeaseLost('Processing cancelled after losing its lease.')
                    if time.monotonic() > deadline:
                        raise RenderError('Video processing exceeded its time limit')
                if process.returncode:
                    raise RenderError(f'{name} failed (exit {process.returncode})')
            finally:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait()

    def __call__(self, source, directory, cancel):
        duration, _, _ = probe(source)
        env = os.environ.copy()
        env.update({'AUTO_LAYOUT': '0', 'AUTO_HOOK': '0', 'CLIP_WORKERS': '1',
                    'YOLO_MODEL_PATH': str(self.settings.openshorts_home / 'yolov8n.pt'),
                    'PYTHONUNBUFFERED': '1', 'OMP_NUM_THREADS': '2'})
        metadata = []
        if self.settings.mode == 'local':
            # Upstream loads dotenv; explicit empty entries prevent inherited model credentials.
            for key in ('GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'LLM_API_KEY', 'LLM_BASE_URL'):
                env[key] = ''
            sampled = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(source), '-an', '-vf',
                                      'fps=2,scale=32:32,format=gray', '-f', 'rawvideo', '-'],
                                     capture_output=True, timeout=90, check=True).stdout
            frames = [sampled[i:i+1024] for i in range(0, len(sampled) - 1023, 1024)]
            scores = [0] + [sum(abs(a-b) for a, b in zip(prev, curr)) / 1024
                            for prev, curr in zip(frames, frames[1:])]
            start, end = choose_window(scores, duration, self.settings.clip_seconds)
            trimmed = directory / 'selected.mp4'
            self._run(['ffmpeg', '-y', '-v', 'error', '-ss', str(start), '-i', str(source),
                       '-t', str(end-start), '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264',
                       '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
                       '-movflags', '+faststart', str(trimmed)], directory, cancel, name='select')
            output = directory / 'clip-0.mp4'
            self._run([self.settings.python, str(self.settings.openshorts_home / 'main.py'),
                       '-i', str(trimmed), '-o', str(output), '--skip-analysis', '--format', 'vertical'],
                      directory, cancel, env=env, cwd=self.settings.openshorts_home, name='openshorts')
            metadata = [(output, start, end, 'A moment from the workday.')]
        else:
            output_dir = directory / 'ai'
            output_dir.mkdir()
            self._run([self.settings.python, str(self.settings.openshorts_home / 'main.py'),
                       '-i', str(source), '-o', str(output_dir), '--format', 'vertical'],
                      directory, cancel, env=env, cwd=self.settings.openshorts_home, name='openshorts')
            manifest = output_dir / f'{source.stem}_metadata.json'
            if not manifest.exists():
                raise RenderError('OpenShorts returned no clip selection metadata')
            data = json.loads(manifest.read_text())
            delivered = ready_clips((directory / 'openshorts.log').read_text(errors='replace'), output_dir)
            for index, clip in enumerate(data.get('shorts', [])[:20]):
                start, end = float(clip['start']), float(clip['end'])
                if not 0 <= start < end <= duration or end-start > 60.1:
                    raise RenderError('OpenShorts returned an invalid clip range')
                output = delivered.get(index)
                if output is not None:
                    caption = clip.get('video_description_for_instagram') or 'A moment from the workday.'
                    metadata.append((output, start, end, str(caption)[:300]))
        if not metadata:
            raise RenderError('OpenShorts did not produce any playable clips')
        artifacts = []
        for index, (video, start, end, caption) in enumerate(metadata):
            actual_duration, width, height = probe(video)
            if abs(width / height - 9 / 16) > 0.02 or actual_duration > 61:
                raise RenderError('Rendered clip must be vertical and at most 60 seconds')
            thumb = directory / f'thumb-{index}.jpg'
            self._run(['ffmpeg', '-y', '-v', 'error', '-ss', str(min(actual_duration/2, 2)),
                       '-i', str(video), '-frames:v', '1', '-vf', 'scale=360:-2', str(thumb)],
                      directory, cancel, name='thumbnail')
            artifacts.append(Artifact(video, thumb, actual_duration, start, end, caption))
        return artifacts


class Lease:
    def __init__(self, api, job, interval):
        self.api, self.job, self.interval = api, job, interval
        self.cancel = threading.Event()
        self.stop = threading.Event()
        self.deadline = datetime.fromisoformat(job['lease_expires_at'].replace('Z', '+00:00')).timestamp()
        self.thread = threading.Thread(target=self._loop, daemon=True)

    def _loop(self):
        while not self.stop.wait(self.interval):
            try:
                result = self.api.post(f"/engine/jobs/{self.job['id']}/heartbeat", {'lease_token': self.job['lease_token']})
                self.deadline = datetime.fromisoformat(result['lease_expires_at'].replace('Z', '+00:00')).timestamp()
            except LeaseLost:
                self.cancel.set()
                return
            except Exception:
                if time.time() >= self.deadline - 10:
                    self.cancel.set()
                    return

    def check(self):
        if self.cancel.is_set() or time.time() >= self.deadline - 5:
            raise LeaseLost('Job lease expired or was replaced.')


class JobWorker:
    def __init__(self, settings, api=None, renderer=None):
        self.settings = settings
        self.api = api or ApiClient(settings.api_url, settings.engine_key)
        self.renderer = renderer or OpenShortsRenderer(settings)
        self.active_lease = None

    def process(self, job):
        self.settings.work_dir.mkdir(parents=True, exist_ok=True)
        lease = Lease(self.api, job, self.settings.heartbeat_seconds)
        self.active_lease = lease
        lease.check()
        lease.thread.start()
        try:
            with tempfile.TemporaryDirectory(prefix='job-', dir=self.settings.work_dir) as d:
                directory = Path(d)
                source = directory / 'source.mp4'
                self.api.download(job['segment']['download_url'], source, self.settings.max_source_bytes)
                lease.check()
                artifacts = self.renderer(source, directory, lease.cancel)
                clips = []
                for index, artifact in enumerate(artifacts):
                    lease.check()
                    urls = self.api.post(f"/engine/jobs/{job['id']}/upload-urls",
                                         {'lease_token': job['lease_token'], 'index': index})
                    self.api.upload(urls['video_upload_url'], artifact.video, 'video/mp4')
                    lease.check()
                    self.api.upload(urls['thumb_upload_url'], artifact.thumb, 'image/jpeg')
                    clips.append({'path': urls['path'], 'thumb_path': urls['thumb_path'],
                                  'duration_s': artifact.duration, 'caption': artifact.caption,
                                  'source_start_s': artifact.start, 'source_end_s': artifact.end})
                lease.check()
                # Completion is idempotent and the server checks its lease. Once
                # sent, a heartbeat may observe the already-completed job before
                # we receive its response. Keep ambiguous completion retryable.
                lease.stop.set()
                for attempt in range(4):
                    try:
                        result = self.api.post(f"/engine/jobs/{job['id']}/done",
                                               {'lease_token': job['lease_token'], 'clips': clips})
                        return result['clip_ids']
                    except ApiError as error:
                        if error.status < 500 or attempt == 3:
                            raise
                        time.sleep(2 ** attempt)
        except LeaseLost:
            raise
        except Exception as error:
            if not lease.cancel.is_set():
                try:
                    self.api.post(f"/engine/jobs/{job['id']}/failed",
                                  {'lease_token': job['lease_token'], 'error': type(error).__name__})
                except Exception:
                    LOG.warning('Could not report failure; lease expiry will recover the job.')
            raise
        finally:
            lease.stop.set()
            lease.thread.join(timeout=65)
            self.active_lease = None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--once', action='store_true', help='Process at most one queued job and exit.')
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    settings = Settings.from_env()
    renderer = OpenShortsRenderer(settings)
    renderer.verify()
    worker = JobWorker(settings, renderer=renderer)
    stopping = threading.Event()
    def stop(*_):
        stopping.set()
        if worker.active_lease:
            worker.active_lease.cancel.set()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    LOG.info('OpenShorts worker ready; selection mode=%s', settings.mode)
    while not stopping.is_set():
        try:
            jobs = worker.api.post('/engine/jobs/claim', {'worker': 'openshorts-' + str(os.getpid()), 'max': 1})['jobs']
            for job in jobs:
                result = worker.process(job)
                LOG.info('Completed job %s: %d clip(s)', job['id'], len(result))
            if args.once:
                return 0
        except Exception as error:
            LOG.error('Processing failed: %s', type(error).__name__)
            if args.once:
                return 1
            if isinstance(error, ApiError) and error.status in (401, 403):
                raise
        stopping.wait(5)
    return 0


if __name__ == '__main__':
    sys.exit(main())
