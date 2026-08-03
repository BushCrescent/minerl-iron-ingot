#!/usr/bin/env bash
# Start a virtual X display, then the streaming server on top of it.
# MineRL launches a real Minecraft client that needs an OpenGL context;
# Xvfb gives it one without any physical display attached.
set -euo pipefail

export DISPLAY="${DISPLAY:-:99}"
export MINERL_HEADLESS=1

Xvfb "$DISPLAY" -screen 0 1024x768x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!
trap 'kill $XVFB_PID 2>/dev/null || true' EXIT

# Wait for the display to accept connections before the JVM tries to use it.
for _ in $(seq 1 30); do
  xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && break
  sleep 0.5
done

exec python -u server/demo_server.py
