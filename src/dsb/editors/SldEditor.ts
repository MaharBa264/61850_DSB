import {
  css,
  html,
  LitElement,
  property,
  PropertyValues,
  query,
  state,
  svg,
  TemplateResult,
} from 'lit-element';
import panzoom, { PanZoom } from 'panzoom';

import { newEditEventV2 } from '@compas-oscd/core';

import { validateName } from '../lib/project-model.js';
import { moveEdit, removeEdit, renameEdits } from '../lib/sld-edit.js';
import { toDxf, toSvg } from '../lib/sld-export.js';
import { buildSldModel, CELL, DrawGroup, Prim, SldModel } from '../lib/sld-model.js';

const KIND_LABEL: Record<string, string> = {
  equipment: 'Equipo',
  transformer: 'Transformador',
  busbar: 'Barra',
  bay: 'Campo',
};
const TYPE_LABEL: Record<string, string> = {
  CBR: 'Interruptor',
  DIS: 'Seccionador',
  ERS: 'Puesta a tierra',
  CTR: 'Transformador de corriente',
  VTR: 'Transformador de tensión',
  PTR: 'Transformador de potencia',
};

function download(name: string, mime: string, data: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * DSB — Unifilar propio (etapa B).
 *
 * Dibuja el SCL con símbolos IEC, permite seleccionar, mover (arrastrando,
 * con ajuste a la grilla), renombrar y eliminar, y exportar a SVG y DXF.
 */
export default class DsbSldPlugin extends LitElement {
  @property({ attribute: false }) doc!: XMLDocument;
  @property({ type: Number }) editCount = -1;

  @state() private substationName = '';
  @state() private model: SldModel = { groups: [], width: 0, height: 0 };
  @state() private selectedId: string | null = null;
  @state() private nameDraft = '';
  @state() private descDraft = '';
  @state() private error = '';

  @query('#viewport') private viewport?: SVGGElement;
  private pz?: PanZoom;
  private drag?: {
    id: string;
    x: number;
    y: number;
    dx: number;
    dy: number;
    moved: boolean;
  };

  private get substations(): Element[] {
    return this.doc ? Array.from(this.doc.querySelectorAll(':root > Substation')) : [];
  }

  private get substation(): Element | undefined {
    const subs = this.substations;
    return subs.find(s => s.getAttribute('name') === this.substationName) ?? subs[0];
  }


  protected update(changed: PropertyValues): void {
    if (changed.has('doc') || changed.has('editCount')) this.rebuild();
    super.update(changed);
  }

  private rebuild(): void {
    const sub = this.substation;
    if (sub) this.substationName = sub.getAttribute('name') ?? '';
    this.model = sub ? buildSldModel(sub) : { groups: [], width: 0, height: 0 };
    const sel = this.selected;
    if (this.selectedId && !sel) this.selectedId = null;
    else if (sel) this.syncDrafts(sel);
  }

  private get selected(): DrawGroup | undefined {
    return this.model.groups.find(g => g.id === this.selectedId && g.element);
  }

  private syncDrafts(g: DrawGroup) {
    this.nameDraft = g.element?.getAttribute('name') ?? '';
    this.descDraft = g.element?.getAttribute('desc') ?? '';
  }

  protected firstUpdated(): void {
    if (this.viewport)
      this.pz = panzoom(this.viewport, {
        maxZoom: 3,
        minZoom: 0.2,
        zoomDoubleClickSpeed: 1,
        beforeMouseDown: e => !!(e.target as Element).closest?.('.draggable'),
      });
  }

  /** Ajusta el zoom para que todo el dibujo entre en pantalla. */
  private fitView(): void {
    const svgEl = this.shadowRoot?.querySelector('svg.canvas');
    if (!svgEl || !this.pz || !this.model.width) return;
    const r = svgEl.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const scale = Math.min(r.width / (this.model.width + 40), r.height / (this.model.height + 40), 1.5);
    this.pz.zoomAbs(0, 0, scale);
    this.pz.moveTo(20 * scale, 20 * scale);
  }

  private fitted = false;

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    if (!this.fitted && this.model.groups.length) {
      this.fitted = true;
      requestAnimationFrame(() => this.fitView());
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.pz?.dispose();
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
  }

  // ---------- interacción ----------

  private select(g: DrawGroup) {
    this.selectedId = g.id;
    this.syncDrafts(g);
    this.error = '';
  }

  private onDown(e: PointerEvent, g: DrawGroup) {
    if (e.button !== 0) return;
    e.stopPropagation();
    this.select(g);
    this.drag = { id: g.id, x: e.clientX, y: e.clientY, dx: 0, dy: 0, moved: false };
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
  }

  private affected(id: string): SVGGElement[] {
    const all = Array.from(this.shadowRoot!.querySelectorAll<SVGGElement>('g[data-gid]'));
    return all.filter(n => {
      const gid = n.getAttribute('data-gid')!;
      return gid === id || gid.startsWith(id + '/');
    });
  }

  private onMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d) return;
    const scale = this.pz?.getTransform().scale ?? 1;
    d.dx = Math.round((e.clientX - d.x) / scale / CELL);
    d.dy = Math.round((e.clientY - d.y) / scale / CELL);
    d.moved = d.dx !== 0 || d.dy !== 0;
    for (const n of this.affected(d.id))
      n.setAttribute('transform', `translate(${d.dx * CELL},${d.dy * CELL})`);
  };

  private onUp = () => {
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    const d = this.drag;
    this.drag = undefined;
    if (!d) return;
    const g = this.model.groups.find(x => x.id === d.id);
    if (d.moved && g?.element) {
      this.dispatchEvent(
        newEditEventV2(moveEdit(g.element, d.dx, d.dy), { title: `Mover ${g.label}` })
      );
    } else for (const n of this.affected(d.id)) n.removeAttribute('transform');
  };

  private applyChanges() {
    const g = this.selected;
    if (!g?.element) return;
    const err = validateName(this.nameDraft);
    if (err) {
      this.error = err;
      return;
    }
    const el = g.element;
    const edits: Parameters<typeof newEditEventV2>[0][] = [];
    if (this.nameDraft.trim() !== (el.getAttribute('name') ?? ''))
      edits.push(renameEdits(el, this.nameDraft));
    if (this.descDraft !== (el.getAttribute('desc') ?? ''))
      edits.push({
        element: el,
        attributes: { desc: this.descDraft.trim() || null },
        attributesNS: {},
      });
    if (!edits.length) return;
    this.selectedId = null; // el id cambia al renombrar
    this.dispatchEvent(newEditEventV2(edits, { title: `Editar ${g.label}` }));
    this.error = '';
  }

  private deleteSelected() {
    const g = this.selected;
    if (!g?.element) return;
    this.selectedId = null;
    this.dispatchEvent(newEditEventV2(removeEdit(g.element), { title: `Eliminar ${g.label}` }));
  }

  private exportAs(kind: 'svg' | 'dxf') {
    const base = this.substationName || 'unifilar';
    if (kind === 'svg') download(`${base}.svg`, 'image/svg+xml', toSvg(this.model));
    else download(`${base}.dxf`, 'application/dxf', toDxf(this.model));
  }

  // ---------- dibujo ----------

  private prim(p: Prim) {
    switch (p.k) {
      case 'line':
        return svg`<line x1=${p.x1} y1=${p.y1} x2=${p.x2} y2=${p.y2}></line>`;
      case 'circle':
        return svg`<circle cx=${p.cx} cy=${p.cy} r=${p.r} class=${p.fill ? 'dot' : ''}></circle>`;
      case 'rect':
        return svg`<rect x=${p.x} y=${p.y} width=${p.w} height=${p.h}></rect>`;
      case 'text':
        return svg`<text x=${p.x} y=${p.y} font-size=${p.size}>${p.t}</text>`;
    }
  }

  private bbox(g: DrawGroup) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const p of g.prims) {
      const pts: [number, number][] =
        p.k === 'line' ? [[p.x1, p.y1], [p.x2, p.y2]]
        : p.k === 'circle' ? [[p.cx - p.r, p.cy - p.r], [p.cx + p.r, p.cy + p.r]]
        : p.k === 'rect' ? [[p.x, p.y], [p.x + p.w, p.y + p.h]]
        : [[p.x, p.y - p.size], [p.x + p.t.length * p.size * 0.6, p.y + 2]];
      for (const [x, y] of pts) {
        x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y);
      }
    }
    return { x: x1 - 4, y: y1 - 4, w: x2 - x1 + 8, h: y2 - y1 + 8 };
  }

  private renderGroup(g: DrawGroup) {
    if (g.kind === 'wire')
      return svg`<g class="wire">${g.prims.map(p => this.prim(p))}</g>`;
    const b = this.bbox(g);
    const sel = g.id === this.selectedId;
    return svg`<g class="draggable ${g.kind} ${sel ? 'sel' : ''}" data-gid=${g.id}
        @pointerdown=${(e: PointerEvent) => this.onDown(e, g)}>
      <rect class="hit" x=${b.x} y=${b.y} width=${b.w} height=${b.h}></rect>
      ${g.prims.map(p => this.prim(p))}
    </g>`;
  }

  private renderPanel(): TemplateResult {
    const g = this.selected;
    if (!g)
      return html`<aside><h3>Selección</h3>
        <p class="hint">Haga clic en un equipo, barra o campo. Arrastre para moverlo (se ajusta a la grilla).</p></aside>`;
    const t = g.type ? TYPE_LABEL[g.type] ?? g.type : '';
    return html`<aside>
      <h3>${KIND_LABEL[g.kind] ?? g.kind}${t ? ` — ${t}` : ''}</h3>
      <label>Nombre
        <input .value=${this.nameDraft}
               @input=${(e: Event) => (this.nameDraft = (e.target as HTMLInputElement).value)} />
      </label>
      <label>Descripción
        <input .value=${this.descDraft}
               @input=${(e: Event) => (this.descDraft = (e.target as HTMLInputElement).value)} />
      </label>
      ${this.error ? html`<p class="err">${this.error}</p>` : ''}
      <div class="btns">
        <button @click=${this.applyChanges}>Aplicar</button>
        <button class="danger" @click=${this.deleteSelected}>Eliminar</button>
      </div>
      ${g.kind === 'bay'
        ? html`<p class="hint">Eliminar un campo borra todos sus equipos.</p>`
        : ''}
    </aside>`;
  }

  render(): TemplateResult {
    if (!this.doc) return html``;
    const subs = this.substations;
    return html`
      <div class="bar">
        <strong>Unifilar</strong>
        ${subs.length > 1
          ? html`<select @change=${(e: Event) => {
              this.substationName = (e.target as HTMLSelectElement).value;
              this.selectedId = null;
              this.rebuild();
            }}>
              ${subs.map(s => html`<option ?selected=${s.getAttribute('name') === this.substationName}>${s.getAttribute('name')}</option>`)}
            </select>`
          : html`<span>${this.substationName}</span>`}
        <span class="stats">${this.model.groups.filter(g => g.kind === 'equipment' || g.kind === 'transformer').length} equipos</span>
        <button @click=${() => this.fitView()}>Ajustar a pantalla</button>
        <button @click=${() => this.exportAs('svg')}>Exportar SVG</button>
        <button @click=${() => this.exportAs('dxf')}>Exportar DXF</button>
      </div>
      <div class="main">
        <svg class="canvas" @pointerdown=${() => { this.selectedId = null; }}>
          <g id="viewport">${this.model.groups.map(g => this.renderGroup(g))}</g>
        </svg>
        ${this.renderPanel()}
      </div>
      ${!this.model.groups.length
        ? html`<p class="empty">No hay subestación. Créela en la pestaña "1. Proyecto".</p>`
        : ''}`;
  }

  static styles = css`
    :host { font-family: var(--mdc-typography-font-family, Roboto, sans-serif); display: block; height: calc(100vh - 112px); color: var(--mdc-theme-on-surface, #222); }
    .bar { display: flex; gap: 16px; align-items: center; padding: 8px 16px; border-bottom: 1px solid rgba(128,128,128,.3); flex-wrap: wrap; }
    .stats { opacity: .75; font-size: 13px; flex: 1; }
    .main { display: flex; height: calc(100% - 49px); }
    svg.canvas { flex: 1; min-width: 0; height: 100%; cursor: grab; color: var(--mdc-theme-on-surface, #222); }
    svg line, svg circle, svg rect { stroke: currentColor; stroke-width: 1.5; fill: none; }
    svg circle.dot { fill: currentColor; }
    svg rect.hit { stroke: none; fill: transparent; }
    svg text { fill: currentColor; stroke: none; font-family: inherit; pointer-events: none; }
    .wire line { stroke-width: 1.2; }
    .busbar line { stroke-width: 2; }
    .draggable { cursor: move; }
    .draggable:hover line, .draggable:hover circle, .draggable:hover rect:not(.hit) { stroke: var(--mdc-theme-primary, #2aa198); }
    .draggable.sel line, .draggable.sel circle, .draggable.sel rect:not(.hit) { stroke: var(--mdc-theme-secondary, #d33682); stroke-width: 2.5; }
    .draggable.sel text { fill: var(--mdc-theme-secondary, #d33682); }
    aside { width: 280px; padding: 8px 16px; border-left: 1px solid rgba(128,128,128,.3); overflow: auto; }
    aside h3 { font-weight: 400; margin: 8px 0; }
    aside label { display: block; font-size: 12px; opacity: .85; margin: 8px 0; }
    aside input { display: block; width: 100%; box-sizing: border-box; padding: 6px; margin-top: 2px; font: inherit; }
    .btns { display: flex; gap: 8px; margin-top: 12px; }
    .danger { color: #c62828; }
    .err { color: #c62828; }
    .hint, .empty { opacity: .7; font-size: 13px; }
    .empty { padding: 0 16px; }
    button { font: inherit; padding: 4px 12px; cursor: pointer; }
  `;
}
