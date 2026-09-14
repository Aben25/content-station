FROM python:3.11-slim

ARG OPENSHORTS_REVISION=5a6f42807576eda572673b32f8c7625cb6d82a3c
ARG PYTORCH_VERSION=2.11.0
ARG TORCHVISION_VERSION=0.26.0

RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg git libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
RUN git clone --filter=blob:none https://github.com/mutonby/openshorts.git openshorts \
    && git -C openshorts checkout --detach "$OPENSHORTS_REVISION" \
    && test "$(git -C openshorts rev-parse HEAD)" = "$OPENSHORTS_REVISION" \
    && test -f openshorts/LICENSE

# Preserve upstream's exact PyTorch versions while selecting CPU-only wheels.
RUN python -m pip install --no-cache-dir \
        --index-url https://download.pytorch.org/whl/cpu \
        "torch==${PYTORCH_VERSION}" "torchvision==${TORCHVISION_VERSION}" \
    && python -m pip install --no-cache-dir -r /opt/openshorts/requirements.txt \
    && python -m pip check

WORKDIR /opt/openshorts
RUN python -c 'import cv2, faster_whisper, mediapipe, scenedetect, torch, torchvision, ultralytics; assert not torch.cuda.is_available(); assert "+cpu" in torch.__version__, torch.__version__' \
    && python -c 'from ultralytics import YOLO; YOLO("yolov8n.pt")' \
    && test -s yolov8n.pt

# Exercise the pinned renderer with generated media and verify a decoded 9:16 result.
RUN ffmpeg -hide_banner -loglevel error -y \
        -f lavfi -i "testsrc2=size=320x180:rate=10:duration=2" \
        -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=2" \
        -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac /tmp/input.mp4 \
    && YOLO_MODEL_PATH=/opt/openshorts/yolov8n.pt \
        python main.py --input /tmp/input.mp4 --output /tmp/vertical.mp4 \
        --skip-analysis --format vertical \
    && ffprobe -v error -select_streams v:0 \
        -show_entries stream=width,height -of csv=p=0 /tmp/vertical.mp4 \
        | tee /tmp/dimensions.txt \
    && test "$(cat /tmp/dimensions.txt)" = "1080,1920" \
    && ffmpeg -v error -i /tmp/vertical.mp4 -f null -

WORKDIR /app
COPY contentstation_worker.py .

ENV OPENSHORTS_HOME=/opt/openshorts \
    OPENSHORTS_PYTHON=/usr/local/bin/python \
    YOLO_MODEL_PATH=/opt/openshorts/yolov8n.pt \
    ENGINE_WORK_DIR=/tmp/jobs \
    ENGINE_MODE=local

CMD ["python", "contentstation_worker.py"]
