import type { DiagramLayout, EdgeLayout, NodeLayout, Point } from './layout';
import { isGeneralization } from './layout';
import { FONTS, METRICS, memberFont, nameFont, type FontSpec, type Measurer } from './measure';

export const STYLE = {
  stroke: '#4d4d4d',
  text: '#1a1a1a',
  fill: { class: '#d5e8d4', abstract: '#d5e8d4', interface: '#dae8fc', enum: '#fff2cc' },
  frame: '#a6a6a6',
  frameText: '#808080',
  background: '#ffffff',
  arrow: { triangle: 12, triangleHalf: 7, diamond: 14, diamondHalf: 5.5, open: 8, openHalf: 4.5 },
  dash: '5 3',
};

/** Font stack written into the SVG; matches the canvas measurer. */
export const SVG_FONT = `'Source Sans 3', Helvetica, Arial, sans-serif`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => String(Math.round(v * 100) / 100);

/** Baseline for text vertically centred in a line box of height `line`. */
export function baseline(top: number, line: number, size: number): number {
  return top + (line + size * 0.7) / 2;
}

function textEl(x: number, y: number, s: string, f: FontSpec, anchor: 'start' | 'middle' = 'start', fill = STYLE.text): string {
  return `<text x="${n(x)}" y="${n(y)}" font-family="${SVG_FONT}" font-size="${f.size}"${f.bold ? ' font-weight="700"' : ''}${f.italic ? ' font-style="italic"' : ''}${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''} fill="${fill}">${esc(s)}</text>`;
}

function renderNode(nd: NodeLayout, m: Measurer): string {
  const { x, y, width: w, height: h, box, def } = nd;
  const out: string[] = [];
  const fill = STYLE.fill[def.kind];
  out.push(`<g data-class="${esc(def.name)}">`);
  out.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="#ffffff" stroke="none"/>`);
  out.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(box.headerHeight)}" fill="${fill}" stroke="none"/>`);
  let ty = y + METRICS.pad;
  const cx = x + w / 2;
  if (box.stereotypeText) {
    out.push(textEl(cx, baseline(ty, METRICS.stereoLine, FONTS.stereotype.size), box.stereotypeText, FONTS.stereotype, 'middle'));
    ty += METRICS.stereoLine;
  }
  out.push(textEl(cx, baseline(ty, METRICS.nameLine, FONTS.name.size), def.name, nameFont(def), 'middle'));

  for (const comp of [box.attrs, box.methods]) {
    if (!comp) continue;
    const top = y + comp.y;
    out.push(`<line x1="${n(x)}" y1="${n(top)}" x2="${n(x + w)}" y2="${n(top)}" stroke="${STYLE.stroke}" stroke-width="1"/>`);
    comp.members.forEach((mem, i) => {
      const f = memberFont(mem);
      const by = baseline(top + METRICS.pad + i * METRICS.memberLine, METRICS.memberLine, f.size);
      const tx = x + METRICS.hpad;
      out.push(textEl(tx, by, mem.text, f));
      if (mem.isStatic) {
        const tw = m.width(mem.text, f);
        out.push(`<line x1="${n(tx)}" y1="${n(by + 1.5)}" x2="${n(tx + tw)}" y2="${n(by + 1.5)}" stroke="${STYLE.text}" stroke-width="0.8"/>`);
      }
    });
  }
  out.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="none" stroke="${STYLE.stroke}" stroke-width="1"/>`);
  out.push('</g>');
  return out.join('');
}

interface Head { kind: 'triangle' | 'diamond' | 'open' | 'none'; filled: boolean }

export function headsFor(e: EdgeLayout): { source: Head; target: Head; dashed: boolean } {
  const none: Head = { kind: 'none', filled: false };
  switch (e.rel.kind) {
    case 'inheritance': return { source: none, target: { kind: 'triangle', filled: false }, dashed: false };
    case 'realization': return { source: none, target: { kind: 'triangle', filled: false }, dashed: true };
    case 'composition': return { source: { kind: 'diamond', filled: true }, target: none, dashed: false };
    case 'aggregation': return { source: { kind: 'diamond', filled: false }, target: none, dashed: false };
    case 'association': return { source: none, target: { kind: 'open', filled: false }, dashed: false };
    case 'dependency': return { source: none, target: { kind: 'open', filled: false }, dashed: true };
    default: return { source: none, target: none, dashed: false };
  }
}

/**
 * Draws a head at `tip`, pointing away from `from`. Returns the SVG and how far
 * the line should be pulled back from the tip so it doesn't show through.
 */
function head(h: Head, tip: Point, from: Point): { svg: string; inset: number } {
  if (h.kind === 'none') return { svg: '', inset: 0 };
  const len = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const ux = (tip.x - from.x) / len, uy = (tip.y - from.y) / len; // towards tip
  const px = -uy, py = ux;
  const at = (back: number, side: number) => `${n(tip.x - ux * back + px * side)},${n(tip.y - uy * back + py * side)}`;
  const A = STYLE.arrow;
  const stroke = `stroke="${STYLE.stroke}" stroke-width="1" stroke-linejoin="miter"`;
  if (h.kind === 'triangle') {
    return { svg: `<polygon points="${at(0, 0)} ${at(A.triangle, A.triangleHalf)} ${at(A.triangle, -A.triangleHalf)}" fill="#ffffff" ${stroke}/>`, inset: A.triangle };
  }
  if (h.kind === 'diamond') {
    const fill = h.filled ? STYLE.stroke : '#ffffff';
    return {
      svg: `<polygon points="${at(0, 0)} ${at(A.diamond / 2, A.diamondHalf)} ${at(A.diamond, 0)} ${at(A.diamond / 2, -A.diamondHalf)}" fill="${fill}" ${stroke}/>`,
      inset: A.diamond,
    };
  }
  return { svg: `<polyline points="${at(A.open, A.openHalf)} ${at(0, 0)} ${at(A.open, -A.openHalf)}" fill="none" ${stroke}/>`, inset: 0 };
}

function pullBack(pts: Point[], atStart: boolean, d: number): Point[] {
  if (!d || pts.length < 2) return pts;
  const out = pts.map((p) => ({ ...p }));
  const [a, b] = atStart ? [out[0], out[1]] : [out[out.length - 1], out[out.length - 2]];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const t = Math.min(d, len) / len;
  a.x += (b.x - a.x) * t;
  a.y += (b.y - a.y) * t;
  return out;
}

function renderEdge(e: EdgeLayout): string {
  if (e.points.length < 2) return '';
  const h = headsFor(e);
  let pts = e.points;
  const last = pts.length - 1;
  const src = head(h.source, pts[0], pts[1]);
  const tgt = head(h.target, pts[last], pts[last - 1]);
  pts = pullBack(pts, true, src.inset);
  pts = pullBack(pts, false, tgt.inset);
  // Generalization edges are drawn from the parent so shared trunks overlap exactly (dash phase included).
  if (isGeneralization(e.rel)) pts = [...pts].reverse();
  const d = 'M' + pts.map((p) => `${n(p.x)} ${n(p.y)}`).join(' L');
  const out = [`<g data-edge="${esc(e.rel.source)}-${e.rel.kind}-${esc(e.rel.target)}">`];
  out.push(`<path d="${d}" fill="none" stroke="${STYLE.stroke}" stroke-width="1"${h.dashed ? ` stroke-dasharray="${STYLE.dash}"` : ''}/>`);
  out.push(src.svg, tgt.svg);
  for (const l of e.labels) {
    if (l.role === 'center') {
      out.push(`<rect x="${n(l.x)}" y="${n(l.y)}" width="${n(l.width)}" height="${n(l.height)}" fill="#ffffff"/>`);
    }
    out.push(textEl(l.x + l.width / 2, baseline(l.y, l.height, FONTS.label.size), l.text, FONTS.label, 'middle'));
  }
  out.push('</g>');
  return out.join('');
}

export interface RenderOptions {
  /** Extra CSS (e.g. embedded @font-face rules) for standalone exports. */
  fontCss?: string;
}

export function renderSvg(layout: DiagramLayout, m: Measurer, opts: RenderOptions = {}): string {
  const { width: W, height: H } = layout;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  if (opts.fontCss) parts.push(`<defs><style>${opts.fontCss}</style></defs>`);
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${STYLE.background}"/>`);
  // Half-pixel offset keeps 1px strokes on integer coordinates crisp.
  parts.push('<g transform="translate(0.5 0.5)">');
  if (layout.frames) {
    for (const g of layout.groups) {
      parts.push(`<rect x="${n(g.x)}" y="${n(g.y)}" width="${n(g.width)}" height="${n(g.height)}" rx="6" fill="none" stroke="${STYLE.frame}" stroke-width="1" stroke-dasharray="4 3"/>`);
      parts.push(textEl(g.x + 8, baseline(g.y + 4, 14, 11), g.name, { size: 11 }, 'start', STYLE.frameText));
    }
  }
  for (const e of layout.edges) parts.push(renderEdge(e));
  for (const nd of layout.nodes) parts.push(renderNode(nd, m));
  for (const l of layout.lollipops) {
    parts.push(`<g data-lollipop="${esc(l.owner)}-${esc(l.name)}">`);
    parts.push(`<line x1="${n(l.stub[0].x)}" y1="${n(l.stub[0].y)}" x2="${n(l.stub[1].x)}" y2="${n(l.stub[1].y)}" stroke="${STYLE.stroke}" stroke-width="1"/>`);
    parts.push(`<circle cx="${n(l.center.x)}" cy="${n(l.center.y)}" r="${l.radius}" fill="#ffffff" stroke="${STYLE.stroke}" stroke-width="1"/>`);
    parts.push(textEl(l.text.x, baseline(l.text.y, l.text.height, FONTS.label.size), l.name, { ...FONTS.label, italic: true }));
    parts.push('</g>');
  }
  parts.push('</g></svg>');
  return parts.join('');
}
