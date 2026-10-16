import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '../src/parser';
import { layoutDiagram, segmentHitsRect, type DiagramLayout } from '../src/layout';
import { checkLayout } from '../src/checks';
import { toDrawio } from '../src/drawio';
import { DOMParser } from '@xmldom/xmldom';
import { stubMeasurer } from './stubMeasurer';

async function layout(src: string): Promise<DiagramLayout> {
  const { diagram, errors } = parse(src);
  expect(errors).toEqual([]);
  return layoutDiagram(diagram, stubMeasurer);
}

const example = (f: string) => readFileSync(`src/examples/${f}.uml`, 'utf8');
const node = (l: DiagramLayout, name: string) => l.nodes.find((n) => n.def.name === name)!;

describe('segmentHitsRect', () => {
  const r = { x: 0, y: 0, width: 100, height: 50 };
  test('crossing segments hit', () => {
    expect(segmentHitsRect({ x: -10, y: 25 }, { x: 110, y: 25 }, r)).toBe(true);
    expect(segmentHitsRect({ x: 50, y: -10 }, { x: 50, y: 10 }, r)).toBe(true);
  });
  test('segments that end on or run along the border do not', () => {
    expect(segmentHitsRect({ x: 50, y: -40 }, { x: 50, y: 0 }, r)).toBe(false);
    expect(segmentHitsRect({ x: -10, y: 0 }, { x: 110, y: 0 }, r)).toBe(false);
    expect(segmentHitsRect({ x: 120, y: 25 }, { x: 200, y: 25 }, r)).toBe(false);
  });
});

describe('layout acceptance', () => {
  for (const f of ['gof', 'library']) {
    test(`${f}: no edge segment passes through any node, no overlapping boxes or labels`, async () => {
      const l = await layout(example(f));
      // The explicit check the spec asks for: every segment against every node rectangle.
      for (const e of l.edges) {
        for (let i = 1; i < e.points.length; i++) {
          for (const n of l.nodes) {
            expect(segmentHitsRect(e.points[i - 1], e.points[i], n, 1), `${e.rel.source}→${e.rel.target} crosses ${n.def.name}`).toBe(false);
          }
        }
      }
      expect(checkLayout(l)).toEqual([]);
    });
  }

  test('edges are orthogonal', async () => {
    const l = await layout(example('gof'));
    for (const e of l.edges) {
      for (let i = 1; i < e.points.length; i++) {
        const p = e.points[i - 1], q = e.points[i];
        expect(p.x === q.x || p.y === q.y).toBe(true);
      }
    }
  });

  test('kitchen-sink aspect ratio stays near 4:3', async () => {
    const l = await layout(example('gof'));
    const aspect = l.width / l.height;
    expect(aspect).toBeGreaterThan(1.0);
    expect(aspect).toBeLessThan(1.7);
  });

  test('parents sit above children, and siblings share one trunk into the parent', async () => {
    const l = await layout(example('library'));
    const q = node(l, 'MediaItem');
    const kids = ['Book', 'Magazine', 'Film', 'Album', 'Podcast', 'Newspaper'];
    const entries = new Set<string>();
    for (const k of kids) {
      expect(node(l, k).y).toBeGreaterThan(q.y + q.height);
      const e = l.edges.find((x) => x.rel.source === k && x.rel.target === 'MediaItem')!;
      const end = e.points[e.points.length - 1];
      entries.add(`${end.x},${end.y}`);
    }
    expect(entries.size).toBe(1);
  });

  test('@same-row nodes share a row', async () => {
    const l = await layout(example('library'));
    const ys = ['Film', 'Newspaper', 'Podcast', 'Book'].map((n) => node(l, n).y);
    expect(new Set(ys).size).toBe(1);
    const gof = await layout(example('gof'));
    const ys2 = ['WinButton', 'MacButton', 'WinCheckbox', 'MacCheckbox'].map((n) => node(gof, n).y);
    expect(new Set(ys2).size).toBe(1);
  });

  test('a class that both realizes and wraps its parent still hangs below it (Decorator)', async () => {
    const l = await layout(example('gof'));
    expect(node(l, 'CoffeeDecorator').y).toBeGreaterThan(node(l, 'Coffee').y);
    expect(node(l, 'Composite').y).toBeGreaterThan(node(l, 'Component').y);
  });

  test('boxes have no empty space at the bottom and 6px compartment padding', async () => {
    const l = await layout(example('gof'));
    for (const n of l.nodes) {
      const last = n.box.methods ?? n.box.attrs;
      expect(last.y + last.height).toBe(n.height);
      if (last.members.length) expect(last.height).toBe(6 * 2 + last.members.length * 16);
    }
  });

  test('implicit classes are drawn as empty boxes; lollipops are not nodes', async () => {
    const l = await layout(example('gof'));
    expect(node(l, 'Logger').def.implicit).toBe(true);
    expect(l.lollipops.map((x) => `${x.owner}-()${x.name}`)).toEqual(['Shape-()Cloneable']);
    const shape = node(l, 'Shape');
    const lol = l.lollipops[0];
    expect(lol.radius * 2).toBe(14);
    expect(lol.stub[0].x).toBe(shape.x + shape.width); // attached to the right side, near the top
    expect(lol.stub[0].y).toBeLessThan(shape.y + shape.box.headerHeight);
  });

  test('right direction puts parents left of children', async () => {
    const l = await layout('@direction right\nA --|> P\nB --|> P\nC --|> P');
    for (const k of ['A', 'B', 'C']) expect(node(l, k).x).toBeGreaterThan(node(l, 'P').x + node(l, 'P').width);
    expect(checkLayout(l)).toEqual([]);
  });

  test('multi-group components fall back gracefully', async () => {
    const l = await layout(`@frames on
@group a: A, B
@group b: C, D
A --> B : x [1] [2]
B --> C : y
C --|> D
A ..> D`);
    expect(l.groups).toHaveLength(2);
    expect(checkLayout(l)).toEqual([]);
  });
});

describe('drawio export', () => {
  test('keeps positions, uses stack-layout swimlanes and edge points', async () => {
    const l = await layout(example('library'));
    const xml = toDrawio(l);
    expect(xml).toContain('childLayout=stackLayout');
    expect(xml).toContain('collapsible=0');
    expect(xml).toContain('edgeStyle=orthogonalEdgeStyle');
    expect(xml).toContain('<Array as="points">');
    expect(xml).toMatch(/exitX=[\d.]+;exitY=[\d.]+/);
    expect(xml).toContain('&#xa;'); // multi-line compartments
    expect(xml).toMatch(/<mxGeometry x="-1" relative="1"/); // source multiplicity
    expect(xml).toMatch(/<mxGeometry x="1" relative="1"/); // target multiplicity
    const q = node(l, 'MediaItem');
    expect(xml).toContain(`<mxGeometry x="${q.x}" y="${q.y}" width="${q.width}" height="${q.height}"`);
    // Well-formed XML.
    const doc = new DOMParser({ onError: (level, msg) => { if (level !== 'warning') throw new Error(msg); } }).parseFromString(xml, 'text/xml');
    expect(doc.getElementsByTagName('mxCell').length).toBeGreaterThan(10);
  });
});
