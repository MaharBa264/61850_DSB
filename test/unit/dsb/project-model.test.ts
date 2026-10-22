import { expect } from '@open-wc/testing';

import {
  createLineBay,
  createSubstation,
  createVoltageLevel,
  getProjectInfo,
  listBusbars,
  missingRootNamespaces,
  suggestColumn,
  suggestVoltageLevelRow,
  validateKV,
  validateName,
  SXY_NS,
} from '../../../src/dsb/lib/project-model.js';

const EMPTY =
  '<SCL xmlns="http://www.iec.ch/61850/2003/SCL" version="2007" revision="B" release="4"><Header id="t"/></SCL>';

function newDoc(): XMLDocument {
  return new DOMParser().parseFromString(EMPTY, 'application/xml');
}

function project(busbars: number) {
  const doc = newDoc();
  const sub = createSubstation(doc, {
    name: 'ETSL',
    description: 'Estación transformadora',
    location: 'San Luis',
  });
  doc.documentElement.appendChild(sub);
  const vl = createVoltageLevel(doc, 'ETSL', { name: 'J1', kV: 132, busbars }, 1);
  sub.appendChild(vl);
  return { doc, sub, vl };
}

describe('DSB project-model', () => {
  it('valida nombre obligatorio y tensión', () => {
    expect(validateName('  ')).to.be.a('string');
    expect(validateName('a/b')).to.be.a('string');
    expect(validateName('ETSL')).to.equal(null);
    expect(validateKV(0)).to.be.a('string');
    expect(validateKV(NaN)).to.be.a('string');
    expect(validateKV(13.2)).to.equal(null);
  });

  it('crea subestación con descripción y ubicación recuperables', () => {
    const { doc } = project(1);
    expect(getProjectInfo(doc)).to.deep.equal({
      name: 'ETSL',
      description: 'Estación transformadora',
      location: 'San Luis',
    });
  });

  it('crea nivel de tensión con barras y tensión en kV', () => {
    const { vl } = project(2);
    expect(vl.querySelector('Voltage')?.textContent).to.equal('132');
    expect(vl.querySelector('Voltage')?.getAttribute('multiplier')).to.equal('k');
    expect(listBusbars(vl)).to.deep.equal(['BB1', 'BB2']);
  });

  it('campo de línea de doble barra: equipos y tipos esperados', () => {
    const { doc, vl } = project(2);
    const bay = createLineBay(
      doc,
      { substation: 'ETSL', voltageLevel: 'J1' },
      { name: 'L1', busbars: listBusbars(vl), column: 1 }
    );
    const eq = Array.from(bay.querySelectorAll('ConductingEquipment')).map(
      e => `${e.getAttribute('name')}:${e.getAttribute('type')}`
    );
    expect(eq).to.deep.equal([
      'QB1:DIS',
      'QB2:DIS',
      'QA1:CBR',
      'TC1:CTR',
      'QB9:DIS',
      'QC9:ERS',
    ]);
  });

  it('simple barra: un solo seccionador de barra; con TV agrega VTR', () => {
    const { doc, vl } = project(1);
    const bay = createLineBay(
      doc,
      { substation: 'ETSL', voltageLevel: 'J1' },
      { name: 'L1', busbars: listBusbars(vl), column: 1, withVT: true }
    );
    expect(bay.querySelectorAll('ConductingEquipment[type="DIS"]')).to.have.length(2);
    expect(bay.querySelector('ConductingEquipment[type="VTR"]')).to.not.equal(null);
  });

  it('cada Terminal apunta a un ConnectivityNode existente', () => {
    const { doc, vl } = project(2);
    const bay = createLineBay(
      doc,
      { substation: 'ETSL', voltageLevel: 'J1' },
      { name: 'L1', busbars: listBusbars(vl), column: 1 }
    );
    vl.appendChild(bay);
    const paths = new Set(
      Array.from(doc.querySelectorAll('ConnectivityNode')).map(c => c.getAttribute('pathName'))
    );
    const terms = Array.from(doc.querySelectorAll('Terminal'));
    expect(terms.length).to.be.greaterThan(0);
    for (const t of terms) expect(paths.has(t.getAttribute('connectivityNode'))).to.be.true;
  });

  it('los seccionadores de barra conectan a la barra correcta', () => {
    const { doc, vl } = project(2);
    const bay = createLineBay(
      doc,
      { substation: 'ETSL', voltageLevel: 'J1' },
      { name: 'L1', busbars: ['BB1', 'BB2'], column: 1 }
    );
    const t = (n: string) =>
      bay.querySelector(`ConductingEquipment[name="${n}"] Terminal[name="T1"]`)?.getAttribute('connectivityNode');
    expect(t('QB1')).to.equal('ETSL/J1/BB1/L1');
    expect(t('QB2')).to.equal('ETSL/J1/BB2/L1');
    vl.appendChild(bay);
  });

  it('los campos sucesivos no se superponen y llevan coordenadas sxy', () => {
    const { doc, vl } = project(2);
    const ctx = { substation: 'ETSL', voltageLevel: 'J1' };
    const b1 = createLineBay(doc, ctx, { name: 'L1', busbars: ['BB1', 'BB2'], column: suggestColumn(vl) });
    vl.appendChild(b1);
    const c2 = suggestColumn(vl);
    expect(c2).to.be.greaterThan(parseInt(b1.getAttributeNS(SXY_NS, 'x')!, 10));
    expect(b1.getAttributeNS(SXY_NS, 'y')).to.equal('2');
  });

  it('niveles de tensión sucesivos se apilan', () => {
    const { sub } = project(1);
    expect(suggestVoltageLevelRow(sub)).to.be.greaterThan(1);
  });

  it('detecta falta de declaración sxy en la raíz', () => {
    expect(missingRootNamespaces(newDoc())).to.have.property('xmlns:sxy');
  });
});
