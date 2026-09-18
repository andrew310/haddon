/** Physics for chat heads: interact.js-style inertia, then a Rebound spring home. */

export type SpringState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

export const CHATHEAD_SPRING = {
  tension: 90,
  friction: 14,
  mass: 1,
};

/** interact.js default inertia.resistance */
export const INERTIA_RESISTANCE = 8;
export const INERTIA_MIN_SPEED = 120;
export const INERTIA_END_SPEED = 40;

export function speed(state: SpringState): number {
  return Math.hypot(state.vx, state.vy);
}

export function stepInertia(
  state: SpringState,
  dt: number,
  resistance = INERTIA_RESISTANCE,
): SpringState {
  const decay = Math.exp(-resistance * dt);
  return {
    x: state.x + state.vx * dt,
    y: state.y + state.vy * dt,
    vx: state.vx * decay,
    vy: state.vy * decay,
  };
}

export function stepSpring(
  state: SpringState,
  target: { x: number; y: number },
  dt: number,
  config = CHATHEAD_SPRING,
): SpringState {
  const ax =
    (-config.tension * (state.x - target.x) - config.friction * state.vx) /
    config.mass;
  const ay =
    (-config.tension * (state.y - target.y) - config.friction * state.vy) /
    config.mass;
  const vx = state.vx + ax * dt;
  const vy = state.vy + ay * dt;
  return {
    x: state.x + vx * dt,
    y: state.y + vy * dt,
    vx,
    vy,
  };
}

export function isSettled(
  state: SpringState,
  target: { x: number; y: number } = { x: 0, y: 0 },
): boolean {
  return (
    Math.abs(state.x - target.x) < 0.5 &&
    Math.abs(state.y - target.y) < 0.5 &&
    Math.abs(state.vx) < 16 &&
    Math.abs(state.vy) < 16
  );
}
