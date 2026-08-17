import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/preact';

if (!globalThis.PointerEvent) {
  const PointerEventPolyfill = class PointerEvent extends MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? '';
    }
  };
  globalThis.PointerEvent = PointerEventPolyfill;
  if (globalThis.window) {
    globalThis.window.PointerEvent = PointerEventPolyfill;
  }
}

afterEach(() => cleanup());
