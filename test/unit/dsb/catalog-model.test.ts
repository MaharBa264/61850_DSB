import { expect } from '@open-wc/testing';

import {
  addIedEdit,
  bom,
  catalogFromJson,
  catalogToJson,
  checkHost,
  classesOf,
  estimateIo,
  hostsOf,
  listIeds,
  modelsFromIcd,
  needOf,
  newIedModel,
  normalizeIed,
  readSnapshot,
  snapshotEdits,
  suggestIedName,
  suggestModels,
  toBomCsv,
  validateIedModel,
  validateIedName,
  IedModel,
} from '../../../src/dsb/lib/catalog-model.js';
import { createBay, createSubstation, createVoltageLevel, listBusbars, suggestColumn } from '../../../src/dsb/lib/project-model.js';
import { bayPackageEdits, LnAllocator } from '../../../src/dsb/lib/functions-model.js';

const SCL = 'http://www.iec.ch/61850/2003/SCL';
const parse = (s: string) => new DOMParser().parseFromString(s, 'application/xml');

function apply(e: any): void {
  if (Array.isArray(e)) return e.forEach(apply);
  if ('parent' in e) return void e.parent.insertBefore(e.node, e.reference);
  if ('node' in e) return void e.node.parentNode.removeChild(e.node);
}

function project() {
  const doc = parse(`<SCL xmlns="${SCL}" version="2007" revision="B" release="4"><Header id="x"/></SCL>`);
  const sub = createSubstation(doc, { name: 'ET', location: '', description: '' });
  doc.documentElement.appendChild(sub);
  const vl = createVoltageLevel(doc, 'ET', { name: 'J1', kV: 132, busbars: 1 }, 1);
  sub.appendChild(vl);
  const bay = createBay(doc, { substation: 'ET', voltageLevel: 'J1' }, { name: 'L1', busbars: listBusbars(vl), column: suggestColumn(vl), template: 'linea' });
  vl.appendChild(bay);
  apply(bayPackageEdits(doc, bay, 132, new LnAllocator(sub)));
  return { doc, sub, vl, bay };
}

const ied = (over: Partial<IedModel>): IedModel =>
  normalizeIed({ ...newIedModel(), manufacturer: 'ACME', model: 'P1', ...over });

describe('catalog-model', () => {
  it('normaliza el id y valida', () => {
    const m = ied({});
    expect(m.id).to.equal('acme-p1');
    expect(validateIedModel(m)).to.deep.equal([]);
    expect(validateIedModel(ied({ manufacturer: ' ' } as any)).length).to.be.greaterThan(0);
    expect(validateIedModel(ied({ digitalIn: -1 })).length).to.equal(1);
    expect(validateIedModel(ied({ capacity: { ptoc: 1 } })).length).to.equal(1);
  });

  it('importa un ICD contando LN por clase', () => {
    const icd = parse(`<SCL xmlns="${SCL}"><IED name="X" manufacturer="Siemens" type="7SJ85"><AccessPoint name="A"><Server>
      <LDevice inst="LD0"><LN0 lnClass="LLN0" lnType="a"><GSEControl name="g"/><ReportControl name="r"/></LN0><LN lnClass="LPHD" inst="1" lnType="b"/>
      <LN lnClass="PTOC" inst="1" lnType="c"/><LN lnClass="PTOC" inst="2" lnType="c"/><LN lnClass="XCBR" inst="1" lnType="d"/></LDevice>
      </Server></AccessPoint></IED></SCL>`);
    const [m] = modelsFromIcd(icd);
    expect(m.manufacturer).to.equal('Siemens');
    expect(m.model).to.equal('7SJ85');
    expect(m.capacity).to.deep.equal({ PTOC: 2, XCBR: 1 });
    expect(m.protocols).to.deep.equal(['GOOSE', 'MMS']);
    expect(m.source).to.equal('icd');
  });

  it('exporta e importa JSON descartando entradas inválidas', () => {
    const c = { ieds: [ied({ capacity: { PTOC: 2 } }), { ...ied({}), model: '' } as any], switches: [] };
    const back = catalogFromJson(catalogToJson(c));
    expect(back.ieds.length).to.equal(1);
    expect(back.ieds[0].capacity.PTOC).to.equal(2);
    expect(() => catalogFromJson('{"a":1}')).to.throw();
  });

  it('estima E/S y verifica capacidad de un campo de línea', () => {
    const { sub, bay } = project();
    const need = needOf(bay);
    expect(need.classes.PDIS).to.equal(1);
    expect(need.classes.XCBR).to.equal(1);
    expect(estimateIo(need.classes).digitalIn).to.equal(need.digitalIn);
    expect(need.digitalIn).to.be.greaterThan(0);
    expect(hostsOf(sub)).to.include(bay);

    expect(checkHost(need, []).status).to.equal('none');
    const small = ied({ capacity: { PTOC: 1 } });
    const r = checkHost(need, [small]);
    expect(r.status).to.equal('short');
    expect(r.rows.find(x => x.lnClass === 'PDIS')!.ok).to.equal(false);

    const full = ied({
      model: 'Full',
      capacity: Object.fromEntries(Object.entries(need.classes).map(([k, v]) => [k, v])),
      digitalIn: need.digitalIn,
      digitalOut: need.digitalOut,
      analogIn: need.analogIn,
      price: 100,
    });
    expect(checkHost(need, [full]).status).to.equal('ok');
    // dos IED se suman
    const half = (k: 'a' | 'b') =>
      ied({
        model: 'H' + k,
        capacity: Object.fromEntries(Object.entries(need.classes).map(([c, v]) => [c, k === 'a' ? Math.ceil(v / 2) : Math.floor(v / 2) + 1])),
        digitalIn: need.digitalIn,
        digitalOut: need.digitalOut,
        analogIn: need.analogIn,
      });
    expect(checkHost(need, [half('a'), half('b')]).status).to.equal('ok');
    const cheap = ied({ ...full, model: 'Cheap', id: '', price: 50 });
    expect(suggestModels(need, [small, full, normalizeIed(cheap)]).map(m => m.model)).to.deep.equal(['Cheap', 'Full']);
  });

  it('asigna IED al campo, valida nombres y guarda el modelo en el proyecto', () => {
    const { doc, sub, bay } = project();
    const m = ied({ capacity: { PTOC: 2 }, price: 10 });
    const name = suggestIedName(sub, bay, 'Protección y control');
    expect(name).to.equal('L1_PC');
    expect(validateIedName(sub, name)).to.equal(null);
    expect(validateIedName(sub, '1x')).to.not.equal(null);
    apply([addIedEdit(doc, bay, name, m.id, 'Protección y control'), ...snapshotEdits(doc, sub, [m])]);
    expect(listIeds(bay).map(i => [i.name, i.modelId])).to.deep.equal([['L1_PC', 'acme-p1']]);
    expect(validateIedName(sub, name)).to.contain('Ya existe');
    expect(suggestIedName(sub, bay, 'Protección y control')).to.equal('L1_PC2');
    // las funciones siguen igual de contadas
    expect(classesOf(bay).PDIS).to.equal(1);
    // snapshot ida y vuelta
    expect(readSnapshot(sub)).to.deep.equal([m]);
    apply(snapshotEdits(doc, sub, [m, ied({ model: 'P2' })]));
    expect(readSnapshot(sub).length).to.equal(2);
    expect(sub.querySelectorAll(':scope > Private[type="DSB-Catalog"]').length).to.equal(1);
    // el Private va antes que los hijos que no son Private/Text
    expect(Array.from(bay.children).findIndex(c => c.getAttribute('type') === 'DSB-Ied')).to.be.lessThan(
      Array.from(bay.children).findIndex(c => c.tagName === 'LNode')
    );
  });

  it('lista de materiales', () => {
    const { doc, sub, bay } = project();
    const m = ied({ price: 10 });
    apply([addIedEdit(doc, bay, 'A', m.id, 'Protección'), addIedEdit(doc, bay, 'B', m.id, 'Control')]);
    const lines = bom(sub, [m]);
    expect(lines.length).to.equal(1);
    expect(lines[0].quantity).to.equal(2);
    const csv = toBomCsv(lines);
    expect(csv).to.contain('ACME;P1;2;10;20;A, B');
  });
});
