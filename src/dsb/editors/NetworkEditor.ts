import { css, html, LitElement, property, PropertyValues, state, svg, TemplateResult } from 'lit-element';

import { newEditEventV2 } from '@compas-oscd/core';

import { IedModel, readSnapshot, SwitchModel, upsertById } from '../lib/catalog-model.js';
import { loadCatalog } from '../lib/catalog-store.js';
import { fmtBps, fullReport, Issue, loadReport, LoadRow, peakUtilization, utilization } from '../lib/network-check.js';
import {
  addressingCsv,
  assignIps,
  assignStreamAddresses,
  attachSvIeds,
  autoTopology,
  emptyPlan,
  hex4,
  importPlannedIeds,
  Link,
  LOAD_CRIT,
  LOAD_WARN,
  Medium,
  NetNode,
  NetworkPlan,
  newNode,
  newStream,
  newSubnet,
  NODE_KINDS,
  nodeOf,
  NodeKind,
  parseAppid,
  planEdits,
  portsOf,
  readPlan,
  REDUNDANCY_MODES,
  Stream,
  STREAM_PRESETS,
  Subnet,
  SUBNET_KINDS,
  subnetOf,
  SubnetKind,
  uid,
} from '../lib/network-model.js';

type Section = 'subnets' | 'nodes' | 'topology' | 'streams' | 'check';

function download(name: string, mime: string, data: string) {
  const url = URL.createObjectURL(new Blob(['﻿' + data], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const num = (v: string, def = 0) => (v.trim() === '' || Number.isNaN(Number(v)) ? def : Number(v));
const LEVEL_MARK = { error: '✖', warn: '▲', info: 'ℹ' } as const;
const LEVEL_LABEL = { error: 'Errores', warn: 'Avisos', info: 'Pendientes' } as const;

/**
 * DSB — Red y comunicación (etapa E).
 *
 * Diseño asistido de la red Ethernet: subredes (estación, bus de proceso, redes
 * de RTU), equipos, topología con diseño automático, flujos GOOSE/SV con MAC,
 * APPID, VLAN y prioridad, cálculo de carga por enlace y validación de
 * duplicados por subred. Se trabaja sobre una copia y se guarda en el proyecto
 * con "Guardar plan".
 */
export default class DsbNetworkPlugin extends LitElement {
  @property({ attribute: false }) doc!: XMLDocument;
  @property({ type: Number }) editCount = -1;

  @state() private section: Section = 'subnets';
  @state() private plan: NetworkPlan = emptyPlan();
  @state() private dirty = false;
  @state() private message = '';
  @state() private focusSubnet = '';
  @state() private newKind: NodeKind = 'rtu';
  @state() private newPreset = STREAM_PRESETS[0].id;
  @state() private levelFilter: '' | 'error' | 'warn' | 'info' = '';

  private catalog = loadCatalog();
  private cache: { plan: NetworkPlan; issues: Issue[]; load: LoadRow[] } | null = null;

  private get substation(): Element | null {
    return this.doc?.querySelector(':root > Substation') ?? null;
  }

  private get iedModels(): IedModel[] {
    const sub = this.substation;
    let list = [...(sub ? readSnapshot(sub) : [])];
    for (const m of this.catalog.ieds) list = upsertById(list, m);
    return list;
  }

  private get switchModels(): SwitchModel[] {
    return this.catalog.switches;
  }

  private get models() {
    return { ieds: this.iedModels, switches: this.switchModels };
  }

  /** Validación y carga del plan de trabajo (se recalcula solo cuando cambia). */
  private get analysis() {
    if (!this.cache || this.cache.plan !== this.plan) {
      this.cache = { plan: this.plan, issues: fullReport(this.plan, this.models), load: loadReport(this.plan) };
    }
    return this.cache;
  }

  protected update(changed: PropertyValues): void {
    if ((changed.has('doc') || changed.has('editCount')) && !this.dirty) {
      const sub = this.substation;
      this.plan = sub ? readPlan(sub) : emptyPlan();
      this.cache = null;
    }
    super.update(changed);
  }

  // ---------- cambios sobre la copia de trabajo ----------

  private set(plan: NetworkPlan, message = '') {
    this.plan = plan;
    this.dirty = true;
    this.message = message;
  }

  private setSubnet(id: string, patch: Partial<Subnet>) {
    this.set({ ...this.plan, subnets: this.plan.subnets.map(s => (s.id === id ? { ...s, ...patch } : s)) });
  }

  private setNode(id: string, patch: Partial<NetNode>) {
    this.set({ ...this.plan, nodes: this.plan.nodes.map(n => (n.id === id ? { ...n, ...patch } : n)) });
  }

  private setStream(id: string, patch: Partial<Stream>) {
    this.set({ ...this.plan, streams: this.plan.streams.map(s => (s.id === id ? { ...s, ...patch } : s)) });
  }

  private setLink(id: string, patch: Partial<Link>) {
    this.set({ ...this.plan, links: this.plan.links.map(l => (l.id === id ? { ...l, ...patch } : l)) });
  }

  private addSubnet(kind: SubnetKind) {
    this.set({ ...this.plan, subnets: [...this.plan.subnets, newSubnet(this.plan, kind)] });
  }

  private removeSubnet(id: string) {
    const p = this.plan;
    this.set({
      ...p,
      subnets: p.subnets.filter(s => s.id !== id),
      nodes: p.nodes.map(n => ({ ...n, ifaces: n.ifaces.filter(i => i.subnet !== id) })),
      links: p.links.filter(l => l.subnet !== id),
      streams: p.streams.filter(s => s.subnet !== id),
    });
    if (this.focusSubnet === id) this.focusSubnet = '';
  }

  private removeNode(id: string) {
    const p = this.plan;
    this.set({
      ...p,
      nodes: p.nodes.filter(n => n.id !== id),
      links: p.links.filter(l => l.a !== id && l.b !== id),
      streams: p.streams.filter(s => s.publisher !== id).map(s => ({ ...s, subscribers: s.subscribers.filter(x => x !== id) })),
      subnets: p.subnets.map(s => (s.owner === id ? { ...s, owner: '' } : s)),
    });
  }

  /** Deja el lugar previsto para el bus de proceso: una subred de proceso y puertos reservados. */
  private reserveProcessBus() {
    const p = this.plan;
    const subnets = p.subnets.some(s => s.kind === 'process') ? p.subnets : [...p.subnets, newSubnet(p, 'process')];
    this.set(
      { ...p, subnets, processReserve: true, nodes: p.nodes.map(n => (n.kind === 'ied' && n.reserved < 1 ? { ...n, reserved: 1 } : n)) },
      'Bus de proceso previsto: subred creada y un puerto reservado en cada IED.',
    );
  }

  private importIeds() {
    const sub = this.substation;
    const target = this.defaultSubnet('station');
    if (!sub) return;
    if (!target) {
      this.message = 'Primero cree una subred (pestaña Subredes).';
      return;
    }
    const r = importPlannedIeds(sub, this.plan, target.id, this.iedModels);
    this.set(r.plan, r.added ? `Se importaron ${r.added} IED planificados a "${target.name}".` : 'No hay IED planificados nuevos (asígnelos en "4. Catálogo e IEDs").');
  }

  private defaultSubnet(kind?: SubnetKind): Subnet | undefined {
    return this.plan.subnets.find(s => s.id === this.focusSubnet) ?? this.plan.subnets.find(s => s.kind === kind) ?? this.plan.subnets[0];
  }

  private addNode() {
    const n = newNode(this.plan, this.newKind);
    const sn = this.defaultSubnet();
    if (sn) n.ifaces = [{ subnet: sn.id, ip: '', mac: '' }];
    let subnets = this.plan.subnets;
    if (this.newKind === 'rtu') {
      // la RTU queda como dueña de una red de RTU libre, y también en la red elegida (p. ej. la de estación)
      const free = subnets.find(s => s.kind === 'rtu' && !s.owner);
      if (free) {
        subnets = subnets.map(s => (s.id === free.id ? { ...s, owner: n.id } : s));
        n.ifaces = [...n.ifaces.filter(i => i.subnet !== free.id), { subnet: free.id, ip: '', mac: '' }];
        if (sn && sn.id !== free.id && !n.ifaces.some(i => i.subnet === sn.id)) n.ifaces.push({ subnet: sn.id, ip: '', mac: '' });
      }
    }
    this.set({ ...this.plan, subnets, nodes: [...this.plan.nodes, n] });
  }

  private attachSv() {
    const proc = this.plan.subnets.find(s => s.kind === 'process');
    if (!proc) {
      this.message = 'Primero cree un bus de proceso (pestaña Subredes).';
      return;
    }
    const r = attachSvIeds(this.plan, proc.id, this.iedModels);
    this.set(r.plan, r.attached ? `${r.attached} IED con modelo SV conectados a "${proc.name}".` : 'Ningún IED nuevo para conectar: el modelo debe declarar SV en el catálogo.');
  }

  private pickModel(n: NetNode, modelId: string) {
    const m = [...this.iedModels, ...this.switchModels].find(x => x.id === modelId);
    this.setNode(n.id, m ? { modelId, copper: m.copper, fiber: m.fiber } : { modelId: '' });
  }

  private autoDesign() {
    const sn = this.defaultSubnet();
    if (!sn) return;
    const r = autoTopology(this.plan, sn.id, this.models);
    const note = r.notes.length ? ` ${r.notes.join(' ')}` : '';
    this.set(r.plan, r.addedLinks || r.addedNodes ? `Diseño automático de "${sn.name}": ${r.addedNodes} switch(es) y ${r.addedLinks} enlace(s) nuevos.${note}` : `Nada para conectar en "${sn.name}".${note}`);
  }

  private autoIps() {
    const sn = this.defaultSubnet();
    if (!sn) return;
    const r = assignIps(this.plan, sn.id);
    this.set(r.plan, `IP asignadas en "${sn.name}": ${r.assigned}${r.failed ? ` (${r.failed} sin lugar: la red es chica)` : ''}.`);
  }

  private addLink() {
    const sn = this.defaultSubnet();
    if (!sn) return;
    const members = this.plan.nodes.filter(n => n.ifaces.some(i => i.subnet === sn.id));
    if (members.length < 2) {
      this.message = 'Hacen falta al menos dos equipos conectados a la subred.';
      return;
    }
    const l: Link = { id: uid('lk', this.plan.links.map(x => x.id)), a: members[0].id, b: members[1].id, medium: 'cobre', subnet: sn.id, lan: sn.redundancy === 'PRP' ? 'A' : '', speed: 0 };
    this.set({ ...this.plan, links: [...this.plan.links, l] });
  }

  private addStream() {
    const sn = this.defaultSubnet(this.newPreset.startsWith('sv') ? 'process' : 'station');
    if (!sn) {
      this.message = 'Primero cree una subred.';
      return;
    }
    const inSubnet = this.plan.nodes.filter(n => n.ifaces.some(i => i.subnet === sn.id));
    // SV lo publica una unidad de fusión; GOOSE, un IED
    const pub = inSubnet.find(n => n.kind === (this.newPreset.startsWith('sv') ? 'mu' : 'ied')) ?? inSubnet.find(n => n.kind !== 'switch') ?? inSubnet[0];
    if (!pub) {
      this.message = `No hay equipos conectados a "${sn.name}" para publicar el flujo.`;
      return;
    }
    this.set({ ...this.plan, streams: [...this.plan.streams, newStream(this.plan, this.newPreset, pub.id, sn.id)] });
  }

  private save() {
    const sub = this.substation;
    if (!sub) return;
    const edits = planEdits(this.doc, sub, this.plan);
    if (edits.length) this.dispatchEvent(newEditEventV2(edits, { title: 'Plan de red' }));
    this.dirty = false;
    this.message = 'Plan de red guardado en el proyecto.';
  }

  private discard() {
    const sub = this.substation;
    this.plan = sub ? readPlan(sub) : emptyPlan();
    this.dirty = false;
    this.message = 'Se descartaron los cambios sin guardar.';
  }

  // ---------- piezas de formulario ----------

  private txt(value: string | number, on: (v: string) => void, opts: { w?: number; ph?: string; type?: string } = {}) {
    return html`<input .value=${String(value)} placeholder=${opts.ph ?? ''} type=${opts.type ?? 'text'} style=${opts.w ? `width:${opts.w}px` : ''} @change=${(e: Event) => on((e.target as HTMLInputElement).value)} />`;
  }

  private sel<T extends string>(options: { id: T; label: string }[], value: T, on: (v: T) => void) {
    return html`<select .value=${value} @change=${(e: Event) => on((e.target as HTMLSelectElement).value as T)}>
      ${options.map(o => html`<option value=${o.id} ?selected=${o.id === value}>${o.label}</option>`)}
    </select>`;
  }

  private subnetOptions = (empty?: string) => [...(empty ? [{ id: '', label: empty }] : []), ...this.plan.subnets.map(s => ({ id: s.id, label: s.name }))];

  /** Selector de subred; con `all` ofrece además "Todas". */
  private focusPicker(all = true) {
    const value = all ? this.focusSubnet : this.defaultSubnet()?.id ?? '';
    return html`<label class="f inline">Subred
      ${this.sel(this.subnetOptions(all ? 'Todas' : undefined), value, v => (this.focusSubnet = v))}</label>`;
  }

  // ---------- subredes ----------

  private renderProcessCard(): TemplateResult {
    const p = this.plan;
    const proc = p.subnets.filter(s => s.kind === 'process');
    const mus = p.nodes.filter(n => n.kind === 'mu').length;
    const sv = p.streams.filter(s => s.kind === 'SV').length;
    const reserved = p.nodes.filter(n => n.reserved > 0).length;
    return html`<div class="card">
      <b>Bus de proceso (IEC 61850-9-2)</b>
      <p class="hint">El modelo ya lo contempla: subredes de tipo "Bus de proceso" (1 Gbit/s, sin tráfico de fondo), unidades de fusión, flujos SV con APPID 0x4000–0x7FFF y MAC 01-0C-CD-04, poda de multicast y puertos reservados en los equipos.</p>
      <p>Subredes de proceso: <b>${proc.length}</b> · unidades de fusión: <b>${mus}</b> · flujos SV: <b>${sv}</b> · equipos con puerto reservado: <b>${reserved}</b></p>
      <div class="row">
        <button @click=${this.reserveProcessBus}>${proc.length ? 'Reservar un puerto en cada IED' : 'Dejar previsto el bus de proceso'}</button>
        <label class="chk"><input type="checkbox" .checked=${p.processReserve} @change=${(e: Event) => this.set({ ...p, processReserve: (e.target as HTMLInputElement).checked })} /> Al importar IED, reservar un puerto para bus de proceso</label>
      </div></div>`;
  }

  private renderSubnets(): TemplateResult {
    const p = this.plan;
    return html`
      <div class="row">
        <button class="primary" @click=${() => this.addSubnet('station')}>+ Red de estación</button>
        <button @click=${() => this.addSubnet('process')}>+ Bus de proceso</button>
        <button @click=${() => this.addSubnet('rtu')}>+ Red de RTU</button>
        <button @click=${() => this.addSubnet('other')}>+ Otra</button>
      </div>
      <p class="hint">Cada subred es un dominio L2 independiente: la búsqueda de IP, MAC y APPID repetidos se hace dentro de cada una. Las redes de las RTU son independientes entre sí y pueden repetir direccionamiento. Los valores iniciales (10.10.x, 10.20.x, 10.30.x; 100 Mbit/s; 1 Gbit/s para proceso) son una propuesta: edítelos.</p>
      ${this.renderProcessCard()}
      ${p.subnets.map(s => this.renderSubnet(s))}
      ${p.subnets.length ? '' : html`<p class="empty">Todavía no hay subredes. Empiece por una red de estación.</p>`}`;
  }

  private renderSubnet(s: Subnet): TemplateResult {
    const rtus = this.plan.nodes.filter(n => n.kind === 'rtu').map(n => ({ id: n.id, label: n.name }));
    return html`<div class="card">
      <div class="grid">
        <label class="f">Nombre${this.txt(s.name, v => this.setSubnet(s.id, { name: v.trim() }))}</label>
        <label class="f">Tipo${this.sel(SUBNET_KINDS, s.kind, v => this.setSubnet(s.id, { kind: v }))}</label>
        <label class="f">Red (CIDR)${this.txt(s.cidr, v => this.setSubnet(s.id, { cidr: v.trim() }))}</label>
        <label class="f">VLAN (vacío = sin etiqueta)${this.txt(s.vlan ?? '', v => this.setSubnet(s.id, { vlan: v.trim() === '' ? null : num(v, -1) }), { type: 'number' })}</label>
        <label class="f">Prioridad 802.1p (0–7)${this.txt(s.prio, v => this.setSubnet(s.id, { prio: num(v, 4) }), { type: 'number' })}</label>
        <label class="f">Velocidad de enlace (Mbit/s)${this.txt(s.bitRate, v => this.setSubnet(s.id, { bitRate: num(v, 100) }), { type: 'number' })}</label>
        <label class="f">Redundancia${this.sel(REDUNDANCY_MODES.map(r => ({ id: r, label: r === 'none' ? 'Sin redundancia' : r })), s.redundancy, v => this.setSubnet(s.id, { redundancy: v }))}</label>
        <label class="f">Puerta de enlace${this.txt(s.gateway, v => this.setSubnet(s.id, { gateway: v.trim() }))}</label>
        <label class="f">Tráfico de fondo (kbit/s por enlace)${this.txt(s.background, v => this.setSubnet(s.id, { background: num(v) }), { type: 'number' })}</label>
        ${s.kind === 'rtu' ? html`<label class="f">RTU dueña${this.sel([{ id: '', label: '— elegir —' }, ...rtus], s.owner, v => this.setSubnet(s.id, { owner: v }))}</label>` : ''}
      </div>
      <div class="row">
        <label class="chk"><input type="checkbox" .checked=${s.pruned} @change=${(e: Event) => this.setSubnet(s.id, { pruned: (e.target as HTMLInputElement).checked })} /> Poda de multicast (el flujo solo llega a sus suscriptores)</label>
        <span class="sp"></span>
        <button class="danger" @click=${() => this.removeSubnet(s.id)}>Quitar subred</button>
      </div></div>`;
  }

  // ---------- equipos ----------

  private renderNodes(): TemplateResult {
    const p = this.plan;
    const list = p.nodes.filter(n => !this.focusSubnet || n.ifaces.some(i => i.subnet === this.focusSubnet));
    const modelOptions = (n: NetNode) => {
      const src: { id: string; label: string }[] =
        n.kind === 'switch' ? this.switchModels.map(m => ({ id: m.id, label: `${m.manufacturer} ${m.model}` })) : n.kind === 'ied' || n.kind === 'mu' ? this.iedModels.map(m => ({ id: m.id, label: `${m.manufacturer} ${m.model}` })) : [];
      return [{ id: '', label: '— a mano —' }, ...src];
    };
    return html`
      <div class="row">
        ${this.focusPicker()}
        <button class="primary" @click=${this.importIeds}>Importar IED planificados</button>
        <button @click=${this.attachSv} title="Conecta al bus de proceso los IED cuyo modelo declara SV">Conectar IED con SV al bus de proceso</button>
        <span class="sp"></span>
        ${this.sel(NODE_KINDS, this.newKind, v => (this.newKind = v))}
        <button @click=${this.addNode}>+ Agregar equipo</button>
      </div>
      <p class="hint">Los IED planificados (pestaña 4) entran con su modelo, sus puertos y el nivel de tensión como grupo. Las RTU, switches, unidades de fusión y gateways se agregan a mano. Cada equipo puede tener una interfaz por subred (p. ej. estación + bus de proceso).</p>
      <table>
        <tr><th>Nombre</th><th>Tipo</th><th>Modelo</th><th>Cu</th><th>Fo</th><th title="Puertos libres para bus de proceso">Res.</th><th>Grupo</th><th>Interfaces (subred · IP · MAC)</th><th></th></tr>
        ${list.map(n => {
          const ports = portsOf(n, this.models);
          return html`<tr>
            <td>${this.txt(n.name, v => this.setNode(n.id, { name: v.trim() }), { w: 130 })}</td>
            <td>${this.sel(NODE_KINDS, n.kind, v => this.setNode(n.id, { kind: v }))}</td>
            <td>${this.sel(modelOptions(n), n.modelId, v => this.pickModel(n, v))}</td>
            <td>${ports.fromModel ? ports.copper : this.txt(n.copper, v => this.setNode(n.id, { copper: num(v) }), { w: 46, type: 'number' })}</td>
            <td>${ports.fromModel ? ports.fiber : this.txt(n.fiber, v => this.setNode(n.id, { fiber: num(v) }), { w: 46, type: 'number' })}</td>
            <td>${this.txt(n.reserved, v => this.setNode(n.id, { reserved: num(v) }), { w: 46, type: 'number' })}</td>
            <td>${this.txt(n.group, v => this.setNode(n.id, { group: v.trim() }), { w: 100 })}</td>
            <td>${n.ifaces.map((i, k) => html`<div class="if">
              ${this.sel(this.subnetOptions(), i.subnet, v => this.setNode(n.id, { ifaces: n.ifaces.map((x, j) => (j === k ? { ...x, subnet: v } : x)) }))}
              ${this.txt(i.ip, v => this.setNode(n.id, { ifaces: n.ifaces.map((x, j) => (j === k ? { ...x, ip: v.trim() } : x)) }), { w: 110, ph: 'IP' })}
              ${this.txt(i.mac, v => this.setNode(n.id, { ifaces: n.ifaces.map((x, j) => (j === k ? { ...x, mac: v.trim() } : x)) }), { w: 140, ph: 'MAC (de fábrica)' })}
              <button class="x" title="Quitar interfaz" @click=${() => this.setNode(n.id, { ifaces: n.ifaces.filter((_, j) => j !== k) })}>×</button></div>`)}
              <button class="x" @click=${() => { const sn = this.defaultSubnet(); if (sn) this.setNode(n.id, { ifaces: [...n.ifaces, { subnet: sn.id, ip: '', mac: '' }] }); }}>+ interfaz</button></td>
            <td class="act"><button class="danger" @click=${() => this.removeNode(n.id)}>Quitar</button></td></tr>`;
        })}
      </table>
      ${list.length ? '' : html`<p class="empty">No hay equipos${this.focusSubnet ? ' en esta subred' : ''}. Importe los IED planificados o agregue una RTU.</p>`}`;
  }

  // ---------- topología ----------

  private renderDiagram(subnetId: string): TemplateResult {
    const p = this.plan;
    const members = p.nodes.filter(n => n.ifaces.some(i => i.subnet === subnetId));
    if (!members.length) return html``;
    const links = p.links.filter(l => l.subnet === subnetId);
    const switches = members.filter(n => n.kind === 'switch');
    const rest = members.filter(n => n.kind !== 'switch');
    const parent = new Map<string, string>();
    for (const n of rest) {
      const l = links.find(x => (x.a === n.id && switches.some(s => s.id === x.b)) || (x.b === n.id && switches.some(s => s.id === x.a)));
      if (l) parent.set(n.id, l.a === n.id ? l.b : l.a);
    }
    const W = 104;
    const PER = 6;
    const pos = new Map<string, { x: number; y: number }>();
    let x0 = 20;
    const groups = [...switches.map(s => ({ sw: s as NetNode | null, kids: rest.filter(n => parent.get(n.id) === s.id) })), { sw: null as NetNode | null, kids: rest.filter(n => !parent.has(n.id)) }];
    let height = 120;
    for (const g of groups) {
      if (!g.sw && !g.kids.length) continue;
      const cols = Math.max(1, Math.min(PER, g.kids.length));
      const width = Math.max(cols, 1) * W;
      if (g.sw) pos.set(g.sw.id, { x: x0 + width / 2 - 44, y: 20 });
      g.kids.forEach((k, i) => {
        const r = Math.floor(i / PER);
        pos.set(k.id, { x: x0 + (i % PER) * W + 6, y: 120 + r * 60 });
        height = Math.max(height, 120 + r * 60 + 60);
      });
      x0 += width + 24;
    }
    const rows = this.analysis.load.filter(r => r.subnet === subnetId);
    const colour = (l: Link) => {
      const u = Math.max(0, ...rows.filter(r => r.linkId === l.id).map(utilization));
      return u >= LOAD_CRIT ? '#c62828' : u >= LOAD_WARN ? '#ef8f00' : l.medium === 'fibra' ? '#1565c0' : '#6b7a80';
    };
    const fill = (k: NodeKind) => ({ switch: '#cfe8e5', rtu: '#fde7c2', gateway: '#e1d5f0', mu: '#d6ecc5', ied: '#e8edf0', other: '#eee' })[k];
    const box = (n: NetNode) => {
      const q = pos.get(n.id)!;
      const w = n.kind === 'switch' ? 88 : 92;
      return svg`<g><rect x=${q.x} y=${q.y} width=${w} height="34" rx="4" fill=${fill(n.kind)} stroke="#777" /><text x=${q.x + w / 2} y=${q.y + 14} text-anchor="middle" font-size="11">${n.name.length > 14 ? `${n.name.slice(0, 13)}…` : n.name}</text><text x=${q.x + w / 2} y=${q.y + 28} text-anchor="middle" font-size="9" opacity=".7">${n.ifaces.find(i => i.subnet === subnetId)?.ip ?? ''}</text></g>`;
    };
    const line = (l: Link) => {
      const a = pos.get(l.a);
      const b = pos.get(l.b);
      if (!a || !b) return svg``;
      const dash = l.lan === 'B' ? '5 3' : '';
      return svg`<line x1=${a.x + 44} y1=${a.y + 17} x2=${b.x + 44} y2=${b.y + 17} stroke=${colour(l)} stroke-width=${l.medium === 'fibra' ? 3 : 2} stroke-dasharray=${dash} />`;
    };
    return html`<div class="diag"><svg width=${Math.max(x0, 400)} height=${height}>${links.map(line)}${members.map(n => (pos.has(n.id) ? box(n) : svg``))}</svg>
      <div class="legend">Línea gris = cobre · azul = fibra · discontinua = LAN B (PRP) · naranja/rojo = carga ≥ ${LOAD_WARN * 100} % / ≥ ${LOAD_CRIT * 100} %</div></div>`;
  }

  private renderTopology(): TemplateResult {
    const sn = this.defaultSubnet();
    if (!sn) return html`<p class="empty">Cree una subred primero.</p>`;
    const members = this.plan.nodes.filter(n => n.ifaces.some(i => i.subnet === sn.id));
    const opts = members.map(n => ({ id: n.id, label: n.name }));
    const links = this.plan.links.filter(l => l.subnet === sn.id);
    const prp = sn.redundancy === 'PRP';
    return html`
      <div class="row">
        ${this.focusPicker(false)}
        <button class="primary" @click=${this.autoDesign}>Diseñar topología automáticamente</button>
        <button @click=${this.autoIps}>Asignar IP libres</button>
        <button @click=${this.addLink}>+ Enlace</button>
      </div>
      <p class="hint">El diseño automático pone un switch por grupo (nivel de tensión), usa el modelo de switch más chico del catálogo que alcance y los une en estrella, o en anillo con RSTP si hay tres o más. Respeta los puertos de cada equipo. No modifica enlaces existentes. PRP/HSR se arman a mano (en PRP, un enlace por LAN A y B).</p>
      ${this.renderDiagram(sn.id)}
      <table><tr><th>Desde</th><th>Hasta</th><th>Medio</th>${prp ? html`<th>LAN</th>` : ''}<th>Velocidad propia (Mbit/s)</th><th></th></tr>
        ${links.map(l => html`<tr>
          <td>${this.sel(opts, l.a, v => this.setLink(l.id, { a: v }))}</td>
          <td>${this.sel(opts, l.b, v => this.setLink(l.id, { b: v }))}</td>
          <td>${this.sel<Medium>([{ id: 'cobre', label: 'Cobre' }, { id: 'fibra', label: 'Fibra' }], l.medium, v => this.setLink(l.id, { medium: v }))}</td>
          ${prp ? html`<td>${this.sel([{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }], l.lan || 'A', v => this.setLink(l.id, { lan: v as Link['lan'] }))}</td>` : ''}
          <td>${this.txt(l.speed || '', v => this.setLink(l.id, { speed: num(v) }), { w: 70, ph: `${sn.bitRate}`, type: 'number' })}</td>
          <td class="act"><button class="danger" @click=${() => this.set({ ...this.plan, links: this.plan.links.filter(x => x.id !== l.id) })}>Quitar</button></td></tr>`)}
      </table>
      ${links.length ? '' : html`<p class="empty">Sin enlaces en esta subred.</p>`}`;
  }

  // ---------- flujos ----------

  private renderStreams(): TemplateResult {
    const p = this.plan;
    const list = p.streams.filter(s => !this.focusSubnet || s.subnet === this.focusSubnet);
    return html`
      <div class="row">
        ${this.focusPicker()}
        ${this.sel(STREAM_PRESETS.map(x => ({ id: x.id, label: x.label })), this.newPreset, v => (this.newPreset = v))}
        <button class="primary" @click=${this.addStream}>+ Flujo</button>
        <button @click=${() => { const r = assignStreamAddresses(p, this.focusSubnet || undefined); this.set(r.plan, `MAC multicast y APPID asignados: ${r.assigned}.`); }}>Asignar MAC y APPID libres</button>
      </div>
      <p class="hint">Cada flujo reserva una MAC multicast (GOOSE 01-0C-CD-01-xx-xx, SV 01-0C-CD-04-xx-xx) y un APPID únicos dentro de su subred. Tamaños de trama y tasas son estimaciones de diseño (SV 9-2LE: 126 B a 4000 tramas/s); ajústelos a los equipos reales. "Pico" suma las tramas extra del primer segundo tras un evento.</p>
      <table>
        <tr><th>Nombre</th><th>Tipo</th><th>Subred</th><th>Publicador</th><th>MAC destino</th><th>APPID</th><th>VLAN</th><th>Prio</th><th>Trama (B)</th><th>Tramas/s</th><th>Extra</th><th>Suscriptores</th><th></th></tr>
        ${list.map(s => {
          const members = p.nodes.filter(n => n.ifaces.some(i => i.subnet === s.subnet));
          return html`<tr>
            <td>${this.txt(s.name, v => this.setStream(s.id, { name: v.trim() }), { w: 130 })}</td>
            <td>${s.kind}</td>
            <td>${this.sel(this.subnetOptions(), s.subnet, v => this.setStream(s.id, { subnet: v, vlan: subnetOf(p, v)?.vlan ?? null }))}</td>
            <td>${this.sel(members.map(n => ({ id: n.id, label: n.name })).concat(members.some(n => n.id === s.publisher) ? [] : [{ id: s.publisher, label: nodeOf(p, s.publisher)?.name ?? '—' }]), s.publisher, v => this.setStream(s.id, { publisher: v }))}</td>
            <td>${this.txt(s.mac, v => this.setStream(s.id, { mac: v.trim() }), { w: 130, ph: '01-0C-CD-01-00-01' })}</td>
            <td>${this.txt(s.appid ? hex4(s.appid) : '', v => this.setStream(s.id, { appid: parseAppid(v) ?? 0 }), { w: 56, ph: '0001' })}</td>
            <td>${this.txt(s.vlan ?? '', v => this.setStream(s.id, { vlan: v.trim() === '' ? null : num(v, -1) }), { w: 56, type: 'number' })}</td>
            <td>${this.txt(s.prio, v => this.setStream(s.id, { prio: num(v, 4) }), { w: 40, type: 'number' })}</td>
            <td>${this.txt(s.frameBytes, v => this.setStream(s.id, { frameBytes: num(v) }), { w: 60, type: 'number' })}</td>
            <td>${this.txt(s.fps, v => this.setStream(s.id, { fps: num(v) }), { w: 66, type: 'number' })}</td>
            <td>${this.txt(s.burstFrames, v => this.setStream(s.id, { burstFrames: num(v) }), { w: 50, type: 'number' })}</td>
            <td><details><summary>${s.subscribers.length ? `${s.subscribers.length}` : 'todos'}</summary>${members.filter(n => n.id !== s.publisher).map(n => html`<label class="chk"><input type="checkbox" .checked=${s.subscribers.includes(n.id)} @change=${(e: Event) => this.setStream(s.id, { subscribers: (e.target as HTMLInputElement).checked ? [...s.subscribers, n.id] : s.subscribers.filter(x => x !== n.id) })} /> ${n.name}</label>`)}</details></td>
            <td class="act"><button class="danger" @click=${() => this.set({ ...p, streams: p.streams.filter(x => x.id !== s.id) })}>Quitar</button></td></tr>`;
        })}
      </table>
      ${list.length ? '' : html`<p class="empty">No hay flujos. Agregue GOOSE entre IED o SV desde una unidad de fusión.</p>`}`;
  }

  // ---------- validación y carga ----------

  private renderCheck(): TemplateResult {
    const { issues, load } = this.analysis;
    const inScope = issues.filter(i => !this.focusSubnet || !i.subnet || i.subnet === this.focusSubnet);
    const count = (l: Issue['level']) => inScope.filter(i => i.level === l).length;
    const shown = inScope.filter(i => !this.levelFilter || i.level === this.levelFilter);
    const rows = load.filter(r => !this.focusSubnet || r.subnet === this.focusSubnet).slice(0, 40);
    return html`
      <div class="row">
        ${this.focusPicker()}
        ${(['error', 'warn', 'info'] as const).map(l => html`<button class="tab ${this.levelFilter === l ? 'on' : ''}" @click=${() => (this.levelFilter = this.levelFilter === l ? '' : l)}>${LEVEL_MARK[l]} ${LEVEL_LABEL[l]}: ${count(l)}</button>`)}
        <span class="sp"></span>
        <button @click=${() => download(`${this.substation?.getAttribute('name') ?? 'proyecto'}_direccionamiento.csv`, 'text/csv;charset=utf-8', addressingCsv(this.plan))}>Exportar tabla de direccionamiento (CSV)</button>
      </div>
      ${inScope.length ? '' : html`<p class="ok">✔ Sin observaciones${this.focusSubnet ? ' en esta subred' : ''}.</p>`}
      <ul class="issues">${shown.map(i => html`<li class=${i.level}><span>${LEVEL_MARK[i.level]}</span> ${i.text}</li>`)}</ul>
      <h3>Carga por enlace y por sentido</h3>
      <p class="hint">Régimen = flujos en estado estable + tráfico de fondo de la subred. Pico = además las tramas extra del primer segundo tras un evento. Sin poda de multicast, cada flujo recorre todo el árbol de la subred (peor caso). Aviso desde ${LOAD_WARN * 100} %, error desde ${LOAD_CRIT * 100} %.</p>
      <table><tr><th>Subred</th><th>Enlace</th><th>LAN</th><th>Capacidad</th><th>Régimen</th><th>%</th><th>Pico %</th><th>Flujos</th></tr>
        ${rows.map(r => {
          const u = utilization(r);
          return html`<tr><td>${subnetOf(this.plan, r.subnet)?.name ?? ''}</td><td>${r.from} → ${r.to}</td><td>${r.lan}</td><td>${fmtBps(r.capacity)}</td><td>${fmtBps(r.steady)}</td>
            <td><div class="bar"><div class="fill ${u >= LOAD_CRIT ? 'crit' : u >= LOAD_WARN ? 'warn' : ''}" style=${`width:${Math.min(100, u * 100)}%`}></div></div> ${(u * 100).toFixed(1)}</td>
            <td>${(peakUtilization(r) * 100).toFixed(1)}</td><td class="caps">${r.streams.length}</td></tr>`;
        })}</table>
      ${rows.length ? '' : html`<p class="empty">Sin enlaces para calcular.</p>`}`;
  }

  render(): TemplateResult {
    if (!this.doc) return html``;
    if (!this.substation) return html`<p class="empty" style="padding:16px">No hay subestación. Créela en la pestaña "1. Proyecto".</p>`;
    const { issues } = this.analysis;
    const errors = issues.filter(i => i.level === 'error').length;
    const tab = (s: Section, label: string) => html`<button class="tab ${this.section === s ? 'on' : ''}" @click=${() => (this.section = s)}>${label}</button>`;
    return html`
      <div class="top">
        ${tab('subnets', 'Subredes')}${tab('nodes', 'Equipos')}${tab('topology', 'Topología')}${tab('streams', 'Flujos GOOSE / SV')}${tab('check', `Validación y carga${errors ? ` (${errors} ✖)` : ''}`)}
        <span class="sp"></span>
        ${this.dirty ? html`<span class="warnmsg">Cambios sin guardar</span><button @click=${this.discard}>Descartar</button>` : ''}
        <button class="primary" ?disabled=${!this.dirty} @click=${this.save}>Guardar plan</button>
      </div>
      ${this.message ? html`<p class="msg">${this.message}</p>` : ''}
      <div class="body">${{ subnets: () => this.renderSubnets(), nodes: () => this.renderNodes(), topology: () => this.renderTopology(), streams: () => this.renderStreams(), check: () => this.renderCheck() }[this.section]()}</div>`;
  }

  static styles = css`
    :host { font-family: var(--mdc-typography-font-family, Roboto, sans-serif); display: block; color: var(--mdc-theme-on-surface, #222); }
    .top { display: flex; gap: 8px; align-items: center; padding: 8px 16px; border-bottom: 1px solid rgba(128,128,128,.3); flex-wrap: wrap; }
    .sp { flex: 1; }
    .body { padding: 8px 16px 24px; overflow: auto; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; margin: 8px 0; }
    th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid rgba(128,128,128,.25); vertical-align: top; }
    td.act { white-space: nowrap; }
    td.caps { text-align: right; }
    .card { border: 1px solid rgba(128,128,128,.4); border-radius: 6px; padding: 8px 16px 8px; margin: 8px 0 14px; background: rgba(255,255,255,.35); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px 16px; }
    .f { display: flex; flex-direction: column; font-size: 12px; gap: 2px; }
    .f.inline { flex-direction: row; align-items: center; gap: 6px; font-size: 13px; }
    input, select { font: inherit; font-size: 13px; padding: 3px 5px; max-width: 100%; }
    .grid input, .grid select { width: 100%; box-sizing: border-box; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0; align-items: center; }
    .chk { font-size: 13px; display: flex; gap: 4px; align-items: center; }
    button { font: inherit; padding: 4px 12px; cursor: pointer; }
    button.x { padding: 0 6px; font-size: 12px; }
    .if { display: flex; gap: 4px; margin-bottom: 3px; }
    .tab { border: none; background: none; border-bottom: 3px solid transparent; font-size: 14px; padding: 8px 10px; }
    .tab.on { border-bottom-color: var(--mdc-theme-primary, #2aa198); font-weight: 500; }
    .primary { background: var(--mdc-theme-primary, #2aa198); color: #fff; border: none; border-radius: 3px; }
    button:disabled { opacity: .4; cursor: default; }
    .danger, .error span { color: #c62828; }
    .warn span, .warnmsg { color: #ef8f00; }
    .ok { color: #2e7d32; }
    .hint, .empty, .legend { opacity: .7; font-size: 13px; }
    .msg { color: var(--mdc-theme-primary, #2aa198); padding: 0 16px; margin: 6px 0 0; }
    h3 { font-weight: 400; margin: 18px 0 4px; }
    ul.issues { list-style: none; padding: 0; margin: 6px 0; font-size: 13px; }
    ul.issues li { padding: 3px 0; border-bottom: 1px solid rgba(128,128,128,.18); }
    ul.issues li span { display: inline-block; width: 18px; }
    .info span { color: #1565c0; }
    .bar { display: inline-block; width: 90px; height: 8px; background: rgba(128,128,128,.25); border-radius: 4px; vertical-align: middle; overflow: hidden; }
    .fill { height: 100%; background: #2e7d32; }
    .fill.warn { background: #ef8f00; }
    .fill.crit { background: #c62828; }
    .diag { overflow: auto; border: 1px solid rgba(128,128,128,.3); border-radius: 6px; padding: 6px; margin: 8px 0; background: rgba(255,255,255,.5); }
    details summary { cursor: pointer; }
  `;
}
