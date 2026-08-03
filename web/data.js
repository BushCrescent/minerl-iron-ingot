/* Evaluation results — single source of truth for every figure on the page.
   Numbers come from the 50-episode run of evaluate.py (5 episodes crashed on
   MineRL env errors and are excluded from the rate). */

export const RESULTS = {
  episodesAttempted: 50,
  episodesCompleted: 45,
  episodesCrashed: 5,
  successes: 43,
  failures: 2,
  successRate: 95.6,
  avgSteps: 4246,
  fastestSteps: 1592,
  slowestSteps: 12413,
  maxSteps: 18000,
};

/* Average step at which each reward milestone first fires.
   Reward bit values match REWARD_ITEMS in evaluate.py. */
export const MILESTONES = [
  { reward: 1,   key: "log",            label: "Log",                   short: "Log",     steps: 400 },
  { reward: 2,   key: "planks",         label: "Planks",                short: "Planks",  steps: 629 },
  { reward: 4,   key: "stick_table",    label: "Stick / Crafting table", short: "Stick",   steps: 666 },
  { reward: 8,   key: "wooden_pickaxe", label: "Wooden pickaxe",        short: "Wood pick", steps: 753 },
  { reward: 16,  key: "cobblestone",    label: "Cobblestone",           short: "Cobble",  steps: 1023 },
  { reward: 32,  key: "stone_furnace",  label: "Stone pickaxe / Furnace", short: "Stone pick", steps: 1238 },
  { reward: 64,  key: "iron_ore",       label: "Iron ore",              short: "Iron ore", steps: 2685 },
  { reward: 128, key: "iron_ingot",     label: "Iron ingot",            short: "Ingot",   steps: 3603 },
];

/* Steps-to-ingot distribution across the 43 successful episodes. */
export const DISTRIBUTION = [
  { label: "< 2,500",        short: "<2.5k",  sub: "steps", count: 18 },
  { label: "2,500 – 5,000",  short: "2.5–5k", sub: "steps", count: 14 },
  { label: "5,000 – 10,000", short: "5–10k",  sub: "steps", count: 8 },
  { label: "> 10,000",       short: ">10k",   sub: "steps", count: 3 },
];

export const BASELINES = [
  { label: "VPT (rl-from-early-game-2x)", short: "VPT agent", rate: 95.6, note: "reaches iron ingot" },
  { label: "Scripted heuristic",          short: "Heuristic", rate: 5.0,  note: "reaches log only" },
  { label: "Random policy",               short: "Random",    rate: 0.0,  note: "never crafts" },
];

/* One cell per completed episode, in run order. `false` = stalled before the
   ingot. Both failures held iron ore but never smelted it. */
export const EPISODE_GRID = Array.from({ length: 45 }, (_, i) => i !== 12 && i !== 31);

export const FAILURE_MODES = [
  { label: "Reached iron ingot", count: 43, ok: true },
  { label: "Had iron ore, failed to smelt", count: 2, ok: false },
];
