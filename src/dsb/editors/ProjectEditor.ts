import '@material/mwc-button';
import '@material/mwc-formfield';
import '@material/mwc-list/mwc-list-item';
import '@material/mwc-select';
import '@material/mwc-switch';
import '@material/mwc-textfield';
import {
  css,
  html,
  LitElement,
  property,
  state,
  TemplateResult,
} from 'lit-element';

import { newEditEventV2 } from '@compas-oscd/core';

import {
  createLineBay,
  createProjectPrivate,
  createSubstation,
  createVoltageLevel,
  DSB_PRIVATE_TYPE,
  getProjectInfo,
  getSubstation,
  listBusbars,
  missingRootNamespaces,
  suggestColumn,
  suggestVoltageLevelRow,
  validateKV,
  validateName,
  XMLNS_NS,
} from '../lib/project-model.js';

/** Edits mínimos que agregan las declaraciones de namespace faltantes. */
function namespaceEdits(doc: XMLDocument) {
  const missing = missingRootNamespaces(doc);
  if (!Object.keys(missing).length) return [];
  return [
    {
      element: doc.documentElement,
      attributes: {},
      attributesNS: { [XMLNS_NS]: missing },
    },
  ];
}

/**
 * DSB — Proyecto y unifilar por plantillas (etapas A y B).
 *
 * Datos del proyecto (nombre obligatorio, ubicación, descripción), niveles de
 * tensión con sus barras, y alta de campos desde plantilla. El resultado es
 * SCL estándar: el editor "Diagrama unifilar" lo dibuja y permite editarlo.
 */
export default class DsbProjectPlugin extends LitElement {
  @property({ attribute: false }) doc!: XMLDocument;
  @property({ type: Number }) editCount = -1;

  @state() private name = '';
  @state() private description = '';
  @state() private location = '';
  @state() private vlName = '';
  @state() private vlKV = '';
  @state() private vlBusbars = '2';
  @state() private bayVl = '';
  @state() private bayName = '';
  @state() private bayVT = false;
  @state() private message = '';
  @state() private touched = false;

  private emit(edit: Parameters<typeof newEditEventV2>[0], title: string) {
    this.dispatchEvent(newEditEventV2(edit, { title }));
  }

  protected updated(changed: Map<string | number | symbol, unknown>) {
    if (changed.has('doc') || changed.has('editCount')) this.loadFromDoc();
  }

  private loadFromDoc() {
    if (!this.doc) return;
    const info = getProjectInfo(this.doc);
    this.name = info.name;
    this.description = info.description;
    this.location = info.location;
    const vls = this.voltageLevels;
    if (!vls.find(v => v.getAttribute('name') === this.bayVl))
      this.bayVl = vls[0]?.getAttribute('name') ?? '';
  }

  private get substation(): Element | null {
    return this.doc ? getSubstation(this.doc) : null;
  }

  private get voltageLevels(): Element[] {
    return Array.from(this.substation?.querySelectorAll(':scope > VoltageLevel') ?? []);
  }

  private saveProject() {
    this.touched = true;
    const err = validateName(this.name);
    if (err) return;
    const info = {
      name: this.name.trim(),
      description: this.description,
      location: this.location,
    };
    const sub = this.substation;
    const edits: Parameters<typeof newEditEventV2>[0][] = [
      ...namespaceEdits(this.doc),
    ];
    if (!sub) {
      edits.push({
        parent: this.doc.documentElement,
        node: createSubstation(this.doc, info),
        reference: this.doc.querySelector(':root > IED, :root > Communication, :root > DataTypeTemplates'),
      });
    } else {
      edits.push({
        element: sub,
        attributes: {
          name: info.name,
          desc: info.description.trim() || null,
        },
        attributesNS: {},
      });
      const priv = Array.from(sub.children).find(
        c => c.tagName === 'Private' && c.getAttribute('type') === DSB_PRIVATE_TYPE
      );
      if (priv) edits.push({ node: priv });
      if (info.location.trim())
        edits.push({
          parent: sub,
          node: createProjectPrivate(this.doc, info.location.trim()),
          reference: sub.firstElementChild && sub.firstElementChild.tagName !== 'Private'
            ? sub.firstElementChild
            : null,
        });
    }
    this.emit(edits, `Proyecto "${info.name}"`);
    this.message = 'Proyecto guardado.';
  }

  private addVoltageLevel() {
    const sub = this.substation;
    if (!sub) return;
    const kV = parseFloat(this.vlKV.replace(',', '.'));
    if (validateName(this.vlName) || validateKV(kV)) {
      this.touched = true;
      return;
    }
    if (this.voltageLevels.some(v => v.getAttribute('name') === this.vlName.trim())) {
      this.message = `Ya existe el nivel de tensión "${this.vlName.trim()}".`;
      return;
    }
    const vl = createVoltageLevel(
      this.doc,
      sub.getAttribute('name') ?? '',
      { name: this.vlName, kV, busbars: parseInt(this.vlBusbars, 10) },
      suggestVoltageLevelRow(sub)
    );
    this.emit(
      [
        ...namespaceEdits(this.doc),
        { parent: sub, node: vl, reference: null },
      ],
      `Nivel de tensión ${this.vlName.trim()}`
    );
    this.bayVl = this.vlName.trim();
    this.vlName = '';
    this.vlKV = '';
    this.touched = false;
    this.message = 'Nivel de tensión agregado.';
  }

  private addLineBay() {
    const sub = this.substation;
    const vl = this.voltageLevels.find(v => v.getAttribute('name') === this.bayVl);
    if (!sub || !vl) return;
    if (validateName(this.bayName)) {
      this.touched = true;
      return;
    }
    const name = this.bayName.trim();
    if (Array.from(vl.querySelectorAll(':scope > Bay')).some(b => b.getAttribute('name') === name)) {
      this.message = `Ya existe un campo "${name}" en ${this.bayVl}.`;
      return;
    }
    const busbars = listBusbars(vl);
    if (!busbars.length) {
      this.message = 'El nivel de tensión no tiene barras: agregue al menos una.';
      return;
    }
    const bay = createLineBay(
      this.doc,
      { substation: sub.getAttribute('name') ?? '', voltageLevel: this.bayVl },
      { name, busbars, column: suggestColumn(vl), withVT: this.bayVT }
    );
    this.emit(
      [...namespaceEdits(this.doc), { parent: vl, node: bay, reference: null }],
      `Campo de línea ${name}`
    );
    this.bayName = '';
    this.touched = false;
    this.message = `Campo "${name}" agregado a ${this.bayVl}. Véalo en la pestaña "Diagrama unifilar".`;
  }

  private voltage(vl: Element): string {
    return vl.querySelector(':scope > Voltage')?.textContent ?? '?';
  }

  private nameError(v: string): string {
    return this.touched ? validateName(v) ?? '' : '';
  }

  render(): TemplateResult {
    if (!this.doc) return html``;
    const sub = this.substation;
    const vls = this.voltageLevels;
    return html`
      <div class="wrap">
        <section>
          <h2>Proyecto</h2>
          <mwc-textfield
            label="Nombre (obligatorio)"
            required
            .value=${this.name}
            .validationMessage=${this.nameError(this.name)}
            @input=${(e: Event) => (this.name = (e.target as HTMLInputElement).value)}
          ></mwc-textfield>
          <mwc-textfield
            label="Ubicación"
            .value=${this.location}
            @input=${(e: Event) => (this.location = (e.target as HTMLInputElement).value)}
          ></mwc-textfield>
          <mwc-textfield
            label="Descripción"
            .value=${this.description}
            @input=${(e: Event) => (this.description = (e.target as HTMLInputElement).value)}
          ></mwc-textfield>
          ${this.touched && validateName(this.name)
            ? html`<p class="err">${validateName(this.name)}</p>`
            : ''}
          <mwc-button
            raised
            label=${sub ? 'Guardar proyecto' : 'Crear proyecto'}
            @click=${this.saveProject}
          ></mwc-button>
        </section>

        ${sub
          ? html`
              <section>
                <h2>Niveles de tensión</h2>
                ${vls.length
                  ? html`<ul>
                      ${vls.map(
                        v => html`<li>
                          <b>${v.getAttribute('name')}</b> — ${this.voltage(v)} kV —
                          barras: ${listBusbars(v).join(', ') || 'ninguna'} — campos:
                          ${v.querySelectorAll(':scope > Bay').length -
                          listBusbars(v).length}
                        </li>`
                      )}
                    </ul>`
                  : html`<p class="hint">Todavía no hay niveles de tensión.</p>`}
                <div class="row">
                  <mwc-textfield
                    label="Nombre (ej. J1)"
                    .value=${this.vlName}
                    @input=${(e: Event) => (this.vlName = (e.target as HTMLInputElement).value)}
                  ></mwc-textfield>
                  <mwc-textfield
                    label="Tensión nominal (kV)"
                    .value=${this.vlKV}
                    @input=${(e: Event) => (this.vlKV = (e.target as HTMLInputElement).value)}
                  ></mwc-textfield>
                  <mwc-select
                    label="Barras"
                    .value=${this.vlBusbars}
                    @selected=${(e: CustomEvent) => {
                      const v = (e.target as HTMLInputElement).value;
                      if (v) this.vlBusbars = v;
                    }}
                  >
                    <mwc-list-item value="1" selected>Simple barra</mwc-list-item>
                    <mwc-list-item value="2">Doble barra</mwc-list-item>
                  </mwc-select>
                  <mwc-button outlined label="Agregar nivel" @click=${this.addVoltageLevel}></mwc-button>
                </div>
                ${this.touched && (validateName(this.vlName) || validateKV(parseFloat(this.vlKV.replace(',', '.'))))
                  ? html`<p class="err">
                      ${validateName(this.vlName) ||
                      validateKV(parseFloat(this.vlKV.replace(',', '.')))}
                    </p>`
                  : ''}
              </section>

              <section>
                <h2>Agregar campo desde plantilla</h2>
                ${vls.length
                  ? html`
                      <div class="row">
                        <mwc-select
                          label="Nivel de tensión"
                          .value=${this.bayVl}
                          @selected=${(e: CustomEvent) => {
                            const v = (e.target as HTMLInputElement).value;
                            if (v) this.bayVl = v;
                          }}
                        >
                          ${vls.map(
                            v => html`<mwc-list-item
                              value=${v.getAttribute('name')!}
                              ?selected=${v.getAttribute('name') === this.bayVl}
                              >${v.getAttribute('name')} (${this.voltage(v)} kV)</mwc-list-item
                            >`
                          )}
                        </mwc-select>
                        <mwc-select label="Plantilla" value="linea">
                          <mwc-list-item value="linea" selected>Campo de línea</mwc-list-item>
                        </mwc-select>
                        <mwc-textfield
                          label="Nombre del campo (ej. Q01)"
                          .value=${this.bayName}
                          @input=${(e: Event) => (this.bayName = (e.target as HTMLInputElement).value)}
                        ></mwc-textfield>
                        <mwc-formfield label="Con transformador de tensión">
                          <mwc-switch
                            ?selected=${this.bayVT}
                            @click=${() => (this.bayVT = !this.bayVT)}
                          ></mwc-switch>
                        </mwc-formfield>
                        <mwc-button outlined label="Agregar campo" @click=${this.addLineBay}></mwc-button>
                      </div>
                      ${this.touched && validateName(this.bayName)
                        ? html`<p class="err">${validateName(this.bayName)}</p>`
                        : ''}
                    `
                  : html`<p class="hint">Primero agregue un nivel de tensión.</p>`}
              </section>
            `
          : html`<p class="hint">Cree el proyecto (nombre obligatorio) para continuar.</p>`}
        ${this.message ? html`<p class="msg">${this.message}</p>` : ''}
      </div>
    `;
  }

  static styles = css`
    .wrap {
      max-width: 900px;
      margin: 0 auto;
      padding: 16px;
      font-family: var(--mdc-typography-font-family, Roboto, sans-serif);
    }
    section {
      background: var(--mdc-theme-surface, #fff);
      border-radius: 4px;
      padding: 8px 16px 16px;
      margin-bottom: 16px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }
    h2 {
      font-weight: 400;
      font-size: 1.2em;
    }
    mwc-textfield,
    mwc-select {
      display: block;
      margin: 8px 0;
      max-width: 420px;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      align-items: center;
    }
    .row mwc-textfield,
    .row mwc-select {
      margin: 0;
      width: 220px;
    }
    .err {
      color: var(--mdc-theme-error, #b00020);
    }
    .hint {
      opacity: 0.7;
    }
    .msg {
      color: var(--mdc-theme-primary, #6200ee);
    }
  `;
}
