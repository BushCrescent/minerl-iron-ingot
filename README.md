# Mining Iron from Pixels

An evaluation of OpenAI's **Video Pre-Training (VPT)** agent on the task of obtaining an
**iron ingot** in Minecraft, from a fresh randomly generated world, using nothing but raw
640×360 pixels and a human-equivalent keyboard-and-mouse action space.

**95.6% success rate** across 45 completed episodes, averaging 4,246 steps to the ingot.

> John Park · CS175 Project in Artificial Intelligence

---

## Results

| | |
|---|---|
| Success rate | **95.6%** (43 / 45 completed episodes) |
| Episodes attempted | 50 (5 crashed on MineRL environment errors, excluded) |
| Average steps to ingot | 4,246 of an 18,000 budget |
| Fastest / slowest | 1,592 / 12,413 steps |
| Failure mode | Both failures held iron ore and never completed the smelt |

Average step at which each reward milestone first fires:

| Milestone | Reward bit | Avg. step |
|---|---:|---:|
| Log | 1 | 400 |
| Planks | 2 | 629 |
| Stick / crafting table | 4 | 666 |
| Wooden pickaxe | 8 | 753 |
| Cobblestone | 16 | 1,023 |
| Stone pickaxe / furnace | 32 | 1,238 |
| Iron ore | 64 | 2,685 |
| Iron ingot | 128 | 3,603 |

The two longest legs are stone-tools → iron ore (1,447 steps) and ore → ingot (918).
Everything upstream of smelting is effectively solved at this model scale.

Baselines under the same environment and budget: a random policy never crafts anything
(0%), and a scripted heuristic reaches a log but no further (~5%).

---

## What's in here

**My work:**

| Path | What it does |
|---|---|
| `evaluate.py` | Evaluation harness — runs N episodes, tracks milestone timings, prints the success/failure breakdown |
| `server/iron_ingot_wrapper.py` | `gym.Wrapper` that ends the episode on `iron_ingot > 0` and records the step each reward bit first fired |
| `server/demo_server.py` | Headless MineRL + VPT streaming the agent's POV to a browser over WebSocket |
| `server/record_replay.py` | Records an episode to mp4 + milestone timeline + per-milestone screenshots |
| `web/` | Project website — no build step, no dependencies |
| `baseline.py` | Random-action reference run |

**From the MineRL BASALT 2022 intro-track starter kit** (MIT, © MineRL Labs) —
`openai_vpt/`, `config.py`, `run.py`, `test.py`, `Dockerfile`, `environment.yml`,
`apt.txt`, `aicrowd.json`. The VPT model architecture and weights are OpenAI's.

---

## Setup

Install [MineRL v1.0.0+](https://github.com/minerllabs/minerl) and the
[OpenAI VPT](https://github.com/openai/Video-Pre-Training) requirements, then download the
`rl-from-early-game-2x` checkpoint:

```
data/
└── VPT-models/
    ├── 2x.model
    └── rl-from-early-game-2x.weights
```

- [`2x.model`](https://openaipublic.blob.core.windows.net/minecraft-rl/models/2x.model)
- [`rl-from-early-game-2x.weights`](https://openaipublic.blob.core.windows.net/minecraft-rl/models/rl-from-early-game-2x.weights) (~948 MB)

Weights are gitignored — they're too large to commit without LFS.

## Running the evaluation

```bash
python evaluate.py
```

Adjust `NUM_EPISODES` and `MAX_STEPS` at the top of the file. On a headless machine, wrap
it: `xvfb-run -a python evaluate.py`.

## The website

```bash
python3 -m http.server 8000 --directory web
```

Plain HTML/CSS/ES modules — no npm, no bundler. Every figure reads from `web/data.js`, so
changing a number needs no rebuild. `node web/bundle.js` produces a single-file
`dist/index.html`.

See **[DEPLOY.md](DEPLOY.md)** for hosting, and for the live demo backend — which runs
Minecraft headless under `Xvfb` on a server and streams frames to the browser, since
Minecraft cannot run in a web page.

---

## How VPT works

Three stages, none of which are retrained here — this project evaluates the released
checkpoint:

1. **Inverse Dynamics Model** — trained on 2,000 hours of contractor gameplay with recorded
   keyboard/mouse, learning to infer the action between two frames. Non-causal, so it can
   look ahead, which makes it far cheaper to train than a policy.
2. **Behavioral cloning** — the IDM pseudo-labels 70,000 hours of unlabeled web video; a
   causal transformer is then trained to predict those actions from past frames alone.
3. **RL fine-tuning** — PPO with a reward per new item in the crafting chain, KL-penalised
   against the frozen BC policy. Starting from a competent prior is what makes this
   tractable; random exploration would essentially never see an iron ingot.

At inference: 128×128 resized frames → IMPALA CNN → 4-layer, 16-head transformer with a
256-step attention memory → 24 binary buttons + quantised camera deltas.

---

## License

MIT — see [LICENSE](LICENSE).
(MIT, © 2022 MineRL Labs). VPT model and weights © OpenAI, under their own terms.
