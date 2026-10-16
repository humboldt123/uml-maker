import type { ClassDef, Member } from './model';

export const FONT_FAMILY = `"Source Sans 3", Helvetica, Arial, sans-serif`;

export interface FontSpec {
  size: number;
  bold?: boolean;
  italic?: boolean;
}

export const FONTS = {
  name: { size: 14, bold: true } as FontSpec,
  stereotype: { size: 12 } as FontSpec,
  member: { size: 12.5 } as FontSpec,
  label: { size: 12 } as FontSpec,
};

/** Vertical rhythm, in px. */
export const METRICS = {
  pad: 6, // compartment padding (top/bottom)
  hpad: 10, // horizontal text inset
  nameLine: 18,
  stereoLine: 15,
  memberLine: 16,
  emptyCompartment: 10,
  minWidth: 60,
  labelPadX: 3,
  labelLine: 15,
};

export function cssFont(f: FontSpec): string {
  return `${f.italic ? 'italic ' : ''}${f.bold ? '700' : '400'} ${f.size}px ${FONT_FAMILY}`;
}

export interface Measurer {
  width(text: string, font: FontSpec): number;
}

/** Measures with a hidden canvas using the same font string the SVG uses. */
export class CanvasMeasurer implements Measurer {
  private ctx: CanvasRenderingContext2D;
  private cache = new Map<string, number>();
  constructor() {
    const canvas = document.createElement('canvas');
    canvas.style.display = 'none';
    this.ctx = canvas.getContext('2d')!;
  }
  width(text: string, font: FontSpec): number {
    const css = cssFont(font);
    const key = css + '\u0000' + text;
    let w = this.cache.get(key);
    if (w === undefined) {
      this.ctx.font = css;
      w = this.ctx.measureText(text).width;
      this.cache.set(key, w);
    }
    return w;
  }
}

/** Fonts the diagram uses; wait for these before the first measurement. */
export async function loadDiagramFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const specs: FontSpec[] = [
    FONTS.name, { ...FONTS.name, italic: true }, FONTS.member, { ...FONTS.member, italic: true },
  ];
  try {
    await Promise.all(specs.map((s) => document.fonts.load(cssFont(s), 'AaZz«»')));
  } catch {
    /* fall back to whatever is available */
  }
}

export interface Compartment {
  y: number; // relative to the box top
  height: number;
  members: Member[];
}

export interface BoxGeometry {
  width: number;
  height: number;
  headerHeight: number;
  stereotypeText?: string;
  attrs: Compartment;
  methods: Compartment | null; // null for enums without methods
}

export function stereotypeText(def: ClassDef): string | undefined {
  const parts: string[] = [];
  if (def.kind === 'interface') parts.push('interface');
  if (def.kind === 'enum') parts.push('enumeration');
  if (def.stereotype) parts.push(def.stereotype);
  return parts.length ? `«${parts.join(', ')}»` : undefined;
}

export function memberFont(m: Member): FontSpec {
  return { ...FONTS.member, italic: m.isAbstract };
}

export function nameFont(def: ClassDef): FontSpec {
  return { ...FONTS.name, italic: def.kind === 'abstract' };
}

function compartmentHeight(n: number): number {
  return n ? METRICS.pad * 2 + n * METRICS.memberLine : METRICS.emptyCompartment;
}

export function measureClass(def: ClassDef, m: Measurer): BoxGeometry {
  const stereo = stereotypeText(def);
  let w = m.width(def.name, nameFont(def));
  if (stereo) w = Math.max(w, m.width(stereo, FONTS.stereotype));
  for (const mem of [...def.attributes, ...def.methods]) w = Math.max(w, m.width(mem.text, memberFont(mem)));
  const width = Math.max(METRICS.minWidth, Math.ceil(w + METRICS.hpad * 2));

  const headerHeight = METRICS.pad * 2 + METRICS.nameLine + (stereo ? METRICS.stereoLine : 0);
  const attrs: Compartment = { y: headerHeight, height: compartmentHeight(def.attributes.length), members: def.attributes };
  // Enums list constants only; draw a methods compartment only if they have methods.
  const hasMethods = def.kind !== 'enum' || def.methods.length > 0;
  const methods: Compartment | null = hasMethods
    ? { y: attrs.y + attrs.height, height: compartmentHeight(def.methods.length), members: def.methods }
    : null;
  const height = methods ? methods.y + methods.height : attrs.y + attrs.height;
  return { width, height, headerHeight, stereotypeText: stereo, attrs, methods };
}
