#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
OS_HOME=${OPENSHORTS_HOME:-"$ROOT/.runtime/openshorts"}
PYTHON_BIN=${PYTHON_BIN:-python3.11}
REVISION=5a6f42807576eda572673b32f8c7625cb6d82a3c
command -v ffmpeg >/dev/null || { echo 'Install FFmpeg before setting up OpenShorts.'; exit 1; }
"$PYTHON_BIN" -c 'import sys; assert sys.version_info >= (3,11), "Python 3.11 or newer required"'
if [ ! -d "$OS_HOME/.git" ]; then
  mkdir -p "$(dirname -- "$OS_HOME")"
  git clone https://github.com/mutonby/openshorts.git "$OS_HOME"
  git -C "$OS_HOME" checkout --detach "$REVISION"
fi
if [ "$(git -C "$OS_HOME" rev-parse HEAD)" != "$REVISION" ]; then
  echo 'Existing OpenShorts checkout is a different revision. Use a new OPENSHORTS_HOME directory.'
  exit 1
fi
if [ ! -x "$OS_HOME/.venv/bin/python" ]; then
  "$PYTHON_BIN" -m venv "$OS_HOME/.venv"
fi
"$OS_HOME/.venv/bin/python" -m pip install -r "$OS_HOME/requirements.txt"
(cd "$OS_HOME" && .venv/bin/python -c 'from ultralytics import YOLO; YOLO("yolov8n.pt")')
echo "Pinned OpenShorts ready in $OS_HOME"
