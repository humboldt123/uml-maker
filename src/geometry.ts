export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

export function rectsOverlap(a: Rect, b: Rect, pad = 0): boolean {
  return a.x < b.x + b.width + pad && b.x < a.x + a.width + pad && a.y < b.y + b.height + pad && b.y < a.y + a.height + pad;
}

/** True if segment p-q passes through the interior of r (shrunk by `inset`). */
export function segmentHitsRect(p: Point, q: Point, r: Rect, inset = 1): boolean {
  const x0 = r.x + inset, x1 = r.x + r.width - inset, y0 = r.y + inset, y1 = r.y + r.height - inset;
  if (x1 <= x0 || y1 <= y0) return false;
  // Liang–Barsky clip.
  let t0 = 0, t1 = 1;
  const dx = q.x - p.x, dy = q.y - p.y;
  const clip = (pp: number, qq: number) => {
    if (pp === 0) return qq > 0; // parallel: inside iff qq > 0 (strict, so touching the border is not a hit)
    const t = qq / pp;
    if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  if (!clip(-dx, p.x - x0)) return false;
  if (!clip(dx, x1 - p.x)) return false;
  if (!clip(-dy, p.y - y0)) return false;
  if (!clip(dy, y1 - p.y)) return false;
  return t1 - t0 > 1e-6;
}
