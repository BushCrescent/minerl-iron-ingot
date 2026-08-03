/* ============================================================
   Site config. Edit this file to point the demo at a live backend.
   Loaded as a plain script so it can be swapped at deploy time
   without rebuilding anything.
   ============================================================ */
window.SITE_CONFIG = {
  /* Base URL of the MineRL streaming server (server/demo_server.py).
     Leave null to force replay mode.
     Examples:
       "http://localhost:8000"
       "https://minerl-demo.yourdomain.com"     <- must be https if the site is https */
  DEMO_BACKEND: null,

  /* How long to wait for the backend health check before giving up (ms). */
  PROBE_TIMEOUT: 2500,

  /* Recorded episode used when no backend is reachable.
     Produced by: python server/record_replay.py */
  REPLAY_VIDEO: "assets/replay.mp4",
  REPLAY_META: "assets/replay.json",
};
