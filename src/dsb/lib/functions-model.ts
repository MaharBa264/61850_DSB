/**
 * Asignación de funciones (etapa C): LNode con `iedName="None"` sobre equipos,
 * campos y transformadores. Es la "especificación" (SSD): las funciones quedan
 * reservadas hasta que se asigne un IED.
 *
 * Funciones puras sobre el SCL; las ediciones se devuelven como `EditV2`.
 */
import type { EditV2 } from '@compas-oscd/core';

import {
  BayKind,
  FunctionDef,
  functionById,
  FUNCTIONS,
  Package,
  TargetKind,
  TRANSFORMER_PACKAGE,
  typicalPackage,
} from './functions-catalog.js';
import { BAY_PRIVATE_TYPE, DSB_NS, SCL_NS } from './project-model.js';

export const FUNCTION_PRIVATE_TYPE = 'DSB-Function';
export const UNASSIGNED = 'None';

export interface Assigned {
  lnode: Element;
  /** `FunctionDef.id`, o `''` si el LNode no fue creado por DSB. */
  functionId: string;
  ansi: string;
  name: string;
  lnClass: string;
  lnInst: string;
}

/** Tipo de objeto del unifilar al que se asigna (para filtrar el catálogo). */
export function targetKind(el: Element): TargetKind | null {
  if (el.tagName === 'Bay') return 'BAY';
  if (el.tagName === 'PowerTransformer') return 'PTR';
  if (el.tagName === 'ConductingEquipment') {
    const t = el.getAttribute('type');
    return t === 'CBR' || t === 'DIS' || t === 'ERS' || t === 'CTR' || t === 'VTR' ? t : null;
  }
  return null;
}

/** Tipo del campo: marca DSB o, si falta, deducción por su equipamiento. */
export function bayKind(bay: Element): BayKind | null {
  const marked = Array.from(bay.children)
    .find(c => c.tagName === 'Private' && c.getAttribute('type') === BAY_PRIVATE_TYPE)
    ?.getElementsByTagNameNS(DSB_NS, 'Bay')[0]
    ?.getAttribute('template');
  if (marked === 'linea' || marked === 'alimentador' || marked === 'trafo') return marked;
  const eq = Array.from(bay.querySelectorAll(':scope > ConductingEquipment'));
  if (!eq.length) return null;
  if (eq.some(e => e.getAttribute('type') === 'ERS')) return 'linea';
  if (eq.some(e => e.getAttribute('name') === 'QB9')) return 'alimentador';
  return 'trafo';
}

/** LNode asignados (propios del elemento, no de sus hijos). */
export function listAssigned(el: Element): Assigned[] {
  return Array.from(el.children)
    .filter(c => c.tagName === 'LNode')
    .map(lnode => {
      const meta = Array.from(lnode.children)
        .find(c => c.tagName === 'Private' && c.getAttribute('type') === FUNCTION_PRIVATE_TYPE)
        ?.getElementsByTagNameNS(DSB_NS, 'Function')[0];
      const id = meta?.getAttribute('id') ?? '';
      const def = functionById(id);
      return {
        lnode,
        functionId: id,
        ansi: meta?.getAttribute('ansi') ?? def?.ansi ?? '',
        name: meta?.getAttribute('name') ?? def?.name ?? lnode.getAttribute('lnClass') ?? '',
        lnClass: lnode.getAttribute('lnClass') ?? '',
        lnInst: lnode.getAttribute('lnInst') ?? '',
      };
    });
}

/** Reparte `lnInst` sin repetir por clase dentro de toda la subestación. */
export class LnAllocator {
  private used = new Map<string, Set<number>>();

  constructor(scope?: Element) {
    scope?.querySelectorAll('LNode').forEach(n => this.reserve(n.getAttribute('lnClass') ?? '', n.getAttribute('lnInst') ?? ''));
  }

  reserve(lnClass: string, lnInst: string): void {
    const n = parseInt(lnInst, 10);
    if (!lnClass || !Number.isFinite(n)) return;
    if (!this.used.has(lnClass)) this.used.set(lnClass, new Set());
    this.used.get(lnClass)!.add(n);
  }

  next(lnClass: string): string {
    const s = this.used.get(lnClass) ?? new Set<number>();
    let n = 1;
    while (s.has(n)) n++;
    this.reserve(lnClass, String(n));
    return String(n);
  }
}

/** Crea el LNode de una función (sin insertarlo). */
export function createFunctionLNode(
  doc: XMLDocument,
  def: FunctionDef,
  alloc: LnAllocator
): Element {
  const ln = doc.createElementNS(SCL_NS, 'LNode');
  ln.setAttribute('iedName', UNASSIGNED);
  ln.setAttribute('lnClass', def.lnClass);
  ln.setAttribute('lnInst', alloc.next(def.lnClass));
  const p = doc.createElementNS(SCL_NS, 'Private');
  p.setAttribute('type', FUNCTION_PRIVATE_TYPE);
  const f = doc.createElementNS(DSB_NS, 'dsb:Function');
  f.setAttribute('id', def.id);
  f.setAttribute('ansi', def.ansi);
  f.setAttribute('name', def.name);
  p.appendChild(f);
  ln.appendChild(p);
  return ln;
}

/** Referencia de inserción: después de Private/Text/LNode existentes. */
export function lnodeReference(parent: Element): Element | null {
  return (
    Array.from(parent.children).find(
      c => c.tagName !== 'Private' && c.tagName !== 'Text' && c.tagName !== 'LNode'
    ) ?? null
  );
}

/** Edición que agrega una función a un elemento. */
export function addFunctionEdit(
  doc: XMLDocument,
  target: Element,
  def: FunctionDef,
  alloc: LnAllocator
): EditV2 {
  return { parent: target, node: createFunctionLNode(doc, def, alloc), reference: lnodeReference(target) };
}

/** Ediciones del paquete típico para un campo (equipos y el campo en sí). */
export function bayPackageEdits(
  doc: XMLDocument,
  bay: Element,
  kV: number,
  alloc: LnAllocator,
  kind: BayKind | null = bayKind(bay)
): EditV2[] {
  if (!kind) return [];
  const pkg: Package = typicalPackage(kind, kV);
  const edits: EditV2[] = [];
  const add = (el: Element, ids: string[] | undefined) => {
    const have = new Set(listAssigned(el).map(a => a.functionId));
    // Los LNode nuevos de un mismo elemento van uno tras otro, en orden.
    for (const id of ids ?? []) {
      const def = functionById(id);
      if (!def || have.has(id)) continue;
      edits.push(addFunctionEdit(doc, el, def, alloc));
    }
  };
  for (const eq of Array.from(bay.querySelectorAll(':scope > ConductingEquipment'))) {
    const t = targetKind(eq);
    if (t) add(eq, pkg[t]);
  }
  add(bay, pkg.BAY);
  return edits;
}

/** Ediciones del paquete típico para un transformador de potencia. */
export function transformerPackageEdits(
  doc: XMLDocument,
  pt: Element,
  alloc: LnAllocator
): EditV2[] {
  const have = new Set(listAssigned(pt).map(a => a.functionId));
  return TRANSFORMER_PACKAGE.filter(id => !have.has(id)).flatMap(id => {
    const def = functionById(id);
    return def ? [addFunctionEdit(doc, pt, def, alloc)] : [];
  });
}

export interface FunctionRow {
  functionId: string;
  group: string;
  voltageLevel: string;
  bay: string;
  object: string;
  kind: string;
  ansi: string;
  name: string;
  lnClass: string;
  lnInst: string;
  assignedTo: string;
}

/** Todas las funciones asignadas de la subestación, con su ubicación. */
export function collectFunctions(substation: Element): FunctionRow[] {
  const rows: FunctionRow[] = [];
  const push = (el: Element, vl: string, bay: string, object: string, kind: string) => {
    for (const a of listAssigned(el))
      rows.push({
        functionId: a.functionId,
        group: functionById(a.functionId)?.group ?? 'Otras',
        voltageLevel: vl,
        bay,
        object,
        kind,
        ansi: a.ansi,
        name: a.name,
        lnClass: a.lnClass,
        lnInst: a.lnInst,
        assignedTo: a.lnode.getAttribute('iedName') ?? UNASSIGNED,
      });
  };
  for (const pt of Array.from(substation.querySelectorAll(':scope > PowerTransformer')))
    push(pt, '', '', pt.getAttribute('name') ?? '', 'Transformador de potencia');
  for (const vl of Array.from(substation.querySelectorAll(':scope > VoltageLevel'))) {
    const vlName = vl.getAttribute('name') ?? '';
    for (const bay of Array.from(vl.querySelectorAll(':scope > Bay'))) {
      const bayName = bay.getAttribute('name') ?? '';
      push(bay, vlName, bayName, bayName, 'Campo');
      for (const eq of Array.from(bay.querySelectorAll(':scope > ConductingEquipment')))
        push(eq, vlName, bayName, eq.getAttribute('name') ?? '', eq.getAttribute('type') ?? '');
    }
  }
  return rows;
}

export interface FunctionSummary {
  group: string;
  ansi: string;
  name: string;
  lnClass: string;
  count: number;
}

/** Cantidad de cada función (para el presupuesto), de protección y control primero. */
export function summarize(rows: FunctionRow[]): FunctionSummary[] {
  const m = new Map<string, FunctionSummary>();
  for (const r of rows) {
    const key = `${r.ansi}|${r.name}|${r.lnClass}`;
    const cur = m.get(key) ?? { group: r.group, ansi: r.ansi, name: r.name, lnClass: r.lnClass, count: 0 };
    cur.count++;
    m.set(key, cur);
  }
  const order = new Map(FUNCTIONS.map((f, i) => [f.name, i]));
  return Array.from(m.values()).sort(
    (a, b) => (order.get(a.name) ?? 999) - (order.get(b.name) ?? 999)
  );
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV (separador `;`, apto para Excel en español) con todas las funciones. */
export function toFunctionsCsv(rows: FunctionRow[]): string {
  const head = ['Nivel de tensión', 'Campo', 'Objeto', 'Tipo', 'Grupo', 'ANSI', 'Función', 'Clase LN', 'Instancia', 'Asignada a'];
  const lines = [head.join(';')];
  for (const r of rows)
    lines.push(
      [r.voltageLevel, r.bay, r.object, r.kind, r.group, r.ansi, r.name, r.lnClass, r.lnInst, r.assignedTo]
        .map(csvCell)
        .join(';')
    );
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** Resumen (cantidad por función) en CSV. */
export function toSummaryCsv(summary: FunctionSummary[]): string {
  const lines = [['Grupo', 'ANSI', 'Función', 'Clase LN', 'Cantidad'].join(';')];
  for (const s of summary) lines.push([s.group, s.ansi, s.name, s.lnClass, s.count].map(csvCell).join(';'));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/**
 * SSD (System Specification Description): el proyecto sin IEDs ni
 * comunicación; conserva Header, Substation (con LNode `None`) y plantillas.
 */
export function toSsd(doc: XMLDocument): string {
  const copy = doc.cloneNode(true) as XMLDocument;
  copy.querySelectorAll(':root > IED, :root > Communication').forEach(n => n.remove());
  const header = copy.querySelector(':root > Header');
  header?.setAttribute('toolID', 'DSB');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(copy.documentElement) + '\n';
}
