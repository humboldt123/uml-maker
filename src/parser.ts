import type {
  ClassDef, ClassKind, Diagram, Member, ParseError, ParseResult, RelKind, Relationship,
} from './model';

const NAME = String.raw`[A-Za-z_$][\w$.]*(?:<[^<>]*(?:<[^<>]*>[^<>]*)*>)?`;

const HEADER_RE = new RegExp(
  String.raw`^(abstract\s+class|class|interface|enum)\s+(${NAME})\s*(?:<<\s*([^>]+?)\s*>>)?\s*\{?\s*$`,
);

/** Relationship operators. `flip` means the written left side is the target. */
const OPERATORS: { op: string; kind: RelKind; flip?: boolean }[] = [
  { op: '--|>', kind: 'inheritance' },
  { op: '<|--', kind: 'inheritance', flip: true },
  { op: '..|>', kind: 'realization' },
  { op: '<|..', kind: 'realization', flip: true },
  { op: '*--', kind: 'composition' },
  { op: '--*', kind: 'composition', flip: true },
  { op: 'o--', kind: 'aggregation' },
  { op: '--o', kind: 'aggregation', flip: true },
  { op: '-->', kind: 'association' },
  { op: '<--', kind: 'association', flip: true },
  { op: '..>', kind: 'dependency' },
  { op: '<..', kind: 'dependency', flip: true },
  { op: '-()', kind: 'lollipop' },
  { op: '--', kind: 'link' },
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const REL_RE = new RegExp(
  String.raw`^(${NAME})\s*(${OPERATORS.map((o) => escapeRe(o.op)).join('|')})\s*(${NAME})\s*(.*)$`,
);

/** Strip a trailing `# comment` or `// comment` from a relationship or directive line. */
function stripTrailingComment(s: string): string {
  return s.replace(/\s+#\s.*$/, '').replace(/\s+\/\/.*$/, '').trim();
}

function isComment(t: string): boolean {
  return t.startsWith('//') || t === '#' || t.startsWith('# ') || t.startsWith('#\t');
}

/** Parse relationship text, or return null if the line isn't one. */
export function parseRelationship(t: string, line: number): Relationship | { error: string } | null {
  const m = REL_RE.exec(stripTrailingComment(t));
  if (!m) return null;
  const [, a, op, b, restRaw] = m;
  const def = OPERATORS.find((o) => o.op === op)!;
  let rest = restRaw.trim();
  const mults: string[] = [];
  for (;;) {
    const mm = /\[([^\]]*)\]\s*$/.exec(rest);
    if (!mm) break;
    mults.unshift(mm[1].trim());
    rest = rest.slice(0, mm.index).trim();
  }
  if (mults.length > 2) return { error: 'At most two multiplicities: [source] [target]' };
  let label: string | undefined;
  if (rest) {
    if (!rest.startsWith(':')) return { error: `Unexpected text after relationship: "${rest}"` };
    label = rest.slice(1).trim() || undefined;
  }
  let source = a, target = b;
  let [sourceMult, targetMult] = mults;
  if (def.flip) {
    [source, target] = [b, a];
    [sourceMult, targetMult] = [targetMult, sourceMult];
  }
  if (def.kind === 'lollipop' && (label || mults.length)) {
    return { error: 'A lollipop (-()) takes no label or multiplicities' };
  }
  return {
    kind: def.kind, source, target, line,
    label, sourceMult: sourceMult || undefined, targetMult: targetMult || undefined,
  };
}

function parseMember(raw: string, line: number): Member {
  let text = raw;
  let isAbstract = false, isStatic = false;
  text = text.replace(/\{\s*(abstract|static)\s*\}/g, (_, tag: string) => {
    if (tag === 'abstract') isAbstract = true;
    else isStatic = true;
    return ' ';
  });
  // Collapse the gap a removed tag leaves, but keep the visibility char attached: "+{static} x" -> "+x".
  text = text.replace(/^([+\-#~])\s+/, '$1').replace(/\s{2,}/g, ' ').trim();
  return { text, isAbstract, isStatic, line };
}

function splitNames(s: string): string[] {
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

export function parse(src: string): ParseResult {
  const diagram: Diagram = {
    classes: [], relationships: [], groups: [], sameRows: [],
    direction: 'down', spacing: 'normal', frames: false,
  };
  const errors: ParseError[] = [];
  const byName = new Map<string, ClassDef>();
  const groupOf = new Map<string, string>();
  let current: ClassDef | null = null;
  let inMethods = false;

  const nameRe = new RegExp(`^${NAME}$`);
  const lines = src.split(/\r?\n/);

  lines.forEach((rawLine, i) => {
    const line = i + 1;
    const t = rawLine.trim();
    const err = (message: string) => errors.push({ line, message });

    if (t === '') { current = null; return; }
    if (isComment(t)) return;

    if (t.startsWith('@')) {
      current = null;
      const d = stripTrailingComment(t);
      const m = /^@([\w-]+)\s*(.*)$/.exec(d);
      const key = m?.[1] ?? '';
      const arg = (m?.[2] ?? '').trim();
      switch (key) {
        case 'direction':
          if (arg === 'down' || arg === 'right') diagram.direction = arg;
          else err('@direction must be "down" or "right"');
          break;
        case 'spacing':
          if (arg === 'compact' || arg === 'normal' || arg === 'loose') diagram.spacing = arg;
          else err('@spacing must be "compact", "normal" or "loose"');
          break;
        case 'frames':
          if (arg === 'on' || arg === 'off') diagram.frames = arg === 'on';
          else err('@frames must be "on" or "off"');
          break;
        case 'group': {
          const gm = /^([\w.-]+)\s*:\s*(.*)$/.exec(arg);
          if (!gm) { err('Expected "@group name: A, B, C"'); break; }
          const members = splitNames(gm[2]);
          if (!members.length) { err('@group needs at least one class'); break; }
          if (diagram.groups.some((g) => g.name === gm[1])) { err(`Group "${gm[1]}" is already defined`); break; }
          const bad = members.find((n) => !nameRe.test(n));
          if (bad) { err(`"${bad}" is not a valid class name`); break; }
          const taken = members.find((n) => groupOf.has(n));
          if (taken) { err(`"${taken}" is already in group "${groupOf.get(taken)}"`); break; }
          members.forEach((n) => groupOf.set(n, gm[1]));
          diagram.groups.push({ name: gm[1], members, line });
          break;
        }
        case 'same-row': {
          const names = splitNames(arg);
          if (names.length < 2) { err('@same-row needs at least two classes'); break; }
          const bad = names.find((n) => !nameRe.test(n));
          if (bad) { err(`"${bad}" is not a valid class name`); break; }
          diagram.sameRows.push(names);
          break;
        }
        default:
          err(`Unknown directive "@${key}"`);
      }
      return;
    }

    const hm = HEADER_RE.exec(stripTrailingComment(t));
    if (hm) {
      const kindWord = hm[1].replace(/\s+/g, ' ');
      const kind: ClassKind = kindWord === 'abstract class' ? 'abstract' : (kindWord as ClassKind);
      const name = hm[2];
      const existing = byName.get(name);
      if (existing && !existing.implicit) {
        err(`Class "${name}" is already defined on line ${existing.line}`);
        current = null;
        return;
      }
      const def: ClassDef = existing ?? {
        name, kind, attributes: [], methods: [], implicit: false, line,
      };
      Object.assign(def, { kind, implicit: false, line, stereotype: hm[3] });
      if (!existing) { byName.set(name, def); diagram.classes.push(def); }
      current = def;
      inMethods = false;
      return;
    }

    const rel = parseRelationship(t, line);
    if (rel) {
      if ('error' in rel) err(rel.error);
      else diagram.relationships.push(rel);
      return;
    }

    if (current) {
      if (/^-{3,}$/.test(t)) {
        if (inMethods) err('Only one "---" separator per class');
        inMethods = true;
        return;
      }
      if (current.kind === 'enum' && !inMethods && !/^[+\-#~]/.test(t) && !/^[\w$]+(\(.*\))?,?;?$/.test(t)) {
        // Enum constants are bare identifiers; allow anything with a visibility prefix as a field.
        err(`Unexpected enum constant "${t}"`);
        return;
      }
      (inMethods ? current.methods : current.attributes).push(parseMember(t, line));
      return;
    }

    if (/^(class|abstract|interface|enum)\b/.test(t)) err(`Malformed header: "${t}"`);
    else err(`Unexpected line outside a class: "${t}"`);
  });

  // Implicit classes from relationships and groups, in order of first mention.
  const ensure = (name: string, line: number) => {
    if (!byName.has(name)) {
      const def: ClassDef = { name, kind: 'class', attributes: [], methods: [], implicit: true, line };
      byName.set(name, def);
      diagram.classes.push(def);
    }
  };
  for (const r of diagram.relationships) {
    ensure(r.source, r.line);
    if (r.kind !== 'lollipop') ensure(r.target, r.line);
  }
  for (const g of diagram.groups) g.members.forEach((n) => ensure(n, g.line));
  for (const row of diagram.sameRows) {
    for (const n of row) {
      if (!byName.has(n)) {
        const line = lines.findIndex((l) => l.trim().startsWith('@same-row') && l.includes(n)) + 1;
        errors.push({ line, message: `@same-row: unknown class "${n}"` });
      }
    }
  }

  errors.sort((a, b) => a.line - b.line);
  return { diagram, errors };
}
