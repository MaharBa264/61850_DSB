import { expect } from '@open-wc/testing';

import {
  createBay,
  createPowerTransformer,
  createSubstation,
  createVoltageLevel,
  listBusbars,
  suggestColumn,
} from '../../../src/dsb/lib/project-model.js';
import {
  addFunctionEdit,
  bayKind,
  bayPackageEdits,
  collectFunctions,
  LnAllocator,
  listAssigned,
  summarize,
  targetKind,
  toFunctionsCsv,
  toSsd,
  transformerPackageEdits,
} from '../../../src/dsb/lib/functions-model.js';
import { functionById, FUNCTIONS, typicalPackage } from '../../../src/dsb/lib/functions-catalog.js';

function apply(e: any): void {
  if (Array.isArray(e)) return e.forEach(apply);
  if ('parent' in e) return void e.parent.insertBefore(e.node, e.reference);
  if ('node' in e) return void e.node.parentNode.removeChild(e.node);
}

function project(kV = 132) {
  const doc = new DOMParser().parseFromString(
    '<SCL xmlns="http://www.iec.ch/61850/2003/SCL" version="2007" revision="B" release="4"><Header id="t"/></SCL>',
    'application/xml'
  );
  const sub = createSubstation(doc, { name: 'ETSL', description: '', location: '' });
  doc.documentElement.appendChild(sub);
  const vl = createVoltageLevel(doc, 'ETSL', { name: 'J1', kV, busbars: 2 }, 1);
  sub.appendChild(vl);
  const bay = createBay(
    doc,
    { substation: 'ETSL', voltageLevel: 'J1' },
    { name: 'L1', busbars: listBusbars(vl), column: suggestColumn(vl), template: 'linea' }
  );
  vl.appendChild(bay);
  return { doc, sub, vl, bay };
}

describe('DSB functions-catalog', () => {
  it('los ids son únicos y cada función tiene clase LN y destino', () => {
    const ids = FUNCTIONS.map(f => f.id);
    expect(new Set(ids).size).to.equal(ids.length);
    for (const f of FUNCTIONS) {
      expect(f.lnClass).to.match(/^[A-Z]{4}$/);
      expect(f.targets.length).to.be.greaterThan(0);
    }
  });

  it('mapea ANSI a clase LN según la norma', () => {
    expect(functionById('ptoc-51')!.lnClass).to.equal('PTOC');
    expect(functionById('pdis-21')!.lnClass).to.equal('PDIS');
    expect(functionById('rrec-79')!.lnClass).to.equal('RREC');
    expect(functionById('rbrf-50bf')!.lnClass).to.equal('RBRF');
    expect(functionById('pdif-87t')!.lnClass).to.equal('PDIF');
  });

  it('todos los ids de los paquetes existen', () => {
    for (const kind of ['linea', 'alimentador', 'trafo'] as const)
      for (const kv of [13.2, 33, 132])
        for (const ids of Object.values(typicalPackage(kind, kv)))
          for (const id of ids!) expect(functionById(id), id).to.not.equal(undefined);
  });

  it('línea de AT lleva distancia y de MT sobrecorriente', () => {
    expect(typicalPackage('linea', 132).CBR).to.include('pdis-21');
    expect(typicalPackage('linea', 132).CBR).to.not.include('ptoc-51');
    expect(typicalPackage('linea', 33).CBR).to.include('ptoc-51');
    expect(typicalPackage('linea', 33).CBR).to.not.include('pdis-21');
  });
});

describe('DSB functions-model', () => {
  it('deduce el tipo de objeto y la plantilla del campo', () => {
    const { bay } = project();
    expect(bayKind(bay)).to.equal('linea');
    expect(targetKind(bay)).to.equal('BAY');
    expect(targetKind(bay.querySelector('ConductingEquipment[name="QA1"]')!)).to.equal('CBR');
  });

  it('agrega una función como LNode iedName="None" con metadatos', () => {
    const { doc, sub, bay } = project();
    const qa1 = bay.querySelector('ConductingEquipment[name="QA1"]')!;
    apply(addFunctionEdit(doc, qa1, functionById('ptoc-51')!, new LnAllocator(sub)));
    const ln = qa1.querySelector(':scope > LNode')!;
    expect(ln.getAttribute('iedName')).to.equal('None');
    expect(ln.getAttribute('lnClass')).to.equal('PTOC');
    expect(ln.getAttribute('lnInst')).to.equal('1');
    const a = listAssigned(qa1)[0];
    expect(a.ansi).to.equal('50/51');
    expect(a.functionId).to.equal('ptoc-51');
  });

  it('los LNode van antes que Terminal en el equipo (orden del esquema)', () => {
    const { doc, sub, bay } = project();
    const qa1 = bay.querySelector('ConductingEquipment[name="QA1"]')!;
    apply(addFunctionEdit(doc, qa1, functionById('ptoc-51')!, new LnAllocator(sub)));
    expect(qa1.firstElementChild!.tagName).to.equal('LNode');
  });

  it('lnInst no se repite dentro de la subestación', () => {
    const { doc, sub, bay } = project();
    const alloc = new LnAllocator(sub);
    const qa1 = bay.querySelector('ConductingEquipment[name="QA1"]')!;
    apply(addFunctionEdit(doc, qa1, functionById('ptoc-51')!, alloc));
    apply(addFunctionEdit(doc, qa1, functionById('ptoc-51n')!, alloc));
    const insts = listAssigned(qa1).filter(a => a.lnClass === 'PTOC').map(a => a.lnInst);
    expect(insts).to.deep.equal(['1', '2']);
    // un allocator nuevo respeta lo ya existente
    expect(new LnAllocator(sub).next('PTOC')).to.equal('3');
  });

  it('el paquete típico de una línea de 132 kV asigna funciones a cada objeto', () => {
    const { doc, sub, bay } = project(132);
    apply(bayPackageEdits(doc, bay, 132, new LnAllocator(sub)));
    const cls = (n: string) =>
      listAssigned(bay.querySelector(`ConductingEquipment[name="${n}"]`)!).map(a => a.lnClass);
    expect(cls('QA1')).to.include.members(['PDIS', 'RREC', 'RBRF', 'CSWI', 'XCBR']);
    expect(cls('QB1')).to.include.members(['XSWI', 'CSWI']);
    expect(cls('TC1')).to.deep.equal(['TCTR']);
    expect(listAssigned(bay).map(a => a.lnClass)).to.include('MMXU');
  });

  it('aplicar el paquete dos veces no duplica funciones', () => {
    const { doc, sub, bay } = project();
    apply(bayPackageEdits(doc, bay, 132, new LnAllocator(sub)));
    const n = bay.querySelectorAll('LNode').length;
    apply(bayPackageEdits(doc, bay, 132, new LnAllocator(sub)));
    expect(bay.querySelectorAll('LNode').length).to.equal(n);
  });

  it('el transformador recibe diferencial, térmica y cambiador de tomas', () => {
    const { doc, sub } = project();
    const pt = createPowerTransformer(doc, 'ETSL', { name: 'TR1', windings: [] }, 0, 9);
    sub.insertBefore(pt, sub.querySelector('VoltageLevel'));
    apply(transformerPackageEdits(doc, pt, new LnAllocator(sub)));
    expect(listAssigned(pt).map(a => a.lnClass)).to.include.members(['PDIF', 'PTTR', 'YPTR', 'YLTC', 'ATCC']);
  });

  it('resume cantidades y genera CSV con BOM y separador ;', () => {
    const { doc, sub, bay } = project();
    apply(bayPackageEdits(doc, bay, 132, new LnAllocator(sub)));
    const rows = collectFunctions(sub);
    expect(rows.length).to.be.greaterThan(10);
    const sum = summarize(rows);
    // 3 seccionadores x (XSWI) + tierra: XSWI cuenta todos
    const xswi = sum.find(s => s.lnClass === 'XSWI')!;
    expect(xswi.group).to.equal('Equipo');
    expect(xswi.count).to.equal(4); // QB1, QB2, QB9, QC9
    const csv = toFunctionsCsv(rows);
    expect(csv.startsWith('﻿')).to.be.true;
    expect(csv.split('\r\n')[0]).to.contain(';');
    expect(csv).to.contain('Distancia'.slice(0, 0) + 'PDIS');
  });

  it('el SSD no contiene IEDs ni comunicación pero conserva los LNode', () => {
    const { doc, sub, bay } = project();
    apply(bayPackageEdits(doc, bay, 132, new LnAllocator(sub)));
    doc.documentElement.appendChild(doc.createElementNS('http://www.iec.ch/61850/2003/SCL', 'IED'));
    doc.documentElement.appendChild(doc.createElementNS('http://www.iec.ch/61850/2003/SCL', 'Communication'));
    const ssd = toSsd(doc);
    expect(ssd).to.contain('<?xml');
    const parsed = new DOMParser().parseFromString(ssd, 'application/xml');
    expect(parsed.querySelector('parsererror')).to.equal(null);
    expect(parsed.querySelector(':root > IED')).to.equal(null);
    expect(parsed.querySelector(':root > Communication')).to.equal(null);
    expect(parsed.querySelectorAll('LNode[iedName="None"]').length).to.be.greaterThan(10);
  });
});
