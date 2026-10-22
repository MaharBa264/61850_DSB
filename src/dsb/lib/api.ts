/**
 * Cliente del servidor DSB (`/api`, ver `server/`). La sesión viaja en una
 * cookie HttpOnly; el encabezado `x-dsb` es la defensa anti-CSRF del servidor.
 */

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface User {
  id: number;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
  active: boolean;
  mustChange: boolean;
}

export type Visibility = 'private' | 'shared' | 'public';
export type Access = 'admin' | 'owner' | 'editor' | 'viewer';

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  visibility: Visibility;
  owner: { id: number; username: string; displayName: string };
  createdAt: string;
  updatedAt: string;
  access: Access;
  canEdit: boolean;
  canManage: boolean;
  head: number;
  locked?: boolean;
  lockedByMe?: boolean;
}

export interface Member {
  userId: number;
  username: string;
  displayName: string;
  role: 'viewer' | 'editor';
}

export interface LockInfo {
  holderId: number;
  holder: string;
  mine: boolean;
  expiresAt: string;
}

export interface ProjectDetail extends ProjectSummary {
  members: Member[];
  lock: LockInfo | null;
}

export interface VersionInfo {
  number: number;
  parentNumber: number | null;
  message: string;
  createdAt: string;
  size: number;
  sha256: string;
  author: string;
  milestones: string[];
}

export interface Milestone {
  id: number;
  versionNumber: number;
  name: string;
  note: string;
  createdAt: string;
  author: string;
}

export interface AuditRow {
  id: number;
  at: string;
  username: string | null;
  action: string;
  projectId: string | null;
  detail: Record<string, unknown>;
}

async function raw(method: string, path: string, body?: unknown, keepalive = false): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      keepalive,
      headers: { 'x-dsb': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ApiError(0, 'No se pudo conectar con el servidor.');
  }
  if (!res.ok) {
    let message = `Error ${res.status}`;
    try {
      message = (await res.json()).error ?? message;
    } catch (e) {
      /* sin cuerpo JSON */
    }
    throw new ApiError(res.status, message);
  }
  return res;
}

/** Llamada con respuesta JSON. */
export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await raw(method, path, body);
  if (!(res.headers.get('content-type') ?? '').includes('json')) throw new ApiError(404, 'El servidor DSB no está disponible aquí.');
  return (await res.json()) as T;
}

/** Llamada con respuesta de texto (contenido SCL) y encabezados. */
export async function apiText(path: string): Promise<{ text: string; headers: Headers }> {
  const res = await raw('GET', path);
  return { text: await res.text(), headers: res.headers };
}

/** Libera el bloqueo aunque la pestaña se esté cerrando. */
export function releaseLockOnExit(projectId: string): void {
  void raw('DELETE', `/projects/${projectId}/lock`, undefined, true).catch(() => undefined);
}
