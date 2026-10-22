/**
 * Diseño de la red Ethernet (etapa E): subredes, equipos (IED, RTU, switches,
 * unidades de fusión), topología, direccionamiento (IP, MAC, APPID, VLAN) y flujos
 * GOOSE/SV.
 *
 * El plan viaja dentro del proyecto como `Private type="DSB-Network"` en la
 * Substation (mismo criterio que el catálogo): es parte del único modelo SCL que
 * va madurando y entra en el control de versiones. Todavía no crea `Communication`
 * ni `ConnectedAP`: eso se genera al armar el SCD (etapa G) cuando existan los IED
 * reales.
 *
 * Reglas de diseño:
 * - Cada subred es un dominio L2: los duplicados (IP, MAC, APPID) se buscan
 *   dentro de cada subred. Las redes de las RTU son independientes entre sí.
 * - El bus de proceso es un tipo de subred más (`process`), con unidades de
 *   fusión (`mu`) y flujos SV, y se puede reservar puertos en los equipos.
 *
 * Funciones puras; las ediciones se devuelven como `EditV2`.
 */
import type { EditV2 } from '@compas-oscd/core';

import { allIeds, IedModel, SwitchModel } from './catalog-model.js';
import { DSB_NS, SCL_NS } from './project-model.js';

export const NETWORK_PRIVATE_TYPE = 'DSB-Network';

export type SubnetKind = 'station' | 'process' | 'rtu' | 'other';
export const SUBNET_KINDS: { id: SubnetKind; label: string }[] = [
  { id: 'station', label: 'Red de estación' },
  { id: 'process', label: 'Bus de proceso' },
  { id: 'rtu', label: 'Red de RTU' },
  { id: 'other', label: 'Otra' },
];

export type NodeKind = 'ied' | 'rtu' | 'switch' | 'mu' | 'gateway' | 'other';
export const NODE_KINDS: { id: NodeKind; label: string }[] = [
  { id: 'ied', label: 'IED' },
  { id: 'rtu', label: 'RTU' },
  { id: 'switch', label: 'Switch' },
  { id: 'mu', label: 'Unidad de fusión' },
  { id: 'gateway', label: 'Gateway / SCADA' },
  { id: 'other', label: 'Otro' },
];

export const REDUNDANCY_MODES = ['none', 'RSTP', 'PRP', 'HSR'] as const;
export type Redundancy = (typeof REDUNDANCY_MODES)[number];
export type StreamKind = 'GOOSE' | 'SV';
export type Medium = 'cobre' | 'fibra';
export type Lan = '' | 'A' | 'B';

export interface Subnet {
  id: string;
  name: string;
  kind: SubnetKind;
  /** Red IPv4 en notación CIDR (p. ej. 10.10.1.0/24). */
  cidr: string;
  /** VLAN por defecto de los flujos de la subred; null = sin etiqueta. */
  vlan: number | null;
  /** Prioridad 802.1p por defecto (0-7). */
  prio: number;
  /** Velocidad de los enlaces, en Mbit/s. */
  bitRate: number;
  redundancy: Redundancy;
  /** true = el tráfico multicast solo viaja hacia sus suscriptores (poda por VLAN/MMRP/IGMP). */
  pruned: boolean;
  /** Puerta de enlace (opcional). */
  gateway: string;
  /** Tráfico de fondo (MMS, PTP, gestión) en kbit/s por enlace. */
  background: number;
  /** En redes de RTU: id del equipo RTU dueño de la red. */
  owner: string;
}

export interface Iface {
  subnet: string;
  ip: string;
  mac: string;
}

export interface NetNode {
  id: string;
  name: string;
  kind: NodeKind;
  /** Modelo del catálogo (IED o switch); vacío = puertos a mano. */
  modelId: string;
  copper: number;
  fiber: number;
  /** Puertos que se dejan libres para el bus de proceso futuro. */
  reserved: number;
  /** Agrupación para el diseño automático (nivel de tensión, sala…). */
  group: string;
  ifaces: Iface[];
}

export interface Link {
  id: string;
  a: string;
  b: string;
  medium: Medium;
  subnet: string;
  /** LAN A/B en redes PRP; vacío en el resto. */
  lan: Lan;
  /** Velocidad propia en Mbit/s; 0 = la de la subred. */
  speed: number;
}

export interface Stream {
  id: string;
  name: string;
  kind: StreamKind;
  publisher: string;
  subnet: string;
  /** MAC multicast de destino. */
  mac: string;
  appid: number;
  vlan: number | null;
  prio: number;
  /** Tamaño de la trama Ethernet (con VLAN y FCS), en bytes. */
  frameBytes: number;
  /** Tramas por segundo en régimen estable. */
  fps: number;
  /** Tramas extra en el primer segundo tras un evento (solo GOOSE). */
  burstFrames: number;
  /** Suscriptores (ids de equipos); vacío = toda la subred. */
  subscribers: string[];
}

export interface NetworkPlan {
  subnets: Subnet[];
  nodes: NetNode[];
  links: Link[];
  streams: Stream[];
  /** Al importar IED, dejar un puerto libre para un bus de proceso futuro. */
  processReserve: boolean;
}

export const emptyPlan = (): NetworkPlan => ({ subnets: [], nodes: [], links: [], streams: [], processReserve: false });

/** Perfiles de flujo con valores típicos (editables; son estimaciones de diseño). */
export const STREAM_PRESETS: { id: string; label: string; kind: StreamKind; frameBytes: number; fps: number; burstFrames: number; prio: number }[] = [
  { id: 'goose', label: 'GOOSE (refresco 1 s)', kind: 'GOOSE', frameBytes: 200, fps: 1, burstFrames: 10, prio: 4 },
  { id: 'sv80', label: 'SV 9-2LE, 80 muestras/ciclo a 50 Hz', kind: 'SV', frameBytes: 126, fps: 4000, burstFrames: 0, prio: 4 },
  { id: 'sv256', label: 'SV 9-2, 256 muestras/ciclo a 50 Hz', kind: 'SV', frameBytes: 126, fps: 12800, burstFrames: 0, prio: 4 },
];

/** Preámbulo (8) + espacio entre tramas (12), por trama. */
export const WIRE_OVERHEAD = 20;
export const LOAD_WARN = 0.5;
export const LOAD_CRIT = 0.8;
export const PEAK_WARN = 0.9;

// ---------- direccionamiento ----------

export function parseIp(s: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s.trim());
  if (!m) return null;
  let n = 0;
  for (let i = 1; i <= 4; i++) {
    const o = parseInt(m[i], 10);
    if (o > 255) return null;
    n = n * 256 + o;
  }
  return n;
}

export const ipToString = (n: number) => [24, 16, 8, 0].map(sh => (n / 2 ** sh) & 255).join('.');

export interface Cidr {
  network: number;
  prefix: number;
  broadcast: number;
  /** Cantidad de direcciones de equipo (sin red ni difusión). */
  hosts: number;
}

/** Interpreta `a.b.c.d/p` (p entre 8 y 30). Devuelve null si no es válida. */
export function parseCidr(s: string): Cidr | null {
  const m = /^(.+)\/(\d{1,2})$/.exec(s.trim());
  if (!m) return null;
  const base = parseIp(m[1]);
  const prefix = parseInt(m[2], 10);
  if (base === null || prefix < 8 || prefix > 30) return null;
  const size = 2 ** (32 - prefix);
  const network = Math.floor(base / size) * size;
  return { network, prefix, broadcast: network + size - 1, hosts: size - 2 };
}

/** true si la dirección de la notación CIDR es exactamente la de red. */
export function isNetworkAddress(s: string): boolean {
  const c = parseCidr(s);
  const base = parseIp(s.split('/')[0] ?? '');
  return !!c && base === c.network;
}

export const cidrOverlap = (a: Cidr, b: Cidr) => a.network <= b.broadcast && b.network <= a.broadcast;

/** MAC en formato IEC 61850 (`AA-BB-CC-DD-EE-FF`) o null si no es válida. */
export function normalizeMac(s: string): string | null {
  const hex = s.trim().replace(/[-:.\s]/g, '').toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(hex)) return null;
  return hex.match(/../g)!.join('-');
}

export const isMulticastMac = (mac: string) => (parseInt(mac.slice(0, 2), 16) & 1) === 1;

/** Rango multicast reservado por la norma: GOOSE 01-0C-CD-01-00-00..01-FF; SV 01-0C-CD-04-00-00..01-FF. */
export function macInStandardRange(mac: string, kind: StreamKind): boolean {
  const prefix = kind === 'GOOSE' ? '01-0C-CD-01-' : '01-0C-CD-04-';
  if (!mac.startsWith(prefix)) return false;
  const hi = parseInt(mac.slice(12, 14), 16);
  return hi <= 1;
}

/** Rangos de APPID recomendados por la norma: GOOSE 0x0000–0x3FFF, SV 0x4000–0x7FFF. */
export const appidRange = (kind: StreamKind): [number, number] => (kind === 'GOOSE' ? [0x0000, 0x3fff] : [0x4000, 0x7fff]);

export const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');

export function parseAppid(s: string): number | null {
  const t = s.trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{1,4}$/.test(t)) return null;
  return parseInt(t, 16);
}

// ---------- utilidades del plan ----------

export const nodeOf = (plan: NetworkPlan, id: string) => plan.nodes.find(n => n.id === id);
export const subnetOf = (plan: NetworkPlan, id: string) => plan.subnets.find(s => s.id === id);

/** Id corto y único con un prefijo (`sn`, `nd`, `lk`, `st`). */
export function uid(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let n = 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/** Nombre libre con sufijo numérico si ya existe. */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

export function newSubnet(plan: NetworkPlan, kind: SubnetKind): Subnet {
  const second = kind === 'process' ? 20 : kind === 'rtu' ? 30 : 10;
  let third = 1;
  const taken = new Set(plan.subnets.map(s => s.cidr));
  while (taken.has(`10.${second}.${third}.0/24`)) third++;
  const sameKind = plan.subnets.filter(s => s.kind === kind).length;
  const label = SUBNET_KINDS.find(k => k.id === kind)!.label;
  return {
    id: uid('sn', plan.subnets.map(s => s.id)),
    name: uniqueName(sameKind ? `${label} ${sameKind + 1}` : label, plan.subnets.map(s => s.name)),
    kind,
    cidr: `10.${second}.${third}.0/24`,
    vlan: null,
    prio: 4,
    bitRate: kind === 'process' ? 1000 : 100,
    redundancy: 'none',
    pruned: false,
    gateway: '',
    background: kind === 'process' ? 0 : 500,
    owner: '',
  };
}

export function newNode(plan: NetworkPlan, kind: NodeKind, name?: string): NetNode {
  const label = NODE_KINDS.find(k => k.id === kind)!.label.replace(/[^A-Za-z]+/g, '');
  const prefix = { ied: 'IED', rtu: 'RTU', switch: 'SW', mu: 'MU', gateway: 'GW', other: 'EQ' }[kind];
  return {
    id: uid('nd', plan.nodes.map(n => n.id)),
    name: name ?? uniqueName(prefix || label, plan.nodes.map(n => n.name)),
    kind,
    modelId: '',
    copper: kind === 'switch' ? 8 : kind === 'rtu' || kind === 'gateway' ? 2 : 2,
    fiber: kind === 'switch' ? 2 : 0,
    reserved: 0,
    group: '',
    ifaces: [],
  };
}

export function newStream(plan: NetworkPlan, presetId: string, publisher: string, subnet: string): Stream {
  const p = STREAM_PRESETS.find(x => x.id === presetId) ?? STREAM_PRESETS[0];
  const sn = subnetOf(plan, subnet);
  const pub = nodeOf(plan, publisher);
  const base = `${pub?.name ?? 'Flujo'}_${p.kind}`;
  return {
    id: uid('st', plan.streams.map(s => s.id)),
    name: uniqueName(base, plan.streams.map(s => s.name)),
    kind: p.kind,
    publisher,
    subnet,
    mac: '',
    appid: 0,
    vlan: sn?.vlan ?? null,
    prio: p.prio,
    frameBytes: p.frameBytes,
    fps: p.fps,
    burstFrames: p.burstFrames,
    subscribers: [],
  };
}

/** Puertos del equipo: del modelo del catálogo si lo tiene, o los cargados a mano. */
export function portsOf(node: NetNode, models: { ieds: IedModel[]; switches: SwitchModel[] }): { copper: number; fiber: number; fromModel: boolean } {
  const m = node.modelId ? [...models.ieds, ...models.switches].find(x => x.id === node.modelId) : undefined;
  return m ? { copper: m.copper, fiber: m.fiber, fromModel: true } : { copper: node.copper, fiber: node.fiber, fromModel: false };
}

/** Puertos usados por el equipo, por medio. */
export function portUse(plan: NetworkPlan, nodeId: string): { copper: number; fiber: number } {
  const use = { copper: 0, fiber: 0 };
  for (const l of plan.links) {
    if (l.a !== nodeId && l.b !== nodeId) continue;
    if (l.medium === 'fibra') use.fiber++;
    else use.copper++;
  }
  return use;
}

export const linkSpeed = (plan: NetworkPlan, l: Link) => (l.speed > 0 ? l.speed : subnetOf(plan, l.subnet)?.bitRate ?? 100);

// ---------- asignación asistida de direcciones ----------

/** Inicio del bloque de cada tipo de equipo dentro de la subred (se usa si caben). */
const BLOCK_START: Record<NodeKind, number> = { switch: 2, rtu: 10, gateway: 10, ied: 20, mu: 100, other: 200 };

/** Primera IP libre desde el desplazamiento `start`; si no hay, desde el principio. */
export function nextFreeIp(cidr: Cidr, used: Set<number>, start: number): number | null {
  const first = cidr.network + 1;
  const last = cidr.broadcast - 1;
  const from = cidr.hosts >= start + 20 ? cidr.network + start : first;
  for (let ip = from; ip <= last; ip++) if (!used.has(ip)) return ip;
  for (let ip = first; ip < from; ip++) if (!used.has(ip)) return ip;
  return null;
}

/** Completa las IP que faltan en una subred (no toca las ya cargadas). */
export function assignIps(plan: NetworkPlan, subnetId: string): { plan: NetworkPlan; assigned: number; failed: number } {
  const sn = subnetOf(plan, subnetId);
  const cidr = sn ? parseCidr(sn.cidr) : null;
  if (!sn || !cidr) return { plan, assigned: 0, failed: 0 };
  const used = new Set<number>();
  const gw = parseIp(sn.gateway);
  if (gw !== null) used.add(gw);
  for (const n of plan.nodes)
    for (const i of n.ifaces) if (i.subnet === subnetId) {
      const v = parseIp(i.ip);
      if (v !== null) used.add(v);
    }
  let assigned = 0;
  let failed = 0;
  const order: NodeKind[] = ['switch', 'gateway', 'rtu', 'ied', 'mu', 'other'];
  const nodes = plan.nodes.map(n => ({ ...n, ifaces: n.ifaces.map(i => ({ ...i })) }));
  for (const kind of order)
    for (const n of nodes.filter(x => x.kind === kind))
      for (const i of n.ifaces) {
        if (i.subnet !== subnetId || parseIp(i.ip) !== null) continue;
        const ip = nextFreeIp(cidr, used, BLOCK_START[kind]);
        if (ip === null) failed++;
        else {
          used.add(ip);
          i.ip = ipToString(ip);
          assigned++;
        }
      }
  return { plan: { ...plan, nodes }, assigned, failed };
}

/** Completa MAC multicast y APPID de los flujos que no los tienen (por subred). */
export function assignStreamAddresses(plan: NetworkPlan, subnetId?: string): { plan: NetworkPlan; assigned: number } {
  const streams = plan.streams.map(s => ({ ...s }));
  let assigned = 0;
  for (const sn of plan.subnets) {
    if (subnetId && sn.id !== subnetId) continue;
    const mine = streams.filter(s => s.subnet === sn.id);
    const usedMac = new Set(mine.map(s => normalizeMac(s.mac)).filter(Boolean) as string[]);
    const usedAppid = new Set(mine.filter(s => s.appid > 0).map(s => s.appid));
    for (const s of mine) {
      if (!normalizeMac(s.mac)) {
        const prefix = s.kind === 'GOOSE' ? '01-0C-CD-01-' : '01-0C-CD-04-';
        for (let n = 1; n <= 0x1ff; n++) {
          const mac = `${prefix}${(n >> 8).toString(16).padStart(2, '0')}-${(n & 255).toString(16).toUpperCase().padStart(2, '0')}`.toUpperCase();
          if (!usedMac.has(mac)) {
            usedMac.add(mac);
            s.mac = mac;
            assigned++;
            break;
          }
        }
      }
      if (!(s.appid > 0)) {
        const [lo, hi] = appidRange(s.kind);
        for (let a = Math.max(lo, 1); a <= hi; a++)
          if (!usedAppid.has(a)) {
            usedAppid.add(a);
            s.appid = a;
            assigned++;
            break;
          }
      }
      if (s.vlan === null && sn.vlan !== null) s.vlan = sn.vlan;
    }
  }
  return { plan: { ...plan, streams }, assigned };
}

// ---------- importación desde los IED planificados ----------

const groupOfHost = (host: Element) => (host.tagName === 'PowerTransformer' ? 'Transformadores' : host.parentElement?.getAttribute('name') ?? 'General');

/**
 * Crea un equipo de red por cada IED planificado que todavía no esté en el plan.
 * Entran a la subred `subnetId`. Con `processReserve` dejan un puerto reservado
 * para un bus de proceso futuro (no se conectan a él: ver `attachSvIeds`).
 */
export function importPlannedIeds(
  substation: Element,
  plan: NetworkPlan,
  subnetId: string,
  models: IedModel[],
): { plan: NetworkPlan; added: number } {
  const known = new Set(plan.nodes.map(n => n.name));
  const nodes = [...plan.nodes];
  let added = 0;
  for (const host of Array.from(substation.querySelectorAll(':scope > PowerTransformer, :scope > VoltageLevel > Bay'))) {
    for (const ied of allIeds(substation).filter(i => i.node.parentElement === host)) {
      if (known.has(ied.name)) continue;
      const model = models.find(m => m.id === ied.modelId);
      const node: NetNode = {
        ...newNode({ ...plan, nodes }, 'ied', ied.name),
        modelId: ied.modelId,
        copper: model?.copper ?? 2,
        fiber: model?.fiber ?? 0,
        reserved: plan.processReserve ? 1 : 0,
        group: groupOfHost(host),
        ifaces: [{ subnet: subnetId, ip: '', mac: '' }],
      };
      nodes.push(node);
      known.add(ied.name);
      added++;
    }
  }
  return { plan: { ...plan, nodes }, added };
}

/** Conecta al bus de proceso los IED cuyo modelo declara SV (y que todavía no estén en él). */
export function attachSvIeds(plan: NetworkPlan, processSubnetId: string, models: IedModel[]): { plan: NetworkPlan; attached: number } {
  let attached = 0;
  const nodes = plan.nodes.map(n => {
    const m = models.find(x => x.id === n.modelId);
    if (n.kind !== 'ied' || !m?.protocols.includes('SV') || n.ifaces.some(i => i.subnet === processSubnetId)) return n;
    attached++;
    return { ...n, ifaces: [...n.ifaces, { subnet: processSubnetId, ip: '', mac: '' }] };
  });
  return { plan: { ...plan, nodes }, attached };
}

// ---------- diseño automático de la topología ----------

export interface AutoResult {
  plan: NetworkPlan;
  notes: string[];
  addedNodes: number;
  addedLinks: number;
}

const roundUp = (n: number, step: number) => Math.ceil(n / step) * step;

/**
 * Conecta los equipos sueltos de una subred: un switch por grupo (nivel de
 * tensión), enlazados en estrella o en anillo (RSTP). Respeta los puertos del
 * catálogo. No toca enlaces existentes. PRP/HSR se diseñan a mano.
 */
export function autoTopology(plan: NetworkPlan, subnetId: string, models: { ieds: IedModel[]; switches: SwitchModel[] }): AutoResult {
  const out: AutoResult = { plan, notes: [], addedNodes: 0, addedLinks: 0 };
  const sn = subnetOf(plan, subnetId);
  if (!sn) return out;
  if (sn.redundancy === 'PRP' || sn.redundancy === 'HSR') {
    out.notes.push(`${sn.redundancy} se diseña a mano: cada equipo necesita dos puertos y dos LAN (${sn.redundancy === 'PRP' ? 'A y B' : 'anillo'}).`);
    return out;
  }
  const nodes = plan.nodes.map(n => ({ ...n, ifaces: n.ifaces.map(i => ({ ...i })) }));
  const links = plan.links.map(l => ({ ...l }));
  const work: NetworkPlan = { ...plan, nodes, links };
  const attached = (n: NetNode) => n.ifaces.some(i => i.subnet === subnetId);
  const linked = new Set(links.filter(l => l.subnet === subnetId).flatMap(l => [l.a, l.b]));
  const free = (n: NetNode) => {
    const cap = portsOf(n, models);
    const use = portUse(work, n.id);
    return { copper: cap.copper - use.copper, fiber: cap.fiber - use.fiber, total: cap.copper + cap.fiber - use.copper - use.fiber - n.reserved };
  };
  const connect = (a: NetNode, b: NetNode, preferFiber: boolean): boolean => {
    const fa = free(a);
    const fb = free(b);
    if (fa.total < 1 || fb.total < 1) return false;
    const order: Medium[] = preferFiber ? ['fibra', 'cobre'] : ['cobre', 'fibra'];
    for (const m of order) {
      const k = m === 'fibra' ? 'fiber' : 'copper';
      if (fa[k] > 0 && fb[k] > 0) {
        links.push({ id: uid('lk', links.map(l => l.id)), a: a.id, b: b.id, medium: m, subnet: subnetId, lan: '', speed: 0 });
        out.addedLinks++;
        return true;
      }
    }
    return false;
  };
  const makeSwitch = (group: string, endCount: number, needUplink: boolean): NetNode => {
    const sw = newNode({ ...work, nodes }, 'switch', uniqueName(`SW_${group}`.replace(/[^A-Za-z0-9_]/g, '_'), nodes.map(n => n.name)));
    const need = endCount + (needUplink ? 2 : 0);
    const pick = models.switches.filter(m => m.copper + m.fiber >= need && (!needUplink || m.fiber >= 2 || m.copper + m.fiber >= need + 2)).sort((x, y) => x.copper + x.fiber - (y.copper + y.fiber))[0];
    if (pick) {
      sw.modelId = pick.id;
      sw.copper = pick.copper;
      sw.fiber = pick.fiber;
    } else {
      sw.copper = roundUp(endCount, 8);
      sw.fiber = 2;
    }
    sw.group = group;
    sw.ifaces = [{ subnet: subnetId, ip: '', mac: '' }];
    nodes.push(sw);
    out.addedNodes++;
    return sw;
  };

  // 1) equipos finales sueltos, por grupo
  const ends = nodes.filter(n => attached(n) && n.kind !== 'switch' && !linked.has(n.id));
  const groups = new Map<string, NetNode[]>();
  for (const n of ends) groups.set(n.group, [...(groups.get(n.group) ?? []), n]);
  const existing = nodes.filter(n => n.kind === 'switch' && attached(n));
  const cap = models.switches.reduce((m, x) => Math.max(m, x.copper + x.fiber), 0) || 24;
  const named = Array.from(groups.keys()).filter(Boolean);
  // los equipos con grupo van primero; los sueltos (RTU, gateway…) cuelgan de cualquier switch con lugar
  for (const group of [...named, ...(groups.has('') ? [''] : [])]) {
    const members = groups.get(group)!;
    const loose = group === '';
    const anySwitch = () => nodes.some(n => n.kind === 'switch' && attached(n));
    // con varios switches hay que dejar dos puertos para enlazarlos entre sí
    const multi = named.length > 1 || existing.length > 0 || members.length > cap || (loose && anySwitch());
    const uplinks = multi ? 2 : 0;
    const chunk = Math.max(1, cap - uplinks);
    const pool = nodes.filter(n => n.kind === 'switch' && attached(n) && (loose || n.group === group || (existing.length > 0 && !n.group)));
    const compatible = (e: NetNode, sw: NetNode) => {
      const fe = free(e);
      const fs = free(sw);
      return fs.total - uplinks >= 1 && fe.total >= 1 && ((fe.copper > 0 && fs.copper > 0) || (fe.fiber > 0 && fs.fiber > 0));
    };
    members.forEach((e, idx) => {
      let sw = pool.find(x => compatible(e, x));
      if (!sw) {
        sw = makeSwitch(loose ? 'General' : group, Math.min(chunk, members.length - idx), multi);
        if (!compatible(e, sw)) {
          nodes.pop();
          out.addedNodes--;
          out.notes.push(`${e.name}: no tiene un puerto compatible con los switches disponibles; conéctelo a mano.`);
          return;
        }
        pool.push(sw);
      }
      if (!connect(e, sw, false)) out.notes.push(`No hay puertos compatibles para conectar ${e.name} a ${sw.name}.`);
    });
  }
  // 2) interconexión entre switches de la subred
  const sws = nodes.filter(n => n.kind === 'switch' && attached(n));
  const interlinked = (a: NetNode, b: NetNode) => links.some(l => (l.a === a.id && l.b === b.id) || (l.a === b.id && l.b === a.id));
  const pairs: [NetNode, NetNode][] = [];
  if (sws.length > 1) {
    if (sn.redundancy === 'RSTP' && sws.length >= 3) for (let i = 0; i < sws.length; i++) pairs.push([sws[i], sws[(i + 1) % sws.length]]);
    else for (let i = 1; i < sws.length; i++) pairs.push([sws[0], sws[i]]);
    if (sn.redundancy === 'RSTP' && sws.length === 2) out.notes.push('Hay solo dos switches: se dejó un enlace; agregue un segundo para redundancia RSTP.');
  }
  for (const [a, b] of pairs) {
    if (interlinked(a, b)) continue;
    if (!connect(a, b, true)) out.notes.push(`No hay puertos libres para enlazar ${a.name} con ${b.name}.`);
  }
  // 3) switches sueltos que quedaron sin enlace (un solo switch, sin equipos)
  out.plan = { ...plan, nodes, links };
  return out;
}

// ---------- serialización en el SCL ----------

const afterPrivates = (parent: Element) =>
  Array.from(parent.children).find(c => c.tagName !== 'Private' && c.tagName !== 'Text') ?? null;

const dsbEl = (doc: XMLDocument, tag: string, attrs: Record<string, string>) => {
  const e = doc.createElementNS(DSB_NS, `dsb:${tag}`);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

const privateOf = (parent: Element) =>
  Array.from(parent.children).find(c => c.tagName === 'Private' && c.getAttribute('type') === NETWORK_PRIVATE_TYPE) ?? null;

const intAttr = (e: Element, a: string, def: number) => {
  const v = parseInt(e.getAttribute(a) ?? '', 10);
  return Number.isFinite(v) ? v : def;
};

export function readPlan(substation: Element): NetworkPlan {
  const priv = privateOf(substation);
  const root = priv?.getElementsByTagNameNS(DSB_NS, 'Network')[0];
  if (!root) return emptyPlan();
  const kids = (tag: string) => Array.from(root.children).filter(c => c.localName === tag && c.namespaceURI === DSB_NS);
  const vlan = (e: Element) => {
    const v = e.getAttribute('vlan');
    return v === null || v === '' ? null : parseInt(v, 10);
  };
  return {
    processReserve: root.getAttribute('processReserve') === 'true',
    subnets: kids('Subnet').map(e => ({
      id: e.getAttribute('id') ?? '',
      name: e.getAttribute('name') ?? '',
      kind: (['station', 'process', 'rtu', 'other'].includes(e.getAttribute('kind') ?? '') ? e.getAttribute('kind') : 'other') as SubnetKind,
      cidr: e.getAttribute('cidr') ?? '',
      vlan: vlan(e),
      prio: intAttr(e, 'prio', 4),
      bitRate: intAttr(e, 'bitRate', 100),
      redundancy: (REDUNDANCY_MODES as readonly string[]).includes(e.getAttribute('redundancy') ?? '') ? (e.getAttribute('redundancy') as Redundancy) : 'none',
      pruned: e.getAttribute('pruned') === 'true',
      gateway: e.getAttribute('gateway') ?? '',
      background: intAttr(e, 'background', 0),
      owner: e.getAttribute('owner') ?? '',
    })),
    nodes: kids('Node').map(e => ({
      id: e.getAttribute('id') ?? '',
      name: e.getAttribute('name') ?? '',
      kind: (NODE_KINDS.some(k => k.id === e.getAttribute('kind')) ? e.getAttribute('kind') : 'other') as NodeKind,
      modelId: e.getAttribute('model') ?? '',
      copper: intAttr(e, 'copper', 0),
      fiber: intAttr(e, 'fiber', 0),
      reserved: intAttr(e, 'reserved', 0),
      group: e.getAttribute('group') ?? '',
      ifaces: Array.from(e.children)
        .filter(c => c.localName === 'If')
        .map(i => ({ subnet: i.getAttribute('subnet') ?? '', ip: i.getAttribute('ip') ?? '', mac: i.getAttribute('mac') ?? '' })),
    })),
    links: kids('Link').map(e => ({
      id: e.getAttribute('id') ?? '',
      a: e.getAttribute('a') ?? '',
      b: e.getAttribute('b') ?? '',
      medium: e.getAttribute('medium') === 'fibra' ? 'fibra' : 'cobre',
      subnet: e.getAttribute('subnet') ?? '',
      lan: (['A', 'B'].includes(e.getAttribute('lan') ?? '') ? e.getAttribute('lan') : '') as Lan,
      speed: intAttr(e, 'speed', 0),
    })),
    streams: kids('Stream').map(e => ({
      id: e.getAttribute('id') ?? '',
      name: e.getAttribute('name') ?? '',
      kind: e.getAttribute('kind') === 'SV' ? 'SV' : 'GOOSE',
      publisher: e.getAttribute('publisher') ?? '',
      subnet: e.getAttribute('subnet') ?? '',
      mac: e.getAttribute('mac') ?? '',
      appid: intAttr(e, 'appid', 0),
      vlan: vlan(e),
      prio: intAttr(e, 'prio', 4),
      frameBytes: intAttr(e, 'frameBytes', 0),
      fps: parseFloat(e.getAttribute('fps') ?? '0') || 0,
      burstFrames: intAttr(e, 'burstFrames', 0),
      subscribers: (e.getAttribute('subscribers') ?? '').split(',').filter(Boolean),
    })),
  };
}

export function planElement(doc: XMLDocument, plan: NetworkPlan): Element {
  const priv = doc.createElementNS(SCL_NS, 'Private');
  priv.setAttribute('type', NETWORK_PRIVATE_TYPE);
  const root = dsbEl(doc, 'Network', { processReserve: String(plan.processReserve) });
  for (const s of plan.subnets)
    root.appendChild(
      dsbEl(doc, 'Subnet', {
        id: s.id, name: s.name, kind: s.kind, cidr: s.cidr, vlan: s.vlan === null ? '' : String(s.vlan), prio: String(s.prio),
        bitRate: String(s.bitRate), redundancy: s.redundancy, pruned: String(s.pruned), gateway: s.gateway,
        background: String(s.background), owner: s.owner,
      }),
    );
  for (const n of plan.nodes) {
    const e = dsbEl(doc, 'Node', {
      id: n.id, name: n.name, kind: n.kind, model: n.modelId, copper: String(n.copper), fiber: String(n.fiber),
      reserved: String(n.reserved), group: n.group,
    });
    for (const i of n.ifaces) e.appendChild(dsbEl(doc, 'If', { subnet: i.subnet, ip: i.ip, mac: i.mac }));
    root.appendChild(e);
  }
  for (const l of plan.links)
    root.appendChild(dsbEl(doc, 'Link', { id: l.id, a: l.a, b: l.b, medium: l.medium, subnet: l.subnet, lan: l.lan, speed: String(l.speed) }));
  for (const s of plan.streams)
    root.appendChild(
      dsbEl(doc, 'Stream', {
        id: s.id, name: s.name, kind: s.kind, publisher: s.publisher, subnet: s.subnet, mac: s.mac, appid: String(s.appid),
        vlan: s.vlan === null ? '' : String(s.vlan), prio: String(s.prio), frameBytes: String(s.frameBytes), fps: String(s.fps),
        burstFrames: String(s.burstFrames), subscribers: s.subscribers.join(','),
      }),
    );
  priv.appendChild(root);
  return priv;
}

/** Ediciones que dejan en el proyecto exactamente este plan. */
export function planEdits(doc: XMLDocument, substation: Element, plan: NetworkPlan): EditV2[] {
  const old = privateOf(substation);
  const edits: EditV2[] = [];
  if (old) edits.push({ node: old });
  const empty = !plan.subnets.length && !plan.nodes.length && !plan.links.length && !plan.streams.length;
  if (!empty) edits.push({ parent: substation, node: planElement(doc, plan), reference: old ? old.nextElementSibling : afterPrivates(substation) });
  return edits;
}

// ---------- tabla de direccionamiento (CSV) ----------

const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

/** Tabla de direccionamiento: una fila por interfaz y por flujo, agrupadas por subred. */
export function addressingCsv(plan: NetworkPlan): string {
  const rows: (string | number)[][] = [['Subred', 'Red', 'VLAN', 'Tipo', 'Nombre', 'Clase', 'IP', 'MAC', 'APPID', 'Prioridad', 'Detalle']];
  for (const sn of plan.subnets) {
    for (const n of plan.nodes)
      for (const i of n.ifaces.filter(x => x.subnet === sn.id))
        rows.push([sn.name, sn.cidr, sn.vlan ?? '', 'Equipo', n.name, NODE_KINDS.find(k => k.id === n.kind)?.label ?? n.kind, i.ip, i.mac, '', '', n.group]);
    for (const s of plan.streams.filter(x => x.subnet === sn.id))
      rows.push([sn.name, sn.cidr, s.vlan ?? '', 'Flujo', s.name, s.kind, '', s.mac, s.appid ? `0x${hex4(s.appid)}` : '', s.prio, nodeOf(plan, s.publisher)?.name ?? '']);
  }
  return rows.map(r => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}
