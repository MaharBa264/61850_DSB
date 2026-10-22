/**
 * Validación del plan de red y cálculo de carga (etapa E).
 *
 * Los duplicados (IP, MAC, APPID) se buscan dentro de cada subred, que es un
 * dominio L2: dos redes de RTU independientes pueden repetir direcciones.
 */
import type { IedModel, SwitchModel } from './catalog-model.js';
import {
  appidRange,
  cidrOverlap,
  hex4,
  isMulticastMac,
  isNetworkAddress,
  Link,
  LOAD_CRIT,
  LOAD_WARN,
  linkSpeed,
  macInStandardRange,
  NetNode,
  NetworkPlan,
  nodeOf,
  normalizeMac,
  parseCidr,
  parseIp,
  PEAK_WARN,
  portsOf,
  portUse,
  Stream,
  Subnet,
  subnetOf,
  WIRE_OVERHEAD,
} from './network-model.js';

export type Level = 'error' | 'warn' | 'info';

export interface Issue {
  level: Level;
  code: string;
  text: string;
  subnet?: string;
  node?: string;
}

type Models = { ieds: IedModel[]; switches: SwitchModel[] };

const nameOf = (plan: NetworkPlan, id: string) => nodeOf(plan, id)?.name ?? id;

/** Enlaces de una subred que pertenecen a una LAN (la vacía = todos). */
const linksOf = (plan: NetworkPlan, subnetId: string, lan: string): Link[] =>
  plan.links.filter(l => l.subnet === subnetId && (lan === '' || l.lan === '' || l.lan === lan));

function components(nodeIds: string[], links: Link[]): string[][] {
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const l of links) {
    if (!adj.has(l.a)) adj.set(l.a, []);
    if (!adj.has(l.b)) adj.set(l.b, []);
    adj.get(l.a)!.push(l.b);
    adj.get(l.b)!.push(l.a);
  }
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const id of adj.keys()) {
    if (seen.has(id)) continue;
    const comp: string[] = [];
    const stack = [id];
    seen.add(id);
    while (stack.length) {
      const x = stack.pop()!;
      comp.push(x);
      for (const y of adj.get(x) ?? []) if (!seen.has(y)) { seen.add(y); stack.push(y); }
    }
    out.push(comp);
  }
  return out;
}

const dup = <T>(items: T[], key: (t: T) => string | null) => {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    if (k) m.set(k, [...(m.get(k) ?? []), it]);
  }
  return Array.from(m.entries()).filter(([, v]) => v.length > 1);
};

export function validatePlan(plan: NetworkPlan, models: Models): Issue[] {
  const out: Issue[] = [];
  const add = (level: Level, code: string, text: string, extra: { subnet?: string; node?: string } = {}) => out.push({ level, code, text, ...extra });

  // --- subredes ---
  for (const sn of plan.subnets) {
    const at = { subnet: sn.id };
    if (!sn.name.trim()) add('error', 'subnet-name', 'Hay una subred sin nombre.', at);
    if (plan.subnets.some(o => o !== sn && o.name === sn.name)) add('error', 'subnet-name-dup', `Hay dos subredes llamadas "${sn.name}".`, at);
    const c = parseCidr(sn.cidr);
    if (!c) add('error', 'subnet-cidr', `${sn.name}: la red "${sn.cidr}" no es válida (use a.b.c.d/prefijo, prefijo de 8 a 30).`, at);
    else if (!isNetworkAddress(sn.cidr)) add('error', 'subnet-cidr-host', `${sn.name}: "${sn.cidr}" tiene bits de equipo; la dirección de red sería ${sn.cidr.split('/')[0]} con máscara /${c.prefix} alineada.`, at);
    if (sn.vlan !== null && (!Number.isInteger(sn.vlan) || sn.vlan < 0 || sn.vlan > 4094)) add('error', 'subnet-vlan', `${sn.name}: la VLAN debe estar entre 0 y 4094.`, at);
    if (!Number.isInteger(sn.prio) || sn.prio < 0 || sn.prio > 7) add('error', 'subnet-prio', `${sn.name}: la prioridad 802.1p va de 0 a 7.`, at);
    if (!(sn.bitRate > 0)) add('error', 'subnet-rate', `${sn.name}: falta la velocidad de enlace.`, at);
    if (sn.gateway && c) {
      const g = parseIp(sn.gateway);
      if (g === null || g < c.network || g > c.broadcast) add('error', 'subnet-gw', `${sn.name}: la puerta de enlace ${sn.gateway} no está dentro de ${sn.cidr}.`, at);
    }
    if (sn.kind === 'rtu') {
      const owner = sn.owner ? nodeOf(plan, sn.owner) : undefined;
      if (!owner) add('error', 'rtu-owner', `${sn.name}: indique la RTU dueña de esta red.`, at);
      else if (!owner.ifaces.some(i => i.subnet === sn.id)) add('error', 'rtu-owner-if', `${sn.name}: la RTU ${owner.name} no tiene interfaz en su propia red.`, at);
    }
    if (sn.kind === 'process' && sn.bitRate < 1000) add('warn', 'process-rate', `${sn.name}: un bus de proceso con SV suele requerir 1 Gbit/s; con ${sn.bitRate} Mbit/s la carga se agota rápido.`, at);
  }
  // solapes entre subredes
  for (let i = 0; i < plan.subnets.length; i++)
    for (let j = i + 1; j < plan.subnets.length; j++) {
      const a = plan.subnets[i];
      const b = plan.subnets[j];
      const ca = parseCidr(a.cidr);
      const cb = parseCidr(b.cidr);
      if (!ca || !cb || !cidrOverlap(ca, cb)) continue;
      const shared = plan.nodes.filter(n => n.ifaces.some(x => x.subnet === a.id) && n.ifaces.some(x => x.subnet === b.id));
      if (shared.length)
        add('error', 'overlap-shared', `${a.name} y ${b.name} usan rangos que se pisan (${a.cidr} / ${b.cidr}) y comparten equipos (${shared.map(s => s.name).join(', ')}): el equipo no puede distinguir las redes.`, { subnet: a.id });
      else if (a.kind !== 'rtu' || b.kind !== 'rtu')
        add('warn', 'overlap', `${a.name} y ${b.name} tienen rangos que se pisan (${a.cidr} / ${b.cidr}). Es válido solo si son dominios L2 independientes.`, { subnet: a.id });
    }

  // --- equipos e interfaces ---
  for (const n of plan.nodes) {
    if (!n.name.trim()) add('error', 'node-name', 'Hay un equipo sin nombre.', { node: n.id });
    if (plan.nodes.some(o => o !== n && o.name === n.name)) add('error', 'node-name-dup', `Hay dos equipos llamados "${n.name}".`, { node: n.id });
    for (const i of n.ifaces) if (!subnetOf(plan, i.subnet)) add('error', 'if-subnet', `${n.name}: una interfaz apunta a una subred que no existe.`, { node: n.id });
    const subnetsOf = n.ifaces.map(i => i.subnet);
    if (new Set(subnetsOf).size < subnetsOf.length) add('warn', 'if-dup', `${n.name}: tiene más de una interfaz en la misma subred.`, { node: n.id });
  }
  for (const sn of plan.subnets) {
    const c = parseCidr(sn.cidr);
    const members = plan.nodes.flatMap(n => n.ifaces.filter(i => i.subnet === sn.id).map(i => ({ n, i })));
    let missingIp = 0;
    let missingMac = 0;
    for (const { n, i } of members) {
      const at = { subnet: sn.id, node: n.id };
      if (!i.ip.trim()) missingIp++;
      else {
        const v = parseIp(i.ip);
        if (v === null) add('error', 'ip-invalid', `${sn.name}: ${n.name} tiene una IP inválida (${i.ip}).`, at);
        else if (c) {
          if (v < c.network || v > c.broadcast) add('error', 'ip-outside', `${sn.name}: la IP ${i.ip} de ${n.name} está fuera de ${sn.cidr}.`, at);
          else if (v === c.network || v === c.broadcast) add('error', 'ip-reserved', `${sn.name}: ${i.ip} (${n.name}) es la dirección de ${v === c.network ? 'red' : 'difusión'}.`, at);
          else if (sn.gateway && parseIp(sn.gateway) === v) add('error', 'ip-gateway', `${sn.name}: ${n.name} usa la IP de la puerta de enlace (${i.ip}).`, at);
        }
      }
      if (!i.mac.trim()) missingMac++;
      else {
        const m = normalizeMac(i.mac);
        if (!m) add('error', 'mac-invalid', `${sn.name}: ${n.name} tiene una MAC inválida (${i.mac}).`, at);
        else if (isMulticastMac(m)) add('error', 'mac-multicast', `${sn.name}: la MAC de ${n.name} (${m}) es multicast; la de un equipo debe ser unicast.`, at);
      }
    }
    for (const [ip, list] of dup(members, x => (parseIp(x.i.ip) === null ? null : String(parseIp(x.i.ip)))))
      add('error', 'ip-dup', `${sn.name}: IP repetida ${list[0].i.ip} en ${list.map(x => x.n.name).join(' y ')}.`, { subnet: sn.id });
    const streams = plan.streams.filter(s => s.subnet === sn.id);
    const macOwners = [
      ...members.filter(x => normalizeMac(x.i.mac)).map(x => ({ mac: normalizeMac(x.i.mac)!, who: x.n.name, stream: false })),
      ...streams.filter(s => normalizeMac(s.mac)).map(s => ({ mac: normalizeMac(s.mac)!, who: `flujo ${s.name}`, stream: true })),
    ];
    for (const [mac, list] of dup(macOwners, x => x.mac)) {
      const onlyStreams = list.every(x => x.stream);
      add(onlyStreams ? 'warn' : 'error', 'mac-dup', `${sn.name}: MAC repetida ${mac} en ${list.map(x => x.who).join(' y ')}.`, { subnet: sn.id });
    }
    if (missingIp) add('info', 'ip-missing', `${sn.name}: ${missingIp} interfaz(es) sin IP (use "Asignar IP").`, { subnet: sn.id });
    if (missingMac) add('info', 'mac-missing', `${sn.name}: ${missingMac} interfaz(es) sin MAC; se completan al poner en marcha (viene de fábrica).`, { subnet: sn.id });
  }

  // --- flujos ---
  for (const sn of plan.subnets) {
    const streams = plan.streams.filter(s => s.subnet === sn.id);
    for (const [appid, list] of dup(streams, s => (s.appid > 0 ? String(s.appid) : null)))
      add('error', 'appid-dup', `${sn.name}: APPID 0x${hex4(Number(appid))} repetido en ${list.map(s => s.name).join(' y ')}.`, { subnet: sn.id });
  }
  for (const s of plan.streams) {
    const sn = subnetOf(plan, s.subnet);
    const at = { subnet: s.subnet, node: s.publisher };
    if (!sn) { add('error', 'stream-subnet', `Flujo ${s.name}: la subred no existe.`); continue; }
    const pub = nodeOf(plan, s.publisher);
    if (!pub) add('error', 'stream-pub', `Flujo ${s.name}: el publicador no existe.`, at);
    else if (!pub.ifaces.some(i => i.subnet === s.subnet)) add('error', 'stream-pub-if', `Flujo ${s.name}: ${pub.name} no está conectado a ${sn.name}.`, at);
    else {
      const m = pub.modelId ? [...models.ieds].find(x => x.id === pub.modelId) : undefined;
      if (m && !m.protocols.includes(s.kind)) add('warn', 'stream-proto', `Flujo ${s.name}: el modelo de ${pub.name} no declara ${s.kind} entre sus protocolos.`, at);
    }
    const mac = normalizeMac(s.mac);
    if (!s.mac.trim()) add('info', 'stream-mac-missing', `Flujo ${s.name}: sin MAC multicast (use "Asignar direcciones").`, at);
    else if (!mac) add('error', 'stream-mac', `Flujo ${s.name}: MAC inválida (${s.mac}).`, at);
    else if (!isMulticastMac(mac)) add('error', 'stream-mac-uni', `Flujo ${s.name}: la MAC de destino debe ser multicast (${mac}).`, at);
    else if (!macInStandardRange(mac, s.kind)) add('warn', 'stream-mac-range', `Flujo ${s.name}: ${mac} está fuera del rango recomendado para ${s.kind} (${s.kind === 'GOOSE' ? '01-0C-CD-01-00-00 a 01-FF' : '01-0C-CD-04-00-00 a 01-FF'}).`, at);
    if (!(s.appid > 0)) add('info', 'stream-appid-missing', `Flujo ${s.name}: sin APPID.`, at);
    else {
      const [lo, hi] = appidRange(s.kind);
      if (s.appid < lo || s.appid > hi) add('warn', 'stream-appid-range', `Flujo ${s.name}: APPID 0x${hex4(s.appid)} fuera del rango recomendado de ${s.kind} (0x${hex4(lo)}–0x${hex4(hi)}).`, at);
    }
    if (s.vlan !== null && (s.vlan < 0 || s.vlan > 4094)) add('error', 'stream-vlan', `Flujo ${s.name}: VLAN fuera de rango (0–4094).`, at);
    if (s.prio < 0 || s.prio > 7) add('error', 'stream-prio', `Flujo ${s.name}: prioridad fuera de rango (0–7).`, at);
    if (!(s.frameBytes >= 64) || !(s.fps > 0)) add('error', 'stream-load', `Flujo ${s.name}: indique tamaño de trama (≥64 B) y tramas por segundo.`, at);
    for (const sub of s.subscribers) {
      const n = nodeOf(plan, sub);
      if (!n) add('error', 'stream-sub', `Flujo ${s.name}: un suscriptor ya no existe.`, at);
      else if (!n.ifaces.some(i => i.subnet === s.subnet)) add('error', 'stream-sub-if', `Flujo ${s.name}: el suscriptor ${n.name} no está en ${sn.name}.`, at);
    }
    if (s.kind === 'SV' && sn.kind !== 'process') add('warn', 'sv-station', `Flujo ${s.name}: SV en una red que no es bus de proceso; el muestreo satura rápido una red de estación.`, at);
  }

  // --- puertos ---
  for (const n of plan.nodes) {
    const cap = portsOf(n, models);
    const use = portUse(plan, n.id);
    const at = { node: n.id };
    if (!use.copper && !use.fiber) continue;
    if (cap.copper + cap.fiber === 0) add('warn', 'ports-unknown', `${n.name}: no tiene puertos declarados; no se puede verificar la conexión.`, at);
    if (use.copper > cap.copper) add('error', 'ports-copper', `${n.name}: usa ${use.copper} puertos de cobre y solo tiene ${cap.copper}.`, at);
    if (use.fiber > cap.fiber) add('error', 'ports-fiber', `${n.name}: usa ${use.fiber} puertos de fibra y solo tiene ${cap.fiber}.`, at);
    if (use.copper <= cap.copper && use.fiber <= cap.fiber && use.copper + use.fiber + n.reserved > cap.copper + cap.fiber)
      add('error', 'ports-reserved', `${n.name}: con ${n.reserved} puerto(s) reservado(s) para bus de proceso no alcanzan los puertos (${use.copper + use.fiber} usados de ${cap.copper + cap.fiber}).`, at);
  }

  // --- topología ---
  for (const l of plan.links) {
    const sn = subnetOf(plan, l.subnet);
    const a = nodeOf(plan, l.a);
    const b = nodeOf(plan, l.b);
    if (!sn) add('error', 'link-subnet', `Un enlace apunta a una subred que no existe.`);
    if (!a || !b) { add('error', 'link-ends', 'Un enlace tiene un extremo que ya no existe.'); continue; }
    if (a === b) add('error', 'link-self', `${a.name}: un enlace conecta el equipo consigo mismo.`, { node: a.id });
    if (sn) for (const x of [a, b]) if (!x.ifaces.some(i => i.subnet === sn.id)) add('error', 'link-if', `Enlace ${a.name}–${b.name}: ${x.name} no tiene interfaz en ${sn.name}.`, { subnet: sn.id, node: x.id });
  }
  for (const sn of plan.subnets) {
    const ids = plan.nodes.filter(n => n.ifaces.some(i => i.subnet === sn.id)).map(n => n.id);
    if (ids.length < 2) continue;
    const lans = sn.redundancy === 'PRP' ? ['A', 'B'] : [''];
    for (const lan of lans) {
      const ls = linksOf(plan, sn.id, lan);
      const comps = components(ids, ls);
      const tag = lan ? ` (LAN ${lan})` : '';
      if (comps.length > 1) {
        const sample = comps.slice(0, 3).map(c => c.map(x => nameOf(plan, x)).slice(0, 3).join(', ') + (c.length > 3 ? '…' : ''));
        add('error', 'net-partition', `${sn.name}${tag}: la red está partida en ${comps.length} grupos sin conexión entre sí [${sample.join(' | ')}].`, { subnet: sn.id });
      }
      const loops = ls.length - ids.length + comps.length;
      if (loops > 0 && sn.redundancy !== 'RSTP' && sn.redundancy !== 'HSR')
        add('error', 'net-loop', `${sn.name}${tag}: hay ${loops} lazo(s) en la topología y la subred no usa RSTP ni HSR; se produciría una tormenta de difusión.`, { subnet: sn.id });
    }
    if (sn.redundancy === 'PRP') {
      for (const n of plan.nodes.filter(x => x.kind !== 'switch' && x.ifaces.some(i => i.subnet === sn.id))) {
        const mine = plan.links.filter(l => l.subnet === sn.id && (l.a === n.id || l.b === n.id));
        if (!mine.some(l => l.lan === 'A') || !mine.some(l => l.lan === 'B')) add('error', 'prp-lan', `${sn.name}: ${n.name} necesita un enlace por cada LAN (A y B) en una red PRP.`, { subnet: sn.id, node: n.id });
      }
      if (plan.links.some(l => l.subnet === sn.id && l.lan === '')) add('warn', 'prp-unlabeled', `${sn.name}: hay enlaces sin LAN asignada en una red PRP.`, { subnet: sn.id });
    }
    if (sn.redundancy === 'RSTP' && !plan.links.some(l => l.subnet === sn.id) && ids.length > 1) add('info', 'rstp-empty', `${sn.name}: sin enlaces cargados todavía.`, { subnet: sn.id });
  }

  // --- redes independientes de RTU y bus de proceso ---
  for (const n of plan.nodes) {
    const rtuNets = n.ifaces.map(i => subnetOf(plan, i.subnet)).filter((s): s is Subnet => !!s && s.kind === 'rtu');
    if (rtuNets.length > 1 && n.kind !== 'rtu' && n.kind !== 'gateway')
      add('warn', 'rtu-bridge', `${n.name} está en ${rtuNets.length} redes de RTU a la vez y las uniría; cada RTU debe quedar en su propio dominio L2.`, { node: n.id });
  }
  for (const n of plan.nodes) {
    const m = n.modelId ? models.ieds.find(x => x.id === n.modelId) : undefined;
    for (const i of n.ifaces) {
      const sn = subnetOf(plan, i.subnet);
      if (sn?.kind === 'process' && m && !m.protocols.includes('SV') && n.kind === 'ied')
        add('warn', 'process-proto', `${n.name} está en el bus de proceso pero su modelo no declara SV.`, { subnet: sn.id, node: n.id });
    }
  }
  const order: Record<Level, number> = { error: 0, warn: 1, info: 2 };
  return out.sort((x, y) => order[x.level] - order[y.level]);
}

// ---------- carga ----------

export interface LoadRow {
  linkId: string;
  subnet: string;
  from: string;
  to: string;
  lan: string;
  medium: string;
  /** Capacidad del enlace y carga, en bit/s. */
  capacity: number;
  steady: number;
  peak: number;
  streams: string[];
}

const wireBits = (s: Stream) => (s.frameBytes + WIRE_OVERHEAD) * 8;
export const steadyBps = (s: Stream) => wireBits(s) * s.fps;
export const burstBps = (s: Stream) => wireBits(s) * s.burstFrames;

/** Aristas dirigidas (publicador → suscriptores) por las que viaja un flujo. */
function streamEdges(plan: NetworkPlan, s: Stream, lan: string): Link[] {
  const sn = subnetOf(plan, s.subnet);
  if (!sn) return [];
  const ls = linksOf(plan, s.subnet, lan);
  const adj = new Map<string, { to: string; link: Link }[]>();
  for (const l of ls) {
    adj.set(l.a, [...(adj.get(l.a) ?? []), { to: l.b, link: l }]);
    adj.set(l.b, [...(adj.get(l.b) ?? []), { to: l.a, link: l }]);
  }
  const parent = new Map<string, { from: string; link: Link }>();
  const queue = [s.publisher];
  const seen = new Set(queue);
  while (queue.length) {
    const x = queue.shift()!;
    for (const e of adj.get(x) ?? []) if (!seen.has(e.to)) { seen.add(e.to); parent.set(e.to, { from: x, link: e.link }); queue.push(e.to); }
  }
  const dirs: Link[] = [];
  const targets = sn.pruned && s.subscribers.length ? s.subscribers.filter(t => seen.has(t)) : Array.from(parent.keys());
  const used = new Set<string>();
  for (const t of targets) {
    let cur = t;
    while (parent.has(cur)) {
      const p = parent.get(cur)!;
      const key = `${p.link.id}:${p.from}>${cur}`;
      if (used.has(key)) break;
      used.add(key);
      dirs.push({ ...p.link, a: p.from, b: cur });
      cur = p.from;
    }
  }
  return dirs;
}

/** Carga por enlace y por sentido (régimen estable y pico tras un evento). */
export function loadReport(plan: NetworkPlan): LoadRow[] {
  const rows = new Map<string, LoadRow>();
  const rowFor = (l: Link, from: string, to: string, lan: string) => {
    const key = `${l.id}:${from}>${to}:${lan}`;
    let r = rows.get(key);
    if (!r) {
      const sn = subnetOf(plan, l.subnet);
      const bg = (sn?.background ?? 0) * 1000;
      r = { linkId: l.id, subnet: l.subnet, from: nodeOf(plan, from)?.name ?? from, to: nodeOf(plan, to)?.name ?? to, lan, medium: l.medium, capacity: linkSpeed(plan, l) * 1e6, steady: bg, peak: bg, streams: [] };
      rows.set(key, r);
    }
    return r;
  };
  for (const s of plan.streams) {
    const sn = subnetOf(plan, s.subnet);
    if (!sn || !nodeOf(plan, s.publisher)) continue;
    const lans = sn.redundancy === 'PRP' ? ['A', 'B'] : [''];
    for (const lan of lans)
      for (const e of streamEdges(plan, s, lan)) {
        const r = rowFor(e, e.a, e.b, lan);
        r.steady += steadyBps(s);
        r.peak += steadyBps(s) + burstBps(s);
        r.streams.push(s.name);
      }
  }
  // enlaces sin ningún flujo: se muestran con el tráfico de fondo
  for (const l of plan.links) {
    if (Array.from(rows.values()).some(r => r.linkId === l.id)) continue;
    const a = nodeOf(plan, l.a);
    const b = nodeOf(plan, l.b);
    if (a && b) rowFor(l, l.a, l.b, l.lan);
  }
  return Array.from(rows.values()).sort((x, y) => y.steady / y.capacity - x.steady / x.capacity);
}

export const utilization = (r: LoadRow) => (r.capacity > 0 ? r.steady / r.capacity : 0);
export const peakUtilization = (r: LoadRow) => (r.capacity > 0 ? r.peak / r.capacity : 0);

/** Avisos de la carga (se suman a los de la validación). */
export function loadIssues(plan: NetworkPlan): Issue[] {
  const out: Issue[] = [];
  for (const r of loadReport(plan)) {
    const u = utilization(r);
    const p = peakUtilization(r);
    const where = `${r.from} → ${r.to}${r.lan ? ` (LAN ${r.lan})` : ''}`;
    const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
    const sn = subnetOf(plan, r.subnet)?.name ?? '';
    if (u >= LOAD_CRIT) out.push({ level: 'error', code: 'load-crit', text: `${sn}: el enlace ${where} está al ${pct(u)} de su capacidad (límite de diseño ${LOAD_CRIT * 100} %).`, subnet: r.subnet });
    else if (u >= LOAD_WARN) out.push({ level: 'warn', code: 'load-warn', text: `${sn}: el enlace ${where} está al ${pct(u)} (aviso desde ${LOAD_WARN * 100} %).`, subnet: r.subnet });
    else if (p >= PEAK_WARN) out.push({ level: 'warn', code: 'load-peak', text: `${sn}: en una avalancha de eventos el enlace ${where} llegaría al ${pct(p)}.`, subnet: r.subnet });
  }
  return out;
}

export function fullReport(plan: NetworkPlan, models: Models): Issue[] {
  const order: Record<Level, number> = { error: 0, warn: 1, info: 2 };
  return [...validatePlan(plan, models), ...loadIssues(plan)].sort((x, y) => order[x.level] - order[y.level]);
}

export const fmtBps = (bps: number) => (bps >= 1e6 ? `${(bps / 1e6).toFixed(2)} Mbit/s` : `${(bps / 1e3).toFixed(1)} kbit/s`);

export type { NetNode };
