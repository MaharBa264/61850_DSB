/**
 * Ediciones del unifilar como `EditV2` (deshacer/rehacer del núcleo).
 * Funciones puras: construyen las ediciones, no las aplican.
 */
import type { EditV2, RemoveV2, SetAttributesV2 } from '@compas-oscd/core';

import { SXY_NS } from './project-model.js';
import { relXY } from './sld-model.js';

/** Mueve un elemento `dx`/`dy` celdas (coordenadas `sxy` relativas al padre). */
export function moveEdit(el: Element, dx: number, dy: number): SetAttributesV2 {
  const r = relXY(el);
  return {
    element: el,
    attributes: {},
    attributesNS: {
      [SXY_NS]: { 'sxy:x': String(r.x + dx), 'sxy:y': String(r.y + dy) },
    },
  };
}

export function removeEdit(el: Element): RemoveV2 {
  return { node: el };
}

/**
 * Renombra un elemento. Para un `Bay` (o barra) actualiza también las rutas
 * `pathName` de sus ConnectivityNode y todos los Terminal que los referencian,
 * para no romper las conexiones.
 */
export function renameEdits(el: Element, newName: string): EditV2 {
  const name = newName.trim();
  const edits: EditV2[] = [{ element: el, attributes: { name }, attributesNS: {} }];
  if (el.tagName !== 'Bay') return edits;

  const old = el.getAttribute('name') ?? '';
  const vl = el.parentElement;
  const sub = vl?.parentElement;
  if (!vl || !sub) return edits;
  const subName = sub.getAttribute('name') ?? '';
  const vlName = vl.getAttribute('name') ?? '';
  const oldPrefix = `${subName}/${vlName}/${old}/`;
  const newPrefix = `${subName}/${vlName}/${name}/`;

  for (const cn of Array.from(el.querySelectorAll(':scope > ConnectivityNode')))
    edits.push({
      element: cn,
      attributes: { pathName: `${newPrefix}${cn.getAttribute('name')}` },
      attributesNS: {},
    });
  for (const t of Array.from(sub.ownerDocument.querySelectorAll('Terminal'))) {
    const ref = t.getAttribute('connectivityNode') ?? '';
    if (!ref.startsWith(oldPrefix)) continue;
    const attrs: Record<string, string> = {
      connectivityNode: newPrefix + ref.slice(oldPrefix.length),
    };
    if (t.getAttribute('bayName') === old) attrs.bayName = name;
    edits.push({ element: t, attributes: attrs, attributesNS: {} });
  }
  return edits;
}
