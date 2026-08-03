"""Shared VPT model loading + device selection.

The upstream `default_device_type()` only ever picks CUDA or CPU, so on Apple
Silicon the policy silently lands on the CPU and runs several times slower than
it needs to. This picks MPS when it's there, and lets `VPT_DEVICE` override.
"""

import os
import pickle
from pathlib import Path

import torch as th

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MODEL = ROOT / "data/VPT-models/2x.model"
DEFAULT_WEIGHTS = ROOT / "data/VPT-models/rl-from-early-game-2x.weights"


def pick_device() -> str:
    """cuda > mps > cpu, unless VPT_DEVICE says otherwise."""
    forced = os.getenv("VPT_DEVICE")
    if forced:
        return forced
    if th.cuda.is_available():
        return "cuda"
    if getattr(th.backends, "mps", None) and th.backends.mps.is_available():
        # A few ops in the transformer have no MPS kernel; this lets them run on
        # the CPU instead of raising. Must be set before the first MPS alloc.
        os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
        return "mps"
    return "cpu"


def build_agent(env, model=None, weights=None, device=None):
    """Load the VPT policy. `env` is the raw env, not a wrapper."""
    from openai_vpt.agent import MineRLAgent

    model = Path(model or os.getenv("VPT_MODEL") or DEFAULT_MODEL)
    weights = Path(weights or os.getenv("VPT_WEIGHTS") or DEFAULT_WEIGHTS)
    for f in (model, weights):
        if not f.exists():
            raise FileNotFoundError(
                f"{f} not found.\n"
                "Download the VPT checkpoint into data/VPT-models/ — see README.md."
            )

    device = device or pick_device()
    params = pickle.load(open(model, "rb"))
    policy_kwargs = params["model"]["args"]["net"]["args"]
    pi_head_kwargs = params["model"]["args"]["pi_head_opts"]
    pi_head_kwargs["temperature"] = float(pi_head_kwargs["temperature"])

    agent = MineRLAgent(
        env, device=device, policy_kwargs=policy_kwargs, pi_head_kwargs=pi_head_kwargs
    )
    agent.load_weights(str(weights))
    agent.policy.eval()
    return agent, device
