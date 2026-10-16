import type { DiagramLayout } from './layout';
import type { Measurer } from './measure';
import { renderSvg } from './render';
import { toDrawio } from './drawio';

const GOOGLE_CSS = 'https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,400;0,700;1,400;1,700&display=swap';
const FACES = [
  { file: 'SourceSans3-Regular.ttf', style: 'normal', weight: 400, jspdf: 'normal' },
  { file: 'SourceSans3-Bold.ttf', style: 'normal', weight: 700, jspdf: 'bold' },
  { file: 'SourceSans3-It.ttf', style: 'italic', weight: 400, jspdf: 'italic' },
  { file: 'SourceSans3-BoldIt.ttf', style: 'italic', weight: 700, jspdf: 'bolditalic' },
] as const;

const fontUrl = (file: string) => `${import.meta.env.BASE_URL}fonts/${file}`;

function bytesToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function fetchBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return bytesToBase64(await res.arrayBuffer());
}

let fontCssPromise: Promise<string> | null = null;

/**
 * @font-face rules with the font data inlined, so exported SVG/PNG render with
 * the same font as the screen. Prefers Google's small latin woff2 subsets and
 * falls back to the bundled TTFs.
 */
export function embeddedFontCss(): Promise<string> {
  fontCssPromise ??= (async () => {
    try {
      const css = await (await fetch(GOOGLE_CSS)).text();
      const blocks = css.split('@font-face').slice(1).map((b) => '@font-face' + b.slice(0, b.indexOf('}') + 1));
      const latin = blocks.filter((b) => /unicode-range:\s*U\+0000-00FF/i.test(b));
      if (latin.length < 4) throw new Error('unexpected Google Fonts CSS');
      const out = await Promise.all(latin.map(async (b) => {
        const url = /url\((https:[^)]+)\)/.exec(b)![1];
        const data = await fetchBase64(url);
        return b.replace(/src:[^;]+;/, `src: url(data:font/woff2;base64,${data}) format('woff2');`).replace(/unicode-range:[^;]+;/, '');
      }));
      return out.join('\n');
    } catch {
      const out = await Promise.all(FACES.map(async (f) =>
        `@font-face{font-family:'Source Sans 3';font-style:${f.style};font-weight:${f.weight};src:url(data:font/ttf;base64,${await fetchBase64(fontUrl(f.file))}) format('truetype');}`));
      return out.join('\n');
    }
  })().catch((e) => { fontCssPromise = null; throw e; });
  return fontCssPromise;
}

export function download(name: string, data: Blob) {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function standaloneSvg(layout: DiagramLayout, m: Measurer): Promise<string> {
  let fontCss = '';
  try { fontCss = await embeddedFontCss(); } catch { /* export without embedded fonts */ }
  return `<?xml version="1.0" encoding="UTF-8"?>\n` + renderSvg(layout, m, { fontCss });
}

export async function exportSvg(layout: DiagramLayout, m: Measurer, name: string) {
  download(`${name}.svg`, new Blob([await standaloneSvg(layout, m)], { type: 'image/svg+xml' }));
}

export async function pngBlob(layout: DiagramLayout, m: Measurer, scale = 3): Promise<Blob> {
  const svg = await standaloneSvg(layout, m);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not rasterize the SVG'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(layout.width * scale);
    canvas.height = Math.round(layout.height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportPng(layout: DiagramLayout, m: Measurer, name: string) {
  download(`${name}.png`, await pngBlob(layout, m, 3));
}

export async function pdfBlob(layout: DiagramLayout, m: Measurer): Promise<Blob> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const { width: W, height: H } = layout;
  const doc = new jsPDF({ unit: 'pt', format: [W, H], orientation: W >= H ? 'landscape' : 'portrait', compress: true });
  await Promise.all(FACES.map(async (f) => {
    doc.addFileToVFS(f.file, await fetchBase64(fontUrl(f.file)));
    doc.addFont(f.file, 'Source Sans 3', f.jspdf);
  }));
  const el = new DOMParser().parseFromString(renderSvg(layout, m), 'image/svg+xml').documentElement as unknown as SVGSVGElement;
  // svg2pdf resolves styles via the DOM, so the element must be attached while it runs.
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden';
  holder.appendChild(el);
  document.body.appendChild(holder);
  try {
    await svg2pdf(el, doc, { x: 0, y: 0, width: W, height: H });
  } finally {
    holder.remove();
  }
  return doc.output('blob');
}

export async function exportPdf(layout: DiagramLayout, m: Measurer, name: string) {
  download(`${name}.pdf`, await pdfBlob(layout, m));
}

export function exportDrawio(layout: DiagramLayout, name: string) {
  download(`${name}.drawio`, new Blob([toDrawio(layout)], { type: 'application/xml' }));
}
