export interface RestartPolicyOptions {
  /** Delay before the first automatic restart; doubles with every further crash. */
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  /** More crashes than this within windowMs count as a crash loop: stop restarting. */
  readonly maxCrashes: number;
  readonly windowMs: number;
}

export const DEFAULT_RESTART_POLICY: RestartPolicyOptions = {
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  maxCrashes: 5,
  windowMs: 3 * 60_000,
};

/** Decides how long to wait before restarting a crashed engine, and when to give up. */
export class RestartPolicy {
  private crashes: number[] = [];

  constructor(
    private readonly options: RestartPolicyOptions = DEFAULT_RESTART_POLICY,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a crash. Returns the restart delay, or undefined when the engine is crash-looping. */
  recordCrash(): number | undefined {
    const time = this.now();
    this.crashes = this.crashes.filter((crash) => time - crash < this.options.windowMs);
    this.crashes.push(time);
    if (this.crashes.length > this.options.maxCrashes) {
      return undefined;
    }
    const delay = this.options.baseDelayMs * 2 ** (this.crashes.length - 1);
    return Math.min(this.options.maxDelayMs, delay);
  }

  /** Forget earlier crashes, e.g. after the user restarted the engine explicitly. */
  reset(): void {
    this.crashes = [];
  }

  get recentCrashes(): number {
    return this.crashes.length;
  }
}
