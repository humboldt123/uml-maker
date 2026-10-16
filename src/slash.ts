import { autocompletion, snippet, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import { parse } from './parser';
import gofExample from './examples/gof.uml?raw';

/**
 * Notion-style slash commands. Typing "/" at the start of a line opens a menu of
 * GoF pattern templates, relationship arrows, class blocks and layout directives.
 * "/adapter" and "/insert adapter" both work.
 */

export interface PatternTemplate {
  key: string; // group name, e.g. "factory-method"
  title: string; // "Factory Method"
  category: string; // "Creational" | "Structural" | "Behavioral"
  source: string;
}

/** Pull each pattern's section (title comment through its last line) out of the kitchen-sink example. */
export function patternTemplates(src = gofExample): PatternTemplate[] {
  const lines = src.split('\n');
  const out: PatternTemplate[] = [];
  let category = '';
  lines.forEach((line, i) => {
    const cat = /^\/\/ (CREATIONAL|STRUCTURAL|BEHAVIORAL)\s*$/.exec(line);
    if (cat) category = cat[1][0] + cat[1].slice(1).toLowerCase();
    const g = /^@group ([\w-]+):/.exec(line);
    if (!g || !category || !lines[i - 1]?.startsWith('// ')) return;
    let end = i + 1;
    while (end < lines.length && !lines[end].startsWith('//')) end++;
    const body = lines.slice(i - 1, end).join('\n').trim();
    out.push({ key: g[1], title: lines[i - 1].slice(3).trim(), category, source: body });
  });
  return out;
}

const PATTERNS = patternTemplates();

/**
 * Renames classes (and the group) in `snippetSrc` that already exist in `doc`, by
 * appending the smallest number that makes every name unique, so inserting a
 * pattern twice never produces duplicate classes.
 */
export function dedupeNames(snippetSrc: string, doc: string): string {
  const existing = parse(doc).diagram;
  const taken = new Set(existing.classes.map((c) => c.name));
  const groups = new Set(existing.groups.map((g) => g.name));
  const mine = parse(snippetSrc).diagram;
  const names = mine.classes.map((c) => c.name);
  if (!names.some((n) => taken.has(n)) && !mine.groups.some((g) => groups.has(g.name))) return snippetSrc;
  let k = 2;
  while (names.some((n) => taken.has(n + k)) || mine.groups.some((g) => groups.has(`${g.name}-${k}`))) k++;
  let out = snippetSrc;
  // Longest names first so "Builder" doesn't clobber "HouseBuilder" halfway.
  for (const n of [...names].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`(?<![\\w$])${n.replace(/[$.]/g, '\\$&')}(?![\\w$])`, 'g'), n + k);
  }
  for (const g of mine.groups) out = out.replace(new RegExp(`^@group ${g.name}:`, 'm'), `@group ${g.name}-${k}:`);
  return out;
}

/** Inserts a multi-line block on its own, with blank lines around it so it doesn't merge into a class. */
function insertBlock(view: EditorView, text: string, from: number, to: number) {
  const doc = view.state.doc;
  const line = doc.lineAt(from);
  const before = doc.sliceString(0, line.from);
  const after = doc.sliceString(to);
  const lead = before === '' || before.endsWith('\n\n') ? '' : '\n';
  const trail = after === '' || after.startsWith('\n\n') ? '\n' : after.startsWith('\n') ? '\n' : '\n\n';
  const insert = lead + text + trail;
  view.dispatch({
    changes: { from: line.from, to, insert },
    selection: { anchor: line.from + lead.length + text.length },
    scrollIntoView: true,
    userEvent: 'input.complete',
  });
}

/**
 * Numbers every `${text}` field left to right (`${1:text}`), so Tab visits them in reading
 * order and defaults like `${1}` are shown as text rather than read as field indexes.
 */
function fields(template: string) {
  let i = 0;
  return snippet(template.replace(/\$\{([^}]*)\}/g, (_, t: string) => `\${${++i}:${t}}`));
}

interface Command extends Completion {
  aliases?: string[];
}

const rel = (label: string, detail: string, template: string, info: string): Command => ({
  label, detail, type: 'keyword', section: 'Relationships', info,
  apply: fields(template),
});

const block = (label: string, detail: string, template: string, aliases: string[] = []): Command => ({
  label, detail, type: 'class', section: 'Classes', aliases,
  apply: fields(template),
});

const directive = (label: string, detail: string, template: string): Command => ({
  label, detail, type: 'property', section: 'Layout', apply: fields(template),
});

const COMMANDS: Command[] = [
  ...PATTERNS.map((p): Command => ({
    label: p.key,
    displayLabel: p.title,
    detail: `${p.category} pattern`,
    type: 'namespace',
    section: { name: 'GoF patterns', rank: 0 },
    aliases: [p.title.toLowerCase(), p.title.toLowerCase().replace(/\s+/g, '-'), p.title.toLowerCase().replace(/\s+/g, '')],
    info: () => {
      const pre = document.createElement('pre');
      pre.className = 'cm-slash-preview';
      pre.textContent = p.source;
      return pre;
    },
    apply: (view, _c, from, to) => insertBlock(view, dedupeNames(p.source, view.state.doc.toString()), from, to),
  })),
  rel('inheritance', 'A --|> B', '${Child} --|> ${Parent}', 'Solid line, hollow triangle at the parent.'),
  rel('realization', 'A ..|> B', '${Impl} ..|> ${Interface}', 'Dashed line, hollow triangle at the interface.'),
  rel('composition', 'A *-- B', '${Whole} *-- ${Part} : ${owns} [${1}] [${0..*}]', 'Filled diamond at the whole.'),
  rel('aggregation', 'A o-- B', '${Whole} o-- ${Part} : ${has} [${1}] [${0..*}]', 'Hollow diamond at the whole.'),
  rel('association', 'A --> B', '${Source} --> ${Target} : ${label}', 'Solid line, open arrow at the target.'),
  rel('dependency', 'A ..> B', '${Client} ..> ${Supplier} : ${uses}', 'Dashed line, open arrow.'),
  rel('link', 'A -- B', '${A} -- ${B}', 'Plain association, no arrowheads.'),
  rel('lollipop', 'A -() I', '${Class} -() ${Interface}', 'Provided-interface circle on the class.'),
  block('class', 'class X', 'class ${Name}\n${-field: Type}\n---\n${+method(): void}'),
  block('abstract class', 'abstract class X', 'abstract class ${Name}\n${#field: Type}\n---\n${+method(): void} {abstract}', ['abstract']),
  block('interface', 'interface X', 'interface ${Name}\n---\n${+method(): void}'),
  block('enum', 'enum X', 'enum ${Name}\n${FIRST}\n${SECOND}'),
  directive('group', '@group name: A, B', '@group ${name}: ${A}, ${B}'),
  directive('same-row', '@same-row A, B', '@same-row ${A}, ${B}'),
  directive('direction', '@direction down | right', '@direction ${down}'),
  directive('spacing', '@spacing compact | normal | loose', '@spacing ${compact}'),
  directive('frames', '@frames on | off', '@frames ${on}'),
];

function score(c: Command, q: string): number {
  if (!q) return 1;
  const names = [c.label, ...(c.aliases ?? [])].map((s) => s.toLowerCase());
  if (names.some((n) => n === q)) return 4;
  if (names.some((n) => n.startsWith(q))) return 3;
  if (names.some((n) => n.split(/[\s-]/).some((w) => w.startsWith(q)))) return 2;
  if (names.some((n) => n.includes(q))) return 1;
  return 0;
}

function slashSource(ctx: CompletionContext): CompletionResult | null {
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = line.text.slice(0, ctx.pos - line.from);
  const m = /^\s*\/(?!\/)([\w\s-]*)$/.exec(before);
  if (!m) return null;
  const query = m[1].toLowerCase().replace(/^insert\b\s*/, '').trim();
  const options = COMMANDS
    .map((c) => ({ c, s: score(c, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map(({ c }) => c);
  if (!options.length) return null;
  const from = line.from + before.indexOf('/');
  return { from, options, filter: false, validFor: /^\/(?!\/)[\w\s-]*$/ };
}

export const slashCommands = autocompletion({
  override: [slashSource],
  activateOnTyping: true,
  icons: false,
  maxRenderedOptions: 60,
  addToOptions: [],
});
