import type { DiagramLayout, EdgeLayout, NodeLayout, Point, Rect } from './layout';
import { FONTS, METRICS } from './measure';
import type { Member, RelKind } from './model';
import { STYLE } from './render';

const xml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#xa;');
const html = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const r = (v: number) => Math.round(v * 100) / 100;

const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,400;0,700;1,400;1,700';
const FONT = `fontFamily=Source Sans 3;fontSource=${encodeURIComponent(FONT_CSS)};`;

const EDGE_STYLE: Record<Exclude<RelKind, 'lollipop'>, string> = {
  inheritance: 'endArrow=block;endFill=0;endSize=12;',
  realization: 'endArrow=block;endFill=0;endSize=12;dashed=1;dashPattern=5 3;',
  composition: 'startArrow=diamondThin;startFill=1;startSize=14;endArrow=none;',
  aggregation: 'startArrow=diamondThin;startFill=0;startSize=14;endArrow=none;',
  association: 'endArrow=open;endFill=0;endSize=8;',
  dependency: 'endArrow=open;endFill=0;endSize=8;dashed=1;dashPattern=5 3;',
  link: 'endArrow=none;',
};

function memberHtml(m: Member): string {
  let s = html(m.text);
  if (m.isAbstract) s = `<i>${s}</i>`;
  if (m.isStatic) s = `<u>${s}</u>`;
  return s;
}

/** Compartment value: one line per member, joined with newlines (written as &#xa;). */
function compartmentValue(members: Member[]): string {
  if (!members.length) return '';
  return `<div style="line-height:${METRICS.memberLine}px">${members.map(memberHtml).join('\n')}</div>`;
}

function headerValue(nd: NodeLayout): string {
  const name = nd.def.kind === 'abstract' ? `<b><i>${html(nd.def.name)}</i></b>` : `<b>${html(nd.def.name)}</b>`;
  if (!nd.box.stereotypeText) return name;
  return `<span style="font-weight:normal;font-size:${FONTS.stereotype.size}px">${html(nd.box.stereotypeText)}</span><br>${name}`;
}

function polylineMidpoint(pts: Point[]): Point {
  const lens = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  let half = lens.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < lens.length; i++) {
    if (half <= lens[i] || i === lens.length - 1) {
      const t = lens[i] ? half / lens[i] : 0;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t };
    }
    half -= lens[i];
  }
  return pts[0];
}

const centerOf = (b: Rect): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const rel = (p: Point, b: Rect) => ({ x: r(Math.min(1, Math.max(0, (p.x - b.x) / b.width))), y: r(Math.min(1, Math.max(0, (p.y - b.y) / b.height))) });

export function toDrawio(layout: DiagramLayout): string {
  const cells: string[] = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  const idOf = (name: string) => `cls-${name.replace(/[^\w-]/g, '_')}`;
  const nodeByName = new Map(layout.nodes.map((n) => [n.def.name, n]));

  if (layout.frames) {
    layout.groups.forEach((g, i) => {
      cells.push(
        `<mxCell id="grp-${i}" value="${xml(g.name)}" style="rounded=1;absoluteArcSize=1;arcSize=12;dashed=1;dashPattern=4 3;fillColor=none;strokeColor=${STYLE.frame};fontColor=${STYLE.frameText};fontSize=11;align=left;verticalAlign=top;spacingLeft=8;spacingTop=0;html=1;${FONT}" vertex="1" parent="1">` +
        `<mxGeometry x="${r(g.x)}" y="${r(g.y)}" width="${r(g.width)}" height="${r(g.height)}" as="geometry"/></mxCell>`,
      );
    });
  }

  for (const nd of layout.nodes) {
    const id = idOf(nd.def.name);
    const { box } = nd;
    const fill = STYLE.fill[nd.def.kind];
    cells.push(
      `<mxCell id="${id}" value="${xml(headerValue(nd))}" style="swimlane;fontStyle=1;align=center;verticalAlign=middle;childLayout=stackLayout;horizontal=1;startSize=${box.headerHeight};horizontalStack=0;resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=0;marginBottom=0;html=1;whiteSpace=nowrap;fillColor=${fill};swimlaneFillColor=#ffffff;strokeColor=${STYLE.stroke};fontColor=${STYLE.text};fontSize=${FONTS.name.size};${FONT}" vertex="1" parent="1">` +
      `<mxGeometry x="${r(nd.x)}" y="${r(nd.y)}" width="${r(nd.width)}" height="${r(nd.height)}" as="geometry"/></mxCell>`,
    );
    const textStyle = `text;strokeColor=none;fillColor=none;align=left;verticalAlign=top;spacing=0;spacingLeft=${METRICS.hpad};spacingTop=${METRICS.pad};overflow=hidden;rotatable=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;html=1;whiteSpace=nowrap;fontColor=${STYLE.text};fontSize=${FONTS.member.size};${FONT}`;
    cells.push(
      `<mxCell id="${id}-attrs" value="${xml(compartmentValue(box.attrs.members))}" style="${textStyle}" vertex="1" parent="${id}">` +
      `<mxGeometry y="${box.attrs.y}" width="${r(nd.width)}" height="${box.attrs.height}" as="geometry"/></mxCell>`,
    );
    if (box.methods) {
      cells.push(
        `<mxCell id="${id}-line" value="" style="line;strokeWidth=1;fillColor=none;align=left;verticalAlign=middle;spacingTop=-1;spacingLeft=3;spacingRight=3;rotatable=0;labelPosition=right;points=[];portConstraint=eastwest;strokeColor=${STYLE.stroke};" vertex="1" parent="${id}">` +
        `<mxGeometry y="${box.methods.y}" width="${r(nd.width)}" height="1" as="geometry"/></mxCell>`,
      );
      cells.push(
        `<mxCell id="${id}-methods" value="${xml(compartmentValue(box.methods.members))}" style="${textStyle};spacingTop=${METRICS.pad - 1}" vertex="1" parent="${id}">` +
        `<mxGeometry y="${box.methods.y + 1}" width="${r(nd.width)}" height="${box.methods.height - 1}" as="geometry"/></mxCell>`,
      );
    }
  }

  layout.edges.forEach((e: EdgeLayout, i) => {
    if (e.rel.kind === 'lollipop' || e.points.length < 2) return;
    const src = nodeByName.get(e.rel.source)!, tgt = nodeByName.get(e.rel.target)!;
    const pts = e.points;
    const exit = rel(pts[0], src), entry = rel(pts[pts.length - 1], tgt);
    const center = e.labels.find((l) => l.role === 'center');
    const id = `edge-${i}`;
    const style =
      `edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;html=1;${EDGE_STYLE[e.rel.kind]}` +
      `exitX=${exit.x};exitY=${exit.y};exitDx=0;exitDy=0;exitPerimeter=0;entryX=${entry.x};entryY=${entry.y};entryDx=0;entryDy=0;entryPerimeter=0;` +
      `strokeColor=${STYLE.stroke};fontColor=${STYLE.text};fontSize=${FONTS.label.size};labelBackgroundColor=#ffffff;${FONT}`;
    let geo = '<mxGeometry relative="1" as="geometry">';
    if (pts.length > 2) geo += `<Array as="points">${pts.slice(1, -1).map((p) => `<mxPoint x="${r(p.x)}" y="${r(p.y)}"/>`).join('')}</Array>`;
    if (center) {
      const mid = polylineMidpoint(pts), c = centerOf(center);
      geo += `<mxPoint x="${r(c.x - mid.x)}" y="${r(c.y - mid.y)}" as="offset"/>`;
    }
    geo += '</mxGeometry>';
    cells.push(`<mxCell id="${id}" value="${xml(center?.text ?? '')}" style="${style}" edge="1" parent="1" source="${idOf(src.def.name)}" target="${idOf(tgt.def.name)}">${geo}</mxCell>`);
    for (const l of e.labels) {
      if (l.role === 'center') continue;
      const end = l.role === 'source' ? pts[0] : pts[pts.length - 1];
      const c = centerOf(l);
      cells.push(
        `<mxCell id="${id}-${l.role}" value="${xml(l.text)}" style="edgeLabel;resizable=0;html=1;align=center;verticalAlign=middle;labelBackgroundColor=none;fontColor=${STYLE.text};fontSize=${FONTS.label.size};${FONT}" vertex="1" connectable="0" parent="${id}">` +
        `<mxGeometry x="${l.role === 'source' ? -1 : 1}" relative="1" as="geometry"><mxPoint x="${r(c.x - end.x)}" y="${r(c.y - end.y)}" as="offset"/></mxGeometry></mxCell>`,
      );
    }
  });

  layout.lollipops.forEach((l, i) => {
    const owner = nodeByName.get(l.owner)!;
    const id = `lol-${i}`;
    cells.push(
      `<mxCell id="${id}" value="" style="ellipse;html=1;aspect=fixed;fillColor=#ffffff;strokeColor=${STYLE.stroke};" vertex="1" parent="1">` +
      `<mxGeometry x="${r(l.center.x - l.radius)}" y="${r(l.center.y - l.radius)}" width="${l.radius * 2}" height="${l.radius * 2}" as="geometry"/></mxCell>`,
    );
    const exit = rel(l.stub[0], owner);
    cells.push(
      `<mxCell id="${id}-stub" value="" style="endArrow=none;html=1;rounded=0;strokeColor=${STYLE.stroke};exitX=${exit.x};exitY=${exit.y};exitDx=0;exitDy=0;exitPerimeter=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;" edge="1" parent="1" source="${idOf(owner.def.name)}" target="${id}">` +
      '<mxGeometry relative="1" as="geometry"/></mxCell>',
    );
    cells.push(
      `<mxCell id="${id}-name" value="${xml(l.name)}" style="text;html=1;align=left;verticalAlign=middle;spacing=0;fontStyle=2;fontColor=${STYLE.text};fontSize=${FONTS.label.size};${FONT}" vertex="1" parent="1">` +
      `<mxGeometry x="${r(l.text.x)}" y="${r(l.text.y)}" width="${r(l.text.width + 4)}" height="${r(l.text.height)}" as="geometry"/></mxCell>`,
    );
  });

  return (
    `<mxfile host="uml-maker" type="device"><diagram id="uml" name="Class diagram">` +
    `<mxGraphModel dx="0" dy="0" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="${layout.width}" pageHeight="${layout.height}" math="0" shadow="0">` +
    `<root>${cells.join('')}</root></mxGraphModel></diagram></mxfile>\n`
  );
}
