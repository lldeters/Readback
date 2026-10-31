// Turns errors and browser reports into short plain text for messages to the host.

/**
 * Longest text the page sends in a report. The host rejects texts above 2000 UTF-16 code units
 * (src/shared/webviewProtocol.ts); data: URIs and stack traces can be far longer.
 */
export const MAX_REPORTED_LENGTH = 1000;

/** Shortens text to at most `max` code units, marking the cut with an ellipsis. */
export function truncate(text: string, max = MAX_REPORTED_LENGTH): string {
  if (text.length <= max) {
    return text;
  }
  let end = max - 1;
  // Never keep only the first half of a surrogate pair.
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) {
    end -= 1;
  }
  return `${text.slice(0, end)}…`;
}

/** A one-line description of a thrown value. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message === '' ? error.name : `${error.name}: ${error.message}`;
  }
  switch (typeof error) {
    case 'string':
      return error;
    case 'number':
    case 'boolean':
    case 'bigint':
    case 'symbol':
    case 'undefined':
      return String(error);
    default:
      return describeObject(error);
  }
}

function describeObject(value: unknown): string {
  try {
    // Typed as string, but undefined for functions and for objects whose toJSON returns nothing.
    const json: unknown = JSON.stringify(value);
    return typeof json === 'string' ? json : 'Unknown error';
  } catch {
    // Cyclic or otherwise unserializable.
    return 'Unknown error';
  }
}
