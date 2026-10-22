import { pluginTag } from '@compas-oscd/open-scd/dist/plugin-tag.js';

import { default as GooseGraph } from './editors/GooseGraph.js';
import { default as ProjectEditor } from './editors/ProjectEditor.js';

/**
 * Registro de plugins propios de DSB (61850_DSB).
 *
 * Se mantiene separado de `compas-plugins.ts` y `oscd-plugins.ts` para que las
 * actualizaciones de CoMPAS (upstream) no generen conflictos de merge.
 */
export enum DsbPluginSrc {
  Project = '/dsb-plugins/editors/ProjectEditor.js',
  GooseGraph = '/dsb-plugins/editors/GooseGraph.js',
}

const plugins: { [key in DsbPluginSrc]: CustomElementConstructor } = {
  [DsbPluginSrc.Project]: ProjectEditor,
  [DsbPluginSrc.GooseGraph]: GooseGraph,
};

export function registerDsbPlugins() {
  for (const [src, pluginConstructor] of Object.entries(plugins)) {
    customElements.define(pluginTag(src), pluginConstructor);
  }
}
