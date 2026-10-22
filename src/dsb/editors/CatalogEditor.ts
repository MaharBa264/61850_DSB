import {
  css,
  html,
  LitElement,
  property,
  PropertyValues,
  state,
  TemplateResult,
} from 'lit-element';

import { newEditEventV2 } from '@compas-oscd/core';

import {
  addIedEdit,
  allIeds,
  bom,
  Catalog,
  catalogFromJson,
  catalogToJson,
  checkHost,
  hostsOf,
  IedModel,
  listIeds,
  modelsFromIcd,
  needOf,
  newIedModel,
  newSwitchModel,
  normalizeIed,
  normalizeSwitch,
  PROTOCOLS,
  readSnapshot,
  REDUNDANCY,
  ROLES,
  snapshotEdits,
  suggestIedName,
  suggestModels,
  SwitchModel,
  toBomCsv,
  upsertById,
  validateIedModel,
  validateIedName,
  validateSwitchModel,
} from '../lib/catalog-model.js';
import { loadCatalog, saveCatalog } from '../lib/catalog-store.js';
import { FUNCTIONS } from '../lib/functions-catalog.js';

function download(name: string, mime: string, data: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Clases LN que ofrece el catálogo de funciones, con una etiqueta legible. */
const LN_OPTIONS: { lnClass: string; label: string }[] = (() => {
  const m = new Map<string, string[]>();
  for (const f of FUNCTIONS) m.set(f.lnClass, [...(m.get(f.lnClass) ?? []), f.ansi ? `${f.name} (${f.ansi})` : f.name]);
  return Array.from(m.entries())
    .map(([lnClass, names]) => ({ lnClass, label: `${lnClass} — ${names.join(' / ')}` }))
    .sort((a, b) => a.lnClass.localeCompare(b.lnClass));
})();

type Section = 'ieds' | 'switches' | 'assign';

const num = (v: string) => (v.trim() === '' ? 0 : Number(v));

/**
 * DSB — Catálogo e IEDs (etapa D).
 *
 * Catálogo de IEDs (carga manual o desde ICD/IID) y de switches, asignación de
 * IEDs a campos y transformadores, verificación de capacidad contra las
 * funciones asignadas en la etapa C y lista de materiales.
 */
export default class DsbCatalogPlugin extends LitElement {
  @property({ attribute: false }) doc!: XMLDocument;
  @property({ type: Number }) editCount = -1;

  @state() private section: Section = 'ieds';
  @state() private catalog: Catalog = loadCatalog();
  @state() private iedDraft: IedModel | null = null;
  @state() private swDraft: SwitchModel | null = null;
  @state() private errors: string[] = [];
  @state() private message = '';
  @state() private host: Element | null = null;
  @state() private pickModel = '';
  @state() private pickRole: string = ROLES[0];
  @state() private iedName = '';
  @state() private capClass = LN_OPTIONS[0].lnClass;
  @state() private capQty = 1;

  private get substation(): Element | null {
    return this.doc?.querySelector(':root > Substation') ?? null;
  }

  /** Catálogo local + modelos guardados en el proyecto (el local manda). */
  private get available(): IedModel[] {
    const sub = this.substation;
    let list = [...(sub ? readSnapshot(sub) : [])];
    for (const m of this.catalog.ieds) list = upsertById(list, m);
    return list;
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    if (changed.has('doc') && this.host && !this.doc.contains(this.host)) this.host = null;
  }

  private emit(edit: Parameters<typeof newEditEventV2>[0], title: string) {
    this.dispatchEvent(newEditEventV2(edit, { title }));
  }

  private persist(c: Catalog, ok: string) {
    this.catalog = c;
    this.message = saveCatalog(c) ? ok : `${ok} (el navegador no permitió guardarlo: exporte el catálogo a un archivo).`;
  }

  // ---------- catálogo de IEDs ----------

  private saveIed() {
    if (!this.iedDraft) return;
    const m = normalizeIed(this.iedDraft);
    const errors = validateIedModel(m);
    this.errors = errors;
    if (errors.length) return;
    this.persist({ ...this.catalog, ieds: upsertById(this.catalog.ieds, m) }, `Se guardó ${m.manufacturer} ${m.model}.`);
    this.iedDraft = null;
  }

  private removeIed(m: IedModel) {
    if (allIeds(this.substation ?? document.createElement('x')).some(i => i.modelId === m.id)) {
      this.message = `${m.model} está asignado en este proyecto; no se borra del catálogo.`;
      return;
    }
    this.persist({ ...this.catalog, ieds: this.catalog.ieds.filter(x => x.id !== m.id) }, `Se quitó ${m.model}.`);
  }

  private setIed(patch: Partial<IedModel>) {
    this.iedDraft = { ...this.iedDraft!, ...patch };
  }

  private addCapacity() {
    const d = this.iedDraft!;
    const qty = Math.max(1, Math.floor(this.capQty || 1));
    this.setIed({ capacity: { ...d.capacity, [this.capClass]: (d.capacity[this.capClass] ?? 0) + qty } });
  }

  private async importIcd(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    let added = 0;
    let skipped = 0;
    let c = this.catalog;
    for (const f of files) {
      const doc = new DOMParser().parseFromString(await f.text(), 'application/xml');
      if (doc.querySelector('parsererror')) {
        skipped++;
        continue;
      }
      for (const m of modelsFromIcd(doc)) {
        if (validateIedModel(m).length) {
          skipped++;
          continue;
        }
        c = { ...c, ieds: upsertById(c.ieds, m) };
        added++;
      }
    }
    input.value = '';
    this.persist(c, `Importados ${added} modelos${skipped ? ` (${skipped} omitidos por datos incompletos)` : ''}. Complete entradas/salidas y puertos a mano.`);
  }

  private async importJson(e: Event) {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    try {
      const inc = catalogFromJson(await f.text());
      let c = this.catalog;
      for (const m of inc.ieds) c = { ...c, ieds: upsertById(c.ieds, m) };
      for (const m of inc.switches) c = { ...c, switches: upsertById(c.switches, m) };
      this.persist(c, `Catálogo importado: ${inc.ieds.length} IEDs y ${inc.switches.length} switches.`);
    } catch (err) {
      this.message = `No se pudo leer el catálogo: ${(err as Error).message}`;
    }
    input.value = '';
  }

  // ---------- switches ----------

  private saveSwitch() {
    if (!this.swDraft) return;
    const m = normalizeSwitch(this.swDraft);
    const errors = validateSwitchModel(m);
    this.errors = errors;
    if (errors.length) return;
    this.persist({ ...this.catalog, switches: upsertById(this.catalog.switches, m) }, `Se guardó ${m.manufacturer} ${m.model}.`);
    this.swDraft = null;
  }

  private setSw(patch: Partial<SwitchModel>) {
    this.swDraft = { ...this.swDraft!, ...patch };
  }

  // ---------- asignación ----------

  private usedModels(extra: string[], without?: Element): IedModel[] {
    const sub = this.substation!;
    const ids = new Set([...allIeds(sub).filter(i => i.node !== without).map(i => i.modelId), ...extra]);
    return this.available.filter(m => ids.has(m.id));
  }

  private assign() {
    const sub = this.substation;
    const model = this.available.find(m => m.id === this.pickModel);
    if (!sub || !this.host || !model) return;
    const name = this.iedName.trim() || suggestIedName(sub, this.host, this.pickRole);
    const err = validateIedName(sub, name);
    if (err) {
      this.message = err;
      return;
    }
    this.emit(
      [addIedEdit(this.doc, this.host, name, model.id, this.pickRole), ...snapshotEdits(this.doc, sub, this.usedModels([model.id]))],
      `IED ${name}`
    );
    this.iedName = '';
    this.message = `Se asignó ${model.model} como ${name}.`;
  }

  private unassign(node: Element) {
    const sub = this.substation!;
    this.emit([{ node }, ...snapshotEdits(this.doc, sub, this.usedModels([], node))], 'Quitar IED');
  }

  private autoAssign() {
    const sub = this.substation;
    if (!sub) return;
    const edits: Parameters<typeof newEditEventV2>[0][] = [];
    const taken: string[] = [];
    const used = new Set<string>();
    let done = 0;
    let missing = 0;
    for (const h of hostsOf(sub)) {
      if (listIeds(h).length) continue;
      const need = needOf(h);
      if (!Object.keys(need.classes).length) continue;
      const m = suggestModels(need, this.available)[0];
      if (!m) {
        missing++;
        continue;
      }
      const name = suggestIedName(sub, h, 'Protección y control', taken);
      taken.push(name);
      used.add(m.id);
      edits.push(addIedEdit(this.doc, h, name, m.id, 'Protección y control'));
      done++;
    }
    if (!done) {
      this.message = missing ? `Ningún modelo del catálogo cubre las ${missing} funciones pendientes.` : 'No hay campos pendientes con funciones.';
      return;
    }
    edits.push(...snapshotEdits(this.doc, sub, this.usedModels([...used])));
    this.emit(edits as any, 'Asignar IEDs');
    this.message = `Se asignaron ${done} IEDs${missing ? `; ${missing} no tienen un modelo que cubra todo (revise el catálogo)` : ''}.`;
  }

  // ---------- vistas ----------

  private field(label: string, value: string | number, on: (v: string) => void, type = 'text', hint = ''): TemplateResult {
    return html`<label class="f">${label}
      <input type=${type} .value=${String(value)} min=${type === 'number' ? '0' : ''} @input=${(e: Event) => on((e.target as HTMLInputElement).value)} />
      ${hint ? html`<small>${hint}</small>` : ''}</label>`;
  }

  private checks(options: readonly string[], selected: string[], on: (v: string[]) => void): TemplateResult {
    return html`<div class="checks">${options.map(
      o => html`<label><input type="checkbox" .checked=${selected.includes(o)} @change=${(e: Event) => on((e.target as HTMLInputElement).checked ? [...selected, o] : selected.filter(x => x !== o))} /> ${o}</label>`
    )}</div>`;
  }

  private renderIedForm(): TemplateResult {
    const d = this.iedDraft!;
    return html`<div class="card">
      <h3>${d.id ? 'Editar IED' : 'Nuevo IED'}</h3>
      <div class="grid">
        ${this.field('Fabricante *', d.manufacturer, v => this.setIed({ manufacturer: v }))}
        ${this.field('Modelo *', d.model, v => this.setIed({ model: v }))}
        ${this.field('Descripción', d.description, v => this.setIed({ description: v }))}
        ${this.field('Entradas digitales', d.digitalIn, v => this.setIed({ digitalIn: num(v) }), 'number')}
        ${this.field('Salidas digitales', d.digitalOut, v => this.setIed({ digitalOut: num(v) }), 'number')}
        ${this.field('Canales analógicos (TC/TV)', d.analogIn, v => this.setIed({ analogIn: num(v) }), 'number')}
        ${this.field('Puertos Ethernet cobre', d.copper, v => this.setIed({ copper: num(v) }), 'number')}
        ${this.field('Puertos Ethernet fibra', d.fiber, v => this.setIed({ fiber: num(v) }), 'number')}
        ${this.field('Precio unitario (opcional)', d.price ?? '', v => this.setIed({ price: v.trim() === '' ? undefined : Number(v) }), 'number')}
      </div>
      <div class="lbl">Protocolos</div>${this.checks(PROTOCOLS, d.protocols, v => this.setIed({ protocols: v }))}
      <div class="lbl">Capacidad de funciones (nodos lógicos)</div>
      <table>${Object.entries(d.capacity).map(
        ([c, q]) => html`<tr><td>${c}</td><td>${q}</td><td><button class="danger" @click=${() => { const { [c]: _, ...rest } = d.capacity; this.setIed({ capacity: rest }); }}>Quitar</button></td></tr>`
      )}</table>
      <div class="row">
        <select .value=${this.capClass} @change=${(e: Event) => (this.capClass = (e.target as HTMLSelectElement).value)}>
          ${LN_OPTIONS.map(o => html`<option value=${o.lnClass} ?selected=${o.lnClass === this.capClass}>${o.label}</option>`)}
        </select>
        <input class="qty" type="number" min="1" .value=${String(this.capQty)} @input=${(e: Event) => (this.capQty = Number((e.target as HTMLInputElement).value))} />
        <button @click=${this.addCapacity}>Agregar</button>
      </div>
      ${this.errors.map(e => html`<p class="err">${e}</p>`)}
      <div class="row"><button class="primary" @click=${this.saveIed}>Guardar</button><button @click=${() => (this.iedDraft = null)}>Cancelar</button></div>
    </div>`;
  }

  private renderIeds(): TemplateResult {
    const inProject = new Set(this.substation ? allIeds(this.substation).map(i => i.modelId) : []);
    return html`
      <div class="row">
        <button class="primary" @click=${() => { this.errors = []; this.iedDraft = newIedModel(); }}>Nuevo IED</button>
        <label class="file">Importar ICD / IID<input type="file" accept=".icd,.iid,.cid,.scd,.xml" multiple @change=${this.importIcd} /></label>
      </div>
      <p class="hint">Un ICD/IID aporta las funciones (nodos lógicos) y los protocolos; entradas/salidas, puertos y precio se completan a mano.</p>
      ${this.iedDraft ? this.renderIedForm() : ''}
      <table>
        <tr><th>Fabricante</th><th>Modelo</th><th>E/S dig.</th><th>Analóg.</th><th>Puertos</th><th>Funciones</th><th>Precio</th><th></th></tr>
        ${this.catalog.ieds.map(
          m => html`<tr>
            <td>${m.manufacturer}</td><td>${m.model}${m.source === 'icd' ? html` <small>(ICD)</small>` : ''}</td>
            <td>${m.digitalIn}/${m.digitalOut}</td><td>${m.analogIn}</td><td>${m.copper} Cu · ${m.fiber} FO</td>
            <td class="caps">${Object.entries(m.capacity).map(([c, q]) => `${c}×${q}`).join(' ') || '—'}</td>
            <td>${m.price ?? '—'}</td>
            <td class="act"><button @click=${() => { this.errors = []; this.iedDraft = { ...m, capacity: { ...m.capacity }, protocols: [...m.protocols] }; }}>Editar</button>
              <button @click=${() => { this.errors = []; this.iedDraft = { ...m, id: '', model: `${m.model} (copia)`, capacity: { ...m.capacity }, protocols: [...m.protocols] }; }}>Duplicar</button>
              <button class="danger" ?disabled=${inProject.has(m.id)} @click=${() => this.removeIed(m)}>Borrar</button></td></tr>`
        )}
      </table>
      ${this.catalog.ieds.length ? '' : html`<p class="empty">El catálogo está vacío. Cargue un IED a mano o importe un ICD/IID.</p>`}`;
  }

  private renderSwitchForm(): TemplateResult {
    const d = this.swDraft!;
    return html`<div class="card">
      <h3>${d.id ? 'Editar switch' : 'Nuevo switch'}</h3>
      <div class="grid">
        ${this.field('Fabricante *', d.manufacturer, v => this.setSw({ manufacturer: v }))}
        ${this.field('Modelo *', d.model, v => this.setSw({ model: v }))}
        ${this.field('Descripción', d.description, v => this.setSw({ description: v }))}
        ${this.field('Puertos cobre (RJ45)', d.copper, v => this.setSw({ copper: num(v) }), 'number')}
        ${this.field('Puertos fibra (SFP)', d.fiber, v => this.setSw({ fiber: num(v) }), 'number')}
        ${this.field('Velocidad por puerto (Mbit/s)', d.speed, v => this.setSw({ speed: num(v) }), 'number')}
        ${this.field('Precio unitario (opcional)', d.price ?? '', v => this.setSw({ price: v.trim() === '' ? undefined : Number(v) }), 'number')}
      </div>
      <div class="lbl">Redundancia</div>${this.checks(REDUNDANCY, d.redundancy, v => this.setSw({ redundancy: v }))}
      <label class="chk"><input type="checkbox" .checked=${d.poe} @change=${(e: Event) => this.setSw({ poe: (e.target as HTMLInputElement).checked })} /> PoE</label>
      ${this.errors.map(e => html`<p class="err">${e}</p>`)}
      <div class="row"><button class="primary" @click=${this.saveSwitch}>Guardar</button><button @click=${() => (this.swDraft = null)}>Cancelar</button></div>
    </div>`;
  }

  private renderSwitches(): TemplateResult {
    return html`
      <div class="row"><button class="primary" @click=${() => { this.errors = []; this.swDraft = newSwitchModel(); }}>Nuevo switch</button></div>
      <p class="hint">Catálogo genérico y editable (no hay estándar interno). Se usa en la etapa 5 para dimensionar la red.</p>
      ${this.swDraft ? this.renderSwitchForm() : ''}
      <table>
        <tr><th>Fabricante</th><th>Modelo</th><th>Puertos</th><th>Velocidad</th><th>Redundancia</th><th>PoE</th><th>Precio</th><th></th></tr>
        ${this.catalog.switches.map(
          m => html`<tr><td>${m.manufacturer}</td><td>${m.model}</td><td>${m.copper} Cu · ${m.fiber} FO</td><td>${m.speed}</td><td>${m.redundancy.join(', ') || '—'}</td><td>${m.poe ? 'Sí' : 'No'}</td><td>${m.price ?? '—'}</td>
            <td class="act"><button @click=${() => { this.errors = []; this.swDraft = { ...m, redundancy: [...m.redundancy] }; }}>Editar</button>
              <button class="danger" @click=${() => this.persist({ ...this.catalog, switches: this.catalog.switches.filter(x => x.id !== m.id) }, `Se quitó ${m.model}.`)}>Borrar</button></td></tr>`
        )}
      </table>
      ${this.catalog.switches.length ? '' : html`<p class="empty">Todavía no hay switches cargados.</p>`}`;
  }

  private statusMark(host: Element): string {
    const ieds = listIeds(host);
    if (!ieds.length) return '○';
    const models = ieds.map(i => this.available.find(m => m.id === i.modelId)).filter((m): m is IedModel => !!m);
    return checkHost(needOf(host), models).status === 'ok' ? '✔' : '✖';
  }

  private renderTree(sub: Element): TemplateResult {
    const item = (el: Element) => html`<div class="item ${this.host === el ? 'sel' : ''}" @click=${() => { this.host = el; this.iedName = ''; this.pickModel = ''; }}>
      <span>${this.statusMark(el)} ${el.getAttribute('name')}</span><span class="badge">${listIeds(el).length}</span></div>`;
    const pts = Array.from(sub.querySelectorAll(':scope > PowerTransformer'));
    return html`
      ${pts.length ? html`<div class="head">Transformadores</div>${pts.map(item)}` : ''}
      ${Array.from(sub.querySelectorAll(':scope > VoltageLevel')).map(vl => {
        const bays = Array.from(vl.querySelectorAll(':scope > Bay')).filter(b => b.querySelector(':scope > ConductingEquipment'));
        return bays.length ? html`<div class="head">${vl.getAttribute('name')} · ${vl.querySelector(':scope > Voltage')?.textContent ?? ''} kV</div>${bays.map(item)}` : '';
      })}`;
  }

  private renderHost(sub: Element): TemplateResult {
    const host = this.host;
    if (!host) return html`<p class="empty">Elija un campo o transformador. ○ sin IED · ✔ cubre todo · ✖ falta capacidad.</p>`;
    const need = needOf(host);
    const planned = listIeds(host);
    const models = planned.map(i => this.available.find(m => m.id === i.modelId)).filter((m): m is IedModel => !!m);
    const check = checkHost(need, models);
    const suggestions = suggestModels(need, this.available);
    const defaultName = suggestIedName(sub, host, this.pickRole);
    return html`
      <h3>${host.getAttribute('name')}</h3>
      ${Object.keys(need.classes).length ? '' : html`<p class="empty">Este objeto no tiene funciones asignadas (etapa 3).</p>`}
      <table>
        <tr><th>Función requerida</th><th>Requerido</th><th>Cubierto</th><th></th></tr>
        ${check.rows.map(r => html`<tr><td>${r.lnClass}</td><td>${r.required}</td><td>${r.covered}</td><td class=${r.ok ? 'ok' : 'err'}>${r.ok ? '✔' : 'falta ' + (r.required - r.covered)}</td></tr>`)}
        ${check.io.map(r => html`<tr class="io"><td>${r.label} <small>(estimado)</small></td><td>${r.required}</td><td>${r.available}</td><td class=${r.ok ? 'ok' : 'err'}>${r.ok ? '✔' : 'faltan ' + (r.required - r.available)}</td></tr>`)}
      </table>
      <h3>IEDs asignados</h3>
      ${planned.length ? html`<table>${planned.map(i => { const m = this.available.find(x => x.id === i.modelId); return html`<tr><td>${i.name}</td><td>${m ? `${m.manufacturer} ${m.model}` : html`<span class="err">${i.modelId} (no está en el catálogo)</span>`}</td><td>${i.role}</td><td><button class="danger" @click=${() => this.unassign(i.node)}>Quitar</button></td></tr>`; })}</table>` : html`<p class="hint">Sin IED asignado.</p>`}
      ${suggestions.length && !planned.length ? html`<p class="hint">Un solo modelo cubre todo:
        ${suggestions.slice(0, 4).map(m => html`<button @click=${() => { this.pickModel = m.id; this.assign(); }}>${m.manufacturer} ${m.model}${m.price !== undefined ? ` (${m.price})` : ''}</button> `)}</p>` : ''}
      <div class="row">
        <select .value=${this.pickModel} @change=${(e: Event) => (this.pickModel = (e.target as HTMLSelectElement).value)}>
          <option value="">— modelo de IED —</option>
          ${this.available.map(m => html`<option value=${m.id} ?selected=${m.id === this.pickModel}>${m.manufacturer} ${m.model}</option>`)}
        </select>
        <select @change=${(e: Event) => (this.pickRole = (e.target as HTMLSelectElement).value)}>${ROLES.map(r => html`<option ?selected=${r === this.pickRole}>${r}</option>`)}</select>
        <input placeholder=${defaultName} .value=${this.iedName} @input=${(e: Event) => (this.iedName = (e.target as HTMLInputElement).value)} />
        <button class="primary" ?disabled=${!this.pickModel} @click=${this.assign}>Asignar</button>
      </div>`;
  }

  private renderBom(sub: Element): TemplateResult {
    const lines = bom(sub, this.available);
    if (!lines.length) return html``;
    const total = lines.reduce((n, l) => n + (l.model?.price ?? 0) * l.quantity, 0);
    const priced = lines.every(l => l.model?.price !== undefined);
    return html`<h3>Lista de materiales (IEDs)</h3>
      <table><tr><th>Fabricante</th><th>Modelo</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr>
        ${lines.map(l => html`<tr><td>${l.model?.manufacturer ?? ''}</td><td>${l.model?.model ?? l.modelId}</td><td>${l.quantity}</td><td>${l.model?.price ?? '—'}</td><td>${l.model?.price !== undefined ? l.model.price * l.quantity : '—'}</td></tr>`)}
        <tr><th colspan="4">Total${priced ? '' : ' (parcial: faltan precios)'}</th><th>${total}</th></tr></table>`;
  }

  private renderAssign(): TemplateResult {
    const sub = this.substation;
    if (!sub) return html`<p class="empty">No hay subestación. Créela en la pestaña "1. Proyecto".</p>`;
    return html`
      <div class="row">
        <button @click=${this.autoAssign}>Asignar automáticamente a los pendientes</button>
        <button @click=${() => download(`${sub.getAttribute('name')}_IEDs.csv`, 'text/csv;charset=utf-8', toBomCsv(bom(sub, this.available)))}>Exportar lista de materiales (CSV)</button>
      </div>
      <div class="main"><nav>${this.renderTree(sub)}</nav><section>${this.renderHost(sub)}${this.renderBom(sub)}</section></div>`;
  }

  render(): TemplateResult {
    if (!this.doc) return html``;
    const tab = (s: Section, label: string) => html`<button class="tab ${this.section === s ? 'on' : ''}" @click=${() => { this.section = s; this.errors = []; }}>${label}</button>`;
    return html`
      <div class="bar">
        ${tab('ieds', 'Catálogo de IEDs')}${tab('switches', 'Catálogo de switches')}${tab('assign', 'Asignación y verificación')}
        <span class="sp"></span>
        <button @click=${() => download('catalogo_dsb.json', 'application/json', catalogToJson(this.catalog))}>Exportar catálogo</button>
        <label class="file">Importar catálogo<input type="file" accept=".json" @change=${this.importJson} /></label>
      </div>
      ${this.message ? html`<p class="msg">${this.message}</p>` : ''}
      <div class="body">${this.section === 'ieds' ? this.renderIeds() : this.section === 'switches' ? this.renderSwitches() : this.renderAssign()}</div>`;
  }

  static styles = css`
    :host { font-family: var(--mdc-typography-font-family, Roboto, sans-serif); display: block; color: var(--mdc-theme-on-surface, #222); }
    .bar { display: flex; gap: 8px; align-items: center; padding: 8px 16px; border-bottom: 1px solid rgba(128,128,128,.3); flex-wrap: wrap; }
    .sp { flex: 1; }
    .body { padding: 8px 16px 16px; }
    .main { display: flex; height: calc(100vh - 230px); margin: 0 -16px; }
    nav { width: 300px; overflow: auto; border-right: 1px solid rgba(128,128,128,.3); }
    section { flex: 1; padding: 0 16px 16px; overflow: auto; }
    .head { font-weight: 500; padding: 10px 8px 4px; opacity: .8; font-size: 13px; text-transform: uppercase; }
    .item { padding: 5px 8px; cursor: pointer; display: flex; justify-content: space-between; gap: 8px; font-size: 14px; }
    .item:hover { background: rgba(128,128,128,.15); }
    .item.sel { background: var(--mdc-theme-primary, #2aa198); color: #fff; }
    .badge { background: rgba(128,128,128,.3); border-radius: 10px; padding: 0 7px; font-size: 12px; }
    table { border-collapse: collapse; width: 100%; font-size: 14px; margin: 8px 0; }
    th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid rgba(128,128,128,.25); }
    td.caps { max-width: 360px; font-size: 12px; }
    td.act { white-space: nowrap; }
    tr.io td { opacity: .85; }
    .card { border: 1px solid rgba(128,128,128,.4); border-radius: 6px; padding: 8px 16px 12px; margin: 8px 0 16px; background: rgba(255,255,255,.35); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 8px 16px; }
    .f { display: flex; flex-direction: column; font-size: 13px; gap: 2px; }
    .f input, select, input.qty, .row input { font: inherit; padding: 5px; }
    .lbl { font-size: 13px; margin-top: 10px; opacity: .8; }
    .checks { display: flex; gap: 14px; flex-wrap: wrap; margin: 4px 0; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0; align-items: center; }
    input.qty { width: 70px; }
    select { max-width: 100%; min-width: 220px; }
    button, .file { font: inherit; padding: 4px 12px; cursor: pointer; }
    .file input { display: none; }
    .file { border: 1px solid rgba(128,128,128,.6); border-radius: 3px; }
    .tab { border: none; background: none; border-bottom: 3px solid transparent; font-size: 15px; padding: 8px 12px; }
    .tab.on { border-bottom-color: var(--mdc-theme-primary, #2aa198); font-weight: 500; }
    .primary { background: var(--mdc-theme-primary, #2aa198); color: #fff; border: none; border-radius: 3px; }
    button:disabled { opacity: .4; cursor: default; }
    .danger, .err { color: #c62828; }
    .ok { color: #2e7d32; }
    .hint, .empty { opacity: .7; }
    .empty { padding: 12px 0; }
    .msg { color: var(--mdc-theme-primary, #2aa198); padding: 0 16px; margin: 6px 0 0; }
    h3 { font-weight: 400; margin: 14px 0 4px; }
  `;
}
