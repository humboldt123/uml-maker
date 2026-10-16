import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { dedupeNames, patternTemplates } from '../src/slash';
import { parse } from '../src/parser';

const gof = readFileSync('src/examples/gof.uml', 'utf8');

describe('slash commands', () => {
  test('all 23 GoF patterns are available as templates that parse on their own', () => {
    const ps = patternTemplates(gof);
    expect(ps).toHaveLength(23);
    expect(ps.map((p) => p.key)).toContain('adapter');
    expect(ps.find((p) => p.key === 'chain')!.title).toBe('Chain of Responsibility');
    for (const p of ps) expect(parse(p.source).errors, p.key).toEqual([]);
  });

  test('inserting a pattern whose names already exist renames them consistently', () => {
    const adapter = patternTemplates(gof).find((p) => p.key === 'adapter')!.source;
    const out = dedupeNames(adapter, adapter);
    expect(out).toContain('@group adapter-2: Client2, Target2, Adapter2, Adaptee2');
    expect(out).toContain('Adapter2 --> Adaptee2 : adaptee [1] [1]');
    expect(parse(`${adapter}\n\n${out}`).errors).toEqual([]);
  });

  test('longer names are not clobbered by shorter ones', () => {
    const builder = patternTemplates(gof).find((p) => p.key === 'builder')!.source;
    const out = dedupeNames(builder, 'class Builder');
    expect(out).toContain('class HouseBuilder2');
    expect(out).toContain('interface Builder2');
    expect(out).not.toContain('HouseBuilder22');
  });

  test('no rename when nothing collides', () => {
    const proxy = patternTemplates(gof).find((p) => p.key === 'proxy')!.source;
    expect(dedupeNames(proxy, 'class Unrelated')).toBe(proxy);
  });
});
