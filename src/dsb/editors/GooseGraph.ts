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

import {
  extractGooseModel,
  GooseIed,
  GooseLink,
  GooseModel,
} from '../lib/goose-model.js';

const NODE_W = 210;
const NODE_H = 56;
const V_GAP = 26;
const COL_GAP = 300;
const MARGIN = 40;

interface Placed {
  ied: GooseIed;
  x: number;
  y: number;
}

/**
 * DSB — Editor gráfico GOOSE (fase 1: solo lectura).
 *
 * Dibuja los IEDs como nodos y cada enlace publicador → suscriptor
 * (deducido de los ExtRef del SCL) como una flecha. Los enlaces cuyo
 * GSEControl no existe en el SCL se marcan en rojo.
 */
export default class DsbGooseGraphPlugin extends LitElement {
  @property({ attribute: false })
  doc!: XMLDocument;

  /** OpenSCD incrementa este contador con cada edición del documento */
  @property({ type: Number })
  editCount = -1;

  @state() private model: GooseModel = { ieds: [], controls: [], links: [] };
  @state() private selectedIed: string | null = null;
  @state() private selectedLink: GooseLink | null = null;
  @state() private filter = '';
  @state() private showIdle = false;

  @query('#viewport') private viewport?: SVGGElement;
  private pz?: PanZoom;

  protected update(changed: PropertyValues): void {
    if (changed.has('doc') || changed.has('editCount')) {
      this.model = this.doc
        ? extractGooseModel(this.doc)
        : { ieds: [], controls: [], links: [] };
      this.selectedLink = null;
    }
    super.update(changed);
  }

  protected firstUpdated(): void {
    this.initPanZoom();
  }

  protected updated(): void {
    if (!this.pz) this.initPanZoom();
  }

  disconnectedCallback(): void {
    this.pz?.dispose();
    this.pz = undefined;
    super.disconnectedCallback();
  }

  private initPanZoom(): void {
    if (!this.viewport) return;
    this.pz = panzoom(this.viewport, {
      maxZoom: 3,
      minZoom: 0.15,
      zoomDoubleClickSpeed: 1,
    });
  }

  // ---------- layout ----------

  private get visibleIeds(): GooseIed[] {
    const f = this.filter.trim().toLowerCase();
    return this.model.ieds.filter(
      i =>
        (this.showIdle || i.role !== 'none') &&
        (!f || i.name.toLowerCase().includes(f) || (i.desc ?? '').toLowerCase().includes(f))
    );
  }

  private layout(): Map<string, Placed> {
    const cols: GooseIed['role'][][] = [['publisher'], ['both'], ['subscriber'], ['none']];
    const placed = new Map<string, Placed>();
    const visible = this.visibleIeds;
    // Ocultar columnas vacías para no dejar huecos
    let colIndex = 0;
    for (const roles of cols) {
      const items = visible
        .filter(i => roles.includes(i.role))
        .sort((a, b) => a.name.localeCompare(b.name));
      if (!items.length) continue;
      items.forEach((ied, row) =>
        placed.set(ied.name, {
          ied,
          x: MARGIN + colIndex * COL_GAP,
          y: MARGIN + row * (NODE_H + V_GAP),
        })
      );
      colIndex++;
    }
    return placed;
  }

  private linkPath(a: Placed, b: Placed): string {
    const sy = a.y + NODE_H / 2;
    const ty = b.y + NODE_H / 2;
    if (a.x === b.x) {
      // misma columna: bucle por el costado derecho
      const bulge = Math.min(140, 40 + Math.abs(ty - sy) / 3);
      const x = a.x + NODE_W;
      return `M${x},${sy} C${x + bulge},${sy} ${x + bulge},${ty} ${x},${ty}`;
    }
    if (b.x > a.x) {
      const sx = a.x + NODE_W;
      const dx = Math.max(60, (b.x - sx) / 2);
      return `M${sx},${sy} C${sx + dx},${sy} ${b.x - dx},${ty} ${b.x},${ty}`;
    }
    // el suscriptor está a la izquierda del publicador
    const sx = a.x;
    const tx = b.x + NODE_W;
    const dx = Math.max(60, (sx - tx) / 2);
    return `M${sx},${sy} C${sx - dx},${sy} ${tx + dx},${ty} ${tx},${ty}`;
  }

  private isActive(l: GooseLink): boolean {
    if (this.selectedLink) return l === this.selectedLink;
    if (this.selectedIed)
      return l.publisher === this.selectedIed || l.subscriber === this.selectedIed;
    return true;
  }

  // ---------- render ----------

  private renderNode(p: Placed): TemplateResult {
    const sel = this.selectedIed === p.ied.name;
    const dim =
      (this.selectedIed &&
        !sel &&
        !this.model.links.some(
          l =>
            (l.publisher === this.selectedIed && l.subscriber === p.ied.name) ||
            (l.subscriber === this.selectedIed && l.publisher === p.ied.name)
        )) ||
      (this.selectedLink &&
        this.selectedLink.publisher !== p.ied.name &&
        this.selectedLink.subscriber !== p.ied.name);
    return svg`
      <g class="node ${p.ied.role} ${sel ? 'sel' : ''} ${dim ? 'dim' : ''}"
         transform="translate(${p.x},${p.y})"
         @click=${(e: Event) => {
           e.stopPropagation();
           this.selectedLink = null;
           this.selectedIed = sel ? null : p.ied.name;
         }}>
        <rect width=${NODE_W} height=${NODE_H} rx="8"></rect>
        <text x="12" y="23" class="name">${p.ied.name}</text>
        <text x="12" y="42" class="sub">${p.ied.desc ?? roleLabel(p.ied.role)}</text>
        <title>${p.ied.name}${p.ied.desc ? ' — ' + p.ied.desc : ''}</title>
      </g>`;
  }

  private renderLink(l: GooseLink, placed: Map<string, Placed>): TemplateResult {
    const a = placed.get(l.publisher);
    const b = placed.get(l.subscriber);
    if (!a || !b) return svg``;
    const active = this.isActive(l);
    return svg`
      <path class="link ${l.unresolved ? 'bad' : ''} ${active ? '' : 'dim'} ${
      this.selectedLink === l ? 'sel' : ''
    }"
            d=${this.linkPath(a, b)} marker-end="url(#arrow${l.unresolved ? '-bad' : ''})"
            @click=${(e: Event) => {
              e.stopPropagation();
              this.selectedIed = null;
              this.selectedLink = this.selectedLink === l ? null : l;
            }}>
        <title>${l.publisher} → ${l.subscriber} · ${l.cbName} (${l.signals.length} señales)${
      l.unresolved ? ' — GSEControl no encontrado' : ''
    }</title>
      </path>`;
  }

  private renderDetails(): TemplateResult {
    const l = this.selectedLink;
    if (l) {
      const c = this.model.controls.find(
        x => x.ied === l.publisher && x.name === l.cbName && (l.publisherLdInst === null || x.ldInst === l.publisherLdInst)
      );
      return html`<aside>
        <h3>${l.publisher} → ${l.subscriber}</h3>
        <dl>
          <dt>GSEControl</dt><dd>${l.cbName}${l.unresolved ? html` <b class="warn">no existe en el SCL</b>` : ''}</dd>
          ${c
            ? html`<dt>DataSet</dt><dd>${c.datSet ?? '—'} (${c.fcdaCount} FCDA)</dd>
                <dt>GoID</dt><dd>${c.appId ?? '—'}</dd>
                <dt>APPID (L2)</dt><dd>${c.appIdL2 ?? '—'}</dd>
                <dt>confRev</dt><dd>${c.confRev ?? '—'}</dd>
                <dt>MAC</dt><dd>${c.mac ?? '—'}</dd>
                <dt>VLAN</dt><dd>${c.vlanId ?? '—'} / prio ${c.vlanPriority ?? '—'}</dd>`
            : ''}
          <dt>Origen</dt><dd>${l.via}</dd>
        </dl>
        <table>
          <tr><th>Entrada (suscriptor)</th><th>Dato publicado</th></tr>
          ${l.signals.map(
            s => html`<tr><td>${s.intAddr ?? s.desc ?? '—'}</td><td>${s.src}</td></tr>`
          )}
        </table>
      </aside>`;
    }
    const n = this.selectedIed;
    if (n) {
      const out = this.model.links.filter(x => x.publisher === n);
      const inn = this.model.links.filter(x => x.subscriber === n);
      const ctl = this.model.controls.filter(x => x.ied === n);
      return html`<aside>
        <h3>${n}</h3>
        <h4>Publica (${ctl.length} GSEControl)</h4>
        <ul>${ctl.map(c => html`<li>${c.name} <small>${c.datSet ?? ''} · APPID ${c.appIdL2 ?? '—'}</small></li>`)}</ul>
        <h4>Suscribe a (${inn.length})</h4>
        <ul>${inn.map(x => html`<li>${x.publisher} · ${x.cbName} <small>${x.signals.length} señales</small></li>`)}</ul>
        <h4>Sus mensajes llegan a (${out.length})</h4>
        <ul>${out.map(x => html`<li>${x.subscriber} · ${x.cbName}</li>`)}</ul>
      </aside>`;
    }
    return html`<aside class="hint">
      Seleccioná un IED o una flecha para ver el detalle.<br />
      Rueda del mouse: zoom · arrastrar: mover.
    </aside>`;
  }

  render(): TemplateResult {
    if (!this.doc) return html``;
    const placed = this.layout();
    const unresolved = this.model.links.filter(l => l.unresolved).length;
    const pubs = this.model.ieds.filter(i => i.role === 'publisher' || i.role === 'both').length;
    const links = this.model.links.filter(l => placed.has(l.publisher) && placed.has(l.subscriber));
    return html`
      <div class="bar">
        <strong>Editor GOOSE</strong>
        <span class="stats">
          ${this.model.ieds.length} IEDs · ${pubs} publicadores · ${this.model.links.length} enlaces
          ${unresolved ? html`· <b class="warn">${unresolved} sin GSEControl</b>` : ''}
        </span>
        <input type="search" placeholder="Filtrar IED…" .value=${this.filter}
               @input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)} />
        <label><input type="checkbox" .checked=${this.showIdle}
               @change=${(e: Event) => (this.showIdle = (e.target as HTMLInputElement).checked)} />
          IEDs sin GOOSE</label>
        <button @click=${() => {
          this.pz?.zoomAbs(0, 0, 1);
          this.pz?.moveTo(0, 0);
        }}>Restablecer vista</button>
      </div>
      <div class="main">
        <svg class="canvas" @click=${() => { this.selectedIed = null; this.selectedLink = null; }}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" class="arrow"></path>
            </marker>
            <marker id="arrow-bad" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" class="arrow bad"></path>
            </marker>
          </defs>
          <g id="viewport">
            ${links.map(l => this.renderLink(l, placed))}
            ${Array.from(placed.values()).map(p => this.renderNode(p))}
          </g>
        </svg>
        ${this.renderDetails()}
      </div>`;
  }

  static styles = css`
    :host { font-family: var(--mdc-typography-font-family, Roboto, sans-serif); display: block; height: calc(100vh - 64px); color: var(--mdc-theme-on-surface, #222); }
    .bar { display: flex; gap: 16px; align-items: center; padding: 8px 16px; border-bottom: 1px solid rgba(128,128,128,.3); flex-wrap: wrap; }
    .stats { opacity: .75; font-size: 13px; flex: 1; }
    .warn { color: #c62828; }
    .main { display: flex; height: calc(100% - 49px); }
    svg.canvas { flex: 1; min-width: 0; height: 100%; background: var(--mdc-theme-background, #fafafa); cursor: grab; }
    aside { width: 320px; overflow: auto; padding: 12px 16px; border-left: 1px solid rgba(128,128,128,.3); font-size: 13px; }
    aside.hint { opacity: .65; }
    aside h3 { margin: 4px 0 8px; font-size: 16px; }
    aside h4 { margin: 14px 0 4px; font-size: 13px; opacity: .8; }
    aside ul { margin: 0; padding-left: 18px; }
    aside small { opacity: .65; }
    dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 0 0 10px; }
    dt { opacity: .65; }
    dd { margin: 0; word-break: break-all; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 3px 4px; border-bottom: 1px solid rgba(128,128,128,.25); word-break: break-all; }
    .node rect { fill: #fff; stroke: #607d8b; stroke-width: 1.5; }
    .node.publisher rect { stroke: #1565c0; }
    .node.subscriber rect { stroke: #2e7d32; }
    .node.both rect { stroke: #6a1b9a; }
    .node.none rect { stroke-dasharray: 4 3; opacity: .7; }
    .node.sel rect { stroke-width: 3; fill: #e3f2fd; }
    .node.dim { opacity: .25; }
    .node { cursor: pointer; }
    .node text { fill: #222; pointer-events: none; font-family: var(--mdc-typography-font-family, Roboto, sans-serif); }
    .node .name { font-weight: 600; font-size: 14px; }
    .node .sub { font-size: 11px; opacity: .7; }
    .link { fill: none; stroke: #1565c0; stroke-width: 1.6; cursor: pointer; }
    .link.bad { stroke: #c62828; stroke-dasharray: 6 4; }
    .link.sel { stroke-width: 3.4; }
    .link.dim { opacity: .12; }
    .link:hover { stroke-width: 3; }
    .arrow { fill: #1565c0; } .arrow.bad { fill: #c62828; }
    input[type='search'] { padding: 4px 8px; }
  `;
}

function roleLabel(r: GooseIed['role']): string {
  return { publisher: 'Publicador', subscriber: 'Suscriptor', both: 'Publicador y suscriptor', none: 'Sin GOOSE' }[r];
}
