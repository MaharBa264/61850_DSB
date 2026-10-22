/**
 * Modelo de proyecto y plantillas de campo (etapas A y B del flujo DSB).
 *
 * Funciones puras sobre un documento SCL: no tienen UI ni dependen de OpenSCD.
 * El resultado son elementos SCL estándar (Substation / VoltageLevel / Bay /
 * ConductingEquipment / ConnectivityNode / Terminal) con coordenadas `sxy`,
 * que el editor "Diagrama unifilar" existente dibuja sin cambios.
 */

export const SCL_NS = 'http://www.iec.ch/61850/2003/SCL';
export const SXY_NS = 'http://www.iec.ch/61850/2003/SCLcoordinates';
export const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
/** Espacio de nombres propio para metadatos de DSB (dentro de `Private`). */
export const DSB_NS = 'urn:edesal:dsb:1';
export const DSB_PRIVATE_TYPE = 'DSB-Project';

/** Separación vertical (en celdas) entre niveles de tensión en el unifilar. */
const VOLTAGE_LEVEL_ROW_SPAN = 12;
/** Fila (relativa al nivel de tensión) donde empiezan los campos. */
const BAY_ROW = 2;

export interface ProjectInfo {
  name: string;
  description: string;
  location: string;
}

export interface VoltageLevelSpec {
  name: string;
  /** Tensión nominal en kV. */
  kV: number;
  /** Cantidad de barras (1 = simple, 2 = doble barra). */
  busbars: number;
}

export interface LineBaySpec {
  name: string;
  /** Nombres de las barras del nivel de tensión a las que se conecta. */
  busbars: string[];
  /** Columna (celdas) del campo dentro del nivel de tensión. */
  column: number;
  /** Incluye transformador de tensión. */
  withVT?: boolean;
}

/** Valida un nombre SCL usado en rutas (`Subestación/Nivel/Campo`). */
export function validateName(value: string): string | null {
  const v = value.trim();
  if (!v) return 'El nombre es obligatorio';
  if (v.includes('/')) return 'El nombre no puede contener "/"';
  if (v.length > 64) return 'El nombre es demasiado largo (máx. 64)';
  return null;
}

/** Valida la tensión nominal (kV): positiva y finita. */
export function validateKV(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return 'La tensión debe ser mayor que 0';
  return null;
}

function el(doc: XMLDocument, tag: string, attrs: Record<string, string> = {}): Element {
  const e = doc.createElementNS(SCL_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function setXY(e: Element, x: number, y: number) {
  e.setAttributeNS(SXY_NS, 'sxy:x', String(x));
  e.setAttributeNS(SXY_NS, 'sxy:y', String(y));
}

/** Atributos de declaración que faltan en la raíz `SCL` (sxy). */
export function missingRootNamespaces(doc: XMLDocument): Record<string, string> {
  const root = doc.documentElement;
  const missing: Record<string, string> = {};
  if (!root.hasAttributeNS(XMLNS_NS, 'sxy')) missing['xmlns:sxy'] = SXY_NS;
  return missing;
}

export function getSubstation(doc: XMLDocument): Element | null {
  return doc.querySelector(':root > Substation');
}

export function getProjectInfo(doc: XMLDocument): ProjectInfo {
  const sub = getSubstation(doc);
  let location = '';
  const priv = sub
    ? Array.from(sub.children).find(
        c => c.tagName === 'Private' && c.getAttribute('type') === DSB_PRIVATE_TYPE
      )
    : undefined;
  const meta = priv?.getElementsByTagNameNS(DSB_NS, 'Project')[0];
  if (meta) location = meta.getAttribute('location') ?? '';
  return {
    name: sub?.getAttribute('name') ?? '',
    description: sub?.getAttribute('desc') ?? '',
    location,
  };
}

/** Elemento `Private` con los metadatos DSB (ubicación). */
export function createProjectPrivate(doc: XMLDocument, location: string): Element {
  const priv = el(doc, 'Private', { type: DSB_PRIVATE_TYPE });
  const meta = doc.createElementNS(DSB_NS, 'dsb:Project');
  meta.setAttribute('location', location);
  priv.appendChild(meta);
  return priv;
}

export function createSubstation(doc: XMLDocument, info: ProjectInfo): Element {
  const sub = el(doc, 'Substation', { name: info.name.trim() });
  if (info.description.trim()) sub.setAttribute('desc', info.description.trim());
  if (info.location.trim()) sub.appendChild(createProjectPrivate(doc, info.location.trim()));
  return sub;
}

/** Barras (Bay con un único ConnectivityNode) de un nivel de tensión. */
export function listBusbars(voltageLevel: Element): string[] {
  return Array.from(voltageLevel.children)
    .filter(
      c =>
        c.tagName === 'Bay' &&
        c.children.length === 1 &&
        c.children[0].tagName === 'ConnectivityNode'
    )
    .map(c => c.getAttribute('name') ?? '');
}

/** Siguiente columna libre para un campo nuevo dentro del nivel de tensión. */
export function suggestColumn(voltageLevel: Element): number {
  const busbars = new Set(listBusbars(voltageLevel));
  let max = 0;
  for (const bay of Array.from(voltageLevel.children)) {
    if (bay.tagName !== 'Bay' || busbars.has(bay.getAttribute('name') ?? '')) continue;
    const x = parseInt(bay.getAttributeNS(SXY_NS, 'x') ?? '0', 10);
    if (x > max) max = x;
  }
  return max === 0 ? 1 : max + 6;
}

/** Siguiente fila libre para un nivel de tensión nuevo. */
export function suggestVoltageLevelRow(substation: Element): number {
  let max = -VOLTAGE_LEVEL_ROW_SPAN + 1;
  for (const vl of Array.from(substation.children)) {
    if (vl.tagName !== 'VoltageLevel') continue;
    const y = parseInt(vl.getAttributeNS(SXY_NS, 'y') ?? '0', 10);
    if (y > max) max = y;
  }
  return max + VOLTAGE_LEVEL_ROW_SPAN;
}

/**
 * Nivel de tensión con su(s) barra(s).
 * Cada barra es un `Bay` con un único `ConnectivityNode` llamado "L1",
 * que es la convención que reconoce el editor de unifilar.
 */
export function createVoltageLevel(
  doc: XMLDocument,
  substationName: string,
  spec: VoltageLevelSpec,
  row: number
): Element {
  const vl = el(doc, 'VoltageLevel', { name: spec.name.trim() });
  setXY(vl, 1, row);
  const v = el(doc, 'Voltage', { unit: 'V', multiplier: 'k' });
  v.textContent = String(spec.kV);
  vl.appendChild(v);
  for (let i = 0; i < spec.busbars; i++) {
    const name = `BB${i + 1}`;
    const bay = el(doc, 'Bay', { name });
    setXY(bay, 1, 1 + i);
    bay.appendChild(
      el(doc, 'ConnectivityNode', {
        name: 'L1',
        pathName: `${substationName}/${spec.name.trim()}/${name}/L1`,
      })
    );
    vl.appendChild(bay);
  }
  return vl;
}

interface EquipSpec {
  name: string;
  type: string;
  desc: string;
  x: number;
  y: number;
  /** Nodos de conexión: nombres locales (L1...) o `bus:<i>` para barras. */
  terminals: string[];
}

/**
 * Plantilla "Campo de línea": seccionadores de barra, interruptor,
 * transformador de corriente, seccionador de línea, puesta a tierra y
 * (opcional) transformador de tensión.
 */
function lineBayEquipment(busbarCount: number, withVT: boolean): EquipSpec[] {
  const cx = Math.max(busbarCount, 1);
  const eq: EquipSpec[] = [];
  for (let i = 0; i < busbarCount; i++) {
    eq.push({
      name: `QB${i + 1}`,
      type: 'DIS',
      desc: `Seccionador de barra ${i + 1}`,
      x: busbarCount === 1 ? cx : 1 + 2 * i,
      y: 1,
      terminals: [`bus:${i}`, 'L1'],
    });
  }
  eq.push(
    { name: 'QA1', type: 'CBR', desc: 'Interruptor', x: cx, y: 3, terminals: ['L1', 'L2'] },
    { name: 'TC1', type: 'CTR', desc: 'Transformador de corriente', x: cx, y: 5, terminals: ['L2', 'L3'] },
    { name: 'QB9', type: 'DIS', desc: 'Seccionador de línea', x: cx, y: 7, terminals: ['L3'] },
    { name: 'QC9', type: 'ERS', desc: 'Puesta a tierra de línea', x: cx + 1, y: 7, terminals: ['L3'] }
  );
  if (withVT)
    eq.push({ name: 'TV1', type: 'VTR', desc: 'Transformador de tensión', x: cx + 2, y: 7, terminals: ['L3'] });
  return eq;
}

/**
 * Crea un `Bay` "campo de línea" listo para insertar en `voltageLevel`.
 * `ctx` identifica la ruta (subestación / nivel) para las referencias de Terminal.
 */
export function createLineBay(
  doc: XMLDocument,
  ctx: { substation: string; voltageLevel: string },
  spec: LineBaySpec
): Element {
  const bayName = spec.name.trim();
  const bay = el(doc, 'Bay', { name: bayName });
  setXY(bay, spec.column, BAY_ROW);

  const nodes = new Set<string>();
  for (const e of lineBayEquipment(spec.busbars.length, !!spec.withVT)) {
    const ce = el(doc, 'ConductingEquipment', { name: e.name, type: e.type, desc: e.desc });
    setXY(ce, e.x, e.y);
    e.terminals.forEach((t, i) => {
      let bayRef = bayName;
      let node = t;
      if (t.startsWith('bus:')) {
        bayRef = spec.busbars[parseInt(t.slice(4), 10)];
        node = 'L1';
      } else nodes.add(t);
      ce.appendChild(
        el(doc, 'Terminal', {
          name: `T${i + 1}`,
          connectivityNode: `${ctx.substation}/${ctx.voltageLevel}/${bayRef}/${node}`,
          substationName: ctx.substation,
          voltageLevelName: ctx.voltageLevel,
          bayName: bayRef,
          cNodeName: node,
        })
      );
    });
    bay.appendChild(ce);
  }
  for (const n of Array.from(nodes).sort())
    bay.appendChild(
      el(doc, 'ConnectivityNode', {
        name: n,
        pathName: `${ctx.substation}/${ctx.voltageLevel}/${bayName}/${n}`,
      })
    );
  return bay;
}
