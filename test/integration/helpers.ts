import * as vscode from 'vscode';

export const EXTENSION_ID = 'lldeters.readback-code';

export function extension(): vscode.Extension<unknown> {
  const found = vscode.extensions.getExtension(EXTENSION_ID);
  if (!found) {
    throw new Error(`${EXTENSION_ID} is not installed in the test instance`);
  }
  return found;
}

export function packageVersion(): string {
  return String((extension().packageJSON as { version: unknown }).version);
}

export async function command<T>(id: string, ...args: unknown[]): Promise<T> {
  return vscode.commands.executeCommand<T>(id, ...args);
}

/** Polls until `probe` returns a value, or fails after `timeoutMs`. */
export async function waitFor<T>(
  probe: () => Promise<T | undefined>,
  timeoutMs: number,
  description: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value !== undefined) {
        return value;
      }
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const reason = last instanceof Error ? `: ${last.message}` : '';
  throw new Error(`Timed out waiting for ${description}${reason}`);
}

/** Minimal shapes of the hidden test commands' JSON results. */
export interface Attempt {
  readonly source: string;
  readonly command?: string;
  readonly outcome: { readonly kind: string; readonly reason?: string };
}

export interface Resolution {
  readonly trusted: boolean;
  readonly blockedBySetting: boolean;
  readonly attempts: readonly Attempt[];
  readonly interpreter?: {
    readonly candidate: { readonly source: string; readonly command: string };
    readonly probe: { readonly executable: string; readonly version: readonly number[] };
  };
}

export interface Status {
  readonly state: string;
  readonly trusted: boolean;
  readonly pid?: number;
  readonly pingMs?: number;
  readonly failure?: { readonly kind: string };
  readonly engine?: Record<string, unknown> & {
    readonly engineVersion: string;
    readonly protocolVersion: number;
    readonly sandboxed: boolean;
    readonly vendored: readonly { readonly name: string; readonly version: string }[];
  };
}
