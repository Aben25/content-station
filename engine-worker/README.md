# OpenShorts worker

This worker integrates the real [OpenShorts renderer](https://github.com/mutonby/openshorts/tree/5a6f42807576eda572673b32f8c7625cb6d82a3c), pinned at `5a6f42807576eda572673b32f8c7625cb6d82a3c`. It does not reimplement its cropping engine. It adds the Firebase API adapter, leased jobs, bounded downloads, artifact upload and completion retries.

Use Python 3.11+, FFmpeg and `bash scripts/setup-openshorts.sh` from the repository root. The worker itself has no Python package dependencies; upstream OpenShorts has a separate virtual environment.

Set the values from `.env.example` in your environment, then run `python engine-worker/contentstation_worker.py`. `--once` claims at most one job and exits. The local launcher supplies these values automatically. The worker does not parse `.env` by itself.

## Selection modes

- `ENGINE_MODE=local` samples motion, selects one window up to `CLIP_SECONDS` (default 30), and invokes OpenShorts with `--skip-analysis --format vertical`. This gives a functioning no-model-cost path. It is a motion heuristic, not proof of useful or compelling editorial selection. Captions are neutral and editable.
- `ENGINE_MODE=ai` invokes the upstream analysis pipeline and requires an explicitly configured `GEMINI_API_KEY`. Silent footage uses its visual analysis. This can send footage to the configured model provider and incur charges. It is opt-in; the local launch does not enable it.

Both modes validate the input and each rendered vertical clip, make a JPEG thumbnail, upload private output and complete a job through the API. A ten-minute/4096-pixel input ceiling protects the five-minute camera-segment pipeline from malformed or unintended inputs. Maximum download is 512 MiB. Default lease is renewed every 30 seconds; loss cancels rendering. Normal success/failure removes job working files. The local setup uses a temporary directory per job; crash leftovers can be removed from `.runtime/jobs` when no worker is running.

Output upload and input download use API-issued capabilities restricted to the API origin. Only the engine API key is needed; do not give this worker Firebase service-account credentials. It never auto-posts to social accounts.

## Verify

`cd engine-worker && python3 -m unittest discover -s tests -v`

The test suite verifies selection bounds, rejected inputs, origin restrictions, stale work cancellation and completion retry without re-rendering. Root `scripts/smoke-e2e.py` exercises the real Firebase emulator and renderer together.

## CPU container

The image pins OpenShorts at `5a6f42807576eda572673b32f8c7625cb6d82a3c` and preserves its upstream `LICENSE`. PyTorch `2.11.0` and torchvision `0.26.0` come from PyTorch's CPU wheel index, avoiding CUDA runtime packages while retaining upstream's versions. The build preloads `yolov8n.pt`, imports the rendering dependency chain, confirms CUDA is unavailable, and performs a decoded 9:16 `--skip-analysis` render from synthetic media.

Build context must be `engine-worker/`; its `.dockerignore` excludes tests, local environments, logs, and credentials. For the pinned Google Artifact Registry image, run from the repository root:

```sh
gcloud builds submit engine-worker \
  --project=lemekeru \
  --region=us-central1 \
  --config=deploy/worker-cloudbuild.yaml
```

No credentials are copied into the image. Supply the API endpoint and engine key only as runtime environment/secret values. `ENGINE_MODE` defaults to `local`, so model-backed analysis remains opt-in.

## Hosting

Build this directory's Dockerfile and run it as a continuously running worker. On Google Cloud, a Cloud Run worker pool is appropriate; a request-driven Cloud Run service with idle CPU throttling is not sufficient for this polling loop. Configure one instance initially and mount secrets through Secret Manager. Do not package local job media or credentials in an image.

The container definition is provided, not a claim that a cloud image was built or deployed. No hosted worker is created by local setup.

## Upstream notices

OpenShorts core is MIT licensed; its `cloud/` directory has a separate commercial license and is not used by this integration. Preserve the upstream LICENSE in its checkout/image. Dependencies have their own terms, including Ultralytics' AGPL license. Do not describe the entire dependency stack as MIT. See the pinned upstream license and dependency licenses when distributing your build.
