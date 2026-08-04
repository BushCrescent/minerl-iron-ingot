"""Record one episode to web/assets/ so the site's demo works without a backend.

Writes:
    web/assets/replay.mp4   — the agent's POV, H.264, speed-adjustable
    web/assets/replay.json  — milestone timeline the page's HUD reads
    web/assets/milestone-<key>.jpg — one frame per milestone, for the gallery

Usage:
    xvfb-run -a python server/record_replay.py                # first success, 4x speed
    xvfb-run -a python server/record_replay.py --speed 8 --max-attempts 5
"""

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from server.iron_ingot_wrapper import IronIngotWrapper, REWARD_ITEMS  # noqa: E402
from server.vpt_agent import build_agent  # noqa: E402

ASSETS = ROOT / "web" / "assets"

# Must match MILESTONES[].key in web/data.js so the gallery finds the files.
KEY_BY_REWARD = {
    1: "log", 2: "planks", 4: "stick_table", 8: "wooden_pickaxe",
    16: "cobblestone", 32: "stone_furnace", 64: "iron_ore", 128: "iron_ingot",
}
LABEL_BY_REWARD = {
    1: "Log", 2: "Planks", 4: "Stick / Crafting table", 8: "Wooden pickaxe",
    16: "Cobblestone", 32: "Stone pickaxe / Furnace", 64: "Iron ore", 128: "Iron ingot",
}


def find_ffmpeg():
    """System ffmpeg, else the static binary imageio-ffmpeg ships, else None.

    The re-encode is not optional in practice: OpenCV writes MPEG-4 Part 2,
    which most browsers refuse to play. Without H.264 the replay would be a
    dead element on the page.
    """
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def to_h264(src, dst, ffmpeg):
    """Re-encode to browser-playable H.264. Returns True on success."""
    if not ffmpeg:
        return False
    try:
        subprocess.run(
            [ffmpeg, "-y", "-i", str(src),
             "-c:v", "libx264", "-preset", "slow", "-crf", "26",
             "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(dst)],
            check=True, capture_output=True,
        )
        return True
    except subprocess.CalledProcessError as exc:
        print(f"  ffmpeg failed: {exc.stderr.decode()[-500:]}")
        return False


def record(args):
    import gym
    import minerl  # noqa: F401

    ASSETS.mkdir(parents=True, exist_ok=True)
    raw = gym.make("MineRLObtainDiamondShovel-v0")
    env = IronIngotWrapper(raw, max_steps=args.max_steps)
    agent, device = build_agent(raw)
    print(f"policy on {device}")

    for attempt in range(1, args.max_attempts + 1):
        print(f"\n=== attempt {attempt}/{args.max_attempts} ===")
        tmp = Path(tempfile.mkdtemp(prefix="replay-"))
        writer = None
        milestones = []
        kept = 0

        steps_done = 0
        crashed = None
        t0 = time.time()

        # MineRL's Minecraft client can die mid-episode (on Apple Silicon it
        # runs x86 Java 8 under Rosetta and LWJGL occasionally segfaults). Keep
        # whatever was recorded rather than losing the whole run to it.
        try:
            obs = env.reset()
            agent.reset()

            while True:
                action = agent.get_action(obs)
                action["ESC"] = 0
                obs, reward, done, info = env.step(action)
                pov = obs["pov"]
                steps_done = info["steps"]

                if writer is None:
                    h, w = pov.shape[:2]
                    writer = cv2.VideoWriter(
                        str(tmp / "raw.mp4"), cv2.VideoWriter_fourcc(*"mp4v"),
                        args.out_fps, (w, h),
                    )

                # Keep every Nth frame: 20 env-steps/sec ÷ speed = playback rate.
                if steps_done % args.speed == 0:
                    writer.write(pov[:, :, ::-1])
                    kept += 1

                if reward > 0:
                    bit = int(reward)
                    if bit in KEY_BY_REWARD and not any(m["reward"] == bit for m in milestones):
                        milestones.append({
                            "reward": bit,
                            "key": KEY_BY_REWARD[bit],
                            "label": LABEL_BY_REWARD[bit],
                            "item": REWARD_ITEMS[bit],
                            "step": steps_done,
                            "t": round(kept / args.out_fps, 2),
                        })
                        cv2.imwrite(str(ASSETS / f"milestone-{KEY_BY_REWARD[bit]}.jpg"),
                                    pov[:, :, ::-1], [cv2.IMWRITE_JPEG_QUALITY, 88])
                        print(f"  step {steps_done:>6}  {REWARD_ITEMS[bit]}", flush=True)

                if steps_done % 250 == 0:
                    print(f"  step {steps_done:>6}  "
                          f"{steps_done / max(time.time() - t0, 1e-6):.1f} steps/s", flush=True)

                if done:
                    break
        except Exception as exc:                      # noqa: BLE001
            crashed = exc
            print(f"  environment died at step {steps_done}: {type(exc).__name__}: {exc}", flush=True)

        if writer is not None:
            writer.release()
        success = bool(getattr(env, "success", False))
        print(f"  -> {'SUCCESS' if success else 'crashed' if crashed else 'no ingot'} "
              f"at {steps_done} steps, {kept} frames kept", flush=True)

        # A crash with nothing usable recorded: retry rather than finalise.
        if crashed and kept < args.min_frames and attempt < args.max_attempts:
            print("  too little footage to keep — retrying", flush=True)
            continue

        if success or attempt == args.max_attempts:
            duration = round(kept / args.out_fps, 2)
            out = ASSETS / "replay.mp4"
            if not to_h264(tmp / "raw.mp4", out, find_ffmpeg()):
                print("  WARNING: no H.264 re-encode — copying raw MPEG-4, which\n"
                      "  most browsers will not play. Install ffmpeg and re-run,\n"
                      "  or: pip install imageio-ffmpeg")
                out.write_bytes((tmp / "raw.mp4").read_bytes())

            meta = {
                "steps": steps_done,
                "success": success,
                "partial": bool(crashed),
                "speed": args.speed,
                "fps": args.out_fps,
                "duration": duration,
                "milestones": milestones,
            }
            (ASSETS / "replay.json").write_text(json.dumps(meta, indent=2))
            print(f"\nwrote {out} ({duration}s) and {ASSETS / 'replay.json'}")
            # Poster frame for the gallery video element.
            cap = cv2.VideoCapture(str(out))
            cap.set(cv2.CAP_PROP_POS_FRAMES, max(kept // 3, 0))
            ok, frame = cap.read()
            if ok:
                cv2.imwrite(str(ASSETS / "video-poster.jpg"), frame, [cv2.IMWRITE_JPEG_QUALITY, 88])
            cap.release()
            break

    env.close()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--speed", type=int, default=4, help="keep every Nth frame (playback speed-up)")
    p.add_argument("--out-fps", type=int, default=20)
    p.add_argument("--max-steps", type=int, default=18000)
    p.add_argument("--max-attempts", type=int, default=3, help="retry until an episode succeeds")
    p.add_argument("--min-frames", type=int, default=200,
                   help="a crashed run with fewer kept frames than this is retried, not kept")
    record(p.parse_args())
