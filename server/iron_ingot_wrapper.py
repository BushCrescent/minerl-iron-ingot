"""IronIngotWrapper — terminate the episode the moment an iron ingot appears.

MineRLObtainDiamondShovel-v0 keeps running all the way to a diamond shovel and
pays out a reward bit per new item in the chain. The task here stops at iron, so this
wrapper ends the episode on `iron_ingot > 0` and records the step at which each
reward bit first fired.

Reward bits (identical to REWARD_ITEMS in evaluate.py):
    1 log · 2 planks · 4 stick/crafting_table · 8 wooden_pickaxe
    16 cobblestone · 32 furnace/stone_pickaxe · 64 iron_ore · 128 iron_ingot
"""

import gym

REWARD_ITEMS = {
    1: "log",
    2: "planks",
    4: "stick/crafting_table",
    8: "wooden_pickaxe",
    16: "cobblestone",
    32: "furnace/stone_pickaxe",
    64: "iron_ore",
    128: "iron_ingot",
}

IRON_INGOT_REWARD = 128


class IronIngotWrapper(gym.Wrapper):
    def __init__(self, env, max_steps=18000):
        super().__init__(env)
        self.max_steps = max_steps
        self.reset_state()

    def reset_state(self):
        self.steps = 0
        self.total_reward = 0
        self.max_reward = 0
        self.milestones = []          # (step, reward_bit, item_name)
        self._seen = set()
        self.success = False

    def reset(self, **kwargs):
        self.reset_state()
        return self.env.reset(**kwargs)

    def step(self, action):
        obs, reward, done, info = self.env.step(action)
        self.steps += 1

        if reward > 0:
            bit = int(reward)
            self.total_reward += bit
            self.max_reward = max(self.max_reward, bit)
            if bit not in self._seen:
                self._seen.add(bit)
                self.milestones.append((self.steps, bit, REWARD_ITEMS.get(bit, f"unknown({bit})")))

        # Primary termination: the ingot exists. Fall back to the inventory
        # field when it is exposed, since a dropped reward would otherwise
        # let the episode run to the full budget.
        if self.max_reward >= IRON_INGOT_REWARD or self._has_ingot(obs):
            self.success = True
            done = True

        if self.steps >= self.max_steps:
            done = True

        info = dict(info or {})
        info.update(
            steps=self.steps,
            success=self.success,
            total_reward=self.total_reward,
            milestones=list(self.milestones),
        )
        return obs, reward, done, info

    @staticmethod
    def _has_ingot(obs):
        try:
            return int(obs["inventory"]["iron_ingot"]) > 0
        except (KeyError, TypeError, ValueError):
            return False
