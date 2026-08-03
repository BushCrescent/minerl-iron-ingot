/* ============================================================
   Demo viewport.

   Two sources, one UI:
     LIVE   — WebSocket to server/demo_server.py. A headless MineRL env
              runs on the server; JPEG frames land on the canvas. Every
              viewer watches the same broadcast episode.
     REPLAY — a recorded episode (mp4 + milestone timeline). Same HUD,
              same milestone chain, driven off the video clock.

   The page probes the backend once on load and picks a source. If the
   probe fails, replay takes over silently — the demo never looks broken.
   ============================================================ */

import { MILESTONES } from "./data.js";

const CFG = window.SITE_CONFIG || {};

const $ = (id) => document.getElementById(id);
const ui = {};
let chainEls = [];
let mode = "replay";        // "live" | "replay"
let liveAvailable = false;
let running = false;
let ws = null;
let startedAt = 0;
let tick = null;
let replayMeta = null;
let objectUrl = null;

/* ------------------------------------------------ chain UI */
function buildChain() {
  ui.chain.innerHTML = "";
  chainEls = MILESTONES.map((m, i) => {
    const li = document.createElement("li");
    li.innerHTML =
      `<span class="ci">${i + 1}</span><span class="cl">${m.label}</span><span class="cs"></span>`;
    ui.chain.appendChild(li);
    return li;
  });
}

function resetChain() {
  chainEls.forEach((li) => {
    li.classList.remove("hit", "current");
    li.querySelector(".cs").textContent = "";
  });
  chainEls[0]?.classList.add("current");
  ui.progress.textContent = `0 / ${MILESTONES.length}`;
  ui.step.textContent = "step 0";
  ui.reward.textContent = "reward 0";
  ui.elapsed.textContent = "0:00";
}

function hitMilestone(index, step) {
  const li = chainEls[index];
  if (!li || li.classList.contains("hit")) return;
  li.classList.add("hit");
  li.classList.remove("current");
  li.querySelector(".cs").textContent = step != null ? `@${step.toLocaleString()}` : "";
  chainEls[index + 1]?.classList.add("current");
  const done = chainEls.filter((e) => e.classList.contains("hit")).length;
  ui.progress.textContent = `${done} / ${MILESTONES.length}`;
}

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function startClock() {
  startedAt = performance.now();
  stopClock();
  tick = setInterval(() => {
    ui.elapsed.textContent = clock((performance.now() - startedAt) / 1000);
  }, 500);
}
function stopClock() { if (tick) { clearInterval(tick); tick = null; } }

function setConn(state, text) {
  ui.connDot.dataset.state = state;
  ui.connText.textContent = text;
}

function setRunning(on) {
  running = on;
  ui.viewport.classList.toggle("running", on);
  ui.stopBtn.disabled = !on;
  ui.hud.hidden = !on;
  ui.runLabel.textContent = on ? "Running…" : "Run agent";
  ui.runBtn.disabled = on;
}

/* ------------------------------------------------ backend probe */
async function probeBackend() {
  if (!CFG.DEMO_BACKEND) return false;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), CFG.PROBE_TIMEOUT ?? 2500);
  try {
    const r = await fetch(`${CFG.DEMO_BACKEND.replace(/\/$/, "")}/api/status`, {
      signal: ctrl.signal, cache: "no-store",
    });
    if (!r.ok) return false;
    const j = await r.json();
    return j.ready === true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/* ------------------------------------------------ LIVE */
function wsUrl() {
  const base = CFG.DEMO_BACKEND.replace(/\/$/, "");
  return base.replace(/^http/, "ws") + "/ws/stream";
}

function startLive() {
  const canvas = ui.canvas;
  const ctx = canvas.getContext("2d", { alpha: false });
  ui.viewport.classList.add("is-live");
  ui.viewport.classList.remove("is-replay");
  ui.mode.textContent = "live";

  setConn("live", "Connecting to MineRL server…");
  ws = new WebSocket(wsUrl());
  ws.binaryType = "blob";

  ws.onopen = () => {
    setConn("live", "Live · streaming from a headless MineRL instance");
    ws.send(JSON.stringify({ type: "start" }));
    setRunning(true);
    resetChain();
    startClock();
  };

  ws.onmessage = async (ev) => {
    if (typeof ev.data !== "string") {
      // binary JPEG frame
      const bmp = await createImageBitmap(ev.data);
      if (canvas.width !== bmp.width) { canvas.width = bmp.width; canvas.height = bmp.height; }
      ctx.drawImage(bmp, 0, 0);
      bmp.close?.();
      return;
    }
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }

    switch (msg.type) {
      case "state":
        ui.step.textContent = `step ${msg.step.toLocaleString()}`;
        ui.reward.textContent = `reward ${msg.total_reward}`;
        break;
      case "milestone": {
        const idx = MILESTONES.findIndex((m) => m.reward === msg.reward);
        if (idx >= 0) hitMilestone(idx, msg.step);
        break;
      }
      case "episode_start":
        resetChain();
        startClock();
        setConn("live", `Live · episode ${msg.episode} · ${msg.viewers} watching`);
        break;
      case "episode_end":
        stopClock();
        setConn("live", msg.success
          ? `Iron ingot obtained in ${msg.steps.toLocaleString()} steps.`
          : `Episode ended at ${msg.steps.toLocaleString()} steps without an ingot.`);
        setRunning(false);
        break;
      case "status":
        if (msg.state === "booting") setConn("live", "Booting the Minecraft client (~30s)…");
        break;
      case "error":
        setConn("offline", `Backend error: ${msg.detail}. Falling back to replay.`);
        stopLive();
        startReplay();
        break;
    }
  };

  ws.onerror = () => {};
  ws.onclose = () => {
    stopClock();
    if (running) {
      setConn("offline", "Stream closed. Switched to the recorded episode.");
      setRunning(false);
      mode = "replay";
      startReplay();
    }
  };
}

function stopLive() {
  if (ws) {
    try { ws.send(JSON.stringify({ type: "stop" })); } catch {}
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  stopClock();
}

/* ------------------------------------------------ REPLAY */
async function loadReplayMeta() {
  if (replayMeta !== null) return replayMeta;
  try {
    const r = await fetch(CFG.REPLAY_META, { cache: "no-store" });
    replayMeta = r.ok ? await r.json() : false;
  } catch { replayMeta = false; }
  return replayMeta;
}

async function startReplay() {
  const v = ui.video;
  ui.viewport.classList.add("is-replay");
  ui.viewport.classList.remove("is-live");
  ui.mode.textContent = "replay";

  const meta = await loadReplayMeta();
  if (!v.currentSrc && !v.src) v.src = CFG.REPLAY_VIDEO;

  resetChain();

  const fired = new Set();
  const onTime = () => {
    const t = v.currentTime;
    ui.elapsed.textContent = clock(t);
    if (!meta) return;
    const frac = meta.duration ? Math.min(t / meta.duration, 1) : 0;
    ui.step.textContent = `step ${Math.round(frac * meta.steps).toLocaleString()}`;
    let total = 0;
    for (const m of meta.milestones) {
      if (t >= m.t) {
        total += m.reward;
        if (!fired.has(m.reward)) {
          fired.add(m.reward);
          const idx = MILESTONES.findIndex((x) => x.reward === m.reward);
          if (idx >= 0) hitMilestone(idx, m.step);
        }
      }
    }
    ui.reward.textContent = `reward ${total}`;
  };

  v.removeEventListener("timeupdate", onTime);
  v.addEventListener("timeupdate", onTime);
  v.addEventListener("ended", () => {
    setRunning(false);
    stopClock();
    setConn(liveAvailable ? "live" : "replay", "Episode complete — iron ingot obtained.");
  }, { once: true });

  v.addEventListener("error", () => {
    setRunning(false);
    setConn("offline", "No recorded episode found — see web/assets/README.md.");
    ui.hint.textContent = "Add web/assets/replay.mp4 (or point DEMO_BACKEND at a live server) to enable the demo.";
    ui.viewport.classList.remove("running");
  }, { once: true });

  try {
    await v.play();
    setRunning(true);
    setConn("replay", meta
      ? `Replay · recorded episode, ${meta.steps.toLocaleString()} steps${meta.success ? " → iron ingot" : ""}`
      : "Replay · recorded episode");
  } catch {
    setRunning(false);
  }
}

function stopReplay() {
  ui.video.pause();
  ui.video.currentTime = 0;
}

/* ------------------------------------------------ control */
function run() {
  if (running) return;
  if (mode === "live" && liveAvailable) startLive();
  else startReplay();
}

function stop() {
  if (mode === "live") stopLive();
  stopReplay();
  setRunning(false);
  stopClock();
  setConn(liveAvailable ? "live" : "replay",
    liveAvailable ? "Live backend ready" : "Replay mode · recorded episode");
}

function toggleMode() {
  stop();
  mode = mode === "live" ? "replay" : "live";
  if (mode === "live" && !liveAvailable) mode = "replay";
  ui.modeBtn.textContent = mode === "live" ? "Use replay" : "Use live server";
  ui.mode.textContent = mode;
  setConn(mode === "live" ? "live" : "replay",
    mode === "live" ? "Live backend ready — press Run" : "Replay mode · recorded episode");
}

/* ------------------------------------------------ init */
export async function initDemo() {
  Object.assign(ui, {
    viewport: $("viewport"), canvas: $("frame"), video: $("replay"),
    overlay: $("vp-overlay"), runBtn: $("run-btn"), runLabel: $("run-label"),
    hint: $("vp-hint"), hud: $("vp-hud"), mode: $("hud-mode"),
    step: $("hud-step"), reward: $("hud-reward"),
    connDot: $("conn-dot"), connText: $("conn-text"),
    stopBtn: $("stop-btn"), modeBtn: $("mode-btn"),
    chain: $("chain"), elapsed: $("live-elapsed"), progress: $("live-progress"),
  });
  if (!ui.viewport) return;

  buildChain();
  resetChain();
  ui.viewport.classList.add("is-replay");

  ui.runBtn.addEventListener("click", run);
  ui.stopBtn.addEventListener("click", stop);
  ui.modeBtn.addEventListener("click", toggleMode);

  liveAvailable = await probeBackend();
  if (liveAvailable) {
    mode = "live";
    ui.mode.textContent = "live";
    ui.modeBtn.textContent = "Use replay";
    setConn("live", "Live backend ready — press Run");
    ui.hint.textContent = "A headless MineRL instance runs on the server and streams the agent's point of view here.";
  } else {
    mode = "replay";
    ui.modeBtn.hidden = true;
    setConn("replay", "Replay mode · recorded episode");
    ui.hint.textContent = CFG.DEMO_BACKEND
      ? "Live server unreachable — playing a recorded episode instead."
      : "Plays a recorded episode. Set DEMO_BACKEND in config.js to stream from a live MineRL server.";
  }
}
