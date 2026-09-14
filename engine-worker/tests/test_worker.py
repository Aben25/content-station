import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from contentstation_worker import (
    ApiClient, ApiError, Artifact, JobWorker, LeaseLost, RenderError,
    Settings, choose_window, media_info, ready_clips,
)


class FakeApi:
    def __init__(self, retry_done=False):
        self.uploads = []
        self.done_calls = 0
        self.failures = []
        self.retry_done = retry_done

    def download(self, url, dest, maximum):
        dest.write_bytes(b'input')

    def upload(self, url, path, content_type):
        self.uploads.append((url, path.name))

    def post(self, path, body):
        if path.endswith('/heartbeat'):
            return {'lease_expires_at': '2099-01-01T00:00:00Z'}
        if path.endswith('/upload-urls'):
            return {'path': 'v2/shop/clips/job/0.mp4', 'thumb_path': 'v2/shop/thumbs/job/0.jpg',
                    'video_upload_url': 'http://127.0.0.1/video', 'thumb_upload_url': 'http://127.0.0.1/thumb'}
        if path.endswith('/done'):
            self.done_calls += 1
            if self.retry_done and self.done_calls == 1:
                raise ApiError(503, 'response lost')
            return {'clip_ids': ['clip-one']}
        if path.endswith('/failed'):
            self.failures.append(body)
            return {'ok': True}
        raise AssertionError(path)


class WorkerTests(unittest.TestCase):
    def settings(self, root):
        return Settings(api_url='http://127.0.0.1:4310', engine_key='x' * 32,
                        openshorts_home=root, python='python3', work_dir=root / 'jobs',
                        heartbeat_seconds=0.05)

    def job(self):
        return {'id': 'job-one', 'lease_token': 'secret-lease',
                'lease_expires_at': '2099-01-01T00:00:00Z',
                'segment': {'download_url': 'http://127.0.0.1/source', 'id': 'segment-one'}}

    def render(self, source, directory, cancel):
        video = directory / 'clip.mp4'
        thumb = directory / 'thumb.jpg'
        video.write_bytes(b'video')
        thumb.write_bytes(b'jpeg')
        return [Artifact(video, thumb, 12, 0, 12, 'Work in progress.')]

    def test_lost_completion_response_retries_without_rendering_or_uploading_again(self):
        with tempfile.TemporaryDirectory() as d:
            api = FakeApi(retry_done=True)
            worker = JobWorker(self.settings(Path(d)), api, renderer=self.render)
            with patch('contentstation_worker.time.sleep'):
                result = worker.process(self.job())
            self.assertEqual(result, ['clip-one'])
            self.assertEqual(api.done_calls, 2)
            self.assertEqual(len(api.uploads), 2)
            self.assertEqual(api.failures, [])
            self.assertEqual(list((Path(d) / 'jobs').iterdir()), [])

    def test_stale_lease_stops_before_upload(self):
        with tempfile.TemporaryDirectory() as d:
            api = FakeApi()
            def render(source, directory, cancel):
                cancel.set()
                return self.render(source, directory, cancel)
            with self.assertRaises(LeaseLost):
                JobWorker(self.settings(Path(d)), api, renderer=render).process(self.job())
            self.assertEqual(api.uploads, [])
            self.assertEqual(api.failures, [])

    def test_completed_job_can_be_acknowledged_after_heartbeat_observes_done(self):
        with tempfile.TemporaryDirectory() as d:
            api = FakeApi()
            worker = JobWorker(self.settings(Path(d)), api, renderer=self.render)
            original_post = api.post
            def post(path, body):
                if path.endswith('/done') and api.done_calls == 0:
                    api.done_calls += 1
                    # Server committed; an in-flight heartbeat sees done, then the
                    # client loses the completion response. Retrying done is safe.
                    worker.active_lease.cancel.set()
                    raise ApiError(503, 'response lost')
                return original_post(path, body)
            api.post = post
            with patch('contentstation_worker.time.sleep'):
                self.assertEqual(worker.process(self.job()), ['clip-one'])
            self.assertEqual(api.done_calls, 2)

    def test_renderer_failure_marks_job_failed(self):
        with tempfile.TemporaryDirectory() as d:
            api = FakeApi()
            def render(*args):
                raise RenderError('No usable video stream')
            with self.assertRaises(RenderError):
                JobWorker(self.settings(Path(d)), api, renderer=render).process(self.job())
            self.assertEqual(len(api.failures), 1)
            self.assertEqual(api.failures[0]['lease_token'], 'secret-lease')

    def test_media_capabilities_cannot_escape_the_api_origin(self):
        api = ApiClient('http://127.0.0.1:4310', 'secret')
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):
                api.download('http://example.com/private', Path(d) / 'x', 200)

    def test_api_url_requires_tls_outside_localhost(self):
        with self.assertRaises(ValueError):
            ApiClient('http://example.com', 'secret')

    def test_motion_window_favors_later_activity(self):
        start, end = choose_window([0] * 80 + [50] * 40, 60, 15, sample_fps=2)
        self.assertGreaterEqual(start, 30)
        self.assertEqual(end - start, 15)
        self.assertLessEqual(end, 60)

    def test_short_source_is_kept_whole(self):
        self.assertEqual(choose_window([0] * 12, 6, 30), (0, 6))

    def test_probe_rejects_audio_only(self):
        with self.assertRaises(RenderError):
            media_info({'streams': [{'codec_type': 'audio'}], 'format': {'duration': '10'}})

    def test_upstream_captioned_deliverable_is_selected(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            captioned = root / 'captioned_source_clip_1.mp4'
            captioned.touch()
            (root / 'source_clip_1.mp4').touch()
            self.assertEqual(ready_clips('CLIP_READY 0 captioned_source_clip_1.mp4\n', root), {0: captioned})

    def test_deliverable_manifest_rejects_path_traversal(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(RenderError):
                ready_clips('CLIP_READY 0 ../private.mp4\n', Path(d))

    def test_probe_rejects_overlong_or_invalid_input(self):
        for duration in ['nan', '-3', '601']:
            with self.subTest(duration=duration), self.assertRaises(RenderError):
                media_info({'streams': [{'codec_type': 'video', 'width': 1280, 'height': 720}],
                            'format': {'duration': duration}})


if __name__ == '__main__':
    unittest.main()
