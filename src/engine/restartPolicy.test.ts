import { describe, expect, it } from 'vitest';
import { RestartPolicy } from './restartPolicy';

describe('RestartPolicy', () => {
  it('backs off exponentially up to the maximum', () => {
    let now = 0;
    const policy = new RestartPolicy(
      { baseDelayMs: 1000, maxDelayMs: 5000, maxCrashes: 10, windowMs: 60_000 },
      () => now,
    );
    const delays = [1, 2, 3, 4, 5].map(() => {
      now += 10;
      return policy.recordCrash();
    });
    expect(delays).toEqual([1000, 2000, 4000, 5000, 5000]);
  });

  it('stops after too many crashes within the window', () => {
    let now = 0;
    const policy = new RestartPolicy(
      { baseDelayMs: 1, maxDelayMs: 10, maxCrashes: 2, windowMs: 1000 },
      () => now,
    );
    expect(policy.recordCrash()).toBe(1);
    expect(policy.recordCrash()).toBe(2);
    expect(policy.recordCrash()).toBeUndefined();
    // Old crashes leave the window.
    now = 5000;
    expect(policy.recordCrash()).toBe(1);
    expect(policy.recentCrashes).toBe(1);
  });

  it('can be reset', () => {
    const policy = new RestartPolicy({
      baseDelayMs: 1,
      maxDelayMs: 10,
      maxCrashes: 1,
      windowMs: 1e9,
    });
    policy.recordCrash();
    expect(policy.recordCrash()).toBeUndefined();
    policy.reset();
    expect(policy.recordCrash()).toBe(1);
  });
});
