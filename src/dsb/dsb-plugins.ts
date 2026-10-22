import { pluginTag } from '@compas-oscd/open-scd/dist/plugin-tag.js';

import { default as CatalogEditor } from './editors/CatalogEditor.js';
import { default as FunctionsEditor } from './editors/FunctionsEditor.js';
import { default as GooseGraph } from './editors/GooseGraph.js';
import { default as ProjectEditor } from './editors/ProjectEditor.js';
import { default as SldEditor } from './editors/SldEditor.js';

/**
 * Registro de plugins propios de DSB (61850_DSB).
 *
 * Se mantiene separado de `compas-plugins.ts` y `oscd-plugins.ts` para que las
 * actualizaciones de CoMPAS (upstream) no generen conflictos de merge.
 */
export enum DsbPluginSrc {
  Project = '/dsb-plugins/editors/ProjectEditor.js',
  Sld = '/dsb-plugins/editors/SldEditor.js',
  Functions = '/dsb-plugins/editors/FunctionsEditor.js',
  Catalog = '/dsb-plugins/editors/CatalogEditor.js',
  GooseGraph = '/dsb-plugins/editors/GooseGraph.js',
}

const plugins: { [key in DsbPluginSrc]: CustomElementConstructor } = {
  [DsbPluginSrc.Project]: ProjectEditor,
  [DsbPluginSrc.Sld]: SldEditor,
  [DsbPluginSrc.Functions]: FunctionsEditor,
  [DsbPluginSrc.Catalog]: CatalogEditor,
  [DsbPluginSrc.GooseGraph]: GooseGraph,
};

export function registerDsbPlugins() {
  for (const [src, pluginConstructor] of Object.entries(plugins)) {
    customElements.define(pluginTag(src), pluginConstructor);
  }
}
