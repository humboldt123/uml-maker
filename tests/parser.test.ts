import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '../src/parser';

describe('parser', () => {
  test('the shipped examples parse cleanly', () => {
    for (const f of ['gof', 'library']) {
      expect(parse(readFileSync(`src/examples/${f}.uml`, 'utf8')).errors).toEqual([]);
    }
  });

  test('headers, stereotypes and compartments', () => {
    const { diagram, errors } = parse(`class Library <<Entity>>
-name: String
---
+Library(name: String)

abstract class MediaItem
#title: String
---
+display(out: Renderer): void {abstract}
+{static} count(): int

interface Renderer
---
+display(s: String): void

enum Genre
FICTION
HISTORY`);
    expect(errors).toEqual([]);
    const [library, item, output, qt] = diagram.classes;
    expect(library).toMatchObject({ name: 'Library', kind: 'class', stereotype: 'Entity' });
    expect(library.attributes.map((m) => m.text)).toEqual(['-name: String']);
    expect(item.kind).toBe('abstract');
    expect(item.attributes[0].text).toBe('#title: String'); // "#x" is protected, not a comment
    expect(item.methods[0]).toMatchObject({ text: '+display(out: Renderer): void', isAbstract: true, isStatic: false });
    expect(item.methods[1]).toMatchObject({ text: '+count(): int', isStatic: true });
    expect(output.kind).toBe('interface');
    expect(qt.attributes.map((m) => m.text)).toEqual(['FICTION', 'HISTORY']);
  });

  test('a class without --- has no methods', () => {
    const { diagram } = parse('class Point\n+x: int\n+y: int');
    expect(diagram.classes[0].methods).toEqual([]);
    expect(diagram.classes[0].attributes).toHaveLength(2);
  });

  test('comments', () => {
    const { diagram, errors } = parse('# a comment\n// another\nclass A\n# comment inside\n#field: int');
    expect(errors).toEqual([]);
    expect(diagram.classes[0].attributes.map((m) => m.text)).toEqual(['#field: int']);
  });

  test('every relationship kind, labels, multiplicities and trailing comments', () => {
    const { diagram, errors } = parse(`Book --|> MediaItem            # inheritance
HtmlRenderer ..|> Renderer
Library *-- MediaItem : contains [1] [0..*]
Library o-- MediaItem
LibraryApp --> Library : catalog [1] [0..1]
MediaItem ..> Loan : creates
A -- B
Library -() Serializable`);
    expect(errors).toEqual([]);
    expect(diagram.relationships.map((r) => r.kind)).toEqual([
      'inheritance', 'realization', 'composition', 'aggregation', 'association', 'dependency', 'link', 'lollipop',
    ]);
    expect(diagram.relationships[2]).toMatchObject({ source: 'Library', target: 'MediaItem', label: 'contains', sourceMult: '1', targetMult: '0..*' });
    expect(diagram.relationships[0].label).toBeUndefined();
    // Implicit classes are created for every name a relationship mentions, except lollipop interfaces.
    const names = diagram.classes.map((c) => c.name);
    expect(names).toContain('Loan');
    expect(names).not.toContain('Serializable');
    expect(diagram.classes.find((c) => c.name === 'B')!.implicit).toBe(true);
  });

  test('relationships right after a block do not become members', () => {
    const { diagram } = parse('class A\n---\n+run(): void\nA --|> B');
    expect(diagram.classes[0].methods).toHaveLength(1);
    expect(diagram.relationships).toHaveLength(1);
  });

  test('every README snippet parses', () => {
    const readme = readFileSync('README.md', 'utf8');
    const blocks = [...readme.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(blocks.length).toBeGreaterThan(8);
    for (const b of blocks) expect(parse(b).errors, b).toEqual([]);
  });

  test('reversed operators swap ends', () => {
    const { diagram } = parse('MediaItem <|-- Film');
    expect(diagram.relationships[0]).toMatchObject({ kind: 'inheritance', source: 'Film', target: 'MediaItem' });
  });

  test('directives', () => {
    const { diagram, errors } = parse(`@direction right   # comment
@spacing loose
@frames on
@group io: Exporter, Renderer
@same-row Exporter, Renderer`);
    expect(errors).toEqual([]);
    expect(diagram).toMatchObject({ direction: 'right', spacing: 'loose', frames: true });
    expect(diagram.groups).toEqual([{ name: 'io', members: ['Exporter', 'Renderer'], line: 4 }]);
    expect(diagram.sameRows).toEqual([['Exporter', 'Renderer']]);
  });

  test('errors carry line numbers', () => {
    const { errors } = parse('class A\n\nnonsense here\n@direction up\nclass A');
    expect(errors.map((e) => e.line)).toEqual([3, 4, 5]);
    expect(errors[0].message).toMatch(/Unexpected line/);
    expect(errors[2].message).toMatch(/already defined on line 1/);
  });
});
