/**
 * Exportación del modelo de dibujo (SldModel) a SVG y DXF (AutoCAD).
 * Ambas salidas parten de las mismas primitivas que el visor.
 */
import { DrawGroup, Prim, SldModel } from './sld-model.js';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function primToSvg(p: Prim): string {
  switch (p.k) {
    case 'line':
      return `<line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}"/>`;
    case 'circle':
      return `<circle cx="${p.cx}" cy="${p.cy}" r="${p.r}"${p.fill ? ' fill="currentColor"' : ' fill="none"'}/>`;
    case 'rect':
      return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="none"/>`;
    case 'text':
      return `<text x="${p.x}" y="${p.y}" font-size="${p.size}" stroke="none" fill="currentColor">${esc(p.t)}</text>`;
  }
}

/** SVG autónomo (fondo blanco, trazo negro) apto para imprimir o abrir en otras herramientas. */
export function toSvg(model: SldModel): string {
  const body = model.groups
    .map(g => `<g data-kind="${g.kind}" data-id="${esc(g.id)}">${g.prims.map(primToSvg).join('')}</g>`)
    .join('\n');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${model.width}" height="${model.height}" ` +
    `viewBox="0 0 ${model.width} ${model.height}" color="#000" stroke="#000" stroke-width="1.5" ` +
    `fill="none" font-family="Arial, sans-serif">\n<rect width="100%" height="100%" fill="#fff" stroke="none"/>\n${body}\n</svg>`
  );
}

/** Capa DXF por tipo de grupo. */
const LAYERS: Record<DrawGroup['kind'], { name: string; color: number }> = {
  equipment: { name: 'EQUIPOS', color: 7 },
  transformer: { name: 'TRANSFORMADORES', color: 7 },
  busbar: { name: 'BARRAS', color: 1 },
  bay: { name: 'TEXTOS_CAMPO', color: 3 },
  wire: { name: 'CONEXIONES', color: 5 },
};

/**
 * DXF ASCII (AutoCAD R12). Unidad: 1 celda = 60 unidades del dibujo; el eje Y
 * se invierte (en DXF crece hacia arriba). Capas: EQUIPOS, TRANSFORMADORES,
 * BARRAS, CONEXIONES, TEXTOS_CAMPO.
 */
export function toDxf(model: SldModel): string {
  const out: (string | number)[] = [];
  const g = (code: number, value: string | number) => out.push(code, value);
  const H = model.height;
  const f = (n: number) => Number(n.toFixed(3));

  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, Object.keys(LAYERS).length);
  for (const l of Object.values(LAYERS)) {
    g(0, 'LAYER'); g(2, l.name); g(70, 0); g(62, l.color); g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  for (const grp of model.groups) {
    const layer = LAYERS[grp.kind].name;
    for (const p of grp.prims) {
      switch (p.k) {
        case 'line':
          g(0, 'LINE'); g(8, layer);
          g(10, f(p.x1)); g(20, f(H - p.y1)); g(30, 0);
          g(11, f(p.x2)); g(21, f(H - p.y2)); g(31, 0);
          break;
        case 'circle':
          g(0, 'CIRCLE'); g(8, layer);
          g(10, f(p.cx)); g(20, f(H - p.cy)); g(30, 0); g(40, p.fill ? 2 : p.r);
          break;
        case 'rect': {
          const pts = [
            [p.x, p.y], [p.x + p.w, p.y], [p.x + p.w, p.y + p.h], [p.x, p.y + p.h], [p.x, p.y],
          ];
          for (let i = 0; i < 4; i++) {
            g(0, 'LINE'); g(8, layer);
            g(10, f(pts[i][0])); g(20, f(H - pts[i][1])); g(30, 0);
            g(11, f(pts[i + 1][0])); g(21, f(H - pts[i + 1][1])); g(31, 0);
          }
          break;
        }
        case 'text':
          g(0, 'TEXT'); g(8, layer);
          g(10, f(p.x)); g(20, f(H - p.y)); g(30, 0); g(40, p.size); g(1, p.t);
          break;
      }
    }
  }
  g(0, 'ENDSEC'); g(0, 'EOF');
  // Pares código/valor, una línea cada uno (formato DXF).
  const lines: string[] = [];
  for (let i = 0; i < out.length; i += 2) lines.push(String(out[i]).padStart(3, ' '), String(out[i + 1]));
  return lines.join('\r\n') + '\r\n';
}
