export type ClassKind = 'class' | 'abstract' | 'interface' | 'enum';

export interface Member {
  /** Display text with {abstract}/{static} removed, visibility kept as written. */
  text: string;
  isAbstract: boolean;
  isStatic: boolean;
  line: number;
}

export interface ClassDef {
  name: string;
  kind: ClassKind;
  stereotype?: string;
  attributes: Member[];
  methods: Member[];
  /** True when the class was created implicitly by a relationship or group. */
  implicit: boolean;
  line: number;
}

export type RelKind =
  | 'inheritance'
  | 'realization'
  | 'composition'
  | 'aggregation'
  | 'association'
  | 'dependency'
  | 'link'
  | 'lollipop';

export interface Relationship {
  kind: RelKind;
  source: string;
  target: string;
  label?: string;
  sourceMult?: string;
  targetMult?: string;
  line: number;
}

export type Direction = 'down' | 'right';
export type Spacing = 'compact' | 'normal' | 'loose';

export interface Group {
  name: string;
  members: string[];
  line: number;
}

export interface Diagram {
  classes: ClassDef[];
  relationships: Relationship[];
  groups: Group[];
  sameRows: string[][];
  direction: Direction;
  spacing: Spacing;
  frames: boolean;
}

export interface ParseError {
  line: number; // 1-based
  message: string;
}

export interface ParseResult {
  diagram: Diagram;
  errors: ParseError[];
}
