import logging
import pickle

import gym
import minerl

from openai_vpt.agent import MineRLAgent

logging.basicConfig(level=logging.INFO)

MINERL_GYM_ENV = 'MineRLObtainDiamondShovel-v0'
MODEL = 'data/VPT-models/2x.model'
WEIGHTS = 'data/VPT-models/rl-from-early-game-2x.weights'
NUM_EPISODES = 20
MAX_STEPS = 18000

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


def main():
    env = gym.make(MINERL_GYM_ENV)

    agent_parameters = pickle.load(open(MODEL, "rb"))
    policy_kwargs = agent_parameters["model"]["args"]["net"]["args"]
    pi_head_kwargs = agent_parameters["model"]["args"]["pi_head_opts"]
    pi_head_kwargs["temperature"] = float(pi_head_kwargs["temperature"])
    agent = MineRLAgent(env, policy_kwargs=policy_kwargs, pi_head_kwargs=pi_head_kwargs)
    agent.load_weights(WEIGHTS)

    results = []

    for i in range(NUM_EPISODES):
        obs = env.reset()
        agent.reset()

        max_reward = 0
        total_reward = 0
        rewards_collected = []
        steps_taken = 0
        got_iron_ingot = False

        for step in range(MAX_STEPS):
            minerl_action = agent.get_action(obs)
            obs, reward, done, info = env.step(minerl_action)

            if reward > 0:
                total_reward += reward
                max_reward = max(max_reward, reward)
                rewards_collected.append((step, reward, REWARD_ITEMS.get(int(reward), f"unknown({reward})")))
                print(f"  Episode {i} Step {step}: reward {reward} ({REWARD_ITEMS.get(int(reward), '?')})")

                if reward >= 128:
                    got_iron_ingot = True

            steps_taken = step + 1

            if done:
                break

        # Determine where the agent got stuck
        if max_reward >= 128:
            stuck_at = "SUCCESS"
        elif max_reward >= 64:
            stuck_at = "Had iron ore, failed to smelt"
        elif max_reward >= 32:
            stuck_at = "Had stone tools, failed to find/mine iron"
        elif max_reward >= 16:
            stuck_at = "Had cobblestone, failed to craft stone tools"
        elif max_reward >= 8:
            stuck_at = "Had wooden pickaxe, failed to mine stone"
        elif max_reward >= 4:
            stuck_at = "Crafted basics, failed to make pickaxe"
        elif max_reward >= 1:
            stuck_at = "Chopped wood but failed to craft"
        else:
            stuck_at = "Never even got wood"

        result = {
            "episode": i,
            "success": got_iron_ingot,
            "max_reward": max_reward,
            "total_reward": total_reward,
            "steps": steps_taken,
            "stuck_at": stuck_at,
            "milestones": rewards_collected,
        }
        results.append(result)
        print(f"[Episode {i}] max_reward={max_reward}, steps={steps_taken}, stuck_at={stuck_at}\n")

    # --- SUMMARY ---
    print("\n" + "=" * 60)
    print("EVALUATION SUMMARY")
    print("=" * 60)

    successes = sum(1 for r in results if r["success"])
    print(f"\nSuccess rate: {successes}/{NUM_EPISODES} ({100*successes/NUM_EPISODES:.1f}%)")
    print(f"Average max reward: {sum(r['max_reward'] for r in results)/NUM_EPISODES:.1f}")
    print(f"Average steps (successful): {sum(r['steps'] for r in results if r['success'])/max(successes,1):.0f}")

    # Failure analysis
    print("\nFailure breakdown:")
    from collections import Counter
    failure_counts = Counter(r["stuck_at"] for r in results if not r["success"])
    for reason, count in failure_counts.most_common():
        print(f"  {reason}: {count}/{NUM_EPISODES - successes}")

    # Per-episode summary
    print("\nPer-episode results:")
    print(f"{'Ep':>3} {'Success':>8} {'MaxRew':>7} {'Steps':>6}  Stuck at")
    print("-" * 60)
    for r in results:
        print(f"{r['episode']:>3} {'YES' if r['success'] else 'no':>8} {r['max_reward']:>7} {r['steps']:>6}  {r['stuck_at']}")

    env.close()


if __name__ == "__main__":
    main()