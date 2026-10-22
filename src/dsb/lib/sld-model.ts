/**
 * Modelo de dibujo del unifilar (etapa B): SCL -> primitivas geométricas.
 *
 * Función pura, sin UI. Las mismas primitivas alimentan el visor SVG y la
 * exportación (SVG/DXF), de modo que lo que se ve es lo que sale en AutoCAD.
 * Convención: una celda = CELL px; cada equipo ocupa una celda de CELL×CELL con
 * terminal superior en (CELL/2, 0) e inferior en (CELL/2, CELL).
 */
import { SXY_NS } from './project-model.js';

export const CELL = 60;

export type Prim =
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { k: 'circle'; cx: number; cy: number; r: number; fill?: boolean }
  | { k: 'rect'; x: number; y: number; w: number; h: number }
  | { k: 'text'; x: number; y: number; t: string; size: number };

export type GroupKind = 'equipment' | 'transformer' | 'busbar' | 'bay' | 'wire';

export interface DrawGroup {
  id: string;
  kind: GroupKind;
  /** Elemento SCL asociado (para seleccionar / mover / borrar). */
  element?: Element;
  label: string;
  type?: string;
  prims: Prim[];
}

export interface SldModel {
  groups: DrawGroup[];
  width: number;
  height: number;
}

const L = (x1: number, y1: number, x2: number, y2: number): Prim => ({ k: 'line', x1, y1, x2, y2 });
const C = (cx: number, cy: number, r: number, fill = false): Prim => ({ k: 'circle', cx, cy, r, fill });

/** Símbolos IEC 60617 en una celda CELL×CELL (origen arriba-izquierda). */
export function symbolPrims(type: string, terminals: number): Prim[] {
  const m = CELL / 2;
  switch (type) {
    case 'CBR':
      return [
        L(m, 0, m, 14), L(m, 46, m, 60), L(m, 46, m - 12, 16),
        L(m - 5, 41, m + 5, 51), L(m - 5, 51, m + 5, 41),
      ];
    case 'DIS':
      return [L(m, 0, m, 14), L(m, 46, m, 60), L(m, 46, m - 12, 16), L(m - 6, 14, m + 6, 14)];
    case 'ERS':
      return [
        L(m, 0, m, 14), L(m, 38, m, 44), L(m, 38, m - 12, 16), L(m - 6, 14, m + 6, 14),
        L(m - 10, 44, m + 10, 44), L(m - 6, 49, m + 6, 49), L(m - 2, 54, m + 2, 54),
      ];
    case 'CTR':
      return [L(m, 0, m, 60), C(m, m, 10)];
    case 'VTR':
      return [L(m, 0, m, 12), C(m, 22, 10), C(m, 36, 10)];
    default:
      return terminals > 1
        ? [L(m, 0, m, 15), L(m, 45, m, 60), { k: 'rect', x: m - 12, y: 15, w: 24, h: 30 }]
        : [L(m, 0, m, 15), { k: 'rect', x: m - 12, y: 15, w: 24, h: 30 }];
  }
}

/** Símbolo de transformador de potencia (2 o 3 arrollamientos). */
export function transformerPrims(windings: number): Prim[] {
  const m = CELL / 2;
  const p: Prim[] = [L(m, 0, m, 8), L(m, 52, m, 60), C(m, 22, 14), C(m, 38, 14)];
  if (windings >= 3) p.push(C(m + 18, m, 14), L(m + 32, m, CELL, m));
  return p;
}

export function relXY(e: Element): { x: number; y: number } {
  return {
    x: parseInt(e.getAttributeNS(SXY_NS, 'x') ?? '0', 10) || 0,
    y: parseInt(e.getAttributeNS(SXY_NS, 'y') ?? '0', 10) || 0,
  };
}

/** Coordenadas absolutas en celdas (suma de los ancestros hasta `SCL`). */
export function absXY(e: Element): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let n: Element | null = e; n && n.tagName !== 'SCL'; n = n.parentElement) {
    const r = relXY(n);
    x += r.x;
    y += r.y;
  }
  return { x, y };
}

interface Endpoint {
  x: number;
  y: number;
  /** `true` si el terminal sale por arriba. */
  top: boolean;
  /** Presente si el terminal es de un arrollamiento de transformador. */
  wd?: { dir: 'top' | 'bottom' | 'side'; idx: number; px: number; py: number };
}

function idOf(e: Element): string {
  const parts: string[] = [];
  for (let n: Element | null = e; n && n.tagName !== 'SCL'; n = n.parentElement)
    parts.unshift(n.getAttribute('name') ?? n.tagName);
  return parts.join('/');
}

/** Construye el modelo de dibujo de una subestación. */
export function buildSldModel(substation: Element): SldModel {
  const groups: DrawGroup[] = [];
  const nodes = new Map<string, Endpoint[]>(); // connectivityNode path -> endpoints
  const busbarByPath = new Map<string, { y: number; name: string; el: Element }>();
  let maxX = 0;
  let maxY = 0;
  const grow = (x: number, y: number) => {
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  // Barras: Bay con un único ConnectivityNode.
  for (const bay of Array.from(substation.querySelectorAll('Bay'))) {
    if (bay.children.length === 1 && bay.children[0].tagName === 'ConnectivityNode') {
      const a = absXY(bay);
      const cn = bay.children[0];
      const vl = bay.parentElement!;
      const path =
        cn.getAttribute('pathName') ??
        `${substation.getAttribute('name')}/${vl.getAttribute('name')}/${bay.getAttribute('name')}/${cn.getAttribute('name')}`;
      busbarByPath.set(path, { y: a.y * CELL + CELL / 2, name: bay.getAttribute('name') ?? '', el: bay });
    }
  }

  const addEndpoint = (path: string | null, ep: Endpoint) => {
    if (!path) return;
    if (!nodes.has(path)) nodes.set(path, []);
    nodes.get(path)!.push(ep);
  };

  // Equipos de maniobra y medida.
  for (const ce of Array.from(substation.querySelectorAll('ConductingEquipment'))) {
    const a = absXY(ce);
    const px = a.x * CELL;
    const py = a.y * CELL;
    const terms = Array.from(ce.children).filter(c => c.tagName === 'Terminal');
    const type = ce.getAttribute('type') ?? '';
    const name = ce.getAttribute('name') ?? '';
    const prims = symbolPrims(type, terms.length).map(p => shift(p, px, py));
    prims.push({ k: 'text', x: px + CELL / 2 + 14, y: py + CELL / 2 + 4, t: name, size: 11 });
    groups.push({ id: idOf(ce), kind: 'equipment', element: ce, label: name, type, prims });
    terms.forEach((t, i) => {
      const top = i === 0;
      addEndpoint(t.getAttribute('connectivityNode'), {
        x: px + CELL / 2,
        y: top ? py : py + CELL,
        top,
      });
    });
    grow(px + CELL, py + CELL);
  }

  // Transformadores de potencia.
  for (const pt of Array.from(substation.querySelectorAll('PowerTransformer'))) {
    const a = absXY(pt);
    const px = a.x * CELL;
    const py = a.y * CELL;
    const windings = Array.from(pt.children).filter(c => c.tagName === 'TransformerWinding');
    const name = pt.getAttribute('name') ?? '';
    const prims = transformerPrims(windings.length).map(p => shift(p, px, py));
    prims.push({ k: 'text', x: px, y: py + CELL + 12, t: name, size: 11 });
    groups.push({ id: idOf(pt), kind: 'transformer', element: pt, label: name, type: 'PTR', prims });
    windings.forEach((w, i) => {
      const t = w.querySelector(':scope > Terminal');
      const dir = i === 0 ? 'top' : i === 1 ? 'bottom' : 'side';
      const wd = { dir, idx: i, px, py } as const;
      const ep: Endpoint =
        i === 0
          ? { x: px + CELL / 2, y: py, top: true, wd }
          : i === 1
          ? { x: px + CELL / 2, y: py + CELL, top: false, wd }
          : { x: px + CELL, y: py + CELL / 2, top: false, wd };
      addEndpoint(t?.getAttribute('connectivityNode') ?? null, ep);
    });
    grow(px + CELL, py + CELL);
  }

  // Barras (líneas horizontales) y conexiones.
  const wires: Prim[] = [];
  // Todas las barras de un nivel de tensión comparten el mismo largo.
  const vlRange = new Map<Element, { min: number; max: number }>();
  for (const [path, eps] of nodes) {
    const bus = busbarByPath.get(path);
    if (!bus) continue;
    const vl = bus.el.parentElement!;
    const r = vlRange.get(vl) ?? { min: Infinity, max: -Infinity };
    for (const e of eps) {
      r.min = Math.min(r.min, e.x);
      r.max = Math.max(r.max, e.x);
    }
    vlRange.set(vl, r);
  }
  const busPrims = new Map<string, Prim[]>();
  for (const [path, eps] of nodes) {
    const bus = busbarByPath.get(path);
    if (bus) {
      const range = vlRange.get(bus.el.parentElement!)!;
      const x1 = range.min - CELL / 2;
      const x2 = range.max + CELL / 2;
      const prims: Prim[] = [L(x1, bus.y, x2, bus.y), L(x1, bus.y - 1, x2, bus.y - 1), L(x1, bus.y + 1, x2, bus.y + 1)];
      prims.push({ k: 'text', x: x1 + 2, y: bus.y - 8, t: bus.name, size: 12 });
      busPrims.set(path, prims);
      for (const e of eps) {
        wires.push(L(e.x, e.y, e.x, bus.y));
        wires.push(C(e.x, bus.y, 3, true));
      }
      grow(x2, bus.y);
      continue;
    }
    if (eps.length < 2) continue;
    const winding = eps.find(e => e.wd);
    if (winding?.wd) {
      // Arrollamiento de transformador: ruta ortogonal por un corredor vertical.
      const w = winding.wd;
      const xc = w.px + CELL + 24 + 12 * w.idx;
      for (const o of eps.filter(e => !e.wd)) {
        const yo = o.y + (o.top ? -20 : 20);
        const yw = w.dir === 'top' ? w.py - 20 : w.dir === 'bottom' ? w.py + CELL + 20 : w.py + CELL / 2;
        wires.push(L(o.x, o.y, o.x, yo), L(o.x, yo, xc, yo), L(xc, yo, xc, yw));
        if (w.dir === 'side') wires.push(L(xc, yw, winding.x, yw));
        else wires.push(L(xc, yw, winding.x, yw), L(winding.x, yw, winding.x, winding.y));
        wires.push(C(o.x, o.y, 3, true));
      }
      continue;
    }
    const ys = eps.map(e => e.y);
    const xs = eps.map(e => e.x);
    const yRail = (Math.min(...ys) + Math.max(...ys)) / 2;
    for (const e of eps) wires.push(L(e.x, e.y, e.x, yRail));
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    if (xMax > xMin) wires.push(L(xMin, yRail, xMax, yRail));
    const distinct = new Set(xs);
    if (eps.length >= 3 || distinct.size > 1)
      for (const x of distinct) if (eps.filter(e => e.x === x).length > 1 || distinct.size > 1) wires.push(C(x, yRail, 3, true));
  }
  for (const [path, prims] of busPrims) {
    const bus = busbarByPath.get(path)!;
    groups.push({ id: idOf(bus.el), kind: 'busbar', element: bus.el, label: bus.name, prims });
  }
  // Barras sin conexiones: dibujar un tramo mínimo para poder verlas.
  for (const [path, bus] of busbarByPath) {
    if (busPrims.has(path)) continue;
    const a = absXY(bus.el);
    const x1 = a.x * CELL;
    groups.push({
      id: idOf(bus.el),
      kind: 'busbar',
      element: bus.el,
      label: bus.name,
      prims: [L(x1, bus.y, x1 + 4 * CELL, bus.y), { k: 'text', x: x1 + 2, y: bus.y - 8, t: bus.name, size: 12 }],
    });
  }
  if (wires.length) groups.unshift({ id: 'wires', kind: 'wire', label: '', prims: wires });

  // Etiquetas de campo.
  for (const bay of Array.from(substation.querySelectorAll('Bay'))) {
    if (busbarByPath.size && Array.from(busbarByPath.values()).some(b => b.el === bay)) continue;
    const eqs = Array.from(bay.querySelectorAll('ConductingEquipment'));
    if (!eqs.length) continue;
    const ps = eqs.map(absXY);
    const x = Math.min(...ps.map(p => p.x)) * CELL;
    const y = Math.min(...ps.map(p => p.y)) * CELL - 8;
    groups.push({
      id: idOf(bay),
      kind: 'bay',
      element: bay,
      label: bay.getAttribute('name') ?? '',
      prims: [{ k: 'text', x, y, t: bay.getAttribute('name') ?? '', size: 14 }],
    });
  }
  return { groups, width: maxX + CELL, height: maxY + CELL };
}

function shift(p: Prim, dx: number, dy: number): Prim {
  switch (p.k) {
    case 'line':
      return { ...p, x1: p.x1 + dx, y1: p.y1 + dy, x2: p.x2 + dx, y2: p.y2 + dy };
    case 'circle':
      return { ...p, cx: p.cx + dx, cy: p.cy + dy };
    case 'rect':
      return { ...p, x: p.x + dx, y: p.y + dy };
    case 'text':
      return { ...p, x: p.x + dx, y: p.y + dy };
  }
}
