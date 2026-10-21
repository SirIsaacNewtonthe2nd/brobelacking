// Runs training off the main thread and reports each checkpoint back to the page.
import { SIZE, TrackEnv, PPO, evaluate } from "./rl.js";

const CHUNK_SIZE = 5000;
const MAX_EVAL_STEPS = 2000;

self.onmessage = ({ data }) => {
  try {
    run(data);
  } catch (err) {
    self.postMessage({ type: "error", message: String(err && err.message || err) });
  }
};

function run({ track, rewards, totalSteps, learningRate, layers, saved }) {
  const model = saved ? PPO.fromSaved(saved, learningRate) : new PPO(layers, learningRate);
  model.setEnv(new TrackEnv(track, SIZE, SIZE, rewards));
  const evalEnv = new TrackEnv(track, SIZE, SIZE, rewards);

  const startSteps = model.numTimesteps;
  let currentSteps = 0;
  let bestScore = -Infinity;

  while (currentSteps < totalSteps) {
    currentSteps = Math.min(currentSteps + CHUNK_SIZE, totalSteps);
    // PPO trains in whole rollouts and can run past a checkpoint,
    // so only ask for the steps still missing to reach this one
    const remaining = startSteps + currentSteps - model.numTimesteps;
    if (remaining > 0) {
      model.learn(remaining, (n) => {
        self.postMessage({ type: "progress", steps: Math.min(n - startSteps, totalSteps) });
      });
    }

    const result = evaluate(model, evalEnv, MAX_EVAL_STEPS);
    const newBest = result.score > bestScore;
    if (newBest) bestScore = result.score;

    self.postMessage({
      type: "checkpoint",
      steps: currentSteps,
      score: result.score,
      best: bestScore,
      length: result.length,
      // Only a new best needs its replay and weights sent over
      states: newBest ? result.states : null,
      model: newBest ? model.save() : null,
    });
  }
  self.postMessage({ type: "done", best: bestScore });
}
