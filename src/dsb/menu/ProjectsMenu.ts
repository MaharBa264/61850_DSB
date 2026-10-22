import { html, LitElement, TemplateResult } from 'lit-element';

import { session } from '../lib/session.js';

/** Entrada de menú "Proyectos": vuelve al explorador de proyectos del servidor. */
export default class DsbProjectsMenu extends LitElement {
  async run(): Promise<void> {
    session.showBrowser();
  }

  render(): TemplateResult {
    return html``;
  }
}
