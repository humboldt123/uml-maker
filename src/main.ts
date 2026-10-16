import './style.css';
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { createEditor } from './editor';
import { parse } from './parser';
import { layoutDiagram, type DiagramLayout } from './layout';
import { CanvasMeasurer, loadDiagramFonts } from './measure';
import { renderSvg } from './render';
import { checkLayout } from './checks';
import { exportDrawio, exportPdf, exportPng, exportSvg } from './exports';
import gofExample from './examples/gof.uml?raw';
import libraryExample from './examples/library.uml?raw';

const EXAMPLES: Record<string, string> = { gof: gofExample, library: libraryExample };
const STORAGE_KEY = 'uml-maker:source';
const THEME_KEY = 'uml-maker:theme';
const DEBOUNCE_MS = 300;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/* ---------------- storage ---------------- */

function load(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function save(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable or full */ }
}

function initialSource(): string {
  const m = /(?:^#|&)code=([^&]+)/.exec(location.hash);
  if (m) {
    const text = decompressFromEncodedURIComponent(m[1]);
    if (text) return text;
  }
  return load(STORAGE_KEY) ?? gofExample;
}

/* ---------------- toast ---------------- */

let toastTimer = 0;
function toast(msg: string) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 2200);
}

/* ---------------- pan & zoom ---------------- */

const viewport = $('viewport');
const stage = $('stage');
const view = { x: 0, y: 0, k: 1 };
const MIN_K = 0.05, MAX_K = 6;

function applyView() {
  stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
  $('zoom-level').textContent = `${Math.round(view.k * 100)}%`;
}

function zoomAt(factor: number, cx: number, cy: number) {
  const k = Math.min(MAX_K, Math.max(MIN_K, view.k * factor));
  const f = k / view.k;
  view.x = cx - (cx - view.x) * f;
  view.y = cy - (cy - view.y) * f;
  view.k = k;
  applyView();
}

function fit() {
  if (!layout) return;
  const pad = 24;
  const vw = viewport.clientWidth, vh = viewport.clientHeight;
  const k = Math.min(2, (vw - pad * 2) / layout.width, (vh - pad * 2) / layout.height);
  view.k = Math.max(MIN_K, k);
  view.x = (vw - layout.width * view.k) / 2;
  view.y = (vh - layout.height * view.k) / 2;
  applyView();
}

viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = viewport.getBoundingClientRect();
  if (e.ctrlKey || e.metaKey) {
    zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
  } else {
    view.x -= e.deltaX;
    view.y -= e.deltaY;
    applyView();
  }
}, { passive: false });

let drag: { x: number; y: number; id: number } | null = null;
viewport.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  drag = { x: e.clientX - view.x, y: e.clientY - view.y, id: e.pointerId };
  viewport.setPointerCapture(e.pointerId);
  viewport.classList.add('panning');
});
viewport.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  view.x = e.clientX - drag.x;
  view.y = e.clientY - drag.y;
  applyView();
});
const endDrag = () => { drag = null; viewport.classList.remove('panning'); };
viewport.addEventListener('pointerup', endDrag);
viewport.addEventListener('pointercancel', endDrag);

const zoomCenter = (f: number) => zoomAt(f, viewport.clientWidth / 2, viewport.clientHeight / 2);
$('zoom-in').onclick = () => zoomCenter(1.25);
$('zoom-out').onclick = () => zoomCenter(1 / 1.25);
$('zoom-level').onclick = () => zoomCenter(1 / view.k);
$('fit').onclick = fit;

/* ---------------- rendering ---------------- */

const measurer = new CanvasMeasurer();
let layout: DiagramLayout | null = null;
let renderToken = 0;
let fitted = false;
let debounce = 0;

function setStatus(html: string) { $('status').innerHTML = html; }
const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

async function update(text: string) {
  const token = ++renderToken;
  const { diagram, errors } = parse(text);
  editor.setErrors(errors);
  if (errors.length) {
    stage.classList.add('stale');
    const e = errors[0];
    const more = errors.length > 1 ? ` (+${errors.length - 1} more)` : '';
    setStatus(`<span class="err" data-line="${e.line}">Line ${e.line}: ${escHtml(e.message)}</span><span>${more ? escHtml(more) + ' · ' : ''}showing last good diagram</span>`);
    return;
  }
  try {
    const t0 = performance.now();
    const next = await layoutDiagram(diagram, measurer);
    if (token !== renderToken) return; // a newer edit superseded this one
    layout = next;
    stage.innerHTML = renderSvg(next, measurer);
    stage.classList.remove('stale');
    $('empty').hidden = next.nodes.length > 0;
    if (!fitted && next.nodes.length) { fit(); fitted = true; }
    const ms = Math.round(performance.now() - t0);
    const rels = next.edges.length + next.lollipops.length;
    setStatus(`<span class="ok">✓ Rendered</span><span>${next.nodes.length} classes · ${rels} relationships · ${next.width}×${next.height}px · layout ${ms} ms</span>`);
  } catch (err) {
    if (token !== renderToken) return;
    console.error(err);
    stage.classList.add('stale');
    setStatus(`<span class="err">Layout failed: ${escHtml(String((err as Error)?.message ?? err))}</span>`);
  }
}

$('status').addEventListener('click', (e) => {
  const line = Number((e.target as HTMLElement).dataset.line);
  if (!line) return;
  const v = editor.view;
  const pos = v.state.doc.line(Math.min(line, v.state.doc.lines)).from;
  v.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
  v.focus();
});

const editor = createEditor($('editor'), initialSource(), (text) => {
  save(STORAGE_KEY, text);
  clearTimeout(debounce);
  debounce = window.setTimeout(() => update(text), DEBOUNCE_MS);
});

/* ---------------- toolbar ---------------- */

$<HTMLSelectElement>('example').onchange = (e) => {
  const sel = e.target as HTMLSelectElement;
  const src = EXAMPLES[sel.value];
  sel.value = '';
  if (!src) return;
  editor.setText(src);
  fitted = false;
};

function baseName(): string {
  const first = layout?.nodes[0]?.def.name;
  return first ? `uml-${first.toLowerCase()}` : 'diagram';
}

function wire(id: string, fn: (l: DiagramLayout) => Promise<void> | void) {
  const btn = $<HTMLButtonElement>(id);
  btn.onclick = async () => {
    if (!layout) return toast('Nothing to export yet');
    btn.disabled = true;
    try { await fn(layout); } catch (err) { console.error(err); toast(`Export failed: ${(err as Error).message}`); } finally { btn.disabled = false; }
  };
}
wire('export-svg', (l) => exportSvg(l, measurer, baseName()));
wire('export-png', (l) => exportPng(l, measurer, baseName()));
wire('export-pdf', (l) => exportPdf(l, measurer, baseName()));
wire('export-drawio', (l) => exportDrawio(l, baseName()));

$('share').onclick = async () => {
  const code = compressToEncodedURIComponent(editor.view.state.doc.toString());
  const url = `${location.origin}${location.pathname}#code=${code}`;
  history.replaceState(null, '', url);
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied to clipboard');
  } catch {
    toast('Link is in the address bar');
  }
};

$('theme').onclick = () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  save(THEME_KEY, root.dataset.theme);
};

/* ---------------- resizable split ---------------- */

const divider = $('divider');
divider.addEventListener('pointerdown', (e) => {
  divider.setPointerCapture(e.pointerId);
  divider.classList.add('dragging');
  const move = (ev: PointerEvent) => {
    const pct = Math.min(75, Math.max(18, (ev.clientX / window.innerWidth) * 100));
    document.querySelector<HTMLElement>('.split')!.style.setProperty('--editor-width', `${pct}%`);
  };
  const up = () => {
    divider.classList.remove('dragging');
    divider.removeEventListener('pointermove', move);
    divider.removeEventListener('pointerup', up);
  };
  divider.addEventListener('pointermove', move);
  divider.addEventListener('pointerup', up);
});

window.addEventListener('hashchange', () => {
  const m = /(?:^#|&)code=([^&]+)/.exec(location.hash);
  const text = m && decompressFromEncodedURIComponent(m[1]);
  if (text && text !== editor.view.state.doc.toString()) { editor.setText(text); fitted = false; }
});

/* ---------------- debug hook for tests ---------------- */

declare global {
  interface Window { __uml?: { layout: () => DiagramLayout | null; problems: () => ReturnType<typeof checkLayout>; source: () => string; ready: Promise<void> } }
}

const ready = (async () => {
  await loadDiagramFonts();
  await update(editor.view.state.doc.toString());
})();
window.__uml = { layout: () => layout, problems: () => (layout ? checkLayout(layout) : []), source: () => editor.view.state.doc.toString(), ready };
