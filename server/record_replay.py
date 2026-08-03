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
import pickle
import subprocess
import sys
import tempfile
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

        obs = env.reset()
        agent.reset()

        while True:
            action = agent.get_action(obs)
            action["ESC"] = 0
            obs, reward, done, info = env.step(action)
            pov = obs["pov"]

            if writer is None:
                h, w = pov.shape[:2]
                writer = cv2.VideoWriter(
                    str(tmp / "raw.mp4"), cv2.VideoWriter_fourcc(*"mp4v"),
                    args.out_fps, (w, h),
                )

            # Keep every Nth frame: 20 env-steps/sec ÷ speed = playback rate.
            if info["steps"] % args.speed == 0:
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
                        "step": info["steps"],
                        "t": round(kept / args.out_fps, 2),
                    })
                    cv2.imwrite(str(ASSETS / f"milestone-{KEY_BY_REWARD[bit]}.jpg"),
                                pov[:, :, ::-1], [cv2.IMWRITE_JPEG_QUALITY, 88])
                    print(f"  step {info['steps']:>6}  {REWARD_ITEMS[bit]}")

            if done:
                break

        writer.release()
        success = bool(env.success)
        print(f"  -> {'SUCCESS' if success else 'no ingot'} in {info['steps']} steps")

        if success or attempt == args.max_attempts:
            duration = round(kept / args.out_fps, 2)
            # Re-encode to H.264 so browsers can actually play it.
            out = ASSETS / "replay.mp4"
            try:
                subprocess.run(
                    ["ffmpeg", "-y", "-i", str(tmp / "raw.mp4"),
                     "-c:v", "libx264", "-preset", "slow", "-crf", "26",
                     "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out)],
                    check=True, capture_output=True,
                )
            except (subprocess.CalledProcessError, FileNotFoundError) as exc:
                print(f"  ffmpeg re-encode failed ({exc}); copying the raw mp4 instead")
                out.write_bytes((tmp / "raw.mp4").read_bytes())

            meta = {
                "steps": info["steps"],
                "success": success,
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
    record(p.parse_args())
