# Deploying the project site

Two pieces, deployed independently:

| Piece | What it is | Where it runs | Cost |
|---|---|---|---|
| `web/` | Static portfolio site. Zero build step, zero dependencies. | Any static host | Free |
| `server/` | Headless MineRL + VPT streaming the agent's POV over a WebSocket. | A GPU box you keep running | Not free |

The site works completely on its own. The server is what turns the demo's **Run
agent** button from a recorded episode into a live one.

---

## The honest constraint

You asked for the MineRL instance to launch inside the website rather than
opening another window. Here is the shape of what's possible:

**Minecraft cannot run in a browser.** MineRL v1.0 starts a real Java Minecraft
client (MCP-Reborn) that needs a JVM and an OpenGL context. There is no WASM
build, no JS port, and the VPT policy is a 0.5B-parameter transformer that wants
a GPU.

**What you get instead**, which is what `server/demo_server.py` implements: the
Minecraft process runs *on your server*, headless, with `Xvfb` supplying a
virtual display. Each 640×360 frame the agent sees is JPEG-encoded and pushed to
the browser over a WebSocket, where it lands on a `<canvas>` in the page. From
the visitor's point of view this is exactly what you asked for — they click Run,
Minecraft plays inside the page, and nothing opens on their machine. The window
that would have opened now opens on a machine in a datacenter, where nobody
sees it.

The catch is cost and latency: roughly **7 minutes per episode on a T4**, 30+
minutes on CPU, ~4 GB RAM for the environment, and ~30 s of boot time before the
first frame. That is why the site ships in replay mode by default and treats
live as an upgrade.

---

## 1. Deploy the static site

`web/` is plain HTML/CSS/ES modules. No npm, no bundler, no framework.

### AWS Amplify — the live deployment

**https://main.dqfv9j2jsw34b.amplifyapp.com**
(app `minerl-iron-ingot`, id `dqfv9j2jsw34b`, region `us-west-2`)

To push changes:

```bash
./deploy-amplify.sh
```

That zips `web/` and pushes it through Amplify's manual-deployment API — no Git
connection and no build step, since the site is static. Takes about 20 seconds.
Override the target with `AMPLIFY_APP_ID`, `AMPLIFY_BRANCH` or
`AWS_DEFAULT_REGION` if the app is ever recreated.

**Deploy on `git push` instead?** Connect the repo in the Amplify console
(*Hosting → Connect branch*) and authorize the GitHub App. The repo is private,
so that authorization is required — it can't be done from the CLI without
handing AWS a GitHub token, which is why the manual flow above is wired up
instead. Leave build settings empty; set the output directory to `web`.

**Custom domain:** Amplify console → *Domain management*. Free managed
certificate; needs a `CNAME` or a Route 53 alias.

### GitHub Pages

Note the repo is currently **private**, and Pages on a private repo requires a
paid plan. Make it public first, then **Settings → Pages → Build and
deployment**: source `Deploy from a branch`, branch `main`, folder `/web`. It
appears at `https://<user>.github.io/<repo>/`.

Nothing in the page uses absolute paths, so serving from a subdirectory works
without changes.

### Netlify / Vercel / Cloudflare Pages

Point the project at this repo and set:

- **Build command:** *(leave empty)*
- **Publish directory:** `web`

### Anywhere else

```bash
python3 -m http.server 8000 --directory web
```

It must be served over HTTP, not opened as a `file://` URL — ES modules are
blocked on `file://`.

---

## 2. Give the demo something to play

Without media the Run button shows a "no recorded episode" message. Record one:

```bash
# needs the VPT weights in data/VPT-models/ and a machine that can run MineRL
xvfb-run -a python server/record_replay.py --speed 4
```

That writes `web/assets/replay.mp4`, `web/assets/replay.json`, one
`milestone-*.jpg` per stage for the gallery, and a poster frame. It retries
until an episode actually reaches the ingot (`--max-attempts`, default 3).

`web/assets/*.mp4` is gitignored by default since the files are large — drop the
ignore lines from `.gitignore` if you want them committed, and use Git LFS for
anything over 100 MB.

See `web/assets/README.md` for the exact filenames and the `replay.json` schema
if you'd rather supply your own video.

---

## 3. Getting the agent actually running

A recorded `replay.mp4` is **not** the only option — it's just the one that needs
no infrastructure. Four ways to do this, cheapest first.

### A. Run it on your own machine (free, works today)

This Mac already runs MineRL — `logs/mc_2123.log` shows a Minecraft client
booting a 640×360 `MineRLObtainDiamondShovel-v0` world. Java 8 and MineRL are
installed. The only missing piece is the checkpoint:

```bash
mkdir -p data/VPT-models && cd data/VPT-models
curl -LO https://openaipublic.blob.core.windows.net/minecraft-rl/models/2x.model
curl -LO https://openaipublic.blob.core.windows.net/minecraft-rl/models/rl-from-early-game-2x.weights
cd ../..

./server/run_local.sh
```

Then set `DEMO_BACKEND: "http://localhost:8000"` in `web/config.js`, serve the
site locally, and the viewport streams a live episode.

The policy runs on **MPS** (the Apple GPU) — `server/vpt_agent.py` picks it,
because upstream VPT only ever checks for CUDA and would otherwise drop you onto
the CPU at a fraction of the speed. `/api/status` reports the observed
`steps_per_sec` so you can see what you're getting.

A Minecraft window *will* open on your machine — that's the server rendering,
and it's unavoidable outside a Linux container with `Xvfb`. The website never
sees it; the browser only receives streamed frames. Minimise it.

### B. Your machine, but publicly reachable (free)

The catch with A is that `localhost` only works for you. A tunnel fixes that
without renting anything:

```bash
brew install cloudflared
./server/run_local.sh --tunnel
```

`cloudflared` prints an `https://….trycloudflare.com` URL. Put it in
`web/config.js` as `DEMO_BACKEND`, redeploy, and the public Amplify site streams
live from your Mac. HTTPS is what makes this work — the browser needs `wss://`,
which it won't upgrade to from an insecure origin.

When your laptop is closed the probe fails and the site falls back to the
recorded replay on its own. So the demo is live when you're around to show it
and still works when you're not. For a portfolio this is usually the right
answer.

(A quick-tunnel URL changes on each restart. A named Cloudflare tunnel on a
domain you own gives you a stable one.)

### C. A hosted GPU (always live, costs money)

For a demo that's live whether or not your laptop is on. Use `server/Dockerfile`
on anything with a persistent GPU — RunPod, Lambda Labs, Modal, a GPU EC2
instance. Roughly $0.20–0.50/hr for a T4, or scale-to-zero on a serverless GPU
platform at the cost of a ~2 minute cold start before the first frame.

Details in section 4 below.

### D. Several replays instead of one

Cheapest way to stop the demo feeling canned: record 3–5 episodes and pick one
at random per visit. Different seed, different biome, different route to the
ingot each time. `record_replay.py` writes one at a time; keeping them as
`replay-1.mp4`, `replay-2.mp4` … and choosing in `config.js` is a small change.

### Be realistic about episode length

The ingot lands around step 3,600 on average. Even at 15 steps/s that's four
minutes of watching, and most visitors won't wait. Two things help:

- The opening minutes are the most legible part anyway — tree-chopping, the
  crafting GUI, the first pickaxe. That's what sells it.
- Set `MAX_STEPS` lower for a demo, or lead with the replay (which can be
  sped up 4×) and offer live as the "watch it think in real time" option.

Live mode is the flex. The replay is the substance. Ship both.

---

## 4. Running the live backend on a server

### Build and run

```bash
# from the REPO ROOT — the image needs openai_vpt/ and data/
docker build -f server/Dockerfile -t minerl-demo .
docker run --gpus all -p 8000:8000 minerl-demo
```

Weights are ~950 MB. To keep them out of the image, mount instead:

```bash
docker run --gpus all -p 8000:8000 \
  -v "$PWD/data/VPT-models:/home/aicrowd/data/VPT-models:ro" \
  minerl-demo
```

Without Docker, on a machine that already runs `evaluate.py`:

```bash
pip install -r server/requirements.txt
xvfb-run -a python server/demo_server.py
```

Check it: `curl http://localhost:8000/api/status` → `{"ready": true, ...}`.

### Point the site at it

Edit `web/config.js`:

```js
window.SITE_CONFIG = {
  DEMO_BACKEND: "https://minerl-demo.yourdomain.com",
  // ...
};
```

The page probes `/api/status` on load. Reachable → live mode, and the viewport
streams. Unreachable, erroring, or the socket drops mid-episode → it falls back
to the recorded replay without the visitor seeing a broken page.

**If your site is HTTPS, the backend must be too.** Browsers block a `wss://`
upgrade from an insecure origin, and the probe will silently fail. Put the
server behind Caddy or nginx with a certificate; both proxy WebSockets fine.
Caddy is one line:

```
minerl-demo.yourdomain.com {
    reverse_proxy localhost:8000
}
```

### Where to host it

Anything with a persistent GPU and no request timeout. Fly.io GPU machines,
Lambda Labs, RunPod, a Hetzner/EC2 GPU instance, or a box under your desk with
a tunnel. **Not** Vercel, Netlify, Cloud Run, or Lambda — serverless platforms
cap request duration and can't hold a WebSocket open for a 7-minute episode.

### Tuning

All environment variables:

| Var | Default | Notes |
|---|---|---|
| `PORT` | `8000` | |
| `SEND_EVERY` | `2` | Transmit every Nth frame. Raise to cut bandwidth. |
| `JPEG_QUALITY` | `72` | |
| `STREAM_WIDTH` | `640` | Lower to `480` to roughly halve bandwidth. |
| `MAX_STEPS` | `18000` | Lower for a demo that always ends in a few minutes. |
| `IDLE_TIMEOUT` | `120` | Seconds with no viewers before the episode stops. |
| `ALLOW_ORIGINS` | `*` | Set to your site's origin in production. |
| `EAGER_BOOT` | `1` | Boot Minecraft at startup so the first click is fast. |

At the defaults one viewer costs roughly 300–400 KB/s.

### Concurrency

One environment, broadcast to every viewer — everyone watches the same episode,
and a visitor who clicks Run mid-episode joins the stream in progress. This is
deliberate: a Minecraft instance per visitor would need several GB of RAM each
and fall over on the second concurrent click. If you want genuinely independent
sessions you'd need a pool of environments and a queue, which is a much bigger
piece of infrastructure than a portfolio demo warrants.

---

## Recommended setup

For a portfolio the pragmatic answer is **static site + recorded replay**, with
the live backend spun up only when you want to show it off:

- It costs nothing and never breaks.
- A recruiter opening the page in six months still sees the agent play.
- `config.js` is one line to flip when you do have a server running, and the
  page handles the switch on its own.

---

## Editing the content

| What | Where |
|---|---|
| All numbers, milestones, distributions | `web/data.js` — every figure and chart reads from here |
| Copy, sections, team | `web/index.html` |
| Colors, spacing, theme | the token block at the top of `web/styles.css` |
| Chart rendering | `web/charts.js` |
| Demo viewport behaviour | `web/demo.js` |
| Backend URL | `web/config.js` |

The charts are hand-rolled SVG with no dependencies, so changing a number in
`data.js` is enough — nothing needs rebuilding.
