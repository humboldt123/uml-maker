import type { FontSpec, Measurer } from '../src/measure';

/**
 * Node has no canvas, so tests use a fixed per-character advance. The app
 * itself always measures with a real canvas (CanvasMeasurer).
 */
export const stubMeasurer: Measurer = {
  width(text: string, f: FontSpec) {
    return text.length * f.size * (f.bold ? 0.56 : 0.5);
  },
};
