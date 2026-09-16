# Clip Lab

The local web UI for running long-form footage through ContentStation's current clipping engine. `server.py` imports `OpenShortsRenderer` from [engine-worker](../../engine-worker/README.md); there is one shared rendering implementation. `index.html` provides uploads, progress, logs, a source timeline, clip playback, editable captions, downloads and optional Postiz drafts.

## Start

Requirements: Python 3.11+, FFmpeg/FFprobe, and the pinned OpenShorts environment. From the repository root:

```sh
bash scripts/setup-openshorts.sh
npm run clip-lab
```

The installer defaults to `python3.11`. If your interpreter has a different name, set `PYTHON_BIN`, for example `PYTHON_BIN=python3.12 bash scripts/setup-openshorts.sh`. Make sure `python3` used by `npm run clip-lab` is a supported version, or launch directly with `python3.12 scripts/clip-lab/server.py`.

Open `http://127.0.0.1:4320/`. Clip Lab binds to loopback and does not require Firebase or a camera. On macOS, the existing integration expects FFmpeg with libass for burned captions; it prefers `/opt/homebrew/opt/ffmpeg-full/bin` when installed.

Upload a video or give its full local path. Clip Lab splits it into 2-, 5- or 9-minute segments and requests 15-, 30-, 45- or 60-second clips. Runs and uploaded copies live in ignored `.runtime/clip-lab/`. A source selected by path stays in place; deleting its run removes only Clip Lab's files.

## Selection and configuration

- **Motion mode:** selects a motion window and renders through OpenShorts without a model key.
- **AI mode:** prefers `GEMINI_API_KEY` from the shell or ignored `.runtime/clip-lab.env`. When a Gemini CLI is installed, the optional bridge can use its configured access. Set `CLIP_LAB_AI=gemini-cli` to select that bridge explicitly. CLI authentication must support headless use; having the binary installed does not establish that model access works. AI processing sends footage or analysis input to the configured provider and may incur charges.

| Setting | Default / purpose |
| --- | --- |
| `CLIP_LAB_PORT` | `4320`; the optional Gemini CLI bridge uses the following port |
| `CLIP_LAB_DIR` | `.runtime/clip-lab/`; local runs and artifacts |
| `OPENSHORTS_HOME` | `.runtime/openshorts/`; pinned renderer checkout |
| `OPENSHORTS_PYTHON` | `<OPENSHORTS_HOME>/.venv/bin/python`; renderer interpreter |

## Postiz drafts

Saving a draft requires an installed, separately authenticated `postiz` CLI and a connected channel. Clip Lab uploads the selected clip and invokes `posts:create --type=draft`. Review or publish it later in Postiz. This path is separate from the owner website's shop-scoped publishing API; see [Postiz setup](../../postiz/README.md).

## Files and checks

- `server.py`: local HTTP routes, segment queue, shared renderer calls and draft creation.
- `index.html`: the current clipping UI.
- `gemini_cli_bridge.py`: optional local adapter for Gemini CLI access.

Run `npm run test:worker` from the repository root for the shared worker regressions. A complete render check additionally needs the installed OpenShorts environment and a video input; AI and Postiz paths require their own configured access.
