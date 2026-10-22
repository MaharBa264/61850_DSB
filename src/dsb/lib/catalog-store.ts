/**
 * Persistencia del catálogo en el navegador (localStorage) y archivo JSON.
 * El catálogo es dato del usuario: no se versiona en el repositorio. Los
 * modelos usados además viajan dentro del proyecto (ver `snapshotEdits`).
 */
import { Catalog, catalogFromJson, catalogToJson, emptyCatalog } from './catalog-model.js';

const KEY = 'dsb-catalog';

export function loadCatalog(): Catalog {
  try {
    const t = localStorage.getItem(KEY);
    return t ? catalogFromJson(t) : emptyCatalog();
  } catch (e) {
    return emptyCatalog();
  }
}

/** `false` si el navegador no permite guardar. */
export function saveCatalog(c: Catalog): boolean {
  try {
    localStorage.setItem(KEY, catalogToJson(c));
    return true;
  } catch (e) {
    return false;
  }
}
