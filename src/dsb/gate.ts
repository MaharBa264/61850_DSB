import { css, html, LitElement, property, state, TemplateResult } from 'lit-element';

import {
  api,
  AuditRow,
  Member,
  ProjectDetail,
  ProjectSummary,
  User,
  Visibility,
} from './lib/api.js';
import { session } from './lib/session.js';

const VIS_LABEL: Record<Visibility, string> = { private: 'Privado', shared: 'Compartido', public: 'Libre' };
const VIS_HELP: Record<Visibility, string> = {
  private: 'Solo usted (y el administrador).',
  shared: 'Usted y los usuarios que elija, como lectores o editores.',
  public: 'Cualquier usuario puede verlo y duplicarlo; solo usted y los editores que elija lo modifican.',
};
const ACCESS_LABEL: Record<string, string> = { admin: 'Administrador', owner: 'Dueño', editor: 'Editor', viewer: 'Lector' };

type View = 'projects' | 'users' | 'audit';
type Filter = 'mine' | 'shared' | 'public' | 'all';

type DirUser = { id: number; username: string; displayName: string };

const fmt = (iso: string) => new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * DSB — Puerta de acceso: inicio de sesión, explorador de proyectos, permisos
 * y administración de usuarios. Envuelve la aplicación; sin servidor DSB
 * (`mode === 'local'`) no muestra nada y la app funciona como siempre.
 *
 * También hace que un proyecto abierto en solo lectura no pueda modificarse:
 * todas las ediciones pasan por `editor.commit`, que se protege en `open-scd.ts`.
 */
export default class DsbGate extends LitElement {
  @property({ attribute: false }) host!: HTMLElement;
  @property({ type: Number }) editCount = -1;

  @state() private tick = 0;
  @state() private view: View = 'projects';
  @state() private filter: Filter = 'mine';
  @state() private projects: ProjectSummary[] = [];
  @state() private message = '';
  @state() private error = '';
  @state() private busy = false;

  // login / clave
  @state() private username = '';
  @state() private password = '';
  @state() private pwCurrent = '';
  @state() private pwNext = '';
  @state() private pwNext2 = '';
  @state() private changingPw = false;

  // nuevo proyecto
  @state() private newName = '';
  @state() private newDesc = '';
  @state() private newVis: Visibility = 'private';
  @state() private creating = false;

  // compartir
  @state() private share: ProjectDetail | null = null;
  @state() private shareVis: Visibility = 'private';
  @state() private shareMembers: Member[] = [];
  @state() private directory: DirUser[] = [];
  @state() private shareAdd = '';

  // administración
  @state() private users: User[] = [];
  @state() private audit: AuditRow[] = [];
  @state() private nuUser = '';
  @state() private nuName = '';
  @state() private nuPass = '';
  @state() private nuAdmin = false;
  @state() private resetFor: number | null = null;
  @state() private resetPass = '';

  private onChange = () => {
    this.tick++;
    if (session.shareRequest) {
      const id = session.shareRequest;
      session.shareRequest = null;
      this.view = 'projects';
      void this.openShare({ id });
    }
    if (session.mode === 'ready' && session.browserOpen && !session.user?.mustChange) void this.loadProjects();
  };
  private onHide = () => session.onPageHide();
  private onUnload = (e: BeforeUnloadEvent) => {
    if (session.project?.dirty && session.project.editing) {
      e.preventDefault();
      e.returnValue = '';
    }
  };

  connectedCallback(): void {
    super.connectedCallback();
    session.addEventListener('change', this.onChange);
    window.addEventListener('pagehide', this.onHide);
    window.addEventListener('beforeunload', this.onUnload);
    session.host = this.host as never;
    void session.init();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    session.removeEventListener('change', this.onChange);
    window.removeEventListener('pagehide', this.onHide);
    window.removeEventListener('beforeunload', this.onUnload);
  }

  protected updated(changed: Map<string, unknown>): void {
    // el contador arranca en -1: cualquier cambio posterior al primer render es una edición (incluida la primera)
    if (changed.has('editCount') && changed.get('editCount') !== undefined) session.noteEdit();
    if (changed.has('host')) session.host = this.host as never;
  }

  // ---------- acciones ----------

  private async run(fn: () => Promise<void>, ok = '') {
    this.busy = true;
    this.error = '';
    this.message = '';
    try {
      await fn();
      if (ok) this.message = ok;
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }

  private async loadProjects() {
    try {
      this.projects = (await api<{ projects: ProjectSummary[] }>('GET', '/projects')).projects;
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  private doLogin(e: Event) {
    e.preventDefault();
    void this.run(async () => {
      await session.login(this.username.trim(), this.password);
      this.password = '';
    });
  }

  private doChangePassword(e: Event) {
    e.preventDefault();
    void this.run(async () => {
      if (this.pwNext !== this.pwNext2) throw new Error('Las contraseñas nuevas no coinciden.');
      await session.changePassword(this.pwCurrent, this.pwNext);
      this.pwCurrent = this.pwNext = this.pwNext2 = '';
      this.changingPw = false;
    }, 'Contraseña cambiada.');
  }

  private open(p: ProjectSummary, readOnly: boolean) {
    void this.run(() => session.openProject(p.id, { readOnly }));
  }

  private createProject() {
    void this.run(async () => {
      const id = await session.createProject({ name: this.newName, description: this.newDesc, visibility: this.newVis });
      this.newName = this.newDesc = '';
      this.creating = false;
      await session.openProject(id);
    });
  }

  private async createFromFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    void this.run(async () => {
      const text = await f.text();
      const name = this.newName.trim() || f.name.replace(/\.[^.]+$/, '');
      const id = await session.createProject({ name, description: this.newDesc, visibility: this.newVis, content: text });
      this.newName = this.newDesc = '';
      this.creating = false;
      await session.openProject(id);
    });
  }

  private duplicate(p: ProjectSummary) {
    const name = window.prompt('Nombre del proyecto nuevo:', `${p.name} (copia)`);
    if (!name) return;
    void this.run(async () => {
      await api('POST', `/projects/${p.id}/duplicate`, { name });
      await this.loadProjects();
    }, 'Proyecto duplicado.');
  }

  private removeProject(p: ProjectSummary) {
    const typed = window.prompt(`Se borrará el proyecto "${p.name}" con TODAS sus versiones. Esto no se puede deshacer.\nEscriba el nombre del proyecto para confirmar:`);
    if (typed === null) return;
    if (typed.trim() !== p.name) {
      this.error = 'El nombre no coincide; no se borró nada.';
      return;
    }
    void this.run(async () => {
      if (session.project?.id === p.id) await session.closeProject();
      await api('DELETE', `/projects/${p.id}`);
      await this.loadProjects();
    }, 'Proyecto borrado.');
  }

  private async openShare(p: { id: string }) {
    await this.run(async () => {
      this.share = (await api<{ project: ProjectDetail }>('GET', `/projects/${p.id}`)).project;
      this.shareVis = this.share.visibility;
      this.shareMembers = [...this.share.members];
      this.directory = (await api<{ users: DirUser[] }>('GET', '/directory')).users;
      this.shareAdd = '';
    });
  }

  private saveShare() {
    const s = this.share;
    if (!s) return;
    void this.run(async () => {
      await api('PATCH', `/projects/${s.id}`, { visibility: this.shareVis });
      await api('PUT', `/projects/${s.id}/members`, { members: this.shareMembers.map(m => ({ userId: m.userId, role: m.role })) });
      this.share = null;
      await this.loadProjects();
    }, 'Permisos guardados.');
  }

  private async loadUsers() {
    await this.run(async () => {
      this.users = (await api<{ users: User[] }>('GET', '/users')).users;
    });
  }

  private async loadAudit() {
    await this.run(async () => {
      this.audit = (await api<{ audit: AuditRow[] }>('GET', '/audit')).audit;
    });
  }

  private createUser() {
    void this.run(async () => {
      await api('POST', '/users', { username: this.nuUser.trim(), displayName: this.nuName.trim() || this.nuUser.trim(), password: this.nuPass, role: this.nuAdmin ? 'admin' : 'user', mustChange: true });
      this.nuUser = this.nuName = this.nuPass = '';
      this.nuAdmin = false;
      await this.loadUsers();
    }, 'Usuario creado. Deberá cambiar la contraseña al ingresar.');
  }

  private patchUser(u: User, patch: Record<string, unknown>, ok: string) {
    void this.run(async () => {
      await api('PATCH', `/users/${u.id}`, patch);
      this.resetFor = null;
      this.resetPass = '';
      await this.loadUsers();
    }, ok);
  }

  // ---------- vistas ----------

  private pwFields(): TemplateResult {
    const inp = (label: string, value: string, set: (v: string) => void) =>
      html`<label>${label}<input type="password" autocomplete="new-password" .value=${value} @input=${(e: Event) => set((e.target as HTMLInputElement).value)} /></label>`;
    return html`${inp('Contraseña actual', this.pwCurrent, v => (this.pwCurrent = v))}
      ${inp('Contraseña nueva (mínimo 8 caracteres)', this.pwNext, v => (this.pwNext = v))}
      ${inp('Repetir la contraseña nueva', this.pwNext2, v => (this.pwNext2 = v))}`;
  }

  private renderLogin(): TemplateResult {
    return html`<div class="center"><form class="card narrow" @submit=${this.doLogin}>
      <h2>61850 DSB</h2><p class="hint">Ingeniería IEC 61850 — inicie sesión</p>
      <label>Usuario<input autocomplete="username" .value=${this.username} @input=${(e: Event) => (this.username = (e.target as HTMLInputElement).value)} /></label>
      <label>Contraseña<input type="password" autocomplete="current-password" .value=${this.password} @input=${(e: Event) => (this.password = (e.target as HTMLInputElement).value)} /></label>
      ${this.error ? html`<p class="err">${this.error}</p>` : ''}
      <button class="primary" type="submit" ?disabled=${this.busy}>Ingresar</button>
    </form></div>`;
  }

  private renderMustChange(): TemplateResult {
    return html`<div class="center"><form class="card narrow" @submit=${this.doChangePassword}>
      <h2>Cambie su contraseña</h2><p class="hint">Está usando una contraseña temporal. Elija una propia para continuar.</p>
      ${this.pwFields()}
      ${this.error ? html`<p class="err">${this.error}</p>` : ''}
      <button class="primary" type="submit" ?disabled=${this.busy}>Cambiar contraseña</button>
      <button type="button" @click=${() => void session.logout()}>Salir</button>
    </form></div>`;
  }

  private filtered(): ProjectSummary[] {
    const me = session.user?.id;
    return this.projects.filter(p => {
      if (this.filter === 'all') return true;
      if (this.filter === 'mine') return p.owner.id === me;
      if (this.filter === 'shared') return p.owner.id !== me && p.visibility !== 'public' || (p.owner.id !== me && p.access === 'editor');
      return p.owner.id !== me && p.visibility === 'public';
    });
  }

  private renderRow(p: ProjectSummary): TemplateResult {
    const cur = session.project?.id === p.id;
    return html`<tr class=${cur ? 'cur' : ''}>
      <td><strong>${p.name}</strong>${cur ? html` <span class="chip">abierto</span>` : ''}${p.description ? html`<div class="hint">${p.description}</div>` : ''}</td>
      <td>${p.owner.displayName}</td>
      <td><span class="chip vis-${p.visibility}">${VIS_LABEL[p.visibility]}</span><div class="hint">${ACCESS_LABEL[p.access]}</div></td>
      <td>${p.head || '—'}</td>
      <td>${p.locked ? (p.lockedByMe ? 'Editando usted' : 'En edición') : ''}</td>
      <td>${fmt(p.updatedAt)}</td>
      <td class="act">
        ${p.head === 0 && !p.canEdit ? html`<span class="hint">vacío</span>` : html`
          <button class="primary" ?disabled=${this.busy} @click=${() => this.open(p, !p.canEdit)}>${p.canEdit ? 'Abrir' : 'Abrir (solo lectura)'}</button>
          ${p.canEdit ? html`<button ?disabled=${this.busy || p.head === 0} @click=${() => this.open(p, true)}>Solo lectura</button>` : ''}`}
        ${p.canManage ? html`<button @click=${() => void this.openShare(p)}>Compartir…</button>` : ''}
        ${p.head ? html`<button @click=${() => this.duplicate(p)}>Duplicar</button>` : ''}
        ${p.canManage ? html`<button class="danger" @click=${() => this.removeProject(p)}>Borrar</button>` : ''}
      </td></tr>`;
  }

  private renderNewProject(): TemplateResult {
    if (!this.creating) return html`<button class="primary" @click=${() => (this.creating = true)}>Nuevo proyecto</button>`;
    return html`<div class="card">
      <h3>Nuevo proyecto</h3>
      <div class="grid">
        <label>Nombre *<input .value=${this.newName} @input=${(e: Event) => (this.newName = (e.target as HTMLInputElement).value)} /></label>
        <label>Descripción<input .value=${this.newDesc} @input=${(e: Event) => (this.newDesc = (e.target as HTMLInputElement).value)} /></label>
        <label>Visibilidad<select @change=${(e: Event) => (this.newVis = (e.target as HTMLSelectElement).value as Visibility)}>
          ${(['private', 'shared', 'public'] as Visibility[]).map(v => html`<option value=${v} ?selected=${v === this.newVis}>${VIS_LABEL[v]}</option>`)}</select></label>
      </div>
      <p class="hint">${VIS_HELP[this.newVis]}</p>
      <div class="row">
        <button class="primary" ?disabled=${this.busy || !this.newName.trim()} @click=${this.createProject}>Crear vacío</button>
        <label class="file">Crear desde un archivo SCD/SSD/ICD<input type="file" accept=".scd,.ssd,.icd,.iid,.cid,.xml" @change=${this.createFromFile} /></label>
        <button @click=${() => (this.creating = false)}>Cancelar</button>
      </div></div>`;
  }

  private renderProjects(): TemplateResult {
    const tab = (f: Filter, label: string) => html`<button class="tab ${this.filter === f ? 'on' : ''}" @click=${() => (this.filter = f)}>${label}</button>`;
    const list = this.filtered();
    return html`
      <div class="row">${tab('mine', 'Mis proyectos')}${tab('shared', 'Compartidos conmigo')}${tab('public', 'Libres')}${session.user?.role === 'admin' ? tab('all', 'Todos') : ''}<span class="sp"></span>${this.renderNewProject()}</div>
      <table>
        <tr><th>Proyecto</th><th>Dueño</th><th>Acceso</th><th>Versión</th><th>Estado</th><th>Actualizado</th><th></th></tr>
        ${list.map(p => this.renderRow(p))}
      </table>
      ${list.length ? '' : html`<p class="hint">No hay proyectos en esta lista.</p>`}`;
  }

  private renderUsers(): TemplateResult {
    return html`<div class="card"><h3>Nuevo usuario</h3>
      <div class="grid">
        <label>Usuario *<input .value=${this.nuUser} @input=${(e: Event) => (this.nuUser = (e.target as HTMLInputElement).value)} /></label>
        <label>Nombre<input .value=${this.nuName} @input=${(e: Event) => (this.nuName = (e.target as HTMLInputElement).value)} /></label>
        <label>Contraseña temporal *<input type="text" autocomplete="off" .value=${this.nuPass} @input=${(e: Event) => (this.nuPass = (e.target as HTMLInputElement).value)} /></label>
      </div>
      <label class="chk"><input type="checkbox" .checked=${this.nuAdmin} @change=${(e: Event) => (this.nuAdmin = (e.target as HTMLInputElement).checked)} /> Administrador</label>
      <div class="row"><button class="primary" ?disabled=${this.busy || !this.nuUser || !this.nuPass} @click=${this.createUser}>Crear usuario</button></div></div>
      <table><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Estado</th><th></th></tr>
      ${this.users.map(u => html`<tr><td>${u.username}</td><td>${u.displayName}</td><td>${u.role === 'admin' ? 'Administrador' : 'Usuario'}</td><td>${u.active ? 'Activo' : html`<span class="err">Inactivo</span>`}</td>
        <td class="act">
          <button @click=${() => this.patchUser(u, { active: !u.active }, u.active ? 'Usuario desactivado.' : 'Usuario activado.')}>${u.active ? 'Desactivar' : 'Activar'}</button>
          <button @click=${() => this.patchUser(u, { role: u.role === 'admin' ? 'user' : 'admin' }, 'Rol cambiado.')}>${u.role === 'admin' ? 'Quitar admin' : 'Hacer admin'}</button>
          ${this.resetFor === u.id
            ? html`<input placeholder="Clave temporal" .value=${this.resetPass} @input=${(e: Event) => (this.resetPass = (e.target as HTMLInputElement).value)} />
                <button class="primary" ?disabled=${this.resetPass.length < 8} @click=${() => this.patchUser(u, { password: this.resetPass }, 'Contraseña restablecida; deberá cambiarla al ingresar.')}>Guardar</button>`
            : html`<button @click=${() => { this.resetFor = u.id; this.resetPass = ''; }}>Restablecer clave…</button>`}
        </td></tr>`)}</table>`;
  }

  private renderAudit(): TemplateResult {
    return html`<table><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr>
      ${this.audit.map(a => html`<tr><td>${fmt(a.at)}</td><td>${a.username ?? ''}</td><td>${a.action}</td><td class="hint">${Object.keys(a.detail).length ? JSON.stringify(a.detail) : ''}</td></tr>`)}</table>`;
  }

  private renderShare(): TemplateResult {
    const s = this.share!;
    const taken = new Set([s.owner.id, ...this.shareMembers.map(m => m.userId)]);
    const candidates = this.directory.filter(u => !taken.has(u.id));
    return html`<div class="modal"><div class="card wide">
      <h3>Permisos de "${s.name}"</h3>
      ${(['private', 'shared', 'public'] as Visibility[]).map(v => html`<label class="radio"><input type="radio" name="vis" .checked=${this.shareVis === v} @change=${() => (this.shareVis = v)} /> <strong>${VIS_LABEL[v]}</strong> — ${VIS_HELP[v]}</label>`)}
      ${this.shareVis !== 'private' ? html`
        <h4>${this.shareVis === 'public' ? 'Editores (el resto solo ve)' : 'Usuarios con acceso'}</h4>
        <table>${this.shareMembers.map(m => html`<tr><td>${m.displayName} <span class="hint">${m.username}</span></td>
          <td><select @change=${(e: Event) => { m.role = (e.target as HTMLSelectElement).value as Member['role']; this.shareMembers = [...this.shareMembers]; }}>
            <option value="viewer" ?selected=${m.role === 'viewer'}>Lector</option><option value="editor" ?selected=${m.role === 'editor'}>Editor</option></select></td>
          <td><button class="danger" @click=${() => (this.shareMembers = this.shareMembers.filter(x => x.userId !== m.userId))}>Quitar</button></td></tr>`)}</table>
        <div class="row"><select @change=${(e: Event) => (this.shareAdd = (e.target as HTMLSelectElement).value)}>
          <option value="">— agregar usuario —</option>${candidates.map(u => html`<option value=${u.id} ?selected=${String(u.id) === this.shareAdd}>${u.displayName} (${u.username})</option>`)}</select>
          <button ?disabled=${!this.shareAdd} @click=${() => { const u = this.directory.find(x => String(x.id) === this.shareAdd)!; this.shareMembers = [...this.shareMembers, { userId: u.id, username: u.username, displayName: u.displayName, role: 'viewer' }]; this.shareAdd = ''; }}>Agregar</button></div>` : ''}
      ${this.error ? html`<p class="err">${this.error}</p>` : ''}
      <div class="row"><button class="primary" ?disabled=${this.busy} @click=${this.saveShare}>Guardar</button><button @click=${() => (this.share = null)}>Cancelar</button></div>
    </div></div>`;
  }

  private renderBrowser(): TemplateResult {
    const u = session.user!;
    const tab = (v: View, label: string, load?: () => void) => html`<button class="tab ${this.view === v ? 'on' : ''}" @click=${() => { this.view = v; this.error = ''; load?.(); }}>${label}</button>`;
    return html`<div class="page">
      <div class="top">
        <strong class="brand">61850 DSB</strong>
        ${tab('projects', 'Proyectos')}
        ${u.role === 'admin' ? html`${tab('users', 'Usuarios', () => void this.loadUsers())}${tab('audit', 'Auditoría', () => void this.loadAudit())}` : ''}
        <span class="sp"></span>
        <span class="hint">${u.displayName}</span>
        <button @click=${() => { this.changingPw = !this.changingPw; this.error = ''; }}>Cambiar contraseña</button>
        <button @click=${() => void session.logout()}>Salir</button>
        ${session.project ? html`<button class="primary" @click=${() => session.hideBrowser()}>Volver al proyecto</button>` : ''}
      </div>
      <div class="content">
        ${this.changingPw ? html`<form class="card narrow" @submit=${this.doChangePassword}>${this.pwFields()}<div class="row"><button class="primary" type="submit" ?disabled=${this.busy}>Guardar</button><button type="button" @click=${() => (this.changingPw = false)}>Cancelar</button></div></form>` : ''}
        ${this.message ? html`<p class="msg">${this.message}</p>` : ''}
        ${this.error && !this.share ? html`<p class="err">${this.error}</p>` : ''}
        ${this.view === 'projects' ? this.renderProjects() : this.view === 'users' ? this.renderUsers() : this.renderAudit()}
      </div>
      ${this.share ? this.renderShare() : ''}
    </div>`;
  }

  private renderOverlay(): TemplateResult | string {
    switch (session.mode) {
      case 'checking':
        return html`<div class="center"><p class="hint">Conectando con el servidor…</p></div>`;
      case 'unavailable':
        return html`<div class="center"><div class="card narrow"><h3>Servidor no disponible</h3><p class="err">${session.error}</p><p class="hint">No se edita sin servidor para no perder trabajo. Reintente en unos instantes.</p><button class="primary" @click=${() => void session.init()}>Reintentar</button></div></div>`;
      case 'login':
        return this.renderLogin();
      case 'ready':
        if (session.user?.mustChange) return this.renderMustChange();
        return session.browserOpen || !session.project ? this.renderBrowser() : '';
      default:
        return '';
    }
  }

  render(): TemplateResult {
    void this.tick;
    const overlay = this.renderOverlay();
    return html`<slot></slot>${overlay ? html`<div class="overlay">${overlay}</div>` : ''}`;
  }

  static styles = css`
    :host { display: block; font-family: var(--mdc-typography-font-family, Roboto, sans-serif); color: var(--mdc-theme-on-surface, #222); }
    .overlay { position: fixed; inset: 0; z-index: 100; background: var(--mdc-theme-background, #eee8d5); overflow: auto; }
    .center { min-height: 100%; display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; }
    .page { min-height: 100%; }
    .top { display: flex; gap: 8px; align-items: center; padding: 8px 16px; background: var(--mdc-theme-primary, #2aa198); color: #fff; flex-wrap: wrap; }
    .top .hint { color: #fff; opacity: .9; }
    .brand { margin-right: 12px; font-size: 18px; }
    .content { padding: 12px 24px 32px; max-width: 1300px; margin: 0 auto; }
    .card { background: rgba(255,255,255,.55); border: 1px solid rgba(128,128,128,.4); border-radius: 6px; padding: 8px 20px 16px; margin: 10px 0; display: flex; flex-direction: column; gap: 8px; }
    .card.narrow { width: 360px; max-width: 100%; }
    .card.wide { width: 720px; max-width: 95vw; max-height: 90vh; overflow: auto; background: var(--mdc-theme-surface, #fdf6e3); }
    .modal { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 10; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px 16px; }
    label { display: flex; flex-direction: column; font-size: 13px; gap: 2px; }
    label.radio, label.chk { flex-direction: row; gap: 6px; align-items: center; font-size: 14px; }
    input, select { font: inherit; padding: 6px; }
    input[type=radio], input[type=checkbox] { padding: 0; }
    table { border-collapse: collapse; width: 100%; font-size: 14px; margin: 8px 0; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid rgba(128,128,128,.25); vertical-align: top; }
    tr.cur { background: rgba(42,161,152,.12); }
    td.act { white-space: nowrap; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 8px 0; }
    .sp { flex: 1; }
    button, .file { font: inherit; padding: 5px 12px; cursor: pointer; }
    .file { border: 1px solid rgba(128,128,128,.6); border-radius: 3px; flex-direction: row; }
    .file input { display: none; }
    .primary { background: var(--mdc-theme-primary, #2aa198); color: #fff; border: none; border-radius: 3px; }
    .top .primary { background: #fff; color: var(--mdc-theme-primary, #2aa198); }
    .tab { border: none; background: none; border-bottom: 3px solid transparent; font-size: 15px; padding: 8px 12px; }
    .top .tab { color: #fff; }
    .tab.on { border-bottom-color: var(--mdc-theme-primary, #2aa198); font-weight: 500; }
    .top .tab.on { border-bottom-color: #fff; }
    button:disabled { opacity: .45; cursor: default; }
    .danger, .err { color: #c62828; }
    .hint { opacity: .7; font-size: 13px; }
    .msg { color: #2e7d32; }
    .chip { display: inline-block; border-radius: 10px; padding: 0 8px; font-size: 12px; background: rgba(128,128,128,.3); }
    .chip.vis-public { background: #c8e6c9; } .chip.vis-shared { background: #bbdefb; } .chip.vis-private { background: #e0e0e0; }
    h2, h3, h4 { font-weight: 400; margin: 8px 0 4px; }
  `;
}

customElements.define('dsb-gate', DsbGate);
