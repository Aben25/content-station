# Cloud worker build report

Date: 2026-09-14

Project/region: `lemekeru` / `us-central1`

Image tag: `us-central1-docker.pkg.dev/lemekeru/contentstation/worker:20260914`

Immutable image: `us-central1-docker.pkg.dev/lemekeru/contentstation/worker@sha256:e8bb3395f79f900096739062bb1c8cbc7e5a36eba36a4d7a5946cf67a75d813c`

## Result

Regional Cloud Build `f422719f-9775-4240-b5da-3ebd69bf70a1` completed with `SUCCESS`. It started at `2026-09-14T20:57:06Z` and finished at `2026-09-14T21:04:04Z`; Artifact Registry reports the digest above for tag `20260914`.

The submitted source context was restricted to `engine-worker/` (6 files, 33.5 KiB before compression), with `deploy/worker-cloudbuild.yaml` supplied as the explicit build configuration. The build did not contain runtime credentials or private media.

## Image behavior and verification

- OpenShorts is checked out at the required detached commit `5a6f42807576eda572673b32f8c7625cb6d82a3c`, and the upstream `LICENSE` is retained in `/opt/openshorts`.
- Upstream-pinned `torch==2.11.0` and `torchvision==0.26.0` are installed from PyTorch's CPU wheel index. The build asserts the installed torch version has the `+cpu` suffix and that CUDA is unavailable.
- `pip check` reported `No broken requirements found`.
- The image imported OpenCV, faster-whisper, MediaPipe, SceneDetect, torch, torchvision and Ultralytics together.
- Ultralytics `yolov8n.pt` was downloaded at build time, verified non-empty, and retained at `/opt/openshorts/yolov8n.pt`. Runtime uses this explicit path and does not download it again.
- FFmpeg generated a two-second 320×180 H.264/AAC synthetic source. The pinned upstream `main.py` ran with `--skip-analysis --format vertical`, detected one scene using TransNetV2, invoked its ffmpeg-native reframe engine, and saved a 1080×1920 MP4 in 2.63 seconds. `ffprobe` verified those dimensions and FFmpeg decoded the complete result without errors.
- Runtime defaults are `ENGINE_MODE=local`, `/tmp/jobs` for work, and the system Python/OpenShorts checkout. Model-backed analysis remains opt-in, and credentials must be passed only at runtime.

## Diagnostic build

Build `1b3a29c7-4b64-4654-aa94-ddaf18fb8321` proved the dependency and render checks passed but failed the dimension assertion: the test expected crop-native `101×180`, while OpenShorts intentionally rendered `1080×1920`. The assertion was corrected to verify the actual 9:16 output; no application code or renderer behavior changed.

## Scope and remaining work

No Cloud Run service or worker pool was deployed and no IAM, API, scheduler, or secret state was changed. Runtime deployment and a live queued-job test remain with the parent task as assigned. No unresolved image-build issue remains.
