import { css, html, LitElement, property, state, TemplateResult } from 'lit-element';

import { api, Milestone, VersionInfo } from '../lib/api.js';
import { serializeDoc, session } from '../lib/session.js';

const fmt = (iso: string) => new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} kB`);

/**
 * DSB — Versiones: estado del proyecto del servidor, creación de versiones,
 * historial, hitos y restauración. Sin servidor solo ofrece descargar el SCD.
 */
export default class DsbVersionsPlugin extends LitElement {
  @property({ attribute: false }) doc!: XMLDocument;
  @property({ type: Number }) editCount = -1;

  @state() private versions: VersionInfo[] = [];
  @state() private message = '';
  @state() private note = '';
  @state() private error = '';
  @state() private busy = false;
  @state() private tick = 0;
  @state() private loadedFor = '';
  @state() private milestoneFor: number | null = null;
  @state() private msName = '';
  @state() private msNote = '';
  @state() private milestones: Milestone[] = [];

  private onChange = () => {
    this.tick++;
    void this.load();
  };

  connectedCallback(): void {
    super.connectedCallback();
    session.addEventListener('change', this.onChange);
    void this.load();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    session.removeEventListener('change', this.onChange);
  }

  private async load(force = false) {
    const p = session.project;
    if (!p) {
      this.versions = [];
      this.loadedFor = '';
      return;
    }
    const key = `${p.id}:${p.base}`;
    if (!force && key === this.loadedFor) return;
    this.loadedFor = key;
    try {
      this.versions = (await api<{ versions: VersionInfo[] }>('GET', `/projects/${p.id}/versions`)).versions;
      this.milestones = (await api<{ milestones: Milestone[] }>('GET', `/projects/${p.id}/milestones`)).milestones;
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  private async run(fn: () => Promise<void>) {
    this.busy = true;
    this.error = '';
    try {
      await fn();
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }

  private createVersion() {
    void this.run(async () => {
      await session.createVersion(this.message.trim());
      this.message = '';
      await this.load(true);
    });
  }

  private restore(n: number) {
    if (session.project?.dirty && !window.confirm('Tiene cambios sin versionar que se perderán al restaurar. ¿Continuar?')) return;
    void this.run(async () => {
      await session.restoreVersion(n);
      await this.load(true);
    });
  }

  private view(n: number) {
    const p = session.project!;
    if (p.dirty && p.editing && !window.confirm('Tiene cambios sin versionar que se perderán al abrir otra versión. ¿Continuar?')) return;
    void this.run(async () => session.openProject(p.id, { version: n }));
  }

  private backToCurrent() {
    const p = session.project!;
    void this.run(async () => session.openProject(p.id));
  }

  private async download(n?: number) {
    const p = session.project;
    let text: string;
    let name: string;
    if (p && n) {
      const res = await fetch(`/api/projects/${p.id}/content?version=${n}`, { credentials: 'same-origin' });
      text = await res.text();
      name = `${p.name}_v${n}.scd`;
    } else {
      text = serializeDoc(this.doc);
      name = p ? `${p.name}.scd` : 'proyecto.scd';
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private addMilestone(n: number) {
    void this.run(async () => {
      await api('POST', `/projects/${session.project!.id}/milestones`, { versionNumber: n, name: this.msName, note: this.msNote });
      this.milestoneFor = null;
      this.msName = this.msNote = '';
      await this.load(true);
    });
  }

  private removeMilestone(m: Milestone) {
    if (!window.confirm(`¿Quitar el hito "${m.name}"? La versión no se borra.`)) return;
    void this.run(async () => {
      await api('DELETE', `/projects/${session.project!.id}/milestones/${m.id}`);
      await this.load(true);
    });
  }

  private status(): TemplateResult {
    const p = session.project!;
    const parts: TemplateResult[] = [];
    if (p.viewing) parts.push(html`<span class="chip warn">Viendo la versión ${p.viewing} (solo lectura)</span>`);
    else if (!p.editing) parts.push(html`<span class="chip">Solo lectura</span>`);
    else if (p.lockLost) parts.push(html`<span class="chip bad">Bloqueo perdido</span>`);
    else if (p.dirty) parts.push(html`<span class="chip warn">Cambios sin guardar</span>`);
    else if (p.draftSavedAt) parts.push(html`<span class="chip ok">Borrador guardado ${p.draftSavedAt.toLocaleTimeString('es-AR', { timeStyle: 'short' })}</span>`);
    else parts.push(html`<span class="chip ok">Sin cambios pendientes</span>`);
    return html`${parts}`;
  }

  private renderHistory(): TemplateResult {
    const p = session.project!;
    return html`<h3>Historial</h3>
      <table>
        <tr><th>Versión</th><th>Mensaje</th><th>Autor</th><th>Fecha</th><th>Tamaño</th><th>Hitos</th><th></th></tr>
        ${this.versions.map(v => html`<tr class=${v.number === p.base && !p.viewing ? 'cur' : v.number === p.viewing ? 'view' : ''}>
          <td><strong>${v.number}</strong></td><td>${v.message}</td><td>${v.author}</td><td>${fmt(v.createdAt)}</td><td>${kb(v.size)}</td>
          <td>${v.milestones.map(n => { const m = this.milestones.find(x => x.name === n); return html`<span class="chip ms" title=${m?.note ?? ''}>${n}${p.canEdit && m ? html` <a href="#" @click=${(e: Event) => { e.preventDefault(); this.removeMilestone(m); }}>×</a>` : ''}</span>`; })}</td>
          <td class="act">
            ${v.number === p.viewing || (v.number === p.base && !p.viewing) ? '' : html`<button ?disabled=${this.busy} @click=${() => this.view(v.number)}>Ver</button>`}
            ${p.editing && !p.viewing && v.number !== p.base && !p.lockLost ? html`<button ?disabled=${this.busy} @click=${() => this.restore(v.number)}>Restaurar</button>` : ''}
            <button @click=${() => void this.download(v.number)}>Descargar</button>
            ${p.canEdit ? html`<button @click=${() => { this.milestoneFor = this.milestoneFor === v.number ? null : v.number; }}>Hito…</button>` : ''}
          </td></tr>
          ${this.milestoneFor === v.number ? html`<tr><td></td><td colspan="6"><div class="row">
            <input placeholder="Nombre del hito (ej. Entregado a presupuesto)" .value=${this.msName} @input=${(e: Event) => (this.msName = (e.target as HTMLInputElement).value)} />
            <input placeholder="Nota (opcional)" .value=${this.msNote} @input=${(e: Event) => (this.msNote = (e.target as HTMLInputElement).value)} />
            <button class="primary" ?disabled=${this.busy || this.msName.trim().length < 2} @click=${() => this.addMilestone(v.number)}>Guardar hito</button></div></td></tr>` : ''}`)}
      </table>
      ${this.versions.length ? '' : html`<p class="hint">Todavía no hay versiones.</p>`}`;
  }

  render(): TemplateResult {
    void this.tick;
    if (!this.doc) return html``;
    const p = session.project;
    if (!p) {
      return html`<div class="wrap"><h3>Sin servidor</h3>
        <p class="hint">Está trabajando en modo local: los cambios viven solo en este navegador. Descargue el archivo para conservarlos.</p>
        <button class="primary" @click=${() => void this.download()}>Descargar SCD</button></div>`;
    }
    return html`<div class="wrap">
      <div class="head">
        <h2>${p.name}</h2><span class="chip">${p.access === 'owner' ? 'Dueño' : p.access === 'admin' ? 'Administrador' : p.access === 'editor' ? 'Editor' : 'Lector'}</span>
        <span class="chip">Versión base ${p.base || '—'}</span>${this.status()}
        <span class="sp"></span>
        <button @click=${() => session.showBrowser()}>Proyectos</button>
        ${p.canManage ? html`<button @click=${() => session.requestShare(p.id)}>Compartir…</button>` : ''}
        <button @click=${() => void this.download()}>Descargar SCD</button>
        <button @click=${() => void session.closeProject()}>Cerrar proyecto</button>
      </div>
      ${p.notice ? html`<p class="msg">${p.notice}</p>` : ''}
      ${this.error ? html`<p class="err">${this.error}</p>` : ''}
      ${p.viewing ? html`<div class="card"><p>Está viendo la versión ${p.viewing}; no se puede modificar.</p><div class="row"><button class="primary" @click=${this.backToCurrent}>Volver a la versión actual</button></div></div>` : ''}
      ${p.editing && !p.lockLost ? html`<div class="card"><h3>Crear versión</h3>
        <p class="hint">Una versión es una foto completa del proyecto que ya no se modifica. Describa qué cambió, por ejemplo: "132 kV: agregado campo L3".</p>
        <div class="row"><input class="msg-in" placeholder="Mensaje de la versión (mínimo 3 caracteres)" .value=${this.message} @input=${(e: Event) => (this.message = (e.target as HTMLInputElement).value)} />
        <button class="primary" ?disabled=${this.busy || this.message.trim().length < 3} @click=${this.createVersion}>Crear versión</button></div></div>` : ''}
      ${!p.editing && !p.viewing ? html`<p class="hint">${p.canEdit ? 'Abierto en solo lectura. Vuelva a abrirlo desde "Proyectos" para editar.' : 'No tiene permiso de edición en este proyecto.'}</p>` : ''}
      ${this.renderHistory()}
    </div>`;
  }

  static styles = css`
    :host { font-family: var(--mdc-typography-font-family, Roboto, sans-serif); display: block; color: var(--mdc-theme-on-surface, #222); }
    .wrap { padding: 8px 24px 24px; max-width: 1200px; }
    .head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .sp { flex: 1; }
    h2, h3 { font-weight: 400; margin: 10px 0 4px; }
    .card { border: 1px solid rgba(128,128,128,.4); border-radius: 6px; padding: 4px 16px 12px; margin: 10px 0; background: rgba(255,255,255,.35); }
    .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 8px 0; }
    input { font: inherit; padding: 6px; }
    .msg-in { flex: 1; min-width: 320px; }
    button { font: inherit; padding: 4px 12px; cursor: pointer; }
    button:disabled { opacity: .45; cursor: default; }
    .primary { background: var(--mdc-theme-primary, #2aa198); color: #fff; border: none; border-radius: 3px; }
    table { border-collapse: collapse; width: 100%; font-size: 14px; margin: 8px 0; }
    th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid rgba(128,128,128,.25); vertical-align: top; }
    tr.cur { background: rgba(42,161,152,.14); } tr.view { background: rgba(255,193,7,.22); }
    td.act { white-space: nowrap; }
    .chip { display: inline-block; border-radius: 10px; padding: 1px 10px; font-size: 12px; background: rgba(128,128,128,.28); }
    .chip.ok { background: #c8e6c9; } .chip.warn { background: #ffe0b2; } .chip.bad { background: #ffcdd2; } .chip.ms { background: #bbdefb; margin-right: 4px; }
    .chip a { text-decoration: none; color: inherit; }
    .hint { opacity: .7; } .msg { color: #2e7d32; } .err { color: #c62828; }
  `;
}
