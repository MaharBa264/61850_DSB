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
    case 'IFL':
      return [L(m, 0, m, 44), L(m, 54, m - 8, 40), L(m, 54, m + 8, 40), L(m - 8, 40, m + 8, 40)];
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
  if (windings >= 3) p.push(C(m - 18, m, 14), L(m - 32, m, 0, m));
  return p;
}

/** Coordenadas `sxy` tal como están en el archivo (sin escalar). */
export function relXY(e: Element): { x: number; y: number } {
  return {
    x: parseInt(e.getAttributeNS(SXY_NS, 'x') ?? '0', 10) || 0,
    y: parseInt(e.getAttributeNS(SXY_NS, 'y') ?? '0', 10) || 0,
  };
}

export const hasXY = (e: Element) => e.hasAttributeNS(SXY_NS, 'x') || e.hasAttributeNS(SXY_NS, 'y');

/**
 * Unidad de las coordenadas de los equipos de un campo. En los proyectos DSB una
 * unidad es una celda; ABB PCM600 exporta cada campo en su propio lienzo y en
 * unidades de ~480 por celda (valores como 780, 2220, 4620).
 */
export const ABB_UNIT = 480;
const ABB_THRESHOLD = 400;

let unitCache = new WeakMap<Element, number>();
let offsets = new WeakMap<Element, { x: number; y: number }>();

export function bayUnit(bay: Element): number {
  let u = unitCache.get(bay);
  if (u === undefined) {
    let max = 0;
    for (const e of Array.from(bay.querySelectorAll('ConductingEquipment, ConnectivityNode'))) {
      const r = relXY(e);
      max = Math.max(max, Math.abs(r.x), Math.abs(r.y));
    }
    u = max >= ABB_THRESHOLD ? ABB_UNIT : 1;
    unitCache.set(bay, u);
  }
  return u;
}

/** Unidades de archivo por celda en las que se expresan las coordenadas de `e`. */
export function unitOf(e: Element): number {
  const bay = e.tagName === 'Bay' ? null : e.closest('Bay');
  return bay ? bayUnit(bay) : 1;
}

/**
 * Coordenadas absolutas en celdas (suma de los ancestros hasta `SCL`). Los
 * elementos dentro de un campo se escalan por la unidad del campo; los campos
 * importados sin posición propia llevan el desplazamiento de `layoutImportedBays`.
 */
export function absXY(e: Element): { x: number; y: number } {
  let x = 0;
  let y = 0;
  const bay = e.tagName === 'Bay' ? null : e.closest('Bay');
  const unit = bay ? bayUnit(bay) : 1;
  for (let n: Element | null = e; n && n.tagName !== 'SCL'; n = n.parentElement) {
    const r = relXY(n);
    const inside = bay !== null && n !== bay && bay.contains(n);
    x += inside ? r.x / unit : r.x;
    y += inside ? r.y / unit : r.y;
    const off = offsets.get(n);
    if (off) {
      x += off.x;
      y += off.y;
    }
  }
  return { x, y };
}

/**
 * Los campos importados (p. ej. ABB PCM600) traen cada uno su propio lienzo y no
 * tienen posición propia: se acomodan uno al lado del otro dentro de su nivel de
 * tensión, y los niveles uno debajo del otro.
 */
export function layoutImportedBays(sub: Element): void {
  unitCache = new WeakMap();
  offsets = new WeakMap();
  const auto = (bay: Element) => !hasXY(bay) && Array.from(bay.querySelectorAll('ConductingEquipment')).some(hasXY);
  const nativeEls = [
    ...Array.from(sub.querySelectorAll(':scope > PowerTransformer')),
    ...Array.from(sub.querySelectorAll('ConductingEquipment')).filter(e => {
      const b = e.closest('Bay');
      return !b || !auto(b);
    }),
  ];
  let cursorY = nativeEls.length ? Math.max(...nativeEls.map(e => absXY(e).y)) + 4 : 1;
  for (const vl of Array.from(sub.querySelectorAll(':scope > VoltageLevel'))) {
    const bays = Array.from(vl.querySelectorAll(':scope > Bay')).filter(auto);
    if (!bays.length) continue;
    let cursorX = 1;
    let h = 0;
    for (const bay of bays) {
      const pts = Array.from(bay.querySelectorAll('ConductingEquipment, ConnectivityNode'))
        .filter(hasXY)
        .map(absXY);
      const minX = Math.min(...pts.map(q => q.x));
      const maxX = Math.max(...pts.map(q => q.x));
      const minY = Math.min(...pts.map(q => q.y));
      const maxY = Math.max(...pts.map(q => q.y));
      offsets.set(bay, { x: cursorX - minX, y: cursorY - minY });
      cursorX += maxX - minX + 3;
      h = Math.max(h, maxY - minY + 2);
    }
    cursorY += h + 3;
  }
}

interface Endpoint {
  x: number;
  y: number;
  /** `true` si el terminal sale por arriba. */
  top: boolean;
  /** X (px) de la primera columna del campo al que pertenece el equipo. */
  bayX?: number;
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
  layoutImportedBays(substation);
  const groups: DrawGroup[] = [];
  const cnByPath = new Map<string, Element>();
  for (const cn of Array.from(substation.querySelectorAll('ConnectivityNode'))) {
    const bay = cn.parentElement;
    const vl = bay?.parentElement;
    cnByPath.set(
      cn.getAttribute('pathName') ?? `${substation.getAttribute('name')}/${vl?.getAttribute('name')}/${bay?.getAttribute('name')}/${cn.getAttribute('name')}`,
      cn
    );
  }
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
      let top = i === 0;
      // si el archivo da la posición del nodo de conexión, el terminal sale hacia donde está el nodo
      const cn = cnByPath.get(t.getAttribute('connectivityNode') ?? '');
      if (cn && hasXY(cn) && hasXY(ce)) {
        const cy = absXY(cn).y;
        if (cy < a.y) top = true;
        else if (cy > a.y) top = false;
      }
      addEndpoint(t.getAttribute('connectivityNode'), {
        x: px + CELL / 2,
        y: top ? py : py + CELL,
        top,
        bayX: ce.parentElement ? absXY(ce.parentElement).x * CELL : undefined,
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
    prims.push({ k: 'text', x: px + CELL / 2 + 18, y: py + CELL / 2 + 4, t: name, size: 11 });
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
          : { x: px, y: py + CELL / 2, top: false, wd };
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
    if (winding?.wd?.dir === 'side') {
      // Tercer arrollamiento: sale por la izquierda y baja por un corredor
      // vertical a la izquierda de la primera columna del campo destino.
      for (const o of eps.filter(e => !e.wd)) {
        const xc = (o.bayX ?? winding.x) - 24;
        const yo = o.y + (o.top ? -20 : 20);
        wires.push(
          L(winding.x, winding.y, xc, winding.y),
          L(xc, winding.y, xc, yo),
          L(xc, yo, o.x, yo),
          L(o.x, yo, o.x, o.y),
          C(o.x, o.y, 3, true)
        );
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
      prims: [{ k: 'text', x, y, t: [bay.getAttribute('name'), bay.getAttribute('desc')].filter(Boolean).join(' — '), size: 14 }],
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
