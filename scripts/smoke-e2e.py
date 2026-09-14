#!/usr/bin/env python3
"""Local-only integration: Auth -> owner -> camera -> OpenShorts -> owner media.

Requires the launcher API/emulators running with --no-worker. Never targets a
hosted project or sends a real SMS. Supply footage you are permitted to test.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'engine-worker'))
from contentstation_worker import ApiClient, JobWorker, OpenShortsRenderer, Settings, probe

PROJECT = 'demo-contentstation-v2'
BASE = 'http://127.0.0.1:4310'
AUTH = 'http://127.0.0.1:9099'


def request(method, path, body=None, token=None):
    url = path if path.startswith('http://127.0.0.1:') else BASE + path
    headers = {}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    if body is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, method=method,
                                 data=None if body is None else json.dumps(body).encode(), headers=headers)
    with urllib.request.urlopen(req, timeout=60) as res:
        data = res.read()
        return json.loads(data) if data else None


def sign_in(phone):
    sent = request('POST', AUTH + '/identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=demo-key',
                   {'phoneNumber': '+' + phone})
    codes = request('GET', AUTH + f'/emulator/v1/projects/{PROJECT}/verificationCodes')['verificationCodes']
    matching = [c for c in codes if c['sessionInfo'] == sent['sessionInfo']]
    if not matching:
        raise RuntimeError('Local Auth emulator did not issue a verification code')
    return request('POST', AUTH + '/identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber?key=demo-key',
                   {'sessionInfo': sent['sessionInfo'], 'code': matching[-1]['code']})['idToken']


def expect_denied(path, token, statuses=(403, 404)):
    try:
        request('GET', path, token=token)
    except urllib.error.HTTPError as error:
        assert error.code in statuses, error.code
        return
    raise AssertionError('Another owner accessed private media')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', type=Path)
    parser.add_argument('--phone', default='14155550198')
    parser.add_argument('--delete', action='store_true', help='Also delete the test clip after playback verification.')
    args = parser.parse_args()
    health = request('GET', '/health')
    assert health.get('project_id') == PROJECT and health.get('emulator') is True, 'This script only runs against the demo emulator.'
    work = ROOT / '.runtime/smoke'
    work.mkdir(parents=True, exist_ok=True)
    source = args.input.resolve() if args.input else work / 'synthetic.mp4'
    if args.input is None:
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
                        '-t', '12', '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p', str(source)], check=True)
    duration, width, height = probe(source)
    owner = sign_in(args.phone)
    me = request('GET', '/me', token=owner)
    if not me['shop']:
        request('POST', '/shops', {'name': 'ContentStation Test Studio', 'type': 'detailing',
                                  'timezone': 'America/Los_Angeles'}, owner)
    pair = request('POST', '/pair/token', {'ssid': 'Local test Wi-Fi', 'password': 'not-a-real-password'}, owner)
    device = request('POST', '/pair/claim', {'pair_token': pair['pair_token'], 'serial': 'smoke-' + str(uuid.uuid4()),
                                          'model': 'API capture simulator', 'app_version': 'integration-test'})
    device_token = device['device_jwt']
    # Scope the media bearer to this synthetic camera; matching paths are checked server-side.
    thumb = work / 'preview.jpg'
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(source), '-frames:v', '1',
                    '-vf', 'scale=480:-2', str(thumb)], check=True)
    request('POST', '/camera/framing/start', token=owner)
    for path in ('/device/preview', '/device/thumb'):
        req = urllib.request.Request(BASE + path, method='POST', data=thumb.read_bytes(),
              headers={'Authorization': 'Bearer ' + device_token, 'Content-Type': 'image/jpeg'})
        with urllib.request.urlopen(req, timeout=30) as response:
            assert response.status == 204
    request('POST', '/camera/reference-frame', token=owner)
    hours = {day: {'open': '00:00', 'close': '23:59'} for day in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')}
    request('PATCH', '/shops/current', {'hours': hours}, owner)
    now = datetime.now(timezone.utc)
    stamps = {'start_ts': (now - timedelta(seconds=duration)).isoformat().replace('+00:00', 'Z'),
              'end_ts': now.isoformat().replace('+00:00', 'Z')}
    upload = request('POST', '/device/segment/upload-url', stamps, device_token)
    local_secrets = json.loads((ROOT / '.runtime/local-env.json').read_text())
    transport = ApiClient(BASE, local_secrets['ENGINE_API_KEY'])
    transport.upload(upload['upload_url'], source, 'video/mp4')
    segment_body = {**stamps, 'path': upload['path'], 'bytes': source.stat().st_size,
                    'width': width, 'height': height, 'fps': 30}
    segment = request('POST', '/device/segment/complete', segment_body, device_token)
    assert request('POST', '/device/segment/complete', segment_body, device_token) == segment, 'Duplicate upload completion was not idempotent'
    request('POST', '/device/heartbeat', {'battery': 100, 'thermal': 'nominal', 'wifi': 'strong',
        'storage_free_mb': 10000, 'state': 'idle', 'app_version': 'integration-test',
        'recording_seconds_today': round(duration)}, device_token)
    home = Path(os.environ.get('OPENSHORTS_HOME') or local_secrets.get('OPENSHORTS_HOME')
                or str(ROOT / '.runtime/openshorts')).resolve()
    settings = Settings(BASE, local_secrets['ENGINE_API_KEY'], home,
                        os.environ.get('OPENSHORTS_PYTHON', str(home / '.venv/bin/python')),
                        ROOT / '.runtime/jobs', clip_seconds=30)
    renderer = OpenShortsRenderer(settings)
    renderer.verify()
    worker = JobWorker(settings, transport, renderer)
    wanted = None
    # Test fixtures should be terminal before this runs. If earlier local camera
    # inputs exist, process them too rather than deleting someone else's queue.
    for _ in range(10):
        jobs = transport.post('/engine/jobs/claim', {'worker': 'e2e-smoke', 'max': 1})['jobs']
        if not jobs:
            break
        job = jobs[0]
        clip_ids = worker.process(job)
        if job['id'] == segment['job_id']:
            wanted = clip_ids
            break
    assert wanted, 'Uploaded segment was not processed'
    clip = request('GET', '/clips/' + wanted[0], token=owner)
    actual = work / 'rendered.mp4'
    transport.download(clip['video_url'], actual, 128 * 1024 * 1024)
    result_duration, result_width, result_height = probe(actual)
    subprocess.run(['ffmpeg', '-v', 'error', '-i', str(actual), '-f', 'null', '-'], check=True)
    req = urllib.request.Request(clip['video_url'], headers={'Range': 'bytes=0-1023'})
    with urllib.request.urlopen(req) as response:
        assert response.status == 206 and len(response.read()) == 1024
    other = sign_in('14155550197')
    other_me = request('GET', '/me', token=other)
    if not other_me['shop']:
        request('POST', '/shops', {'name': 'Isolation test', 'type': 'other'}, other)
    expect_denied('/clips/' + wanted[0], other)
    request('PATCH', '/clips/' + wanted[0], {'caption': 'A moment from the workday. Test clip for owner review.'}, owner)
    if args.delete:
        request('DELETE', '/clips/' + wanted[0], token=owner)
        expect_denied('/clips/' + wanted[0], owner, (404,))
        expect_denied(clip['video_url'], owner, (403, 404, 410))
    result = {'project': PROJECT, 'engine': 'OpenShorts', 'selection': 'local motion heuristic',
        'job_id': segment['job_id'], 'clip_ids': wanted, 'phone': args.phone,
        'input_seconds': duration, 'output_seconds': result_duration, 'width': result_width, 'height': result_height,
        'sha256': hashlib.sha256(actual.read_bytes()).hexdigest(), 'full_decode': 'passed',
        'range_playback': 'passed', 'owner_isolation': 'passed', 'duplicate_segment_completion': 'passed',
        'deletion': 'passed' if args.delete else 'retained for browser review', 'at': datetime.now(timezone.utc).isoformat()}
    (work / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
