FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg git libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt
RUN git clone https://github.com/mutonby/openshorts.git openshorts && \
    cd openshorts && git checkout --detach 5a6f42807576eda572673b32f8c7625cb6d82a3c && \
    pip install --no-cache-dir -r requirements.txt && \
    python -c 'from ultralytics import YOLO; YOLO("yolov8n.pt")'
WORKDIR /app
COPY contentstation_worker.py .
ENV OPENSHORTS_HOME=/opt/openshorts OPENSHORTS_PYTHON=/usr/local/bin/python ENGINE_WORK_DIR=/tmp/jobs ENGINE_MODE=local
CMD ["python", "contentstation_worker.py"]
