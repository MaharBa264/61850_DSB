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
  FunctionDef,
  functionById,
  functionsFor,
  GROUP_ORDER,
} from '../lib/functions-catalog.js';
import {
  addFunctionEdit,
  bayKind,
  bayPackageEdits,
  collectFunctions,
  LnAllocator,
  listAssigned,
  summarize,
  targetKind,
  toFunctionsCsv,
  toSsd,
  toSummaryCsv,
  transformerPackageEdits,
} from '../lib/functions-model.js';

function download(name: string, mime: string, data: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const TYPE_LABEL: Record<string, string> = {
  CBR: 'Interruptor',
  DIS: 'Seccionador',
  ERS: 'Puesta a tierra',
  CTR: 'Transformador de corriente',
  VTR: 'Transformador de tensión',
};

/**
 * DSB — Funciones de protección y control (etapa C).
 *
 * Asigna funciones (ANSI -> nodo lógico) a cada equipo, campo y transformador
 * como LNode sin IED (`iedName="None"`): la especificación del sistema.
 * Permite exportar la lista de funciones (CSV) y el SSD.
 */
export default class DsbFunctionsPlugin extends LitElement {
  @property({ attribute: false }) doc!: XMLDocument;
  @property({ type: Number }) editCount = -1;

  @state() private selected: Element | null = null;
  @state() private pick = '';
  @state() private message = '';

  private get substation(): Element | null {
    return this.doc?.querySelector(':root > Substation') ?? null;
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    if (changed.has('doc') && this.selected && !this.doc.contains(this.selected)) this.selected = null;
  }

  // ---------- ediciones ----------

  private emit(edit: Parameters<typeof newEditEventV2>[0], title: string) {
    this.dispatchEvent(newEditEventV2(edit, { title }));
  }

  private kvOf(bay: Element): number {
    const v = bay.closest('VoltageLevel')?.querySelector(':scope > Voltage')?.textContent;
    return parseFloat(v ?? '0') || 0;
  }

  private addFunction() {
    const sel = this.selected;
    const sub = this.substation;
    const def = functionById(this.pick);
    if (!sel || !sub || !def) return;
    this.emit(addFunctionEdit(this.doc, sel, def, new LnAllocator(sub)), `Función ${def.lnClass}`);
    this.message = `Se agregó ${def.ansi ? def.ansi + ' · ' : ''}${def.name}.`;
  }

  private removeFunction(ln: Element) {
    this.emit({ node: ln }, 'Quitar función');
  }

  private applyPackage(el: Element) {
    const sub = this.substation;
    if (!sub) return;
    const alloc = new LnAllocator(sub);
    const edits =
      el.tagName === 'PowerTransformer'
        ? transformerPackageEdits(this.doc, el, alloc)
        : bayPackageEdits(this.doc, el, this.kvOf(el), alloc);
    if (!edits.length) {
      this.message = 'Ya tiene todas las funciones del paquete típico.';
      return;
    }
    this.emit(edits, `Paquete típico ${el.getAttribute('name')}`);
    this.message = `Se agregaron ${edits.length} funciones a ${el.getAttribute('name')}.`;
  }

  private applyAll() {
    const sub = this.substation;
    if (!sub) return;
    const alloc = new LnAllocator(sub);
    const edits = [
      ...Array.from(sub.querySelectorAll(':scope > PowerTransformer')).flatMap(pt =>
        transformerPackageEdits(this.doc, pt, alloc)
      ),
      ...Array.from(sub.querySelectorAll(':scope > VoltageLevel > Bay')).flatMap(bay =>
        bayKind(bay) ? bayPackageEdits(this.doc, bay, this.kvOf(bay), alloc) : []
      ),
    ];
    if (!edits.length) {
      this.message = 'No hay funciones típicas pendientes.';
      return;
    }
    this.emit(edits, 'Paquetes típicos de toda la subestación');
    this.message = `Se agregaron ${edits.length} funciones en toda la subestación.`;
  }

  private exportCsv(kind: 'list' | 'summary' | 'ssd') {
    const sub = this.substation;
    if (!sub) return;
    const base = sub.getAttribute('name') || 'proyecto';
    const rows = collectFunctions(sub);
    if (kind === 'list') download(`${base}_funciones.csv`, 'text/csv;charset=utf-8', toFunctionsCsv(rows));
    else if (kind === 'summary')
      download(`${base}_resumen_funciones.csv`, 'text/csv;charset=utf-8', toSummaryCsv(summarize(rows)));
    else download(`${base}.ssd`, 'application/xml', toSsd(this.doc));
  }

  // ---------- vistas ----------

  private count(el: Element): number {
    return el.querySelectorAll(':scope > LNode').length;
  }

  private item(el: Element, label: string, indent = 0): TemplateResult {
    const n = this.count(el);
    return html`<li class="item ${el === this.selected ? 'sel' : ''}" style="padding-left:${8 + indent * 14}px"
        @click=${() => { this.selected = el; this.pick = ''; this.message = ''; }}>
      <span>${label}</span>${n ? html`<span class="badge">${n}</span>` : ''}
    </li>`;
  }

  private renderTree(sub: Element): TemplateResult {
    const pts = Array.from(sub.querySelectorAll(':scope > PowerTransformer'));
    const vls = Array.from(sub.querySelectorAll(':scope > VoltageLevel'));
    return html`<ul class="tree">
      ${pts.length ? html`<li class="head">Transformadores de potencia</li>` : ''}
      ${pts.map(pt => this.item(pt, pt.getAttribute('name') ?? '', 1))}
      ${vls.map(vl => {
        const bays = Array.from(vl.querySelectorAll(':scope > Bay')).filter(b => b.querySelector(':scope > ConductingEquipment'));
        return html`<li class="head">${vl.getAttribute('name')} · ${vl.querySelector(':scope > Voltage')?.textContent ?? '?'} kV</li>
          ${bays.map(bay => html`${this.item(bay, `Campo ${bay.getAttribute('name')}`, 1)}
            ${Array.from(bay.querySelectorAll(':scope > ConductingEquipment')).map(eq =>
              this.item(eq, `${eq.getAttribute('name')} — ${TYPE_LABEL[eq.getAttribute('type') ?? ''] ?? eq.getAttribute('type')}`, 2)
            )}`)}`;
      })}
    </ul>`;
  }

  private renderDetail(): TemplateResult {
    const el = this.selected;
    if (!el)
      return html`<p class="hint">Seleccione un campo, un equipo o un transformador para ver y asignar sus funciones.</p>`;
    const kind = targetKind(el);
    const assigned = listAssigned(el);
    const options: FunctionDef[] = kind ? functionsFor(kind) : [];
    const title =
      el.tagName === 'Bay' ? `Campo ${el.getAttribute('name')}`
      : el.tagName === 'PowerTransformer' ? `Transformador ${el.getAttribute('name')}`
      : `${el.getAttribute('name')} — ${TYPE_LABEL[el.getAttribute('type') ?? ''] ?? ''}`;
    const canPackage = el.tagName === 'Bay' || el.tagName === 'PowerTransformer';
    return html`
      <h3>${title}</h3>
      ${assigned.length
        ? html`<table>
            <tr><th>ANSI</th><th>Función</th><th>LN</th><th>Inst.</th><th>IED</th><th></th></tr>
            ${assigned.map(a => html`<tr>
              <td>${a.ansi || '—'}</td><td>${a.name}</td><td>${a.lnClass}</td><td>${a.lnInst}</td>
              <td>${a.lnode.getAttribute('iedName') === 'None' ? html`<i>sin asignar</i>` : a.lnode.getAttribute('iedName')}</td>
              <td><button class="danger" @click=${() => this.removeFunction(a.lnode)}>Quitar</button></td>
            </tr>`)}
          </table>`
        : html`<p class="hint">Sin funciones asignadas.</p>`}
      <div class="row">
        <select .value=${this.pick} @change=${(e: Event) => (this.pick = (e.target as HTMLSelectElement).value)}>
          <option value="">Agregar función…</option>
          ${GROUP_ORDER.map(g => {
            const inGroup = options.filter(o => o.group === g);
            return inGroup.length
              ? html`<optgroup label=${g}>${inGroup.map(o => html`<option value=${o.id} ?selected=${o.id === this.pick}>${o.ansi ? o.ansi + ' · ' : ''}${o.name} (${o.lnClass})</option>`)}</optgroup>`
              : '';
          })}
        </select>
        <button ?disabled=${!this.pick} @click=${this.addFunction}>Agregar</button>
        ${canPackage ? html`<button @click=${() => this.applyPackage(el)}>Aplicar paquete típico</button>` : ''}
      </div>`;
  }

  private renderSummary(sub: Element): TemplateResult {
    const s = summarize(collectFunctions(sub));
    if (!s.length) return html``;
    const total = s.reduce((n, x) => n + x.count, 0);
    const budget = s
      .filter(x => x.group === 'Protección' || x.group === 'Automatismo')
      .reduce((n, x) => n + x.count, 0);
    return html`<h3>Resumen de funciones</h3>
      <p class="hint">${budget} de protección y automatismo (las que dimensionan los IEDs) · ${total} en total.</p>
      <table class="summary">
        ${GROUP_ORDER.map(g => {
          const rows = s.filter(x => x.group === g);
          return rows.length
            ? html`<tr class="grp"><th colspan="4">${g}</th></tr>
                ${rows.map(x => html`<tr><td>${x.ansi || '—'}</td><td>${x.name}</td><td>${x.lnClass}</td><td>${x.count}</td></tr>`)}`
            : '';
        })}
      </table>`;
  }

  render(): TemplateResult {
    const sub = this.substation;
    if (!this.doc) return html``;
    if (!sub) return html`<p class="empty">No hay subestación. Créela en la pestaña "Proyecto (DSB)".</p>`;
    return html`
      <div class="bar">
        <strong>Funciones</strong>
        <span class="stats">${collectFunctions(sub).length} asignadas</span>
        <button @click=${this.applyAll}>Aplicar paquetes típicos a todo</button>
        <button @click=${() => this.exportCsv('list')}>Exportar lista (CSV)</button>
        <button @click=${() => this.exportCsv('summary')}>Exportar resumen (CSV)</button>
        <button @click=${() => this.exportCsv('ssd')}>Exportar SSD</button>
      </div>
      ${this.message ? html`<p class="msg">${this.message}</p>` : ''}
      <div class="main">
        <nav>${this.renderTree(sub)}</nav>
        <section>${this.renderDetail()}${this.renderSummary(sub)}</section>
      </div>`;
  }

  static styles = css`
    :host { font-family: var(--mdc-typography-font-family, Roboto, sans-serif); display: block; color: var(--mdc-theme-on-surface, #222); }
    .bar { display: flex; gap: 12px; align-items: center; padding: 8px 16px; border-bottom: 1px solid rgba(128,128,128,.3); flex-wrap: wrap; }
    .stats { opacity: .75; font-size: 13px; flex: 1; }
    .main { display: flex; height: calc(100vh - 170px); }
    nav { width: 320px; overflow: auto; border-right: 1px solid rgba(128,128,128,.3); }
    section { flex: 1; padding: 0 16px 16px; overflow: auto; }
    ul.tree { list-style: none; margin: 0; padding: 0; }
    .head { font-weight: 500; padding: 10px 8px 4px; opacity: .8; font-size: 13px; text-transform: uppercase; }
    .item { padding: 5px 8px; cursor: pointer; display: flex; justify-content: space-between; gap: 8px; font-size: 14px; }
    .item:hover { background: rgba(128,128,128,.15); }
    .item.sel { background: var(--mdc-theme-primary, #2aa198); color: #fff; }
    .badge { background: rgba(128,128,128,.3); border-radius: 10px; padding: 0 7px; font-size: 12px; }
    .item.sel .badge { background: rgba(255,255,255,.3); }
    table { border-collapse: collapse; width: 100%; font-size: 14px; margin: 8px 0; }
    th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid rgba(128,128,128,.25); }
    table.summary { max-width: 640px; }
    tr.grp th { background: rgba(128,128,128,.18); padding-top: 6px; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
    select { font: inherit; padding: 5px; min-width: 320px; max-width: 100%; }
    button { font: inherit; padding: 4px 12px; cursor: pointer; }
    .danger { color: #c62828; }
    .hint, .empty { opacity: .7; }
    .empty { padding: 16px; }
    .msg { color: var(--mdc-theme-primary, #2aa198); padding: 0 16px; margin: 6px 0 0; }
    h3 { font-weight: 400; margin: 14px 0 4px; }
  `;
}
