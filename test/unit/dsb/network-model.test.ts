import { expect } from '@open-wc/testing';

import { IedModel, newIedModel, normalizeIed, SwitchModel, addIedEdit } from '../../../src/dsb/lib/catalog-model.js';
import { createBay, createSubstation, createVoltageLevel, listBusbars, suggestColumn } from '../../../src/dsb/lib/project-model.js';
import {
  addressingCsv,
  assignIps,
  assignStreamAddresses,
  attachSvIeds,
  autoTopology,
  emptyPlan,
  importPlannedIeds,
  ipToString,
  isNetworkAddress,
  Link,
  macInStandardRange,
  NetNode,
  NetworkPlan,
  newNode,
  newStream,
  newSubnet,
  normalizeMac,
  parseAppid,
  parseCidr,
  parseIp,
  planEdits,
  readPlan,
  Subnet,
} from '../../../src/dsb/lib/network-model.js';
import { burstBps, fullReport, loadReport, steadyBps, utilization, validatePlan } from '../../../src/dsb/lib/network-check.js';

const SCL = 'http://www.iec.ch/61850/2003/SCL';
const parse = (s: string) => new DOMParser().parseFromString(s, 'application/xml');

function apply(e: any): void {
  if (Array.isArray(e)) return e.forEach(apply);
  if ('parent' in e) return void e.parent.insertBefore(e.node, e.reference);
  if ('node' in e) return void e.node.parentNode.removeChild(e.node);
}

const NOMODELS = { ieds: [] as IedModel[], switches: [] as SwitchModel[] };

const sw = (over: Partial<SwitchModel> = {}): SwitchModel => ({
  id: 'sw-x', manufacturer: 'X', model: 'S', description: '', copper: 8, fiber: 2, speed: 100, redundancy: ['RSTP'], poe: false, ...over,
});

/** Plan mínimo: una subred y los equipos pedidos, con IP en orden. */
function build(kinds: [string, NetNode['kind']][], over: Partial<Subnet> = {}) {
  let plan: NetworkPlan = emptyPlan();
  const sn = { ...newSubnet(plan, 'station'), ...over };
  plan = { ...plan, subnets: [sn] };
  const nodes: NetNode[] = [];
  kinds.forEach(([name, kind], i) => {
    nodes.push({ ...newNode({ ...plan, nodes }, kind, name), ifaces: [{ subnet: sn.id, ip: `10.10.1.${10 + i}`, mac: '' }] });
  });
  plan = { ...plan, nodes };
  const link = (a: string, b: string, extra: Partial<Link> = {}): Link => ({
    id: `lk${plan.links.length + 1}`, a: plan.nodes.find(n => n.name === a)!.id, b: plan.nodes.find(n => n.name === b)!.id, medium: 'cobre', subnet: sn.id, lan: '', speed: 0, ...extra,
  });
  return { plan, sn, link };
}

const codes = (plan: NetworkPlan, models = NOMODELS) => validatePlan(plan, models).map(i => i.code);

describe('network-model: direcciones', () => {
  it('interpreta IP y CIDR', () => {
    expect(parseIp('10.10.1.5')).to.equal(168427781);
    expect(ipToString(168427781)).to.equal('10.10.1.5');
    expect(parseIp('10.10.1.256')).to.equal(null);
    expect(parseIp('10.10.1')).to.equal(null);
    const c = parseCidr('10.10.1.0/24')!;
    expect(c.hosts).to.equal(254);
    expect(ipToString(c.broadcast)).to.equal('10.10.1.255');
    expect(parseCidr('10.10.1.0/31')).to.equal(null);
    expect(parseCidr('10.10.1.0/7')).to.equal(null);
    expect(isNetworkAddress('10.10.1.0/24')).to.equal(true);
    expect(isNetworkAddress('10.10.1.5/24')).to.equal(false);
  });

  it('normaliza MAC y reconoce los rangos de la norma', () => {
    expect(normalizeMac('01:0c:cd:01:00:0a')).to.equal('01-0C-CD-01-00-0A');
    expect(normalizeMac('010ccd01000a')).to.equal('01-0C-CD-01-00-0A');
    expect(normalizeMac('zz')).to.equal(null);
    expect(macInStandardRange('01-0C-CD-01-00-FF', 'GOOSE')).to.equal(true);
    expect(macInStandardRange('01-0C-CD-01-02-00', 'GOOSE')).to.equal(false);
    expect(macInStandardRange('01-0C-CD-04-01-FF', 'SV')).to.equal(true);
    expect(macInStandardRange('01-0C-CD-01-00-01', 'SV')).to.equal(false);
    expect(parseAppid('0x3FFF')).to.equal(0x3fff);
    expect(parseAppid('40001')).to.equal(null);
  });

  it('asigna IP libres por bloques sin pisar las existentes', () => {
    const { plan, sn } = build([['SW1', 'switch'], ['P1', 'ied'], ['P2', 'ied'], ['RTU1', 'rtu']]);
    const open = { ...plan, nodes: plan.nodes.map(n => ({ ...n, ifaces: n.ifaces.map(i => ({ ...i, ip: n.name === 'P1' ? '10.10.1.20' : '' })) })) };
    const r = assignIps({ ...open, subnets: [{ ...sn, gateway: '10.10.1.1' }] }, sn.id);
    const ip = (n: string) => r.plan.nodes.find(x => x.name === n)!.ifaces[0].ip;
    expect(r.assigned).to.equal(3);
    expect(ip('SW1')).to.equal('10.10.1.2');
    expect(ip('RTU1')).to.equal('10.10.1.10');
    expect(ip('P1')).to.equal('10.10.1.20');
    expect(ip('P2')).to.equal('10.10.1.21');
    expect(codes(r.plan)).to.not.include('ip-dup');
  });

  it('asigna MAC multicast y APPID por subred, en el rango de cada tipo', () => {
    const { plan, sn } = build([['P1', 'ied'], ['MU1', 'mu']]);
    const p = nodeId(plan, 'P1');
    const m = nodeId(plan, 'MU1');
    const withStreams = { ...plan, streams: [newStream(plan, 'goose', p, sn.id), { ...newStream(plan, 'sv80', m, sn.id), id: 'st9', name: 'MU1_SV' }, { ...newStream(plan, 'goose', p, sn.id), id: 'st8', name: 'P1_GOOSE_2' }] };
    const r = assignStreamAddresses(withStreams);
    const [g1, sv, g2] = r.plan.streams;
    expect(g1.mac).to.equal('01-0C-CD-01-00-01');
    expect(g2.mac).to.equal('01-0C-CD-01-00-02');
    expect(sv.mac).to.equal('01-0C-CD-04-00-01');
    expect([g1.appid, g2.appid, sv.appid]).to.deep.equal([1, 2, 0x4000]);
  });
});

const nodeId = (plan: NetworkPlan, name: string) => plan.nodes.find(n => n.name === name)!.id;

describe('network-model: validación por subred', () => {
  it('detecta IP repetida dentro de una subred', () => {
    const { plan } = build([['A', 'ied'], ['B', 'ied']]);
    plan.nodes[1].ifaces[0].ip = plan.nodes[0].ifaces[0].ip;
    expect(codes(plan)).to.include('ip-dup');
  });

  it('permite repetir IP en redes de RTU independientes', () => {
    let plan = emptyPlan();
    const s1 = { ...newSubnet(plan, 'rtu'), cidr: '192.168.1.0/24' };
    plan = { ...plan, subnets: [s1] };
    const s2 = { ...newSubnet(plan, 'rtu'), cidr: '192.168.1.0/24' };
    plan = { ...plan, subnets: [s1, s2] };
    const r1 = { ...newNode(plan, 'rtu', 'RTU1'), ifaces: [{ subnet: s1.id, ip: '192.168.1.1', mac: '' }] };
    const r2 = { ...newNode({ ...plan, nodes: [r1] }, 'rtu', 'RTU2'), ifaces: [{ subnet: s2.id, ip: '192.168.1.1', mac: '' }] };
    const i1 = { ...newNode({ ...plan, nodes: [r1, r2] }, 'ied', 'P1'), ifaces: [{ subnet: s1.id, ip: '192.168.1.10', mac: '' }] };
    const i2 = { ...newNode({ ...plan, nodes: [r1, r2, i1] }, 'ied', 'P2'), ifaces: [{ subnet: s2.id, ip: '192.168.1.10', mac: '' }] };
    plan = { ...plan, subnets: [{ ...s1, owner: r1.id }, { ...s2, owner: r2.id }], nodes: [r1, r2, i1, i2] };
    const c = codes(plan);
    expect(c).to.not.include('ip-dup');
    expect(c).to.not.include('overlap-shared');
    expect(c).to.not.include('overlap'); // ambas son de RTU: independientes
    expect(c).to.not.include('rtu-owner');
    // si un equipo une las dos redes, ya no son independientes
    const bridge = { ...i1, ifaces: [...i1.ifaces, { subnet: s2.id, ip: '192.168.1.50', mac: '' }] };
    const bad = { ...plan, nodes: [r1, r2, bridge, i2] };
    expect(codes(bad)).to.include('overlap-shared');
    expect(codes(bad)).to.include('rtu-bridge');
  });

  it('valida IP: fuera de la red, de red/difusión, gateway y formato', () => {
    const { plan } = build([['A', 'ied'], ['B', 'ied'], ['C', 'ied'], ['D', 'ied']], { gateway: '10.10.1.1' });
    plan.nodes[0].ifaces[0].ip = '10.10.2.5';
    plan.nodes[1].ifaces[0].ip = '10.10.1.255';
    plan.nodes[2].ifaces[0].ip = '10.10.1.1';
    plan.nodes[3].ifaces[0].ip = '10.10.1.x';
    const c = codes(plan);
    for (const k of ['ip-outside', 'ip-reserved', 'ip-gateway', 'ip-invalid']) expect(c, k).to.include(k);
  });

  it('valida MAC de equipos y repetidos', () => {
    const { plan } = build([['A', 'ied'], ['B', 'ied'], ['C', 'ied']]);
    plan.nodes[0].ifaces[0].mac = '00-1A-2B-3C-4D-5E';
    plan.nodes[1].ifaces[0].mac = '00:1a:2b:3c:4d:5e';
    plan.nodes[2].ifaces[0].mac = '01-0C-CD-01-00-01';
    const c = codes(plan);
    expect(c).to.include('mac-dup');
    expect(c).to.include('mac-multicast');
  });

  it('valida APPID repetido y rangos de los flujos', () => {
    const { plan, sn } = build([['A', 'ied']]);
    const a = plan.nodes[0].id;
    const s1 = { ...newStream(plan, 'goose', a, sn.id), mac: '01-0C-CD-01-00-01', appid: 0x0001 };
    const s2 = { ...newStream(plan, 'goose', a, sn.id), id: 'st2', name: 'G2', mac: '01-0C-CD-01-00-02', appid: 0x0001 };
    const s3 = { ...newStream(plan, 'goose', a, sn.id), id: 'st3', name: 'G3', mac: '01-0C-CD-04-00-02', appid: 0x4005 };
    const c = codes({ ...plan, streams: [s1, s2, s3] });
    expect(c.filter(x => x === 'appid-dup').length).to.equal(1);
    expect(c).to.include('stream-appid-range');
    expect(c).to.include('stream-mac-range');
  });

  it('el mismo APPID en dos subredes distintas no es duplicado', () => {
    let plan = emptyPlan();
    const s1 = newSubnet(plan, 'station');
    const s2 = { ...newSubnet({ ...plan, subnets: [s1] }, 'station') };
    const a = { ...newNode(plan, 'ied', 'A'), ifaces: [{ subnet: s1.id, ip: '10.10.1.20', mac: '' }, { subnet: s2.id, ip: '10.10.2.20', mac: '' }] };
    plan = { ...plan, subnets: [s1, s2], nodes: [a] };
    const g1 = { ...newStream(plan, 'goose', a.id, s1.id), mac: '01-0C-CD-01-00-01', appid: 1 };
    const g2 = { ...newStream(plan, 'goose', a.id, s2.id), id: 'st2', name: 'G2', mac: '01-0C-CD-01-00-01', appid: 1 };
    const c = codes({ ...plan, streams: [g1, g2] });
    expect(c).to.not.include('appid-dup');
    expect(c).to.not.include('mac-dup');
  });

  it('exige que el publicador y los suscriptores estén en la subred', () => {
    const { plan, sn } = build([['A', 'ied'], ['B', 'ied']]);
    const s = { ...newStream(plan, 'goose', plan.nodes[0].id, sn.id), subscribers: ['nd-fantasma'] };
    expect(codes({ ...plan, streams: [s] })).to.include('stream-sub');
    const out = { ...plan, nodes: [{ ...plan.nodes[0], ifaces: [] }, plan.nodes[1]] };
    expect(codes({ ...out, streams: [{ ...s, subscribers: [] }] })).to.include('stream-pub-if');
  });

  it('avisa de SV fuera del bus de proceso y de modelos sin el protocolo', () => {
    const { plan, sn } = build([['MU1', 'mu']]);
    const sv = newStream(plan, 'sv80', plan.nodes[0].id, sn.id);
    expect(codes({ ...plan, streams: [sv] })).to.include('sv-station');
    const model = normalizeIed({ ...newIedModel(), manufacturer: 'A', model: 'B', protocols: ['MMS'] });
    const withModel = { ...plan, nodes: [{ ...plan.nodes[0], modelId: model.id }] };
    expect(codes({ ...withModel, streams: [sv] }, { ieds: [model], switches: [] })).to.include('stream-proto');
  });
});

describe('network-model: topología y puertos', () => {
  it('detecta una red partida y equipos aislados', () => {
    const { plan, link } = build([['SW1', 'switch'], ['A', 'ied'], ['B', 'ied']]);
    expect(codes({ ...plan, links: [link('SW1', 'A')] })).to.include('net-partition');
    expect(codes({ ...plan, links: [link('SW1', 'A'), { ...link('SW1', 'B'), id: 'lk2' }] })).to.not.include('net-partition');
  });

  it('detecta lazos sin RSTP y los permite con RSTP', () => {
    const { plan, sn, link } = build([['S1', 'switch'], ['S2', 'switch'], ['S3', 'switch']]);
    const links = [link('S1', 'S2'), { ...link('S2', 'S3'), id: 'lk2' }, { ...link('S3', 'S1'), id: 'lk3' }];
    expect(codes({ ...plan, links })).to.include('net-loop');
    expect(codes({ ...plan, subnets: [{ ...sn, redundancy: 'RSTP' }], links })).to.not.include('net-loop');
  });

  it('controla los puertos usados contra el modelo del catálogo y las reservas', () => {
    const { plan, link } = build([['S1', 'switch'], ['A', 'ied'], ['B', 'ied'], ['C', 'ied']]);
    const model = sw({ id: 'sw-3', copper: 2, fiber: 0 });
    const s1 = { ...plan.nodes[0], modelId: 'sw-3' };
    const base = { ...plan, nodes: [s1, ...plan.nodes.slice(1)] };
    const links = [link('S1', 'A'), { ...link('S1', 'B'), id: 'lk2' }, { ...link('S1', 'C'), id: 'lk3' }];
    expect(codes({ ...base, links }, { ieds: [], switches: [model] })).to.include('ports-copper');
    const ok = { ...base, links: links.slice(0, 2), nodes: [{ ...s1, reserved: 0 }, ...base.nodes.slice(1)] };
    expect(codes(ok, { ieds: [], switches: [model] })).to.not.include('ports-copper');
    const reserved = { ...ok, nodes: [{ ...s1, reserved: 1 }, ...base.nodes.slice(1)] };
    expect(codes(reserved, { ieds: [], switches: [model] })).to.include('ports-reserved');
  });

  it('en PRP cada equipo necesita enlaces en las LAN A y B', () => {
    const { plan, sn, link } = build([['S1', 'switch'], ['S2', 'switch'], ['A', 'ied']], { redundancy: 'PRP' });
    const links = [link('S1', 'A', { lan: 'A' }), { ...link('S2', 'A', { lan: 'B' }), id: 'lk2' }];
    expect(codes({ ...plan, links })).to.not.include('prp-lan');
    expect(codes({ ...plan, links: [links[0]] })).to.include('prp-lan');
    expect(sn.redundancy).to.equal('PRP');
  });

  it('exige RTU dueña en las redes de RTU', () => {
    let plan = emptyPlan();
    plan = { ...plan, subnets: [newSubnet(plan, 'rtu')] };
    expect(codes(plan)).to.include('rtu-owner');
  });
});

describe('network-model: carga', () => {
  /** MU1 — SW — IED1, IED2 (bus de proceso a 1 Gbit/s). */
  function processBus(pruned: boolean) {
    const { plan, sn, link } = build([['SW', 'switch'], ['MU1', 'mu'], ['IED1', 'ied'], ['IED2', 'ied']], { kind: 'process', bitRate: 1000, background: 0, pruned });
    const links = [link('SW', 'MU1'), { ...link('SW', 'IED1'), id: 'lk2' }, { ...link('SW', 'IED2'), id: 'lk3' }];
    const stream = { ...newStream(plan, 'sv80', nodeId(plan, 'MU1'), sn.id), subscribers: [nodeId(plan, 'IED1')] };
    return { ...plan, links, streams: [stream] };
  }

  it('calcula el régimen y el pico con la sobrecarga de capa 1', () => {
    const s = newStream(emptyPlan(), 'goose', '', '');
    expect(steadyBps(s)).to.equal((200 + 20) * 8 * 1);
    expect(burstBps(s)).to.equal((200 + 20) * 8 * 10);
    const sv = newStream(emptyPlan(), 'sv80', '', '');
    expect(steadyBps(sv)).to.equal((126 + 20) * 8 * 4000);
  });

  it('sin poda, el multicast SV inunda todos los enlaces; con poda solo llega al suscriptor', () => {
    const flood = loadReport(processBus(false)).filter(r => r.streams.length);
    expect(flood.length).to.equal(3);
    const pruned = loadReport(processBus(true)).filter(r => r.streams.length);
    expect(pruned.length).to.equal(2);
    expect(pruned.map(r => r.to).sort()).to.deep.equal(['IED1', 'SW']);
    expect(pruned[0].steady).to.equal(4672000);
    expect(utilization(pruned[0])).to.be.closeTo(0.004672, 1e-9);
  });

  it('avisa al pasar el 50 % y marca error sobre el 80 %', () => {
    const base = processBus(false);
    const many = (n: number) => ({ ...base, streams: Array.from({ length: n }, (_, i) => ({ ...base.streams[0], id: `st${i + 1}`, name: `SV${i + 1}` })) });
    const lv = (n: number) => fullReport({ ...many(n), subnets: base.subnets.map(s => ({ ...s, bitRate: 100 })) }, NOMODELS).filter(i => i.code.startsWith('load')).map(i => i.level);
    expect(lv(1)).to.deep.equal([]);
    expect(lv(6)).to.deep.equal([]); // 28 %
    expect(lv(12)).to.include('warn'); // 56 %
    expect(lv(18)).to.include('error'); // 84 %
  });

  it('en PRP la carga se cuenta en cada LAN', () => {
    const { plan, sn, link } = build([['S1', 'switch'], ['S2', 'switch'], ['MU1', 'mu'], ['A', 'ied']], { redundancy: 'PRP', kind: 'process', bitRate: 1000, background: 0 });
    const links = [link('S1', 'MU1', { lan: 'A' }), { ...link('S2', 'MU1', { lan: 'B' }), id: 'lk2' }, { ...link('S1', 'A', { lan: 'A' }), id: 'lk3' }, { ...link('S2', 'A', { lan: 'B' }), id: 'lk4' }];
    const r = loadReport({ ...plan, links, streams: [newStream(plan, 'sv80', nodeId(plan, 'MU1'), sn.id)] });
    expect(r.filter(x => x.streams.length).map(x => x.lan).sort()).to.deep.equal(['A', 'A', 'B', 'B']);
  });
});

describe('network-model: diseño automático', () => {
  const nodesIn = (n: number, group: string, subnet: string, plan: NetworkPlan, start = 0) =>
    Array.from({ length: n }, (_, i) => ({ ...newNode({ ...plan, nodes: [] }, 'ied', `${group}_IED${start + i + 1}`), id: `nd-${group}-${i}`, group, ifaces: [{ subnet, ip: '', mac: '' }] }));

  it('crea un switch por grupo y los une en estrella', () => {
    let plan = emptyPlan();
    const sn = newSubnet(plan, 'station');
    plan = { ...plan, subnets: [sn], nodes: [...nodesIn(4, '132kV', sn.id, plan), ...nodesIn(3, '33kV', sn.id, plan)] };
    const r = autoTopology(plan, sn.id, NOMODELS);
    expect(r.addedNodes).to.equal(2);
    expect(r.addedLinks).to.equal(7 + 1);
    expect(codes(r.plan)).to.not.include('net-partition');
    expect(codes(r.plan)).to.not.include('net-loop');
    expect(codes(r.plan).filter(c => c.startsWith('ports'))).to.deep.equal([]);
  });

  it('con RSTP y tres o más switches arma un anillo', () => {
    let plan = emptyPlan();
    const sn = { ...newSubnet(plan, 'station'), redundancy: 'RSTP' as const };
    plan = { ...plan, subnets: [sn], nodes: ['A', 'B', 'C'].flatMap(g => nodesIn(2, g, sn.id, plan)) };
    const r = autoTopology(plan, sn.id, NOMODELS);
    expect(r.addedNodes).to.equal(3);
    const inter = r.plan.links.filter(l => r.plan.nodes.find(n => n.id === l.a)!.kind === 'switch' && r.plan.nodes.find(n => n.id === l.b)!.kind === 'switch');
    expect(inter.length).to.equal(3);
    expect(codes(r.plan)).to.not.include('net-loop');
  });

  it('elige el switch más chico del catálogo y reparte si no alcanza', () => {
    let plan = emptyPlan();
    const sn = newSubnet(plan, 'station');
    plan = { ...plan, subnets: [sn], nodes: nodesIn(10, 'J1', sn.id, plan) };
    const cat = { ieds: [], switches: [sw({ id: 'sw-8', copper: 6, fiber: 2 }), sw({ id: 'sw-16', copper: 14, fiber: 2 })] };
    const r = autoTopology(plan, sn.id, cat);
    const switches = r.plan.nodes.filter(n => n.kind === 'switch');
    expect(switches.length).to.equal(1);
    expect(switches[0].modelId).to.equal('sw-16');
    const big = { ...plan, nodes: nodesIn(40, 'J1', sn.id, plan) };
    const r2 = autoTopology(big, sn.id, cat);
    expect(r2.plan.nodes.filter(n => n.kind === 'switch').length).to.be.greaterThan(2);
    expect(codes(r2.plan, cat).filter(c => c.startsWith('ports'))).to.deep.equal([]);
  });

  it('los equipos sin grupo (RTU) cuelgan de un switch existente y no crean otro', () => {
    let plan = emptyPlan();
    const sn = newSubnet(plan, 'station');
    const rtu = { ...newNode(plan, 'rtu', 'RTU1'), ifaces: [{ subnet: sn.id, ip: '', mac: '' }] };
    plan = { ...plan, subnets: [sn], nodes: [...nodesIn(3, 'J1', sn.id, plan), rtu] };
    const r = autoTopology(plan, sn.id, NOMODELS);
    expect(r.plan.nodes.filter(n => n.kind === 'switch').length).to.equal(1);
    expect(r.addedLinks).to.equal(4);
    expect(codes(r.plan)).to.not.include('net-partition');
  });

  it('no diseña PRP y no toca enlaces existentes', () => {
    let plan = emptyPlan();
    const sn = { ...newSubnet(plan, 'station'), redundancy: 'PRP' as const };
    plan = { ...plan, subnets: [sn], nodes: nodesIn(2, 'J1', sn.id, plan) };
    const r = autoTopology(plan, sn.id, NOMODELS);
    expect(r.addedLinks).to.equal(0);
    expect(r.notes.join(' ')).to.contain('PRP');
  });
});

describe('network-model: proyecto', () => {
  function project() {
    const doc = parse(`<SCL xmlns="${SCL}" version="2007" revision="B" release="4"><Header id="x"/></SCL>`);
    const sub = createSubstation(doc, { name: 'ET', location: '', description: '' });
    doc.documentElement.appendChild(sub);
    const vl = createVoltageLevel(doc, 'ET', { name: 'J1', kV: 132, busbars: 1 }, 1);
    sub.appendChild(vl);
    const bay = createBay(doc, { substation: 'ET', voltageLevel: 'J1' }, { name: 'L1', busbars: listBusbars(vl), column: suggestColumn(vl), template: 'linea' });
    vl.appendChild(bay);
    return { doc, sub, bay };
  }

  it('guarda y recupera el plan sin perder nada, y reemplaza al re-guardar', () => {
    const { doc, sub } = project();
    let plan = emptyPlan();
    const sn = { ...newSubnet(plan, 'process'), vlan: 100, pruned: true };
    plan = { ...plan, subnets: [sn], processReserve: true };
    const mu = { ...newNode(plan, 'mu', 'MU1'), reserved: 1, ifaces: [{ subnet: sn.id, ip: '10.20.1.100', mac: '00-1A-2B-3C-4D-5E' }] };
    plan = { ...plan, nodes: [mu] };
    plan = { ...plan, streams: [{ ...newStream(plan, 'sv80', mu.id, sn.id), mac: '01-0C-CD-04-00-01', appid: 0x4001, subscribers: [] }] };
    apply(planEdits(doc, sub, plan));
    const back = readPlan(sub);
    expect(back).to.deep.equal(plan);
    expect(sub.children[0].tagName).to.equal('Private'); // antes de VoltageLevel
    apply(planEdits(doc, sub, { ...plan, streams: [] }));
    expect(sub.querySelectorAll(':scope > Private[type="DSB-Network"]').length).to.equal(1);
    expect(readPlan(sub).streams.length).to.equal(0);
    apply(planEdits(doc, sub, emptyPlan()));
    expect(sub.querySelectorAll(':scope > Private[type="DSB-Network"]').length).to.equal(0);
  });

  it('importa los IED planificados con su nivel de tensión, modelo y reserva', () => {
    const { doc, sub, bay } = project();
    const model = normalizeIed({ ...newIedModel(), manufacturer: 'ABB', model: 'REF615', copper: 2, fiber: 1, protocols: ['GOOSE', 'MMS', 'SV'] });
    apply(addIedEdit(doc, bay, 'L1_PC', model.id, 'Protección y control'));
    let plan: NetworkPlan = { ...emptyPlan(), processReserve: true };
    const st = newSubnet(plan, 'station');
    const pr = newSubnet({ ...plan, subnets: [st] }, 'process');
    plan = { ...plan, subnets: [st, pr] };
    const r = importPlannedIeds(sub, plan, st.id, [model]);
    expect(r.added).to.equal(1);
    const n = r.plan.nodes[0];
    expect(n).to.include({ name: 'L1_PC', group: 'J1', modelId: model.id, copper: 2, fiber: 1, reserved: 1 });
    expect(n.ifaces.map(i => i.subnet)).to.deep.equal([st.id]); // no se conecta solo al bus de proceso
    expect(importPlannedIeds(sub, r.plan, st.id, [model]).added).to.equal(0); // no duplica
    const sv = attachSvIeds(r.plan, pr.id, [model]);
    expect(sv.attached).to.equal(1);
    expect(sv.plan.nodes[0].ifaces.map(i => i.subnet)).to.deep.equal([st.id, pr.id]); // habla SV: ahora sí
    expect(attachSvIeds(sv.plan, pr.id, [model]).attached).to.equal(0); // no repite
    const noSv = { ...model, protocols: ['MMS'] };
    expect(attachSvIeds(r.plan, pr.id, [noSv]).attached).to.equal(0); // sin SV no entra
  });

  it('genera la tabla de direccionamiento', () => {
    const { plan, sn } = build([['A', 'ied']]);
    const s = { ...newStream(plan, 'goose', plan.nodes[0].id, sn.id), mac: '01-0C-CD-01-00-01', appid: 1 };
    const csv = addressingCsv({ ...plan, streams: [s] });
    const lines = csv.trim().split('\r\n');
    expect(lines.length).to.equal(3);
    expect(lines[1]).to.contain('"A"');
    expect(lines[2]).to.contain('"0x0001"');
  });
});
