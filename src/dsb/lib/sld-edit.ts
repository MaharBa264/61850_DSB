/**
 * Ediciones del unifilar como `EditV2` (deshacer/rehacer del núcleo).
 * Funciones puras: construyen las ediciones, no las aplican.
 */
import type { EditV2, RemoveV2, SetAttributesV2 } from '@compas-oscd/core';

import { SXY_NS } from './project-model.js';
import { relXY, unitOf } from './sld-model.js';

/**
 * Mueve un elemento `dx`/`dy` celdas (coordenadas `sxy` relativas al padre). En
 * archivos con otra unidad (ABB: ~480 por celda) el desplazamiento se convierte
 * a las unidades del archivo, para no mezclar escalas.
 */
export function moveEdit(el: Element, dx: number, dy: number): SetAttributesV2 {
  const r = relXY(el);
  const u = unitOf(el);
  return {
    element: el,
    attributes: {},
    attributesNS: {
      [SXY_NS]: { 'sxy:x': String(Math.round(r.x + dx * u)), 'sxy:y': String(Math.round(r.y + dy * u)) },
    },
  };
}

export function removeEdit(el: Element): RemoveV2 {
  return { node: el };
}

/**
 * Renombra un elemento. Para una subestación, un nivel de tensión o un campo
 * (o barra) actualiza también las rutas `pathName` de los ConnectivityNode que
 * quedan debajo y todos los Terminal que los referencian (`connectivityNode` y
 * `substationName`/`voltageLevelName`/`bayName`), para no romper las conexiones.
 */
export function renameEdits(el: Element, newName: string): EditV2 {
  const name = newName.trim();
  const edits: EditV2[] = [{ element: el, attributes: { name }, attributesNS: {} }];
  const chain: Element[] = [];
  for (let n: Element | null = el; n && n.tagName !== 'SCL'; n = n.parentElement) chain.unshift(n);
  const kinds = ['Substation', 'VoltageLevel', 'Bay'];
  if (chain.length > 3 || chain.some((c, i) => c.tagName !== kinds[i])) return edits;

  const old = el.getAttribute('name') ?? '';
  const names = chain.map(c => c.getAttribute('name') ?? '');
  const oldPrefix = `${names.join('/')}/`;
  const newPrefix = `${[...names.slice(0, -1), name].join('/')}/`;
  const nameAttr = ['substationName', 'voltageLevelName', 'bayName'][chain.length - 1];

  for (const cn of Array.from(el.querySelectorAll('ConnectivityNode'))) {
    const path = cn.getAttribute('pathName') ?? '';
    if (path.startsWith(oldPrefix))
      edits.push({ element: cn, attributes: { pathName: newPrefix + path.slice(oldPrefix.length) }, attributesNS: {} });
  }
  for (const t of Array.from(el.ownerDocument.querySelectorAll('Terminal'))) {
    const ref = t.getAttribute('connectivityNode') ?? '';
    if (!ref.startsWith(oldPrefix)) continue;
    const attrs: Record<string, string> = { connectivityNode: newPrefix + ref.slice(oldPrefix.length) };
    if (t.getAttribute(nameAttr) === old) attrs[nameAttr] = name;
    edits.push({ element: t, attributes: attrs, attributesNS: {} });
  }
  return edits;
}

/** Fija la tensión nominal (kV) de un nivel de tensión; crea el `Voltage` si falta. */
export function voltageEdits(doc: XMLDocument, vl: Element, kV: number): EditV2 {
  const v = vl.querySelector(':scope > Voltage');
  if (v)
    return [
      { element: v, attributes: { unit: 'V', multiplier: 'k' }, attributesNS: {} },
      { element: v, textContent: String(kV) },
    ];
  const node = doc.createElementNS(vl.namespaceURI, 'Voltage');
  node.setAttribute('unit', 'V');
  node.setAttribute('multiplier', 'k');
  node.textContent = String(kV);
  // Voltage va después de los Private/Text y antes de los campos
  const ref = Array.from(vl.children).find(c => c.tagName !== 'Private' && c.tagName !== 'Text') ?? null;
  return { parent: vl, node, reference: ref };
}
