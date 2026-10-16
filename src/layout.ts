import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkLabel, ElkNode, LayoutOptions } from 'elkjs/lib/elk-api';
import type { ClassDef, Diagram, Direction, RelKind, Relationship, Spacing } from './model';
import { FONTS, METRICS, measureClass, type BoxGeometry, type Measurer } from './measure';
import { rectsOverlap, segmentHitsRect, type Point, type Rect } from './geometry';
import { alignRows } from './align';

export { rectsOverlap, segmentHitsRect };
export type { Point, Rect };

export interface NodeLayout extends Rect {
  def: ClassDef;
  box: BoxGeometry;
}

export interface LabelLayout extends Rect {
  text: string;
  role: 'center' | 'source' | 'target';
}

export interface EdgeLayout {
  rel: Relationship;
  /** Polyline from the written source to the written target. */
  points: Point[];
  labels: LabelLayout[];
}

export interface LollipopLayout {
  owner: string;
  name: string;
  /** Stub from the class border up to the circle. */
  stub: [Point, Point];
  center: Point;
  radius: number;
  text: Rect;
}

export interface GroupLayout extends Rect { name: string }

export interface DiagramLayout {
  width: number;
  height: number;
  direction: Direction;
  nodes: NodeLayout[];
  edges: EdgeLayout[];
  lollipops: LollipopLayout[];
  groups: GroupLayout[];
  frames: boolean;
}

export const LOLLIPOP = { radius: 7, stub: 10, gap: 4, row: 18 };
const MARGIN = 16;
const GROUP_LABEL_H = 18;
const FRAME_PAD = { top: GROUP_LABEL_H + 8, side: 12 };

// `edgeLayer` is the gap between a horizontal edge channel and the boxes it feeds. It must
// exceed the largest arrowhead (14px diamond) so every head has a straight run into its box.
const SPACING: Record<Spacing, { node: number; layer: number; edgeNode: number; edgeLayer: number; edgeEdge: number; component: number; split: number }> = {
  compact: { node: 30, layer: 50, edgeNode: 12, edgeLayer: 20, edgeEdge: 10, component: 30, split: 900 },
  normal: { node: 45, layer: 70, edgeNode: 16, edgeLayer: 24, edgeEdge: 12, component: 45, split: 1000 },
  loose: { node: 70, layer: 100, edgeNode: 22, edgeLayer: 30, edgeEdge: 16, component: 70, split: 1150 },
};

const GENERALIZATION: RelKind[] = ['inheritance', 'realization'];
export const isGeneralization = (r: Relationship) => GENERALIZATION.includes(r.kind);

let elk: InstanceType<typeof ELK> | null = null;
function getElk() {
  return (elk ??= new ELK());
}

/* ------------------------------------------------------------------ */

interface Prepared {
  diagram: Diagram;
  boxes: Map<string, BoxGeometry>;
  lollipopsByOwner: Map<string, { name: string; textW: number }[]>;
  labelSizes: Map<Relationship, { center?: [number, number]; source?: [number, number]; target?: [number, number] }>;
}

function labelSize(text: string, m: Measurer): [number, number] {
  return [Math.ceil(m.width(text, FONTS.label) + METRICS.labelPadX * 2), METRICS.labelLine];
}

function prepare(diagram: Diagram, m: Measurer): Prepared {
  const boxes = new Map<string, BoxGeometry>();
  for (const c of diagram.classes) boxes.set(c.name, measureClass(c, m));
  const lollipopsByOwner = new Map<string, { name: string; textW: number }[]>();
  const labelSizes: Prepared['labelSizes'] = new Map();
  for (const r of diagram.relationships) {
    if (r.kind === 'lollipop') {
      const list = lollipopsByOwner.get(r.source) ?? [];
      list.push({ name: r.target, textW: Math.ceil(m.width(r.target, { ...FONTS.label, italic: true })) });
      lollipopsByOwner.set(r.source, list);
      continue;
    }
    labelSizes.set(r, {
      center: r.label ? labelSize(r.label, m) : undefined,
      source: r.sourceMult ? labelSize(r.sourceMult, m) : undefined,
      target: r.targetMult ? labelSize(r.targetMult, m) : undefined,
    });
  }
  return { diagram, boxes, lollipopsByOwner, labelSizes };
}

/** Space for the lollipops: one row each, stub + circle + name, off the right side of the header. */
function lollipopBlock(items: { textW: number }[]) {
  const width = LOLLIPOP.stub + LOLLIPOP.radius * 2 + LOLLIPOP.gap + Math.max(...items.map((it) => it.textW)) + 2;
  return { width, height: items.length * LOLLIPOP.row };
}

/** Connected components over classes, where a group glues its members together. */
function components(diagram: Diagram): string[][] {
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    let p = parent.get(a) ?? a;
    if (p !== a) { p = find(p); parent.set(a, p); }
    return p;
  };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
  for (const c of diagram.classes) parent.set(c.name, c.name);
  for (const r of diagram.relationships) if (r.kind !== 'lollipop') union(r.source, r.target);
  for (const g of diagram.groups) for (const n of g.members.slice(1)) union(g.members[0], n);
  for (const row of diagram.sameRows) for (const n of row.slice(1)) if (parent.has(n) && parent.has(row[0])) union(row[0], n);
  const byRoot = new Map<string, string[]>();
  for (const c of diagram.classes) {
    const r = find(c.name);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r)!.push(c.name);
  }
  return [...byRoot.values()];
}

function baseOptions(direction: Direction, spacing: Spacing): LayoutOptions {
  const s = SPACING[spacing];
  return {
    'elk.algorithm': 'layered',
    'elk.direction': direction === 'down' ? 'DOWN' : 'RIGHT',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    'elk.spacing.nodeNode': String(s.node),
    'elk.layered.spacing.nodeNodeBetweenLayers': String(s.layer),
    'elk.spacing.edgeNode': String(s.edgeNode),
    'elk.layered.spacing.edgeNodeBetweenLayers': String(s.edgeLayer),
    'elk.spacing.edgeEdge': String(s.edgeEdge),
    'elk.layered.spacing.edgeEdgeBetweenLayers': String(s.edgeEdge),
    'elk.spacing.edgeLabel': '4',
    'elk.spacing.labelNode': '4',
    'elk.spacing.portPort': '10',
    'elk.layered.mergeEdges': 'false',
  };
}

interface ComponentResult {
  graph: ElkNode;
  /** Set when the component is exactly one group laid out flat; its frame is drawn around the result. */
  soleGroup?: string;
  /** ELK edge id -> relationship, and whether the ELK edge is reversed from the written one. */
  edgeInfo: Map<string, { rel: Relationship; reversed: boolean }>;
}

async function layoutComponent(
  prep: Prepared, names: string[], direction: Direction, layerChoice: Map<string, number>,
): Promise<ComponentResult> {
  const { diagram, boxes } = prep;
  const set = new Set(names);
  const spacing = diagram.spacing;
  const opts = baseOptions(direction, spacing);
  const portSide = direction === 'down' ? 'SOUTH' : 'EAST';

  // Parents of generalization edges get one shared port, so the children render as a tree.
  const genParents = new Set<string>();
  for (const r of diagram.relationships) if (isGeneralization(r) && set.has(r.target) && r.source !== r.target) genParents.add(r.target);

  const makeNode = (name: string): ElkNode => {
    const box = boxes.get(name)!;
    const node: ElkNode = { id: name, width: box.width, height: box.height, layoutOptions: {} };
    if (genParents.has(name)) {
      node.layoutOptions!['elk.portConstraints'] = 'FIXED_SIDE';
      node.ports = [{ id: `${name}::gen`, width: 0, height: 0, layoutOptions: { 'elk.port.side': portSide } }];
    }
    const lol = prep.lollipopsByOwner.get(name);
    if (lol) {
      const b = lollipopBlock(lol);
      node.labels = [{
        id: `${name}::lol`, text: '', width: b.width, height: b.height,
        layoutOptions: { 'elk.nodeLabels.placement': 'OUTSIDE V_TOP H_RIGHT H_PRIORITY' },
      }];
    }
    if (layerChoice.has(name)) node.layoutOptions!['elk.layered.layering.layerChoiceConstraint'] = String(layerChoice.get(name));
    return node;
  };

  const groupOf = new Map<string, string>();
  for (const g of diagram.groups) for (const n of g.members) groupOf.set(n, g.name);
  const groupPad = diagram.frames
    ? `[top=${GROUP_LABEL_H + 8},left=12,bottom=12,right=12]`
    : '[top=6,left=6,bottom=6,right=6]';

  // A component that is a single group (or has no groups) is laid out flat; ELK's model-order
  // handling crashes inside compound nodes, so hierarchy is used only when groups must be nested.
  const groupsIn = new Set(names.map((n) => groupOf.get(n)).filter((g): g is string => !!g));
  const flat = groupsIn.size === 0 || (groupsIn.size === 1 && names.every((n) => groupOf.has(n)));
  const soleGroup = flat && groupsIn.size === 1 ? [...groupsIn][0] : undefined;

  // Keep source order: walk classes in order, emitting each group when its first member appears.
  const children: ElkNode[] = [];
  const groupNodes = new Map<string, ElkNode>();
  for (const c of diagram.classes) {
    if (!set.has(c.name)) continue;
    const g = flat ? undefined : groupOf.get(c.name);
    if (!g) { children.push(makeNode(c.name)); continue; }
    let gn = groupNodes.get(g);
    if (!gn) {
      gn = { id: `group::${g}`, children: [], layoutOptions: { ...opts, 'elk.padding': groupPad } };
      groupNodes.set(g, gn);
      children.push(gn);
    }
    gn.children!.push(makeNode(c.name));
  }

  // Generalization ancestry, so other edges can be oriented to agree with it.
  const supers = new Map<string, string[]>();
  for (const r of diagram.relationships) {
    if (isGeneralization(r) && r.source !== r.target) supers.set(r.source, [...(supers.get(r.source) ?? []), r.target]);
  }
  const isAncestor = (anc: string, of: string) => {
    const seen = new Set<string>();
    const stack = [...(supers.get(of) ?? [])];
    while (stack.length) {
      const x = stack.pop()!;
      if (x === anc) return true;
      if (seen.has(x)) continue;
      seen.add(x);
      stack.push(...(supers.get(x) ?? []));
    }
    return false;
  };

  const edges: ElkExtendedEdge[] = [];
  const edgeInfo = new Map<string, { rel: Relationship; reversed: boolean }>();
  diagram.relationships.forEach((r, i) => {
    if (r.kind === 'lollipop' || !set.has(r.source)) return;
    const id = `e${i}`;
    const sizes = prep.labelSizes.get(r)!;
    const gen = isGeneralization(r) && r.source !== r.target;
    // Generalizations are reversed so the parent lands in the upper layer. Any other edge
    // pointing from a class to one of its own ancestors (Decorator, Composite) is reversed
    // too, so it doesn't fight the inheritance edge during cycle breaking.
    const rev = gen || (r.source !== r.target && isAncestor(r.target, r.source));
    const src = gen ? `${r.target}::gen` : rev ? r.target : r.source;
    const tgt = rev ? r.source : r.target;
    const labels: ElkLabel[] = [];
    const tail = rev ? sizes.target : sizes.source;
    const head = rev ? sizes.source : sizes.target;
    // Centre labels are placed after layout (placeCenterLabels): as ELK labels they get a dummy
    // layer of their own, which pushes the target a whole layer further away.
    if (tail) labels.push({ id: `${id}::t`, text: '', width: tail[0], height: tail[1], layoutOptions: { 'elk.edgeLabels.placement': 'TAIL' } });
    if (head) labels.push({ id: `${id}::h`, text: '', width: head[0], height: head[1], layoutOptions: { 'elk.edgeLabels.placement': 'HEAD' } });
    edges.push({ id, sources: [src], targets: [tgt], labels });
    edgeInfo.set(id, { rel: r, reversed: rev });
  });

  // Very wide inheritance fans wrap onto a second tier, like a hand-drawn tree: siblings named
  // in an @same-row stay on the first tier. Invisible edges from the tier above push them down.
  const splitW = SPACING[spacing].split;
  const childrenOf = new Map<string, string[]>();
  for (const r of diagram.relationships) {
    if (!isGeneralization(r) || r.source === r.target || !set.has(r.source)) continue;
    const list = childrenOf.get(r.target) ?? [];
    if (!list.includes(r.source)) list.push(r.source);
    childrenOf.set(r.target, list);
  }
  let inv = 0;
  const along = (name: string) => (direction === 'down' ? boxes.get(name)!.width : boxes.get(name)!.height);
  for (const kids of childrenOf.values()) {
    const total = kids.reduce((s, k) => s + along(k), 0) + SPACING[spacing].node * (kids.length - 1);
    if (kids.length < 4 || total <= splitW) continue;
    const tiers = Math.min(Math.ceil(total / splitW), Math.floor(kids.length / 2));
    const pinned = kids.filter((k) => diagram.sameRows.some((row) => row.includes(k) && row.filter((x) => kids.includes(x)).length > 1));
    const per = Math.max(pinned.length, Math.ceil(kids.length / tiers));
    const order = [...pinned, ...kids.filter((k) => !pinned.includes(k))];
    const rows: string[][] = [];
    for (let i = 0; i < order.length; i += per) rows.push(order.slice(i, i + per));
    for (let t = 1; t < rows.length; t++) {
      const above = rows[t - 1];
      rows[t].forEach((k, j) => {
        // Anchor under the matching position of the tier above, spread across it.
        const anchor = above[Math.min(above.length - 1, Math.round(((j + 0.5) * above.length) / rows[t].length - 0.5))];
        edges.push({ id: `inv${inv++}`, sources: [anchor], targets: [k] });
      });
    }
  }

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      ...opts,
      'elk.hierarchyHandling': flat ? 'SEPARATE_CHILDREN' : 'INCLUDE_CHILDREN',
      'elk.json.edgeCoords': 'ROOT',
      'elk.json.shapeCoords': 'ROOT',
      'elk.padding': '[top=0,left=0,bottom=0,right=0]',
    },
    children,
    edges,
  };
  let out: ElkNode;
  try {
    out = await getElk().layout(structuredClone(graph));
  } catch (err) {
    if (flat) throw err;
    const relax = (n: ElkNode) => {
      if (n.layoutOptions?.['elk.layered.considerModelOrder.strategy']) n.layoutOptions['elk.layered.considerModelOrder.strategy'] = 'PREFER_EDGES';
      n.children?.forEach(relax);
    };
    relax(graph);
    out = await getElk().layout(graph);
  }
  return { graph: out, edgeInfo, soleGroup };
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                     */

function bounds(rects: Rect[]): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.width); y1 = Math.max(y1, r.y + r.height);
  }
  return isFinite(x0) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : { x: 0, y: 0, width: 0, height: 0 };
}

function simplify(points: Point[]): Point[] {
  // ELK sometimes leaves sub-pixel jitter between consecutive points; snap it so every
  // segment is exactly horizontal or vertical. Endpoints stay put (they sit on box borders).
  points = points.map((p) => ({ ...p }));
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const fix = i === points.length - 1 ? a : b;
    const ref = fix === a ? b : a;
    if (Math.abs(a.x - b.x) < 1.5 && a.x !== b.x) fix.x = ref.x;
    if (Math.abs(a.y - b.y) < 1.5 && a.y !== b.y) fix.y = ref.y;
  }
  const out: Point[] = [];
  for (const p of points) {
    const q = { x: Math.round(p.x * 2) / 2, y: Math.round(p.y * 2) / 2 };
    const last = out[out.length - 1];
    if (last && last.x === q.x && last.y === q.y) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      if ((a.x === last.x && last.x === q.x) || (a.y === last.y && last.y === q.y)) out.pop();
    }
    out.push(q);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Assembly                                                             */

interface Piece {
  nodes: NodeLayout[];
  edges: EdgeLayout[];
  lollipops: LollipopLayout[];
  groups: GroupLayout[];
  /** ELK-proposed rects for end labels, used as a fallback. */
  bbox: Rect;
}

function collectPiece(prep: Prepared, res: ComponentResult, direction: Direction): Piece {
  const nodes: NodeLayout[] = [];
  const groups: GroupLayout[] = [];
  const lollipops: LollipopLayout[] = [];
  const defs = new Map(prep.diagram.classes.map((c) => [c.name, c]));
  const walk = (n: ElkNode) => {
    for (const c of n.children ?? []) {
      if (c.id.startsWith('group::')) {
        groups.push({ name: c.id.slice(7), x: c.x!, y: c.y!, width: c.width!, height: c.height! });
        walk(c);
        continue;
      }
      const def = defs.get(c.id)!;
      nodes.push({ def, box: prep.boxes.get(c.id)!, x: c.x!, y: c.y!, width: c.width!, height: c.height! });
      const lol = prep.lollipopsByOwner.get(c.id);
      const lab = c.labels?.[0];
      if (lol && lab) {
        // A short horizontal stub from the right side of the header, in the space ELK reserved
        // there; several lollipops stack downwards.
        const right = c.x! + c.width!;
        const box = prep.boxes.get(c.id)!;
        lol.forEach((it, i) => {
          const cy = c.y! + Math.min(box.headerHeight / 2, 14) + i * LOLLIPOP.row;
          const cx = right + LOLLIPOP.stub + LOLLIPOP.radius;
          lollipops.push({
            owner: c.id, name: it.name, radius: LOLLIPOP.radius,
            center: { x: cx, y: cy },
            stub: [{ x: right, y: cy }, { x: cx - LOLLIPOP.radius, y: cy }],
            text: { x: cx + LOLLIPOP.radius + LOLLIPOP.gap, y: cy - METRICS.labelLine / 2, width: it.textW, height: METRICS.labelLine },
          });
        });
      }
    }
  };
  walk(res.graph);

  const edges: EdgeLayout[] = [];
  for (const e of (res.graph.edges ?? []) as ElkExtendedEdge[]) {
    const info = res.edgeInfo.get(e.id);
    if (!info) continue; // invisible tiering edge
    let pts: Point[] = [];
    for (const s of e.sections ?? []) {
      pts.push(s.startPoint, ...(s.bendPoints ?? []), s.endPoint);
    }
    pts = simplify(pts);
    if (info.reversed) pts.reverse();
    edges.push({ rel: info.rel, points: pts, labels: [] });
  }

  alignRows({ nodes, edges, lollipops, groups }, rowsToAlign(prep.diagram), direction === 'down' ? 'y' : 'x');
  widenSelfLoops(nodes, edges);
  placeCenterLabels({ nodes, edges, lollipops }, prep.labelSizes);
  placeEndLabels({ nodes, edges, lollipops }, prep.labelSizes);
  const all: Rect[] = [...nodes, ...groups, ...lollipops.map((l) => ({
    x: l.center.x - l.radius, y: l.center.y - l.radius, width: l.text.x + l.text.width - (l.center.x - l.radius), height: l.radius * 2,
  }))];
  for (const e of edges) for (const p of e.points) all.push({ x: p.x, y: p.y, width: 0, height: 0 });
  for (const e of edges) all.push(...e.labels);
  if (res.soleGroup) {
    const b = bounds(all);
    const pad = prep.diagram.frames ? FRAME_PAD : { top: 6, side: 6 };
    const frame = { name: res.soleGroup, x: b.x - pad.side, y: b.y - pad.top, width: b.width + pad.side * 2, height: b.height + pad.top + pad.side };
    groups.push(frame);
    all.push(frame);
  }
  return { nodes, edges, lollipops, groups, bbox: bounds(all) };
}

const SELF_LOOP_REACH = 22;

/**
 * ELK draws self-loops hugging the box (about 10px out), which leaves no room for an
 * arrowhead. Push the loop's outer leg out to SELF_LOOP_REACH when nothing is in the way.
 */
function widenSelfLoops(nodes: NodeLayout[], edges: EdgeLayout[]) {
  for (const e of edges) {
    if (e.rel.source !== e.rel.target || e.points.length < 4) continue;
    const n = nodes.find((x) => x.def.name === e.rel.source);
    if (!n) continue;
    const p0 = e.points[0];
    const inner = e.points.slice(1, -1);
    const sides = [
      { on: Math.abs(p0.x - n.x) < 1, axis: 'x' as const, outer: Math.min(...inner.map((q) => q.x)), dir: -1, edge: n.x },
      { on: Math.abs(p0.x - n.x - n.width) < 1, axis: 'x' as const, outer: Math.max(...inner.map((q) => q.x)), dir: 1, edge: n.x + n.width },
      { on: Math.abs(p0.y - n.y) < 1, axis: 'y' as const, outer: Math.min(...inner.map((q) => q.y)), dir: -1, edge: n.y },
      { on: Math.abs(p0.y - n.y - n.height) < 1, axis: 'y' as const, outer: Math.max(...inner.map((q) => q.y)), dir: 1, edge: n.y + n.height },
    ];
    const side = sides.find((sd) => sd.on);
    if (!side) continue;
    const reach = Math.abs(side.outer - side.edge);
    if (reach >= SELF_LOOP_REACH) continue;
    const shift = (SELF_LOOP_REACH - reach) * side.dir;
    const before = e.points.map((q) => ({ ...q }));
    for (const q of inner) if (Math.abs(q[side.axis] - side.outer) < 1) q[side.axis] += shift;
    const blocked = e.points.some((q, i) => i > 0 && nodes.some((o) => segmentHitsRect(e.points[i - 1], q, o, 1)));
    if (blocked) e.points = before;
  }
}

/** `@same-row` sets (strict) followed by the children of each generalization parent. */
function rowsToAlign(diagram: Diagram): { names: string[]; strict: boolean }[] {
  const rows = diagram.sameRows.map((names) => ({ names, strict: true }));
  const children = new Map<string, string[]>();
  for (const r of diagram.relationships) {
    if (!isGeneralization(r) || r.source === r.target) continue;
    children.set(r.target, [...(children.get(r.target) ?? []), r.source]);
  }
  for (const names of children.values()) if (names.length > 1) rows.push({ names, strict: false });
  return rows;
}

function translatePiece(p: Piece, dx: number, dy: number) {
  const mv = <T extends Point>(o: T) => { o.x += dx; o.y += dy; };
  p.nodes.forEach(mv); p.groups.forEach(mv);
  for (const e of p.edges) { e.points.forEach(mv); e.labels.forEach(mv); }
  for (const l of p.lollipops) { mv(l.center); mv(l.stub[0]); mv(l.stub[1]); mv(l.text); }
  mv(p.bbox);
}

/** Skyline bottom-left packing of component boxes into a strip of the given width. */
function skylinePack(sizes: { w: number; h: number }[], stripW: number): { x: number; y: number }[] {
  let sky: { x: number; w: number; y: number }[] = [{ x: 0, w: stripW, y: 0 }];
  return sizes.map(({ w, h }) => {
    let best = { x: 0, y: Infinity };
    for (let i = 0; i < sky.length; i++) {
      const x = sky[i].x;
      if (x + w > stripW + 1e-6 && x !== 0) continue;
      let y = 0;
      for (const s of sky) if (s.x < x + w && s.x + s.w > x) y = Math.max(y, s.y);
      if (y < best.y || (y === best.y && x < best.x)) best = { x, y };
    }
    const top = best.y + h;
    const nx = best.x, nw = w;
    const next: typeof sky = [];
    for (const s of sky) {
      if (s.x + s.w <= nx || s.x >= nx + nw) { next.push(s); continue; }
      if (s.x < nx) next.push({ x: s.x, w: nx - s.x, y: s.y });
      if (s.x + s.w > nx + nw) next.push({ x: nx + nw, w: s.x + s.w - nx - nw, y: s.y });
    }
    next.push({ x: nx, w: nw, y: top });
    next.sort((a, b) => a.x - b.x);
    // Merge equal-height neighbours.
    sky = next.reduce<typeof sky>((acc, s) => {
      const last = acc[acc.length - 1];
      if (last && last.y === s.y && Math.abs(last.x + last.w - s.x) < 1e-6) last.w += s.w;
      else acc.push({ ...s });
      return acc;
    }, []);
    return best;
  });
}

const TARGET_ASPECT = 4 / 3;

function packScore(w: number, h: number): number {
  return w * h * (1 + 1.5 * Math.abs(Math.log((w / h) / TARGET_ASPECT)));
}

function packPieces(pieces: Piece[], gap: number) {
  if (pieces.length === 1) { const p = pieces[0]; translatePiece(p, -p.bbox.x, -p.bbox.y); return; }
  const sizes = pieces.map((p) => ({ w: p.bbox.width + gap, h: p.bbox.height + gap }));
  const area = sizes.reduce((s, x) => s + x.w * x.h, 0);
  const maxW = Math.max(...sizes.map((s) => s.w));
  const orders: number[][] = [
    sizes.map((_, i) => i),
    sizes.map((_, i) => i).sort((a, b) => sizes[b].h - sizes[a].h || a - b),
  ];
  let best: { score: number; order: number[]; pos: { x: number; y: number }[] } | null = null;
  for (const order of orders) {
    const ordered = order.map((i) => sizes[i]);
    for (let k = 0.5; k <= 2.0; k += 0.05) {
      const W = Math.max(maxW, Math.sqrt(area * TARGET_ASPECT) * k);
      const pos = skylinePack(ordered, W);
      let w = 0, h = 0;
      pos.forEach((p, j) => { w = Math.max(w, p.x + ordered[j].w); h = Math.max(h, p.y + ordered[j].h); });
      const score = packScore(w - gap, h - gap);
      if (!best || score < best.score - 1e-6) best = { score, order, pos };
    }
  }
  best!.order.forEach((pi, j) => {
    const p = pieces[pi];
    translatePiece(p, best!.pos[j].x - p.bbox.x, best!.pos[j].y - p.bbox.y);
  });
}

/* ------------------------------------------------------------------ */
/* Centre label placement                                               */

/** Centres each edge label on its edge, on the longest stretch that is clear of boxes and other labels. */
function placeCenterLabels(layout: Pick<DiagramLayout, 'nodes' | 'edges' | 'lollipops'>, sizes: Prepared['labelSizes']) {
  const obstacles: Rect[] = [...layout.nodes, ...layout.lollipops.map((l) => l.text)];
  const placed: Rect[] = [];
  const segments: { p: Point; q: Point; e: EdgeLayout }[] = [];
  for (const e of layout.edges) for (let i = 1; i < e.points.length; i++) segments.push({ p: e.points[i - 1], q: e.points[i], e });
  // Keep the first stretch next to each box free for the multiplicity that goes there.
  const reserved: Rect[] = [];
  for (const e of layout.edges) {
    const sz = sizes.get(e.rel);
    if (!sz || e.points.length < 2) continue;
    const n = e.points.length;
    for (const [mult, p, q] of [[sz.source, e.points[0], e.points[1]], [sz.target, e.points[n - 1], e.points[n - 2]]] as const) {
      if (!mult) continue;
      const dx = Math.sign(q.x - p.x), dy = Math.sign(q.y - p.y);
      const reach = (dy ? mult[1] : mult[0]) + 4;
      const x0 = Math.min(p.x, p.x + dx * reach), y0 = Math.min(p.y, p.y + dy * reach);
      reserved.push({ x: dy ? p.x - 2 : x0, y: dx ? p.y - 2 : y0, width: dy ? 4 : reach, height: dx ? 4 : reach });
    }
  }

  for (const e of layout.edges) {
    const sz = sizes.get(e.rel)?.center;
    if (!sz || !e.rel.label || e.points.length < 2) continue;
    const [w, h] = sz;
    const pts = e.points;
    const lens = pts.slice(1).map((p, i) => Math.abs(p.x - pts[i].x) + Math.abs(p.y - pts[i].y));
    const total = lens.reduce((a, b) => a + b, 0);
    let best: Rect | null = null, bestCost = Infinity, acc = 0;
    for (let i = 0; i < lens.length; i++) {
      const p = pts[i], q = pts[i + 1];
      const vertical = p.x === q.x;
      const extent = vertical ? h : w;
      for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        const c = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
        // Centred on the line first; beside it only when the segment is too short to show around it.
        const offsets: [number, number, number][] = vertical
          ? [[0, 0, 0], [w / 2 + 4, 0, 300], [-w / 2 - 4, 0, 300]]
          : [[0, 0, 0], [0, -h / 2 - 3, 300], [0, h / 2 + 3, 300]];
        for (const [ox, oy, penalty] of offsets) {
        const r: Rect = { x: c.x + ox - w / 2, y: c.y + oy - h / 2, width: w, height: h };
        const room = penalty ? Infinity : lens[i] - extent; // how much of the segment stays visible
        let cost = penalty + Math.abs(acc + lens[i] * t - total / 2) / 20 + Math.abs(t - 0.5) * 10;
        if (room < 8) cost += 400;
        if (obstacles.some((o) => rectsOverlap(r, o, 2)) || placed.some((o) => rectsOverlap(r, o, 2))) cost += 1000;
        if (reserved.some((o) => rectsOverlap(r, o, 1))) cost += 500;
        for (const s of segments) if (s.e !== e && segmentHitsRect(s.p, s.q, r, 0)) cost += 60;
        if (cost < bestCost) { bestCost = cost; best = r; }
        }
      }
      acc += lens[i];
    }
    if (!best) continue;
    const label: LabelLayout = { ...(best as Rect), text: e.rel.label, role: 'center' };
    e.labels.push(label);
    placed.push(label);
  }
}

/* ------------------------------------------------------------------ */
/* Multiplicity placement                                               */

function placeEndLabels(layout: Pick<DiagramLayout, 'nodes' | 'edges' | 'lollipops'>, sizes: Prepared['labelSizes']) {
  const obstacles: Rect[] = [
    ...layout.nodes,
    ...layout.lollipops.map((l) => ({ x: l.center.x - l.radius, y: l.center.y - l.radius, width: l.radius * 2, height: l.radius * 2 })),
    ...layout.lollipops.map((l) => l.text),
  ];
  const placed: Rect[] = layout.edges.flatMap((e) => e.labels);
  const segments: [Point, Point][] = [];
  for (const e of layout.edges) for (let i = 1; i < e.points.length; i++) segments.push([e.points[i - 1], e.points[i]]);

  const crossings = (r: Rect) => segments.reduce((n, [p, q]) => n + (segmentHitsRect(p, q, r, 0.5) ? 1 : 0), 0);

  for (const e of layout.edges) {
    const sz = sizes.get(e.rel);
    if (!sz || e.points.length < 2) continue;
    const ends: { role: 'source' | 'target'; text?: string; size?: [number, number]; p: Point; q: Point }[] = [
      { role: 'source', text: e.rel.sourceMult, size: sz.source, p: e.points[0], q: e.points[1] },
      { role: 'target', text: e.rel.targetMult, size: sz.target, p: e.points[e.points.length - 1], q: e.points[e.points.length - 2] },
    ];
    for (const end of ends) {
      if (!end.text || !end.size) continue;
      const [w, h] = end.size;
      const dx = Math.sign(end.q.x - end.p.x), dy = Math.sign(end.q.y - end.p.y);
      const segLen = Math.abs(end.q.x - end.p.x) + Math.abs(end.q.y - end.p.y);
      const along0 = 2;
      const candidates: Rect[] = [];
      // Nearest to the box and the line first; then further along the edge, then further sideways.
      for (const side of [3, 12, 24, 40]) {
        for (let along = along0; along <= Math.max(along0, Math.min(segLen - 4, 30)); along += 6) {
          if (dy !== 0) {
            const y = dy > 0 ? end.p.y + along : end.p.y - along - h;
            candidates.push({ x: end.p.x + side, y, width: w, height: h });
            candidates.push({ x: end.p.x - side - w, y, width: w, height: h });
          } else {
            const x = dx > 0 ? end.p.x + along : end.p.x - along - w;
            candidates.push({ x, y: end.p.y - side - h, width: w, height: h });
            candidates.push({ x, y: end.p.y + side, width: w, height: h });
          }
        }
      }
      let best: Rect | null = null, bestCost = Infinity;
      candidates.forEach((c, i) => {
        const hard = obstacles.some((o) => rectsOverlap(c, o, 1)) || placed.some((o) => rectsOverlap(c, o, 1));
        const cost = (hard ? 1000 : 0) + crossings(c) * 50 + i;
        if (cost < bestCost) { bestCost = cost; best = c; }
      });
      const r = best ?? candidates[0];
      const label: LabelLayout = { ...r, text: end.text, role: end.role };
      e.labels.push(label);
      placed.push(label);
    }
  }
}

/* ------------------------------------------------------------------ */

async function layoutOnce(prep: Prepared, direction: Direction, layerChoice: Map<string, number>): Promise<{ layout: DiagramLayout; pieces: Piece[] }> {
  const comps = components(prep.diagram);
  const results = await Promise.all(comps.map((c) => layoutComponent(prep, c, direction, layerChoice)));
  const pieces = results.map((r) => collectPiece(prep, r, direction));
  packPieces(pieces, SPACING[prep.diagram.spacing].component);

  const layout: DiagramLayout = {
    width: 0, height: 0, direction, frames: prep.diagram.frames,
    nodes: pieces.flatMap((p) => p.nodes),
    edges: pieces.flatMap((p) => p.edges),
    lollipops: pieces.flatMap((p) => p.lollipops),
    groups: pieces.flatMap((p) => p.groups),
  };
  // Keep the diagram's own class order for stable output.
  const order = new Map(prep.diagram.classes.map((c, i) => [c.name, i]));
  layout.nodes.sort((a, b) => order.get(a.def.name)! - order.get(b.def.name)!);
  const relOrder = new Map(prep.diagram.relationships.map((r, i) => [r, i]));
  layout.edges.sort((a, b) => relOrder.get(a.rel)! - relOrder.get(b.rel)!);
  return { layout, pieces };
}

function finalize(layout: DiagramLayout) {
  const rects: Rect[] = [...layout.nodes, ...(layout.frames ? layout.groups : [])];
  for (const e of layout.edges) { rects.push(...e.labels); for (const p of e.points) rects.push({ ...p, width: 0, height: 0 }); }
  for (const l of layout.lollipops) rects.push(l.text, { x: l.center.x - l.radius, y: l.center.y - l.radius, width: 2 * l.radius, height: 2 * l.radius });
  const b = bounds(rects);
  const dx = MARGIN - b.x, dy = MARGIN - b.y;
  const mv = <T extends Point>(o: T) => { o.x += dx; o.y += dy; };
  layout.nodes.forEach(mv); layout.groups.forEach(mv);
  for (const e of layout.edges) { e.points.forEach(mv); e.labels.forEach(mv); }
  for (const l of layout.lollipops) { mv(l.center); mv(l.stub[0]); mv(l.stub[1]); mv(l.text); }
  layout.width = Math.ceil(b.width + MARGIN * 2);
  layout.height = Math.ceil(b.height + MARGIN * 2);
}

/** Layer indices for `@same-row` nodes that ELK put in different layers, derived from a first pass. */
function sameRowConstraints(pieces: Piece[], diagram: Diagram, direction: Direction): Map<string, number> {
  const out = new Map<string, number>();
  if (!diagram.sameRows.length) return out;
  const coord = (n: NodeLayout) => Math.round(direction === 'down' ? n.y : n.x);
  for (const piece of pieces) {
    const pos = new Map(piece.nodes.map((n) => [n.def.name, n]));
    // Approximate layers by ranking the distinct layer coordinates inside this component.
    const levels = [...new Set(piece.nodes.map(coord))].sort((a, b) => a - b);
    const layerOf = (n: NodeLayout) => levels.indexOf(coord(n));
    for (const row of diagram.sameRows) {
      const ns = row.map((r) => pos.get(r)).filter((n): n is NodeLayout => !!n);
      if (ns.length < 2) continue;
      // Spans that overlap are already in one layer; alignRows lines them up.
      const spans = ns.map((n) => [coord(n), coord(n) + (direction === 'down' ? n.height : n.width)]);
      const overlap = Math.max(...spans.map((s) => s[0])) < Math.min(...spans.map((s) => s[1]));
      if (overlap) continue;
      const target = Math.max(...ns.map(layerOf));
      for (const n of ns) out.set(n.def.name, target);
    }
  }
  return out;
}

export async function layoutDiagram(diagram: Diagram, measurer: Measurer): Promise<DiagramLayout> {
  const prep = prepare(diagram, measurer);
  const run = async (direction: Direction) => {
    let { layout, pieces } = await layoutOnce(prep, direction, new Map());
    const constraints = sameRowConstraints(pieces, diagram, direction);
    if (constraints.size) ({ layout } = await layoutOnce(prep, direction, constraints));
    finalize(layout);
    return layout;
  };
  const first = await run(diagram.direction);
  const ratio = Math.max(first.width / first.height, first.height / first.width);
  if (ratio <= 2) return first;
  const second = await run(diagram.direction === 'down' ? 'right' : 'down');
  return second.width * second.height < first.width * first.height ? second : first;
}
