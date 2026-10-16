import { rectsOverlap, segmentHitsRect, type Point, type Rect } from './geometry';
import type { EdgeLayout, GroupLayout, LollipopLayout, NodeLayout } from './layout';

/**
 * Post-processing that lines up rows of related nodes (generalization siblings,
 * `@same-row` sets) after ELK's edge-length compaction has staggered them.
 *
 * A node is only moved along the layer axis, and only if every edge attached to
 * it enters through the leading or trailing side, so moving the endpoint keeps
 * the route orthogonal. Each snap is validated against the same geometric rules
 * the tests enforce and rolled back if it would break any of them. Labels are
 * placed afterwards, so only self-loop labels need to move here.
 */

interface PieceLike {
  nodes: NodeLayout[];
  edges: EdgeLayout[];
  lollipops: LollipopLayout[];
  groups: GroupLayout[];
}

type Axis = 'x' | 'y';
const MIN_SEG = 18; // longest arrowhead (14px diamond) plus a little straight line
const EPS = 0.75;

interface Snapshot {
  nodes: Point[];
  edges: { points: Point[]; labels: Rect[] }[];
  lollipops: string[];
}

function save(p: PieceLike): Snapshot {
  return {
    nodes: p.nodes.map((n) => ({ x: n.x, y: n.y })),
    edges: p.edges.map((e) => ({ points: e.points.map((q) => ({ ...q })), labels: e.labels.map((l) => ({ x: l.x, y: l.y, width: l.width, height: l.height })) })),
    lollipops: p.lollipops.map((l) => JSON.stringify([l.center, l.stub, l.text])),
  };
}

function restore(p: PieceLike, s: Snapshot) {
  p.nodes.forEach((n, i) => { n.x = s.nodes[i].x; n.y = s.nodes[i].y; });
  p.edges.forEach((e, i) => {
    e.points = s.edges[i].points.map((q) => ({ ...q }));
    e.labels.forEach((l, j) => Object.assign(l, s.edges[i].labels[j]));
  });
  p.lollipops.forEach((l, i) => {
    const [c, st, t] = JSON.parse(s.lollipops[i]);
    l.center = c; l.stub = st; l.text = t;
  });
}

const size = (r: Rect, axis: Axis) => (axis === 'y' ? r.height : r.width);
const other = (axis: Axis): Axis => (axis === 'y' ? 'x' : 'y');

/** Moves `node` by `d` along `axis`, dragging edge endpoints with it. Returns the touched edge ends, or null if impossible. */
function moveNode(p: PieceLike, node: NodeLayout, d: number, axis: Axis): { edge: EdgeLayout; end: number }[] | null {
  const o = other(axis);
  const lead = node[axis], trail = node[axis] + size(node, axis);
  const touched: { edge: EdgeLayout; end: number }[] = [];
  for (const e of p.edges) {
    const name = node.def.name;
    if (e.rel.source === name && e.rel.target === name) {
      // Self-loops travel with their node.
      for (const q of e.points) q[axis] += d;
      for (const l of e.labels) l[axis] += d;
      continue;
    }
    const ends: number[] = [];
    if (e.rel.source === name) ends.push(0);
    if (e.rel.target === name) ends.push(e.points.length - 1);
    for (const end of ends) {
      const pt = e.points[end];
      const nb = e.points[end === 0 ? 1 : end - 1];
      const onSide = Math.abs(pt[axis] - lead) < EPS || Math.abs(pt[axis] - trail) < EPS;
      if (!onSide || Math.abs(nb[o] - pt[o]) > EPS) return null;
      pt[axis] += d;
      touched.push({ edge: e, end });
    }
  }
  node[axis] += d;
  for (const l of p.lollipops) {
    if (l.owner !== node.def.name) continue;
    l.center[axis] += d; l.stub[0][axis] += d; l.stub[1][axis] += d; l.text[axis] += d;
  }
  return touched;
}

function valid(p: PieceLike, moved: NodeLayout[], touched: { edge: EdgeLayout; end: number }[], before: Map<EdgeLayout, Point[]>, groupOf: Map<NodeLayout, GroupLayout | undefined>): boolean {
  for (const { edge, end } of touched) {
    const pt = edge.points[end], nb = edge.points[end === 0 ? 1 : end - 1];
    const old = before.get(edge)!;
    const opt = old[end], onb = old[end === 0 ? 1 : end - 1];
    const len = Math.abs(nb.x - pt.x) + Math.abs(nb.y - pt.y);
    if (len < MIN_SEG) return false;
    if (Math.sign(nb.x - pt.x) !== Math.sign(onb.x - opt.x) || Math.sign(nb.y - pt.y) !== Math.sign(onb.y - opt.y)) return false;
  }
  for (const m of moved) {
    for (const n of p.nodes) if (n !== m && rectsOverlap(m, n, 6)) return false;
    const g = groupOf.get(m);
    if (g && (m.x < g.x || m.y < g.y || m.x + m.width > g.x + g.width || m.y + m.height > g.y + g.height)) return false;
  }
  for (const e of p.edges) {
    for (let i = 1; i < e.points.length; i++) {
      for (const n of p.nodes) if (segmentHitsRect(e.points[i - 1], e.points[i], n, 1)) return false;
    }
    for (const l of e.labels) for (const n of p.nodes) if (rectsOverlap(l, n)) return false;
  }
  for (const l of p.lollipops) {
    const r = { x: l.center.x - l.radius, y: l.center.y - l.radius, width: l.text.x + l.text.width - l.center.x + l.radius, height: l.radius * 2 };
    for (const n of p.nodes) if (n.def.name !== l.owner && rectsOverlap(r, n, 2)) return false;
  }
  return true;
}

/** Split nodes into clusters whose spans along the axis overlap (i.e. the same layer). */
function sameLayerClusters(nodes: NodeLayout[], axis: Axis): NodeLayout[][] {
  const sorted = [...nodes].sort((a, b) => a[axis] - b[axis]);
  const out: NodeLayout[][] = [];
  let cur: NodeLayout[] = [], end = -Infinity;
  for (const n of sorted) {
    if (cur.length && n[axis] >= end) { out.push(cur); cur = []; end = -Infinity; }
    cur.push(n);
    end = Math.max(end, n[axis] + size(n, axis));
  }
  if (cur.length) out.push(cur);
  return out;
}

export function alignRows(p: PieceLike, rows: { names: string[]; strict: boolean }[], axis: Axis) {
  const byName = new Map(p.nodes.map((n) => [n.def.name, n]));
  const groupOf = new Map<NodeLayout, GroupLayout | undefined>(
    p.nodes.map((n) => [n, p.groups.find((g) => n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height)]),
  );
  for (const row of rows) {
    const present = row.names.map((n) => byName.get(n)).filter((n): n is NodeLayout => !!n);
    const clusters = row.strict ? [present] : sameLayerClusters(present, axis);
    for (const cluster of clusters) {
      if (cluster.length < 2) continue;
      const positions = [...new Set(cluster.map((n) => n[axis]))];
      if (positions.length < 2) continue;
      // Try each existing position as the shared line, cheapest total movement first.
      const cost = (t: number) => cluster.reduce((s, n) => s + Math.abs(n[axis] - t), 0);
      positions.sort((a, b) => cost(a) - cost(b));
      for (const target of positions) {
        const snap = save(p);
        const before = new Map(p.edges.map((e) => [e, e.points.map((q) => ({ ...q }))]));
        const touched: { edge: EdgeLayout; end: number }[] = [];
        let ok = true;
        const moved: NodeLayout[] = [];
        for (const n of cluster) {
          const d = target - n[axis];
          if (!d) continue;
          const t = moveNode(p, n, d, axis);
          if (!t) { ok = false; break; }
          touched.push(...t);
          moved.push(n);
        }
        if (ok && valid(p, moved, touched, before, groupOf)) break;
        restore(p, snap);
      }
    }
  }
}
