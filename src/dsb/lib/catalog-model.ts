/**
 * Catálogo de IEDs y switches (etapa D) y verificación de capacidad.
 *
 * - Modelo de IED = capacidad por clase de nodo lógico (p. ej. 4 PTOC, 1 PDIS)
 *   + entradas/salidas + puertos + protocolos. Se carga a mano o desde un
 *   ICD/IID (se cuentan los LN del archivo).
 * - Un IED "planificado" se asigna a un campo o transformador como
 *   `Private type="DSB-Ied"` (no crea todavía el elemento `IED` del SCL: eso
 *   llega al importar el ICD real).
 * - Los modelos usados viajan dentro del proyecto (`Private type="DSB-Catalog"`
 *   en la Substation), así el archivo se verifica en cualquier equipo.
 *
 * Funciones puras sobre el SCL; las ediciones se devuelven como `EditV2`.
 */
import type { EditV2 } from '@compas-oscd/core';

import { listAssigned } from './functions-model.js';
import { DSB_NS, SCL_NS } from './project-model.js';

export const CATALOG_PRIVATE_TYPE = 'DSB-Catalog';
export const IED_PRIVATE_TYPE = 'DSB-Ied';

export const PROTOCOLS = ['GOOSE', 'MMS', 'SV', 'IEC 104', 'DNP3', 'Modbus'] as const;
export const REDUNDANCY = ['RSTP', 'PRP', 'HSR'] as const;

export interface IedModel {
  id: string;
  manufacturer: string;
  model: string;
  description: string;
  /** Entradas digitales, salidas digitales y canales analógicos (TC/TV). */
  digitalIn: number;
  digitalOut: number;
  analogIn: number;
  /** Puertos Ethernet de cobre (RJ45) y de fibra. */
  copper: number;
  fiber: number;
  protocols: string[];
  /** Capacidad por clase de nodo lógico. */
  capacity: Record<string, number>;
  /** Precio unitario de referencia (opcional, en la moneda que use el usuario). */
  price?: number;
  source: 'manual' | 'icd';
}

export interface SwitchModel {
  id: string;
  manufacturer: string;
  model: string;
  description: string;
  copper: number;
  fiber: number;
  /** Velocidad por puerto, en Mbit/s. */
  speed: number;
  redundancy: string[];
  poe: boolean;
  price?: number;
}

export interface Catalog {
  ieds: IedModel[];
  switches: SwitchModel[];
}

export const emptyCatalog = (): Catalog => ({ ieds: [], switches: [] });

export function slug(...parts: string[]): string {
  return parts
    .join(' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const newIedModel = (): IedModel => ({
  id: '',
  manufacturer: '',
  model: '',
  description: '',
  digitalIn: 0,
  digitalOut: 0,
  analogIn: 0,
  copper: 0,
  fiber: 0,
  protocols: [],
  capacity: {},
  source: 'manual',
});

export const newSwitchModel = (): SwitchModel => ({
  id: '',
  manufacturer: '',
  model: '',
  description: '',
  copper: 0,
  fiber: 0,
  speed: 100,
  redundancy: [],
  poe: false,
});

const nonNeg = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/** Errores de validación (lista vacía = válido). */
export function validateIedModel(m: IedModel): string[] {
  const e: string[] = [];
  if (!m.manufacturer.trim()) e.push('El fabricante es obligatorio.');
  if (!m.model.trim()) e.push('El modelo es obligatorio.');
  for (const [k, v] of [
    ['entradas digitales', m.digitalIn],
    ['salidas digitales', m.digitalOut],
    ['canales analógicos', m.analogIn],
    ['puertos de cobre', m.copper],
    ['puertos de fibra', m.fiber],
  ] as [string, number][])
    if (!nonNeg(v)) e.push(`Cantidad de ${k} inválida.`);
  if (m.price !== undefined && !nonNeg(m.price)) e.push('El precio no puede ser negativo.');
  for (const [k, v] of Object.entries(m.capacity)) if (!/^[A-Z][A-Za-z0-9]{1,3}$/.test(k) || !(v > 0)) e.push(`Capacidad inválida: ${k}.`);
  return e;
}

export function validateSwitchModel(m: SwitchModel): string[] {
  const e: string[] = [];
  if (!m.manufacturer.trim()) e.push('El fabricante es obligatorio.');
  if (!m.model.trim()) e.push('El modelo es obligatorio.');
  if (!nonNeg(m.copper) || !nonNeg(m.fiber)) e.push('Cantidad de puertos inválida.');
  if (m.copper + m.fiber < 2) e.push('Un switch necesita al menos 2 puertos.');
  if (!(m.speed > 0)) e.push('La velocidad debe ser positiva.');
  if (m.price !== undefined && !nonNeg(m.price)) e.push('El precio no puede ser negativo.');
  return e;
}

/** Normaliza (id derivado del fabricante y modelo, textos recortados). */
export function normalizeIed(m: IedModel): IedModel {
  const manufacturer = m.manufacturer.trim();
  const model = m.model.trim();
  return { ...m, manufacturer, model, description: m.description.trim(), id: m.id || slug(manufacturer, model) };
}

export function normalizeSwitch(m: SwitchModel): SwitchModel {
  const manufacturer = m.manufacturer.trim();
  const model = m.model.trim();
  return { ...m, manufacturer, model, description: m.description.trim(), id: m.id || slug(manufacturer, model) };
}

/** Agrega o reemplaza por `id`. */
export function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex(x => x.id === item.id);
  if (i < 0) return [...list, item];
  const c = [...list];
  c[i] = item;
  return c;
}

// ---------- importación de ICD / IID ----------

/** LN que no representan capacidad de función. */
const IGNORED_LN = new Set(['LPHD', 'LLN0']);

/** Un modelo por cada `IED` del archivo: cuenta los LN por clase. */
export function modelsFromIcd(doc: XMLDocument): IedModel[] {
  const out: IedModel[] = [];
  for (const ied of Array.from(doc.querySelectorAll(':root > IED'))) {
    const capacity: Record<string, number> = {};
    for (const ln of Array.from(ied.querySelectorAll('LN'))) {
      const c = ln.getAttribute('lnClass');
      if (c && !IGNORED_LN.has(c)) capacity[c] = (capacity[c] ?? 0) + 1;
    }
    const protocols: string[] = [];
    if (ied.querySelector('GSEControl')) protocols.push('GOOSE');
    if (ied.querySelector('ReportControl')) protocols.push('MMS');
    if (ied.querySelector('SampledValueControl')) protocols.push('SV');
    const manufacturer = ied.getAttribute('manufacturer') ?? '';
    const model = ied.getAttribute('type') ?? ied.getAttribute('name') ?? '';
    out.push(
      normalizeIed({
        ...newIedModel(),
        manufacturer,
        model,
        description: ied.getAttribute('desc') ?? '',
        protocols,
        capacity,
        source: 'icd',
      })
    );
  }
  return out;
}

// ---------- catálogo en archivo JSON ----------

export function catalogToJson(c: Catalog): string {
  return JSON.stringify({ format: 'dsb-catalog', version: 1, ...c }, null, 2);
}

/** Lee un JSON exportado; ignora entradas inválidas. */
export function catalogFromJson(text: string): Catalog {
  const raw = JSON.parse(text);
  if (!raw || raw.format !== 'dsb-catalog') throw new Error('El archivo no es un catálogo DSB.');
  const ieds: IedModel[] = (Array.isArray(raw.ieds) ? raw.ieds : [])
    .map((m: IedModel) => normalizeIed({ ...newIedModel(), ...m }))
    .filter((m: IedModel) => validateIedModel(m).length === 0);
  const switches: SwitchModel[] = (Array.isArray(raw.switches) ? raw.switches : [])
    .map((m: SwitchModel) => normalizeSwitch({ ...newSwitchModel(), ...m }))
    .filter((m: SwitchModel) => validateSwitchModel(m).length === 0);
  return { ieds, switches };
}

// ---------- modelos dentro del proyecto ----------

const el = (doc: XMLDocument, tag: string, attrs: Record<string, string> = {}) => {
  const e = doc.createElementNS(SCL_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

const dsb = (doc: XMLDocument, tag: string, attrs: Record<string, string>) => {
  const e = doc.createElementNS(DSB_NS, `dsb:${tag}`);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

const privateOf = (parent: Element, type: string) =>
  Array.from(parent.children).find(c => c.tagName === 'Private' && c.getAttribute('type') === type) ?? null;

/** Primer hijo que no sea Private/Text: ahí se insertan los `Private` nuevos. */
const afterPrivates = (parent: Element) =>
  Array.from(parent.children).find(c => c.tagName !== 'Private' && c.tagName !== 'Text') ?? null;

/** Modelos de IED guardados en el proyecto. */
export function readSnapshot(substation: Element): IedModel[] {
  const priv = privateOf(substation, CATALOG_PRIVATE_TYPE);
  if (!priv) return [];
  return Array.from(priv.getElementsByTagNameNS(DSB_NS, 'IedModel')).map(m => {
    const num = (a: string) => parseFloat(m.getAttribute(a) ?? '0') || 0;
    const capacity: Record<string, number> = {};
    for (const c of Array.from(m.getElementsByTagNameNS(DSB_NS, 'Cap')))
      capacity[c.getAttribute('lnClass') ?? ''] = parseInt(c.getAttribute('qty') ?? '0', 10) || 0;
    const price = m.getAttribute('price');
    return {
      id: m.getAttribute('id') ?? '',
      manufacturer: m.getAttribute('manufacturer') ?? '',
      model: m.getAttribute('model') ?? '',
      description: m.getAttribute('description') ?? '',
      digitalIn: num('digitalIn'),
      digitalOut: num('digitalOut'),
      analogIn: num('analogIn'),
      copper: num('copper'),
      fiber: num('fiber'),
      protocols: (m.getAttribute('protocols') ?? '').split(',').filter(Boolean),
      capacity,
      price: price === null || price === '' ? undefined : parseFloat(price),
      source: m.getAttribute('source') === 'icd' ? 'icd' : 'manual',
    } as IedModel;
  });
}

function snapshotElement(doc: XMLDocument, models: IedModel[]): Element {
  const priv = el(doc, 'Private', { type: CATALOG_PRIVATE_TYPE });
  for (const m of models) {
    const e = dsb(doc, 'IedModel', {
      id: m.id,
      manufacturer: m.manufacturer,
      model: m.model,
      description: m.description,
      digitalIn: String(m.digitalIn),
      digitalOut: String(m.digitalOut),
      analogIn: String(m.analogIn),
      copper: String(m.copper),
      fiber: String(m.fiber),
      protocols: m.protocols.join(','),
      source: m.source,
    });
    if (m.price !== undefined) e.setAttribute('price', String(m.price));
    for (const [lnClass, qty] of Object.entries(m.capacity)) e.appendChild(dsb(doc, 'Cap', { lnClass, qty: String(qty) }));
    priv.appendChild(e);
  }
  return priv;
}

/** Ediciones que dejan en el proyecto exactamente estos modelos. */
export function snapshotEdits(doc: XMLDocument, substation: Element, models: IedModel[]): EditV2[] {
  const old = privateOf(substation, CATALOG_PRIVATE_TYPE);
  const edits: EditV2[] = [];
  if (old) edits.push({ node: old });
  if (models.length) edits.push({ parent: substation, node: snapshotElement(doc, models), reference: old ? old.nextElementSibling : afterPrivates(substation) });
  return edits;
}

// ---------- IED planificados ----------

/** Objetos que llevan IED: transformadores de potencia y campos (no barras). */
export function hostsOf(substation: Element): Element[] {
  const hosts: Element[] = Array.from(substation.querySelectorAll(':scope > PowerTransformer'));
  for (const bay of Array.from(substation.querySelectorAll(':scope > VoltageLevel > Bay')))
    if (bay.querySelector(':scope > ConductingEquipment')) hosts.push(bay);
  return hosts;
}

export interface PlannedIed {
  node: Element;
  name: string;
  modelId: string;
  role: string;
}

export const ROLES = ['Protección y control', 'Protección', 'Control', 'Medición', 'Unidad de campo'] as const;

export function listIeds(host: Element): PlannedIed[] {
  return Array.from(host.children)
    .filter(c => c.tagName === 'Private' && c.getAttribute('type') === IED_PRIVATE_TYPE)
    .map(node => {
      const m = node.getElementsByTagNameNS(DSB_NS, 'Ied')[0];
      return {
        node,
        name: m?.getAttribute('name') ?? '',
        modelId: m?.getAttribute('model') ?? '',
        role: m?.getAttribute('role') ?? '',
      };
    });
}

/** Todos los IED planificados del proyecto. */
export function allIeds(substation: Element): PlannedIed[] {
  return hostsOf(substation).flatMap(listIeds);
}

export function createPlannedIed(doc: XMLDocument, name: string, modelId: string, role: string): Element {
  const priv = el(doc, 'Private', { type: IED_PRIVATE_TYPE });
  priv.appendChild(dsb(doc, 'Ied', { name, model: modelId, role }));
  return priv;
}

export function addIedEdit(doc: XMLDocument, host: Element, name: string, modelId: string, role: string): EditV2 {
  return { parent: host, node: createPlannedIed(doc, name, modelId, role), reference: afterPrivates(host) };
}

/** Nombre libre: `<campo>_<rol>` con sufijo numérico si hace falta. */
export function suggestIedName(substation: Element, host: Element, role: string, extraUsed: Iterable<string> = []): string {
  const used = new Set([...allIeds(substation).map(i => i.name), ...extraUsed]);
  const code = role === 'Protección' ? 'P' : role === 'Control' ? 'C' : role === 'Medición' ? 'M' : role === 'Unidad de campo' ? 'UC' : 'PC';
  const base = `${host.getAttribute('name') ?? 'IED'}_${code}`.replace(/[^A-Za-z0-9_]/g, '_');
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

/** Nombre válido y sin repetir (los IED se nombran igual en todo el SCD). */
export function validateIedName(substation: Element, name: string): string | null {
  if (!name.trim()) return 'El nombre del IED es obligatorio.';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name.trim())) return 'Use letras, números y "_"; no puede empezar con número.';
  if (name.length > 64) return 'Máximo 64 caracteres.';
  if (allIeds(substation).some(i => i.name === name.trim())) return `Ya existe un IED llamado "${name.trim()}".`;
  return null;
}

// ---------- requerimientos y verificación ----------

export interface Need {
  /** Clases de nodo lógico requeridas por las funciones asignadas. */
  classes: Record<string, number>;
  /** Estimación simple de entradas/salidas (ver `estimateIo`). */
  digitalIn: number;
  digitalOut: number;
  analogIn: number;
}

/** Funciones asignadas al objeto y a sus equipos, contadas por clase. */
export function classesOf(host: Element): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (e: Element) => {
    for (const a of listAssigned(e)) out[a.lnClass] = (out[a.lnClass] ?? 0) + 1;
  };
  add(host);
  for (const eq of Array.from(host.querySelectorAll(':scope > ConductingEquipment'))) add(eq);
  return out;
}

/**
 * Estimación de E/S a partir de las funciones (regla inicial, ajustable):
 * cada equipo de maniobra (XCBR/XSWI) usa 2 entradas (posición doble);
 * cada CSWI, 2 salidas (abrir/cerrar); cada TCTR, 4 canales; cada TVTR, 3.
 */
export function estimateIo(classes: Record<string, number>): Omit<Need, 'classes'> {
  const n = (c: string) => classes[c] ?? 0;
  return {
    digitalIn: 2 * (n('XCBR') + n('XSWI')),
    digitalOut: 2 * n('CSWI'),
    analogIn: 4 * n('TCTR') + 3 * n('TVTR'),
  };
}

export function needOf(host: Element): Need {
  const classes = classesOf(host);
  return { classes, ...estimateIo(classes) };
}

export interface CoverRow {
  lnClass: string;
  required: number;
  covered: number;
  ok: boolean;
}

export interface Check {
  rows: CoverRow[];
  io: { label: string; required: number; available: number; ok: boolean }[];
  /** `none`: sin IED asignado; `ok`: todo cubierto; `short`: falta algo. */
  status: 'none' | 'ok' | 'short';
}

/** Suma las capacidades de los IED asignados y las compara con lo requerido. */
export function checkHost(need: Need, models: IedModel[]): Check {
  const cap: Record<string, number> = {};
  const sum = { digitalIn: 0, digitalOut: 0, analogIn: 0 };
  for (const m of models) {
    for (const [c, q] of Object.entries(m.capacity)) cap[c] = (cap[c] ?? 0) + q;
    sum.digitalIn += m.digitalIn;
    sum.digitalOut += m.digitalOut;
    sum.analogIn += m.analogIn;
  }
  const rows = Object.entries(need.classes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([lnClass, required]) => ({ lnClass, required, covered: cap[lnClass] ?? 0, ok: (cap[lnClass] ?? 0) >= required }));
  const io = [
    { label: 'Entradas digitales', required: need.digitalIn, available: sum.digitalIn },
    { label: 'Salidas digitales', required: need.digitalOut, available: sum.digitalOut },
    { label: 'Canales analógicos', required: need.analogIn, available: sum.analogIn },
  ].map(r => ({ ...r, ok: r.available >= r.required }));
  const status = !models.length ? 'none' : rows.every(r => r.ok) && io.every(r => r.ok) ? 'ok' : 'short';
  return { rows, io, status };
}

/** Modelos de IED únicos que cubren todo lo requerido; el más barato primero. */
export function suggestModels(need: Need, catalog: IedModel[]): IedModel[] {
  return catalog
    .filter(m => checkHost(need, [m]).status === 'ok')
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || a.model.localeCompare(b.model));
}

// ---------- lista de materiales ----------

export interface BomLine {
  model: IedModel | null;
  modelId: string;
  quantity: number;
  names: string[];
}

export function bom(substation: Element, models: IedModel[]): BomLine[] {
  const byId = new Map(models.map(m => [m.id, m]));
  const lines = new Map<string, BomLine>();
  for (const i of allIeds(substation)) {
    const l = lines.get(i.modelId) ?? { model: byId.get(i.modelId) ?? null, modelId: i.modelId, quantity: 0, names: [] };
    l.quantity++;
    l.names.push(i.name);
    lines.set(i.modelId, l);
  }
  return Array.from(lines.values()).sort((a, b) => (a.model?.manufacturer ?? '').localeCompare(b.model?.manufacturer ?? '') || a.modelId.localeCompare(b.modelId));
}

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toBomCsv(lines: BomLine[]): string {
  const head = ['Fabricante', 'Modelo', 'Cantidad', 'Precio unitario', 'Subtotal', 'IEDs'];
  const rows = lines.map(l => {
    const p = l.model?.price;
    return [
      l.model?.manufacturer ?? '',
      l.model?.model ?? l.modelId,
      l.quantity,
      p ?? '',
      p !== undefined ? p * l.quantity : '',
      l.names.join(', '),
    ]
      .map(csvCell)
      .join(';');
  });
  return '﻿' + [head.join(';'), ...rows].join('\r\n') + '\r\n';
}
