// Setup for the webview test project (jsdom). jsdom does no layout, but @xyflow/react measures the
// DOM, so this installs the minimal stand-ins React Flow 12 needs.
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// Sizes reported for elements without an explicit inline width or height (React Flow treats a
// zero-sized container as an error).
const DEFAULT_WIDTH = 120;
const DEFAULT_HEIGHT = 40;

function sizeOf(element: Element): { width: number; height: number } {
  const style = element instanceof HTMLElement ? element.style : undefined;
  return {
    width: Number.parseFloat(style?.width ?? '') || DEFAULT_WIDTH,
    height: Number.parseFloat(style?.height ?? '') || DEFAULT_HEIGHT,
  };
}

function entryFor(target: Element): ResizeObserverEntry {
  const { width, height } = sizeOf(target);
  const box: ResizeObserverSize = { inlineSize: width, blockSize: height };
  return {
    target,
    // @xyflow/system reads contentRect; entries without it make the pan/zoom setup throw.
    contentRect: new DOMRectReadOnly(0, 0, width, height),
    borderBoxSize: [box],
    contentBoxSize: [box],
    devicePixelContentBoxSize: [box],
  };
}

class ResizeObserverStub implements ResizeObserver {
  readonly #callback: ResizeObserverCallback;
  readonly #targets = new Set<Element>();

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }

  observe(target: Element): void {
    this.#targets.add(target);
    // Like the real observer, report the initial size asynchronously.
    setTimeout(() => {
      if (this.#targets.has(target)) {
        this.#callback([entryFor(target)], this);
      }
    }, 0);
  }

  unobserve(target: Element): void {
    this.#targets.delete(target);
  }

  disconnect(): void {
    this.#targets.clear();
  }
}

/** Only m22 (the vertical scale, read as the zoom) is used by React Flow. */
class DOMMatrixReadOnlyStub {
  readonly m22: number;

  constructor(transform?: string) {
    const scale = /scale\(([-\d.]+)/.exec(transform ?? '')?.[1];
    const matrix = /matrix\(([^)]*)\)/.exec(transform ?? '')?.[1]?.split(',');
    this.m22 = Number(scale ?? matrix?.[3] ?? 1) || 1;
  }
}

Object.assign(globalThis, {
  ResizeObserver: ResizeObserverStub,
  DOMMatrixReadOnly: DOMMatrixReadOnlyStub,
});

Object.defineProperties(HTMLElement.prototype, {
  offsetWidth: {
    configurable: true,
    get(this: HTMLElement) {
      return sizeOf(this).width;
    },
  },
  offsetHeight: {
    configurable: true,
    get(this: HTMLElement) {
      return sizeOf(this).height;
    },
  },
});

// Edge labels measure their text with getBBox, which jsdom does not implement.
Object.defineProperty(SVGElement.prototype, 'getBBox', {
  configurable: true,
  value: (): DOMRect => new DOMRect(0, 0, 0, 0),
});
