import { describe, expect, it } from "vitest";
import {
  INERTIA_END_SPEED,
  isSettled,
  speed,
  stepInertia,
  stepSpring,
} from "./chat-head-spring";

describe("stepInertia", () => {
  it("keeps sliding after a throw and slows down", () => {
    let state = { x: 0, y: 0, vx: 800, vy: 0 };
    const start = speed(state);
    for (let i = 0; i < 20; i++) {
      state = stepInertia(state, 1 / 60);
    }
    expect(state.x).toBeGreaterThan(40);
    expect(speed(state)).toBeLessThan(start);
  });

  it("eventually drops below end speed", () => {
    let state = { x: 0, y: 0, vx: 400, vy: 0 };
    for (let i = 0; i < 120; i++) {
      state = stepInertia(state, 1 / 60);
    }
    expect(speed(state)).toBeLessThan(INERTIA_END_SPEED);
  });
});

describe("stepSpring", () => {
  it("overshoots rest before settling", () => {
    let state = { x: 80, y: 0, vx: 0, vy: 0 };
    let crossed = false;
    for (let i = 0; i < 240; i++) {
      state = stepSpring(state, { x: 0, y: 0 }, 1 / 60);
      if (state.x < 0) crossed = true;
    }
    expect(crossed).toBe(true);
    expect(isSettled(state)).toBe(true);
  });
});
