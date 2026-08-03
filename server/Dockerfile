# Streaming demo image: MineRL + VPT + a WebSocket server, all headless.
# Build from the REPO ROOT so the model weights and openai_vpt/ come along:
#   docker build -f server/Dockerfile -t minerl-demo .
#   docker run --gpus all -p 8000:8000 minerl-demo
FROM aicrowd/base-images:minerl-22-base

ARG DEBIAN_FRONTEND=noninteractive
USER root

# Xvfb + GL + ffmpeg (ffmpeg is only needed by record_replay.py).
RUN apt-get -qq update && apt-get -qq install -y --no-install-recommends \
      xvfb x11-utils mesa-utils libgl1-mesa-glx libgl1-mesa-dri \
      libsm6 libxext6 libxrender-dev libglib2.0-0 openjdk-8-jdk ffmpeg \
 && rm -rf /var/lib/apt/lists/*

USER aicrowd
ENV HOME_DIR=/home/aicrowd \
    CONDA_DEFAULT_ENV=minerl \
    PATH=/home/aicrowd/.conda/envs/minerl/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    DISPLAY=:99 \
    MINERL_HEADLESS=1

WORKDIR /home/aicrowd
SHELL ["conda", "run", "-n", "minerl", "/bin/bash", "-c"]

COPY --chown=1001:1001 environment.yml environment.yml
RUN conda env update --name minerl -f environment.yml --prune

COPY --chown=1001:1001 server/requirements.txt server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt

# Everything else, including data/VPT-models/ (~950 MB — keep it out of the
# build context with .dockerignore and mount it instead if you prefer).
COPY --chown=1001:1001 . .

RUN chmod +x server/entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["conda", "run", "--no-capture-output", "-n", "minerl", "bash", "server/entrypoint.sh"]
