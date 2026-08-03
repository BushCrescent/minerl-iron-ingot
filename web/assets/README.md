# Site assets

Every file here is optional — the page degrades to labelled placeholders if
something is missing, so it never looks broken while you're still gathering
media. Drop files in with these exact names and they appear automatically.

## Demo viewport (the "Run agent" button)

| File | What it is |
|---|---|
| `replay.mp4` | Recorded episode, H.264. Played when no live backend is configured. |
| `replay.json` | Milestone timeline that drives the HUD and the milestone chain. |

Generate both in one shot:

```bash
xvfb-run -a python server/record_replay.py --speed 4
```

`replay.json` looks like this — you can hand-write it if you already have a video:

```json
{
  "steps": 4102,
  "success": true,
  "speed": 4,
  "fps": 20,
  "duration": 51.3,
  "milestones": [
    { "reward": 1, "key": "log", "label": "Log", "step": 412, "t": 5.15 },
    { "reward": 128, "key": "iron_ingot", "label": "Iron ingot", "step": 4102, "t": 51.3 }
  ]
}
```

`t` is the timestamp in the video (seconds); `step` is the environment step it
corresponds to.

## Gallery screenshots

One frame per milestone. `record_replay.py` writes these automatically, or pull
them out of your report. `.jpg`, `.png` and `.webp` all work — the page tries
each in that order.

```
milestone-log.jpg
milestone-planks.jpg
milestone-stick_table.jpg
milestone-wooden_pickaxe.jpg
milestone-cobblestone.jpg
milestone-stone_furnace.jpg
milestone-iron_ore.jpg
milestone-iron_ingot.jpg
```

## Full demo video

| File | What it is |
|---|---|
| `demo.mp4` | The long-form video for the gallery section. |
| `video-poster.jpg` | Poster frame shown before playback. |

Keep `demo.mp4` under ~25 MB if you're serving from GitHub Pages, and note that
files over 100 MB need Git LFS.
