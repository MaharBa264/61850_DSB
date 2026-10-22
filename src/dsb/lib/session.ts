/**
 * Estado de sesión y de proyecto abierto (singleton).
 *
 * - `mode`: `local` = sin servidor (la app funciona como siempre, con archivos);
 *   `login` = hay servidor y falta iniciar sesión; `ready` = sesión iniciada.
 * - Un proyecto se abre para **editar** (toma el bloqueo del proyecto) o en
 *   **solo lectura** (cualquier versión). Mientras se edita, cada 30 s se
 *   renueva el bloqueo y se guarda un borrador en el servidor.
 */
import { newOpenDocEvent } from '@compas-oscd/core';

import {
  api,
  apiText,
  ApiError,
  LockInfo,
  ProjectDetail,
  releaseLockOnExit,
  User,
} from './api.js';

export type Mode = 'checking' | 'local' | 'login' | 'ready' | 'unavailable';

export interface OpenProject {
  id: string;
  name: string;
  /** Versión sobre la que se está trabajando (la última al abrir). */
  base: number;
  /** Se está viendo una versión vieja (solo lectura). */
  viewing: number | null;
  editing: boolean;
  canEdit: boolean;
  canManage: boolean;
  access: ProjectDetail['access'];
  dirty: boolean;
  draftSavedAt: Date | null;
  lockLost: boolean;
  notice: string;
}

const HEARTBEAT_MS = 30000;

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>\n';

/** SCL mínimo para un proyecto vacío. */
export const EMPTY_SCL = `${XML_DECL}<SCL xmlns="http://www.iec.ch/61850/2003/SCL" version="2007" revision="B" release="4"><Header id="" version="1" revision="" toolID="DSB"/></SCL>`;

export function serializeDoc(doc: XMLDocument): string {
  const text = new XMLSerializer().serializeToString(doc);
  return text.startsWith('<?xml') ? text : XML_DECL + text;
}

class Session extends EventTarget {
  mode: Mode = 'checking';
  user: User | null = null;
  project: OpenProject | null = null;
  /** Se muestra el explorador de proyectos sobre la app. */
  browserOpen = true;
  error = '';
  /** Proyecto cuyo diálogo de permisos se debe abrir en el explorador. */
  shareRequest: string | null = null;
  /** El elemento `<open-scd>`. */
  host: (HTMLElement & { doc: XMLDocument | null; docName: string; editor: { past: unknown[]; future: unknown[] } }) | null = null;

  private timer: number | undefined;
  private busy = false;

  private emit() {
    this.dispatchEvent(new Event('change'));
  }

  get readOnly(): boolean {
    return !!this.project && (!this.project.editing || this.project.lockLost);
  }

  // ---------- usuario ----------

  async init(): Promise<void> {
    this.mode = 'checking';
    this.emit();
    try {
      const r = await api<{ user: User }>('GET', '/auth/me');
      this.user = r.user;
      this.mode = 'ready';
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) this.mode = 'login';
      else if (err.status === 0 || err.status === 404) this.mode = err.status === 0 ? 'unavailable' : 'local';
      else this.mode = 'unavailable';
      this.error = this.mode === 'unavailable' ? err.message : '';
    }
    this.emit();
  }

  async login(username: string, password: string): Promise<void> {
    const r = await api<{ user: User }>('POST', '/auth/login', { username, password });
    this.user = r.user;
    this.mode = 'ready';
    this.browserOpen = true;
    this.emit();
  }

  async logout(): Promise<void> {
    await this.closeProject(true);
    await api('POST', '/auth/logout').catch(() => undefined);
    this.user = null;
    this.mode = 'login';
    this.emit();
  }

  async changePassword(current: string, next: string): Promise<void> {
    await api('POST', '/auth/password', { current, next });
    if (this.user) this.user = { ...this.user, mustChange: false };
    this.emit();
  }

  // ---------- proyecto ----------

  private setDoc(text: string, name: string) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('El contenido del proyecto no es un XML válido.');
    const host = this.host;
    if (!host) throw new Error('La aplicación todavía no está lista.');
    host.editor.past = [];
    host.editor.future = [];
    host.dispatchEvent(newOpenDocEvent(doc, name));
  }

  /**
   * Abre un proyecto. Para editar toma el bloqueo; si otra persona lo tiene,
   * falla con su mensaje (ofrecer solo lectura).
   */
  async openProject(id: string, opts: { readOnly?: boolean; version?: number } = {}): Promise<void> {
    await this.closeProject(true);
    const { project: detail } = await api<{ project: ProjectDetail }>('GET', `/projects/${id}`);
    const wantEdit = detail.canEdit && !opts.readOnly && !opts.version;
    let notice = '';
    let text: string;
    let base = detail.head;
    let viewing: number | null = null;
    if (wantEdit) {
      await api<{ lock: LockInfo }>('POST', `/projects/${id}/lock`);
      try {
        const d = await apiText(`/projects/${id}/draft`);
        const draftBase = Number(d.headers.get('x-dsb-base') ?? 0);
        if (draftBase === detail.head) {
          text = d.text;
          notice = 'Se recuperó su borrador sin versionar.';
        } else {
          await api('DELETE', `/projects/${id}/draft`);
          notice = 'Su borrador era de una versión anterior y se descartó.';
          text = (await apiText(`/projects/${id}/content`)).text;
        }
      } catch (e) {
        if ((e as ApiError).status !== 404) throw e;
        text = detail.head ? (await apiText(`/projects/${id}/content`)).text : EMPTY_SCL;
      }
    } else {
      if (!detail.head) throw new Error('El proyecto todavía no tiene versiones.');
      const n = opts.version;
      text = (await apiText(`/projects/${id}/content${n ? `?version=${n}` : ''}`)).text;
      if (n) {
        viewing = n;
        base = n;
      }
    }
    try {
      this.setDoc(text, `${detail.name}.scd`);
    } catch (e) {
      if (wantEdit) await api('DELETE', `/projects/${id}/lock`).catch(() => undefined);
      throw e;
    }
    this.project = {
      id,
      name: detail.name,
      base,
      viewing,
      editing: wantEdit,
      canEdit: detail.canEdit,
      canManage: detail.canManage,
      access: detail.access,
      dirty: false,
      draftSavedAt: null,
      lockLost: false,
      notice,
    };
    this.browserOpen = false;
    this.startHeartbeat();
    this.emit();
  }

  /** Crea un proyecto con la primera versión (vacía o desde un archivo) y lo abre. */
  async createProject(input: { name: string; description: string; visibility: string; content?: string }): Promise<string> {
    const r = await api<{ id: string }>('POST', '/projects', { ...input, content: input.content ?? EMPTY_SCL, message: input.content ? 'Importado desde archivo' : 'Proyecto vacío' });
    return r.id;
  }

  noteEdit(): void {
    if (this.project && this.project.editing && !this.project.dirty) {
      this.project.dirty = true;
      this.emit();
    }
  }

  private startHeartbeat() {
    window.clearInterval(this.timer);
    if (!this.project?.editing) return;
    this.timer = window.setInterval(() => void this.heartbeat(), HEARTBEAT_MS);
  }

  /** Renueva el bloqueo y guarda el borrador si hay cambios. */
  async heartbeat(): Promise<void> {
    const p = this.project;
    if (!p || !p.editing || p.lockLost || this.busy) return;
    this.busy = true;
    try {
      await api('POST', `/projects/${p.id}/lock`);
      if (p.dirty && this.host?.doc) {
        await api('PUT', `/projects/${p.id}/draft`, { content: serializeDoc(this.host.doc), base: p.base });
        p.draftSavedAt = new Date();
        p.dirty = false;
      }
    } catch (e) {
      if ((e as ApiError).status === 409) {
        p.lockLost = true;
        p.notice = 'Perdió el bloqueo de edición: otra persona tomó el proyecto. Sus cambios no versionados se pueden descargar.';
      }
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  /** Sella una versión nueva con el contenido actual. */
  async createVersion(message: string): Promise<{ number: number; unchanged: boolean }> {
    const p = this.project;
    if (!p || !p.editing || !this.host?.doc) throw new Error('No hay un proyecto abierto para editar.');
    const r = await api<{ number: number; unchanged: boolean }>('POST', `/projects/${p.id}/versions`, { message, content: serializeDoc(this.host.doc), base: p.base });
    p.base = r.number;
    p.dirty = false;
    p.draftSavedAt = null;
    p.notice = r.unchanged ? 'No hay cambios respecto de la última versión.' : `Se creó la versión ${r.number}.`;
    this.emit();
    return r;
  }

  /** Restaura una versión anterior como versión nueva y recarga el editor. */
  async restoreVersion(n: number, message?: string): Promise<void> {
    const p = this.project;
    if (!p || !p.editing) throw new Error('Abra el proyecto para editar.');
    const r = await api<{ number: number }>('POST', `/projects/${p.id}/versions/${n}/restore`, { message });
    const id = p.id;
    await this.openProject(id);
    if (this.project) this.project.notice = `Se restauró la versión ${n} como versión ${r.number}.`;
    this.emit();
  }

  async closeProject(silent = false): Promise<void> {
    window.clearInterval(this.timer);
    const p = this.project;
    this.project = null;
    if (p?.editing && !p.lockLost) await api('DELETE', `/projects/${p.id}/lock`).catch(() => undefined);
    if (!silent) {
      if (this.host) {
        this.host.doc = null;
        this.host.docName = '';
        this.host.editor.past = [];
        this.host.editor.future = [];
      }
      this.browserOpen = true;
    }
    this.emit();
  }

  /** Al cerrar la pestaña: libera el bloqueo para no hacer esperar a los demás. */
  onPageHide(): void {
    const p = this.project;
    if (p?.editing && !p.lockLost) releaseLockOnExit(p.id);
  }

  requestShare(id: string): void {
    this.shareRequest = id;
    this.browserOpen = true;
    this.emit();
  }

  showBrowser(): void {
    this.browserOpen = true;
    this.emit();
  }

  hideBrowser(): void {
    this.browserOpen = false;
    this.emit();
  }
}

export const session = new Session();
