// Car environment and PPO, ported from app.py. PPO matches the Stable-Baselines3
// defaults the Python app used: MlpPolicy (separate tanh actor/critic nets,
// orthogonal init), n_steps 2048, batch 64, 10 epochs, gamma 0.99, GAE 0.95,
// clip 0.2, vf_coef 0.5, max_grad_norm 0.5, Adam with eps 1e-5.

export const SIZE = 400;
export const OBS_SIZE = 6;
export const N_ACTIONS = 4;
export const CAR_LENGTH = 20;
export const CAR_WIDTH = 10;

const RADAR_ANGLES = [-Math.PI / 3, -Math.PI / 6, 0, Math.PI / 6, Math.PI / 3];

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
export class TrackEnv {
  // track: Uint8Array of width * height, 1 = road
  constructor(track, width, height, rewards) {
    this.track = track;
    this.width = width;
    this.height = height;

    // The car starts at the first road pixel in row order: the topmost point, facing right
    const first = track.indexOf(1);
    this.startX = first >= 0 ? first % width : Math.floor(width / 2);
    this.startY = first >= 0 ? Math.floor(first / width) : Math.floor(height / 2);

    this.centerX = width / 2;
    this.centerY = height / 2;
    this.maxDistance = Math.hypot(this.centerX, this.centerY);

    this.crashPenalty = rewards.crashPenalty;
    this.centerWeight = rewards.centerWeight;
    this.speedWeight = rewards.speedWeight;
    this.revisitPenalty = rewards.revisitPenalty;

    this.visited = new Set();
    this.acceleration = 0.2;
    this.braking = 0.4;
    this.friction = 0.03;
    this.maxSpeed = 5.0;
    this.turnRate = 0.08;
    this.obs = new Float32Array(OBS_SIZE);
  }

  reset() {
    this.x = this.startX;
    this.y = this.startY;
    this.angle = 0;
    this.speed = 0;
    this.visited.clear();
    return this.observe();
  }

  // Five radar distances (to the first off-track pixel, up to 99px) plus speed, all in [0, 1]
  observe() {
    const { track, width, height } = this;
    for (let i = 0; i < 5; i++) {
      const a = this.angle + RADAR_ANGLES[i];
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      let d = 1;
      for (; d < 100; d++) {
        const x = Math.trunc(this.x + dx * d);
        const y = Math.trunc(this.y + dy * d);
        if (x < 0 || x >= width || y < 0 || y >= height || track[y * width + x] === 0) break;
      }
      this.obs[i] = d / 100;
    }
    this.obs[5] = this.speed / this.maxSpeed;
    return this.obs;
  }

  step(action) {
    if (action === 0) this.angle -= this.turnRate;
    else if (action === 1) this.angle += this.turnRate;
    else if (action === 2) this.speed += this.acceleration;
    else if (action === 3) this.speed -= this.braking;

    this.speed -= this.friction;
    this.speed = Math.max(0, Math.min(this.maxSpeed, this.speed));

    this.x += Math.cos(this.angle) * this.speed;
    this.y += Math.sin(this.angle) * this.speed;

    const xi = Math.trunc(this.x);
    const yi = Math.trunc(this.y);
    if (xi < 0 || xi >= this.width || yi < 0 || yi >= this.height
        || this.track[yi * this.width + xi] === 0) {
      return { obs: this.observe(), reward: this.crashPenalty, done: true };
    }

    const distance = Math.hypot(xi - this.centerX, yi - this.centerY);
    let reward = 0.1;
    reward += (1 - distance / this.maxDistance) * this.centerWeight;
    reward += this.speed * this.speedWeight;

    const cell = yi * this.width + xi;
    if (this.visited.has(cell)) reward -= this.revisitPenalty;
    else this.visited.add(cell);

    return { obs: this.observe(), reward, done: false };
  }
}

// ---------------------------------------------------------------------------
// Small MLP over a shared flat parameter buffer
// ---------------------------------------------------------------------------
function gaussian() {
  let u = 0;
  while (u === 0) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

// Same distribution as torch.nn.init.orthogonal_: QR of a Gaussian matrix, sign-fixed
function orthogonal(rows, cols, gain) {
  const transpose = rows < cols;
  const r = transpose ? cols : rows;
  const c = transpose ? rows : cols;
  const q = [];
  for (let j = 0; j < c; j++) {
    const v = new Float64Array(r);
    for (let i = 0; i < r; i++) v[i] = gaussian();
    // Modified Gram-Schmidt keeps diag(R) positive, which is torch's sign convention
    for (const u of q) {
      let dot = 0;
      for (let i = 0; i < r; i++) dot += u[i] * v[i];
      for (let i = 0; i < r; i++) v[i] -= dot * u[i];
    }
    let norm = 0;
    for (let i = 0; i < r; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    for (let i = 0; i < r; i++) v[i] /= norm;
    q.push(v);
  }
  const w = new Float64Array(rows * cols);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      w[i * cols + j] = gain * (transpose ? q[i][j] : q[j][i]);
    }
  }
  return w;
}

class MLP {
  // sizes: [in, ...hidden, out]; tanh on hidden layers, linear output
  constructor(sizes, params, grads, offset) {
    this.sizes = sizes;
    this.layers = [];
    for (let l = 0; l < sizes.length - 1; l++) {
      const nIn = sizes[l];
      const nOut = sizes[l + 1];
      const layer = {
        nIn, nOut,
        W: params.subarray(offset, offset + nIn * nOut),
        gW: grads.subarray(offset, offset + nIn * nOut),
      };
      offset += nIn * nOut;
      layer.b = params.subarray(offset, offset + nOut);
      layer.gb = grads.subarray(offset, offset + nOut);
      offset += nOut;
      this.layers.push(layer);
    }
    this.end = offset;
    this.acts = sizes.map((n) => new Float64Array(n));
    this.deltas = sizes.map((n) => new Float64Array(n));
  }

  static paramCount(sizes) {
    let n = 0;
    for (let l = 0; l < sizes.length - 1; l++) n += sizes[l] * sizes[l + 1] + sizes[l + 1];
    return n;
  }

  init(gains) {
    this.layers.forEach((layer, l) => {
      layer.W.set(orthogonal(layer.nOut, layer.nIn, gains[l]));
      layer.b.fill(0);
    });
  }

  // Returns the output activations (a view reused across calls)
  forward(input) {
    const acts = this.acts;
    for (let i = 0; i < input.length; i++) acts[0][i] = input[i];
    const last = this.layers.length - 1;
    for (let l = 0; l <= last; l++) {
      const { nIn, nOut, W, b } = this.layers[l];
      const a = acts[l];
      const out = acts[l + 1];
      for (let o = 0; o < nOut; o++) {
        let z = b[o];
        const row = o * nIn;
        for (let i = 0; i < nIn; i++) z += W[row + i] * a[i];
        out[o] = l < last ? Math.tanh(z) : z;
      }
    }
    return acts[acts.length - 1];
  }

  // Accumulates parameter gradients for the last forward pass, given d(loss)/d(output)
  backward(dOut) {
    const { acts, deltas, layers } = this;
    let delta = deltas[deltas.length - 1];
    for (let o = 0; o < dOut.length; o++) delta[o] = dOut[o];
    for (let l = layers.length - 1; l >= 0; l--) {
      const { nIn, nOut, W, gW, gb } = layers[l];
      const a = acts[l];
      for (let o = 0; o < nOut; o++) {
        const d = delta[o];
        if (d === 0) continue;
        gb[o] += d;
        const row = o * nIn;
        for (let i = 0; i < nIn; i++) gW[row + i] += d * a[i];
      }
      if (l === 0) break;
      const prev = deltas[l];
      for (let i = 0; i < nIn; i++) {
        let s = 0;
        for (let o = 0; o < nOut; o++) s += W[o * nIn + i] * delta[o];
        prev[i] = s * (1 - a[i] * a[i]);
      }
      delta = prev;
    }
  }
}

// ---------------------------------------------------------------------------
// PPO
// ---------------------------------------------------------------------------
const PPO_DEFAULTS = {
  nSteps: 2048,
  batchSize: 64,
  nEpochs: 10,
  gamma: 0.99,
  gaeLambda: 0.95,
  clipRange: 0.2,
  vfCoef: 0.5,
  maxGradNorm: 0.5,
  adamEps: 1e-5,
};

export class PPO {
  constructor(layers, learningRate, saved = null) {
    Object.assign(this, PPO_DEFAULTS);
    this.layers = layers;
    this.learningRate = learningRate;

    const actorSizes = [OBS_SIZE, ...layers, N_ACTIONS];
    const criticSizes = [OBS_SIZE, ...layers, 1];
    const total = MLP.paramCount(actorSizes) + MLP.paramCount(criticSizes);
    this.params = new Float64Array(total);
    this.grads = new Float64Array(total);
    this.actor = new MLP(actorSizes, this.params, this.grads, 0);
    this.critic = new MLP(criticSizes, this.params, this.grads, this.actor.end);

    this.adamM = new Float64Array(total);
    this.adamV = new Float64Array(total);
    this.adamT = 0;
    this.numTimesteps = 0;

    if (saved) {
      this.params.set(saved.params);
      this.adamM.set(saved.adamM);
      this.adamV.set(saved.adamV);
      this.adamT = saved.adamT;
      this.numTimesteps = saved.numTimesteps;
    } else {
      const hidden = layers.map(() => Math.SQRT2);
      this.actor.init([...hidden, 0.01]);
      this.critic.init([...hidden, 1]);
    }

    this.env = null;
    this.lastObs = new Float32Array(OBS_SIZE);
    this.lastStart = 1;
    this.probs = new Float64Array(N_ACTIONS);
    this.dLogits = new Float64Array(N_ACTIONS);
    this.dValue = new Float64Array(1);
  }

  static fromSaved(saved, learningRate) {
    return new PPO(saved.layers, learningRate, saved);
  }

  save() {
    return {
      layers: this.layers,
      params: Float64Array.from(this.params),
      adamM: Float64Array.from(this.adamM),
      adamV: Float64Array.from(this.adamV),
      adamT: this.adamT,
      numTimesteps: this.numTimesteps,
    };
  }

  setEnv(env) {
    this.env = env;
    this.lastObs.set(env.reset());
    this.lastStart = 1;
  }

  // Softmax of the actor logits into this.probs; returns the log-sum-exp
  policy(obs) {
    const logits = this.actor.forward(obs);
    let max = -Infinity;
    for (let k = 0; k < N_ACTIONS; k++) if (logits[k] > max) max = logits[k];
    let sum = 0;
    for (let k = 0; k < N_ACTIONS; k++) {
      this.probs[k] = Math.exp(logits[k] - max);
      sum += this.probs[k];
    }
    for (let k = 0; k < N_ACTIONS; k++) this.probs[k] /= sum;
    return max + Math.log(sum);
  }

  // Deterministic action: the most likely one
  predict(obs) {
    const logits = this.actor.forward(obs);
    let best = 0;
    for (let k = 1; k < N_ACTIONS; k++) if (logits[k] > logits[best]) best = k;
    return best;
  }

  value(obs) {
    return this.critic.forward(obs)[0];
  }

  // Train until numTimesteps reaches its current value + steps, in whole rollouts
  learn(steps, onRollout) {
    const target = this.numTimesteps + steps;
    while (this.numTimesteps < target) {
      const buffer = this.collectRollout();
      this.train(buffer);
      if (onRollout) onRollout(this.numTimesteps);
    }
  }

  collectRollout() {
    const n = this.nSteps;
    const buf = {
      obs: new Float32Array(n * OBS_SIZE),
      actions: new Int32Array(n),
      rewards: new Float32Array(n),
      starts: new Float32Array(n),
      values: new Float32Array(n),
      logProbs: new Float32Array(n),
      advantages: new Float32Array(n),
      returns: new Float32Array(n),
    };
    const env = this.env;

    for (let t = 0; t < n; t++) {
      const lse = this.policy(this.lastObs);
      const logits = this.actor.acts[this.actor.acts.length - 1];
      let u = Math.random();
      let action = N_ACTIONS - 1;
      for (let k = 0; k < N_ACTIONS; k++) {
        u -= this.probs[k];
        if (u < 0) { action = k; break; }
      }
      buf.logProbs[t] = logits[action] - lse;
      buf.values[t] = this.value(this.lastObs);
      buf.obs.set(this.lastObs, t * OBS_SIZE);
      buf.actions[t] = action;
      buf.starts[t] = this.lastStart;

      const { obs, reward, done } = env.step(action);
      this.numTimesteps++;
      buf.rewards[t] = reward;
      this.lastObs.set(done ? env.reset() : obs);
      this.lastStart = done ? 1 : 0;
    }

    // Generalized advantage estimation, bootstrapping from the value of the next observation
    const lastValue = this.value(this.lastObs);
    let gae = 0;
    for (let t = n - 1; t >= 0; t--) {
      const nextNonTerminal = 1 - (t === n - 1 ? this.lastStart : buf.starts[t + 1]);
      const nextValue = t === n - 1 ? lastValue : buf.values[t + 1];
      const delta = buf.rewards[t] + this.gamma * nextValue * nextNonTerminal - buf.values[t];
      gae = delta + this.gamma * this.gaeLambda * nextNonTerminal * gae;
      buf.advantages[t] = gae;
      buf.returns[t] = gae + buf.values[t];
    }
    return buf;
  }

  train(buf) {
    const n = this.nSteps;
    const order = new Int32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    const obs = new Float32Array(OBS_SIZE);

    for (let epoch = 0; epoch < this.nEpochs; epoch++) {
      // Fisher-Yates shuffle
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
      }

      for (let start = 0; start < n; start += this.batchSize) {
        const end = Math.min(start + this.batchSize, n);
        const size = end - start;

        // Normalize advantages within the minibatch (unbiased std, like torch)
        let mean = 0;
        for (let s = start; s < end; s++) mean += buf.advantages[order[s]];
        mean /= size;
        let variance = 0;
        for (let s = start; s < end; s++) variance += (buf.advantages[order[s]] - mean) ** 2;
        const std = size > 1 ? Math.sqrt(variance / (size - 1)) : 1;

        this.grads.fill(0);
        for (let s = start; s < end; s++) {
          const idx = order[s];
          for (let k = 0; k < OBS_SIZE; k++) obs[k] = buf.obs[idx * OBS_SIZE + k];
          const adv = size > 1 ? (buf.advantages[idx] - mean) / (std + 1e-8) : buf.advantages[idx];
          const action = buf.actions[idx];

          // Clipped surrogate: -mean(min(A * r, A * clip(r))). Gradient flows through r
          // unless the clipped term is strictly smaller.
          const lse = this.policy(obs);
          const logits = this.actor.acts[this.actor.acts.length - 1];
          const ratio = Math.exp(logits[action] - lse - buf.logProbs[idx]);
          const clipped = Math.min(Math.max(ratio, 1 - this.clipRange), 1 + this.clipRange);
          const dRatio = adv * ratio <= adv * clipped ? adv : 0;
          const dLogProb = (-dRatio * ratio) / size;
          for (let k = 0; k < N_ACTIONS; k++) {
            this.dLogits[k] = dLogProb * ((k === action ? 1 : 0) - this.probs[k]);
          }
          this.actor.backward(this.dLogits);

          // Value loss: vf_coef * mean((returns - V)^2)
          const v = this.value(obs);
          this.dValue[0] = (this.vfCoef * 2 * (v - buf.returns[idx])) / size;
          this.critic.backward(this.dValue);
        }

        this.clipGradients();
        this.adamStep();
      }
    }
  }

  clipGradients() {
    let total = 0;
    for (let i = 0; i < this.grads.length; i++) total += this.grads[i] * this.grads[i];
    const coef = this.maxGradNorm / (Math.sqrt(total) + 1e-6);
    if (coef < 1) for (let i = 0; i < this.grads.length; i++) this.grads[i] *= coef;
  }

  adamStep() {
    const beta1 = 0.9;
    const beta2 = 0.999;
    this.adamT++;
    const stepSize = this.learningRate / (1 - beta1 ** this.adamT);
    const bc2Sqrt = Math.sqrt(1 - beta2 ** this.adamT);
    const { params, grads, adamM, adamV, adamEps } = this;
    for (let i = 0; i < params.length; i++) {
      const g = grads[i];
      adamM[i] = beta1 * adamM[i] + (1 - beta1) * g;
      adamV[i] = beta2 * adamV[i] + (1 - beta2) * g * g;
      params[i] -= (stepSize * adamM[i]) / (Math.sqrt(adamV[i]) / bc2Sqrt + adamEps);
    }
  }
}

// Greedy rollout for a checkpoint: total reward, length, and (x, y, angle) per step
export function evaluate(model, env, maxSteps) {
  let obs = env.reset();
  const states = [env.x, env.y, env.angle];
  let score = 0;
  let length = 0;
  for (; length < maxSteps; ) {
    const { obs: next, reward, done } = env.step(model.predict(obs));
    obs = next;
    score += reward;
    length++;
    states.push(env.x, env.y, env.angle);
    if (done) break;
  }
  return { score, length, states: Float32Array.from(states) };
}
