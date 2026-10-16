import { rectsOverlap, segmentHitsRect, type DiagramLayout, type Rect } from './layout';
import { headsFor, STYLE } from './render';

export interface LayoutProblem { kind: string; detail: string }

/** Geometric acceptance checks shared by the unit tests and the browser test. */
export function checkLayout(layout: DiagramLayout): LayoutProblem[] {
  const problems: LayoutProblem[] = [];
  // 1. No edge segment passes through any node rectangle.
  for (const e of layout.edges) {
    for (let i = 1; i < e.points.length; i++) {
      const p = e.points[i - 1], q = e.points[i];
      for (const n of layout.nodes) {
        if (segmentHitsRect(p, q, n, 1)) {
          problems.push({ kind: 'edge-through-node', detail: `${e.rel.source}→${e.rel.target} segment ${i} crosses ${n.def.name}` });
        }
      }
    }
  }
  // 2. Every arrowhead has a straight final segment at least as long as the head itself.
  const headLen = { triangle: STYLE.arrow.triangle, diamond: STYLE.arrow.diamond, open: STYLE.arrow.open, none: 0 };
  for (const e of layout.edges) {
    const n = e.points.length;
    if (n < 2) continue;
    const h = headsFor(e);
    const seg = (a: number, b: number) => Math.abs(e.points[a].x - e.points[b].x) + Math.abs(e.points[a].y - e.points[b].y);
    if (headLen[h.source.kind] && seg(0, 1) < headLen[h.source.kind] + 4) problems.push({ kind: 'short-arrow', detail: `${e.rel.source}→${e.rel.target} source end is ${seg(0, 1)}px` });
    if (headLen[h.target.kind] && seg(n - 1, n - 2) < headLen[h.target.kind] + 4) problems.push({ kind: 'short-arrow', detail: `${e.rel.source}→${e.rel.target} target end is ${seg(n - 1, n - 2)}px` });
  }
  // 3. Nodes don't overlap each other.
  for (let i = 0; i < layout.nodes.length; i++) {
    for (let j = i + 1; j < layout.nodes.length; j++) {
      if (rectsOverlap(layout.nodes[i], layout.nodes[j])) {
        problems.push({ kind: 'node-overlap', detail: `${layout.nodes[i].def.name} / ${layout.nodes[j].def.name}` });
      }
    }
  }
  // 4. Multiplicity labels overlap neither boxes nor other labels.
  const labels = layout.edges.flatMap((e) => e.labels.map((l) => ({ l, e })));
  const mults = labels.filter(({ l }) => l.role !== 'center');
  for (const { l, e } of mults) {
    for (const n of layout.nodes) {
      if (rectsOverlap(l, n)) problems.push({ kind: 'label-on-node', detail: `"${l.text}" of ${e.rel.source}→${e.rel.target} overlaps ${n.def.name}` });
    }
    for (const o of labels) {
      if (o.l !== l && rectsOverlap(l, o.l)) problems.push({ kind: 'label-overlap', detail: `"${l.text}" / "${o.l.text}"` });
    }
  }
  // 5. Centre labels stay off the boxes.
  for (const { l, e } of labels.filter(({ l }) => l.role === 'center')) {
    for (const n of layout.nodes) {
      if (rectsOverlap(l, n)) problems.push({ kind: 'label-on-node', detail: `"${l.text}" of ${e.rel.source}→${e.rel.target} overlaps ${n.def.name}` });
    }
  }
  // 6. Lollipops stay clear of other boxes.
  for (const lol of layout.lollipops) {
    const r: Rect = { x: lol.center.x - lol.radius, y: lol.center.y - lol.radius, width: lol.text.x + lol.text.width - lol.center.x + lol.radius, height: lol.radius * 2 };
    for (const n of layout.nodes) if (rectsOverlap(r, n)) problems.push({ kind: 'lollipop-on-node', detail: `${lol.owner} -() ${lol.name} overlaps ${n.def.name}` });
  }
  return problems;
}
