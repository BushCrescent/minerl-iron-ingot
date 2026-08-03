"""Headless MineRL streaming server.

Runs ONE MineRL environment inside this process and broadcasts the agent's
point-of-view frames to every connected browser over a WebSocket. One
environment, many viewers — a Minecraft instance per visitor would need
several GB of RAM each and would fall over on the second click.

    GET  /api/status   -> {"ready": bool, "state": str, "viewers": int, ...}
    WS   /ws/stream    -> binary JPEG frames + JSON state/milestone messages

Client -> server:  {"type": "start"} | {"type": "stop"}

Run it:
    xvfb-run -a python server/demo_server.py
or inside the container built from server/Dockerfile, which does that for you.
"""

import asyncio
import contextlib
import json
import logging
import os
import pickle
import sys
import threading
import time
from pathlib import Path

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from server.iron_ingot_wrapper import IronIngotWrapper, REWARD_ITEMS  # noqa: E402
from server.vpt_agent import build_agent  # noqa: E402

log = logging.getLogger("demo")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# ----------------------------------------------------------------- config
ENV_ID = os.getenv("MINERL_ENV", "MineRLObtainDiamondShovel-v0")
MODEL = os.getenv("VPT_MODEL", str(ROOT / "data/VPT-models/2x.model"))
WEIGHTS = os.getenv("VPT_WEIGHTS", str(ROOT / "data/VPT-models/rl-from-early-game-2x.weights"))
MAX_STEPS = int(os.getenv("MAX_STEPS", "18000"))
JPEG_QUALITY = int(os.getenv("JPEG_QUALITY", "72"))
STREAM_WIDTH = int(os.getenv("STREAM_WIDTH", "640"))     # 0 = native
SEND_EVERY = int(os.getenv("SEND_EVERY", "2"))           # transmit every Nth frame
IDLE_TIMEOUT = int(os.getenv("IDLE_TIMEOUT", "120"))     # stop the env with no viewers
ALLOW_ORIGINS = os.getenv("ALLOW_ORIGINS", "*").split(",")
PORT = int(os.getenv("PORT", "8000"))

app = FastAPI(title="MineRL VPT demo stream")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOW_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ----------------------------------------------------------------- broadcaster
class Broadcaster:
    """Fan-out to N websockets. Slow clients drop frames rather than stall the env."""

    def __init__(self):
        self.clients: set[WebSocket] = set()
        self.lock = asyncio.Lock()

    async def add(self, ws: WebSocket):
        async with self.lock:
            self.clients.add(ws)

    async def remove(self, ws: WebSocket):
        async with self.lock:
            self.clients.discard(ws)

    @property
    def count(self) -> int:
        return len(self.clients)

    async def send_bytes(self, payload: bytes):
        await self._fanout(lambda ws: ws.send_bytes(payload))

    async def send_json(self, payload: dict):
        text = json.dumps(payload)
        await self._fanout(lambda ws: ws.send_text(text))

    async def _fanout(self, fn):
        async with self.lock:
            targets = list(self.clients)
        if not targets:
            return
        results = await asyncio.gather(*(fn(ws) for ws in targets), return_exceptions=True)
        dead = [ws for ws, r in zip(targets, results) if isinstance(r, Exception)]
        if dead:
            async with self.lock:
                for ws in dead:
                    self.clients.discard(ws)


bus = Broadcaster()


# ----------------------------------------------------------------- engine
class Engine:
    """Owns the MineRL env + VPT policy. Everything blocking runs in a thread."""

    def __init__(self):
        self.state = "cold"        # cold | loading | idle | booting | running | error
        self.error = None
        self.env = None
        self.agent = None
        self.device = None
        self.episode = 0
        self.step = 0
        self.total_reward = 0
        self.sps = 0.0             # observed steps/sec, for the status endpoint
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._last_viewer_at = time.time()

    # -- model / env boot (slow: ~30s for the Minecraft client) ------------
    def _load(self):
        import gym
        import minerl  # noqa: F401  (registers the envs)

        self.state = "booting"
        log.info("booting %s", ENV_ID)
        raw = gym.make(ENV_ID)
        self.env = IronIngotWrapper(raw, max_steps=MAX_STEPS)

        self.state = "loading"
        self.agent, self.device = build_agent(raw, MODEL, WEIGHTS)
        log.info("VPT policy loaded on %s", self.device)

        self.state = "idle"
        log.info("engine ready")

    # -- publishing from the worker thread into the event loop -------------
    def _publish_json(self, payload: dict):
        if self._loop:
            asyncio.run_coroutine_threadsafe(bus.send_json(payload), self._loop)

    def _publish_frame(self, pov: np.ndarray):
        if not self._loop:
            return
        frame = pov
        if STREAM_WIDTH and frame.shape[1] != STREAM_WIDTH:
            h = round(frame.shape[0] * STREAM_WIDTH / frame.shape[1])
            frame = cv2.resize(frame, (STREAM_WIDTH, h), interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", frame[:, :, ::-1], [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
        if ok:
            asyncio.run_coroutine_threadsafe(bus.send_bytes(buf.tobytes()), self._loop)

    # -- the episode loop --------------------------------------------------
    def _run_episode(self):
        try:
            if self.state == "cold":
                self._publish_json({"type": "status", "state": "booting"})
                self._load()
        except Exception as exc:                      # noqa: BLE001
            self.state = "error"
            self.error = str(exc)
            log.exception("engine boot failed")
            self._publish_json({"type": "error", "detail": str(exc)})
            return

        self.episode += 1
        self.state = "running"
        self.step = 0
        self.total_reward = 0

        try:
            obs = self.env.reset()
            self.agent.reset()
            self._publish_json({
                "type": "episode_start", "episode": self.episode, "viewers": bus.count,
            })

            t0 = time.time()
            while not self._stop.is_set():
                action = self.agent.get_action(obs)
                action["ESC"] = 0
                obs, reward, done, info = self.env.step(action)
                self.step = info["steps"]
                self.total_reward = info["total_reward"]

                if self.step % 50 == 0:
                    self.sps = round(self.step / max(time.time() - t0, 1e-6), 1)
                    log.info("step %d · %.1f steps/s · %d viewer(s)", self.step, self.sps, bus.count)

                if reward > 0:
                    bit = int(reward)
                    self._publish_json({
                        "type": "milestone", "reward": bit, "step": self.step,
                        "item": REWARD_ITEMS.get(bit, str(bit)),
                    })

                if self.step % SEND_EVERY == 0:
                    self._publish_frame(obs["pov"])
                    self._publish_json({
                        "type": "state", "step": self.step, "total_reward": self.total_reward,
                    })

                if done:
                    break

                # No one is watching — stop burning GPU on an empty room.
                if bus.count == 0 and time.time() - self._last_viewer_at > IDLE_TIMEOUT:
                    log.info("no viewers for %ss, ending episode", IDLE_TIMEOUT)
                    break

            self._publish_json({
                "type": "episode_end",
                "success": bool(getattr(self.env, "success", False)),
                "steps": self.step,
                "milestones": [
                    {"step": s, "reward": b, "item": n} for s, b, n in self.env.milestones
                ],
            })
        except Exception as exc:                      # noqa: BLE001
            log.exception("episode failed")
            self._publish_json({"type": "error", "detail": str(exc)})
        finally:
            self.state = "idle"
            self._stop.clear()

    # -- control -----------------------------------------------------------
    def start(self, loop: asyncio.AbstractEventLoop):
        if self._thread and self._thread.is_alive():
            return False
        self._loop = loop
        self._stop.clear()
        self._thread = threading.Thread(target=self._run_episode, daemon=True)
        self._thread.start()
        return True

    def stop(self):
        self._stop.set()

    def note_viewer(self):
        self._last_viewer_at = time.time()

    @property
    def running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())


engine = Engine()


# ----------------------------------------------------------------- routes
@app.get("/api/status")
async def status():
    return {
        "ready": engine.state != "error",
        "state": engine.state,
        "running": engine.running,
        "viewers": bus.count,
        "episode": engine.episode,
        "step": engine.step,
        "steps_per_sec": engine.sps,
        "device": engine.device,
        "env": ENV_ID,
        "error": engine.error,
    }


@app.websocket("/ws/stream")
async def stream(ws: WebSocket):
    await ws.accept()
    await bus.add(ws)
    engine.note_viewer()
    loop = asyncio.get_running_loop()

    await ws.send_text(json.dumps({
        "type": "status", "state": engine.state, "viewers": bus.count,
    }))

    # Joining mid-episode is fine — frames just start arriving.
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            if msg.get("type") == "start":
                engine.note_viewer()
                if engine.running:
                    await ws.send_text(json.dumps({
                        "type": "status", "state": "running", "viewers": bus.count,
                        "detail": "joined an episode already in progress",
                    }))
                else:
                    engine.start(loop)
            elif msg.get("type") == "stop":
                # Only the last viewer leaving actually stops the env.
                if bus.count <= 1:
                    engine.stop()
    except WebSocketDisconnect:
        pass
    finally:
        await bus.remove(ws)
        engine.note_viewer()
        if bus.count == 0:
            engine.stop()


@app.on_event("startup")
async def warm():
    """Boot the model and Minecraft client up front so the first click is fast."""
    if os.getenv("EAGER_BOOT", "1") == "1":
        threading.Thread(target=lambda: _safe_load(), daemon=True).start()


def _safe_load():
    with contextlib.suppress(Exception):
        if engine.state == "cold":
            engine._load()


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
