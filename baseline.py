import gym
import minerl

env = gym.make('MineRLObtainDiamondShovel-v0')
obs = env.reset()

done = False
step = 0

while not done and step < 2000:
    action = env.action_space.sample()
    action["ESC"] = 0
    obs, reward, done, info = env.step(action)
    env.render()
    
    if reward > 0:
        print(f"Step {step}: Got reward {reward}")
    step += 1

env.close()