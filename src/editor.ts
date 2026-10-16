import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { StreamLanguage, HighlightStyle, syntaxHighlighting, bracketMatching, type StringStream } from '@codemirror/language';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { tags as t } from '@lezer/highlight';
import type { ParseError } from './model';
import { slashCommands } from './slash';

interface State {
  /** Inside a class block, and after the --- separator. */
  inBlock: boolean;
  afterHeader: boolean; // next token on this line is the class name
  relLine: boolean; // current line is a relationship
  lineStart: boolean;
  enumBlock: boolean;
}

const REL_OPS = /^(--\|>|<\|--|\.\.\|>|<\|\.\.|\*--|--\*|o--|--o|-->|<--|\.\.>|<\.\.|-\(\)|--)/;
const NAME = /^[A-Za-z_$][\w$.]*(<[^>]*>)?/;
const REL_LINE = /^\s*[A-Za-z_$][\w$.]*(<[^>]*>)?\s*(--\|>|<\|--|\.\.\|>|<\|\.\.|\*--|--\*|o--|--o|-->|<--|\.\.>|<\.\.|-\(\)|--)/;

const umlStream = StreamLanguage.define<State>({
  name: 'uml',
  startState: () => ({ inBlock: false, afterHeader: false, relLine: false, lineStart: true, enumBlock: false }),
  token(stream: StringStream, state: State) {
    if (stream.sol()) {
      state.lineStart = true;
      state.afterHeader = false;
      state.relLine = REL_LINE.test(stream.string);
      if (/^\s*$/.test(stream.string)) state.inBlock = false;
    }
    if (stream.eatSpace()) return null;
    const atStart = state.lineStart;
    state.lineStart = false;

    if (atStart) {
      if (stream.match(/^\/\/.*/) || stream.match(/^#(\s.*)?$/)) return 'comment';
      if (stream.match(/^@[\w-]+/)) { state.inBlock = false; return 'keyword'; }
      if (stream.match(/^(abstract\s+class|class|interface|enum)\b/)) {
        state.inBlock = true;
        state.afterHeader = true;
        state.enumBlock = stream.current().startsWith('enum');
        return 'keyword';
      }
      if (state.inBlock && !state.relLine) {
        if (stream.match(/^-{3,}\s*$/)) { state.enumBlock = false; return 'contentSeparator'; }
        if (stream.match(/^[+\-#~]/)) return 'operator';
      }
    }

    if (state.relLine) {
      if (stream.match(/^\s+#\s.*$/) || stream.match(/^\s*\/\/.*$/)) return 'comment';
      if (stream.match(REL_OPS)) return 'operator';
      if (stream.match(/^\[[^\]]*\]/)) return 'number';
      if (stream.match(/^:.*?(?=\s*(\[|\s#\s|\/\/|$))/)) return 'string';
      if (stream.match(NAME)) return 'typeName';
      stream.next();
      return null;
    }

    if (state.afterHeader) {
      if (stream.match(/^<<[^>]*>>/)) return 'meta';
      if (stream.match(NAME)) return 'className';
    }
    if (/^\s*@/.test(stream.string)) {
      if (stream.match(/^\s+#\s.*$/)) return 'comment';
      if (stream.match(/^(down|right|compact|normal|loose|on|off)\b/)) return 'atom';
      if (stream.match(/^[\w.-]+(?=\s*:)/)) return 'labelName';
      if (stream.match(NAME)) return 'typeName';
      stream.next();
      return null;
    }
    if (state.inBlock) {
      if (stream.match(/^\{\s*(abstract|static)\s*\}/)) return 'modifier';
      if (state.enumBlock && stream.match(/^[A-Z_][A-Z0-9_]*\b/)) return 'atom';
      if (stream.match(/^:\s*/)) return 'punctuation';
      if (stream.match(/^[A-Z][\w$]*(<[^>]*>)?/)) return 'typeName';
      if (stream.match(/^[a-z_$][\w$]*/)) return 'variableName';
      stream.next();
      return null;
    }
    stream.skipToEnd();
    return null;
  },
  languageData: { commentTokens: { line: '//' } },
  tokenTable: {
    className: t.className,
    contentSeparator: t.contentSeparator,
    labelName: t.labelName,
  },
});

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: t.className, color: 'var(--syn-class)', fontWeight: '600' },
  { tag: t.typeName, color: 'var(--syn-type)' },
  { tag: t.operator, color: 'var(--syn-op)', fontWeight: '600' },
  { tag: t.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: t.string, color: 'var(--syn-string)' },
  { tag: t.number, color: 'var(--syn-number)' },
  { tag: t.meta, color: 'var(--syn-meta)' },
  { tag: t.modifier, color: 'var(--syn-meta)', fontStyle: 'italic' },
  { tag: t.atom, color: 'var(--syn-number)' },
  { tag: t.contentSeparator, color: 'var(--syn-op)', fontWeight: '600' },
  { tag: t.labelName, color: 'var(--syn-class)' },
  { tag: t.variableName, color: 'var(--syn-var)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--editor-bg)', color: 'var(--text)' },
  // Ligatures would draw "--|>" as an arrow glyph; the operators should look as typed.
  '.cm-scroller': { fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: '1.55', fontVariantLigatures: 'none', fontFeatureSettings: '"liga" 0, "calt" 0' },
  '.cm-gutters': { backgroundColor: 'var(--editor-gutter)', color: 'var(--muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--editor-active)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--editor-active)' },
  '.cm-content': { caretColor: 'var(--text)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--text)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--editor-selection) !important' },
  '.cm-tooltip': { backgroundColor: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.14)' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: "'Source Sans 3', Helvetica, Arial, sans-serif", fontSize: '14px', maxHeight: '22em', minWidth: '260px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '4px 10px', lineHeight: '1.4' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent)', color: 'var(--accent-text)' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > completion-section': { padding: '6px 10px 2px', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', borderBottom: 'none' },
  '.cm-completionDetail': { marginLeft: '10px', fontStyle: 'normal', opacity: '0.65', fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: '12px' },
  '.cm-completionInfo': { padding: '8px 10px', maxWidth: '420px' },
  '.cm-slash-preview': { margin: '0', fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: '11.5px', lineHeight: '1.45', maxHeight: '320px', overflow: 'auto', whiteSpace: 'pre', fontVariantLigatures: 'none', fontFeatureSettings: '"liga" 0, "calt" 0' },
  '.cm-snippetField': { backgroundColor: 'var(--editor-selection)', borderRadius: '2px' },
});

export interface Editor {
  view: EditorView;
  setErrors(errors: ParseError[]): void;
  setText(text: string): void;
}

export function createEditor(parent: HTMLElement, doc: string, onChange: (text: string) => void): Editor {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        bracketMatching(),
        umlStream,
        syntaxHighlighting(highlight),
        lintGutter(),
        slashCommands,
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        theme,
        EditorView.updateListener.of((u) => { if (u.docChanged) onChange(u.state.doc.toString()); }),
      ],
    }),
  });

  return {
    view,
    setErrors(errors) {
      const diags: Diagnostic[] = [];
      for (const e of errors) {
        if (e.line < 1 || e.line > view.state.doc.lines) continue;
        const line = view.state.doc.line(e.line);
        diags.push({ from: line.from, to: line.to, severity: 'error', message: `Line ${e.line}: ${e.message}` });
      }
      view.dispatch(setDiagnostics(view.state, diags));
    },
    setText(text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
  };
}
