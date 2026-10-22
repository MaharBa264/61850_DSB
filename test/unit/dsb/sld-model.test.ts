import { expect } from '@open-wc/testing';

import {
  createLineBay,
  createSubstation,
  createVoltageLevel,
  listBusbars,
  suggestColumn,
} from '../../../src/dsb/lib/project-model.js';
import { buildSldModel, CELL } from '../../../src/dsb/lib/sld-model.js';
import { toDxf, toSvg } from '../../../src/dsb/lib/sld-export.js';

function sample(bays = 2, busbars = 2) {
  const doc = new DOMParser().parseFromString(
    '<SCL xmlns="http://www.iec.ch/61850/2003/SCL" xmlns:sxy="http://www.iec.ch/61850/2003/SCLcoordinates" version="2007" revision="B" release="4"><Header id="t"/></SCL>',
    'application/xml'
  );
  const sub = createSubstation(doc, { name: 'ETSL', description: '', location: '' });
  doc.documentElement.appendChild(sub);
  const vl = createVoltageLevel(doc, 'ETSL', { name: 'J1', kV: 132, busbars }, 1);
  sub.appendChild(vl);
  for (let i = 1; i <= bays; i++)
    vl.appendChild(
      createLineBay(
        doc,
        { substation: 'ETSL', voltageLevel: 'J1' },
        { name: `Q0${i}`, busbars: listBusbars(vl), column: suggestColumn(vl) }
      )
    );
  return sub;
}

describe('DSB sld-model', () => {
  it('genera un grupo por equipo, barra y campo', () => {
    const m = buildSldModel(sample());
    const count = (k: string) => m.groups.filter(g => g.kind === k).length;
    expect(count('equipment')).to.equal(12); // 6 por campo
    expect(count('busbar')).to.equal(2);
    expect(count('bay')).to.equal(2);
    expect(count('wire')).to.equal(1);
  });

  it('cada equipo tiene símbolo (primitivas) y etiqueta', () => {
    const m = buildSldModel(sample(1));
    for (const g of m.groups.filter(g => g.kind === 'equipment')) {
      expect(g.prims.length).to.be.greaterThan(2);
      expect(g.prims.some(p => p.k === 'text' && p.t === g.label)).to.be.true;
    }
    const cbr = m.groups.find(g => g.type === 'CBR')!;
    // el interruptor lleva la cruz: al menos 5 líneas
    expect(cbr.prims.filter(p => p.k === 'line').length).to.equal(5);
  });

  it('la barra se extiende sobre todos los seccionadores conectados', () => {
    const m = buildSldModel(sample(2));
    const bus = m.groups.find(g => g.kind === 'busbar' && g.label === 'BB1')!;
    const l = bus.prims.find(p => p.k === 'line') as any;
    const dis = m.groups
      .filter(g => g.label === 'QB1')
      .map(g => g.prims.find(p => p.k === 'line') as any);
    for (const d of dis) {
      expect(d.x1).to.be.at.least(l.x1);
      expect(d.x1).to.be.at.most(l.x2);
    }
    expect(l.x2 - l.x1).to.be.greaterThan(CELL * 4);
  });

  it('los campos no se superponen horizontalmente', () => {
    const m = buildSldModel(sample(2));
    const xsOf = (bay: string) =>
      m.groups
        .filter(g => g.kind === 'equipment' && g.id.includes(`/${bay}/`))
        .map(g => (g.prims[0] as any).x1);
    expect(Math.min(...xsOf('Q02'))).to.be.greaterThan(Math.max(...xsOf('Q01')));
  });

  it('exporta SVG con todos los grupos', () => {
    const svg = toSvg(buildSldModel(sample(1)));
    expect(svg.startsWith('<svg')).to.be.true;
    expect(svg).to.contain('data-kind="equipment"');
    expect(svg).to.contain('QA1');
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).to.equal(null);
  });

  it('exporta DXF válido en estructura: capas, líneas y EOF', () => {
    const dxf = toDxf(buildSldModel(sample(1)));
    const lines = dxf.split('\r\n');
    expect(lines[0].trim()).to.equal('0');
    expect(dxf).to.contain('BARRAS');
    expect(dxf).to.contain('EQUIPOS');
    expect(dxf).to.contain('LINE');
    expect(dxf).to.contain('CIRCLE');
    expect(dxf.trimEnd().endsWith('EOF')).to.be.true;
    // pares código/valor: cantidad par de líneas (más la última vacía)
    expect((lines.length - 1) % 2).to.equal(0);
  });
});

import { moveEdit, removeEdit, renameEdits } from '../../../src/dsb/lib/sld-edit.js';
import { SXY_NS } from '../../../src/dsb/lib/project-model.js';

function apply(e: any): void {
  if (Array.isArray(e)) return e.forEach(apply);
  if ('node' in e && !('parent' in e)) return e.node.parentNode.removeChild(e.node);
  for (const [k, v] of Object.entries(e.attributes ?? {}))
    v === null ? e.element.removeAttribute(k) : e.element.setAttribute(k, v as string);
  for (const [ns, attrs] of Object.entries(e.attributesNS ?? {}))
    for (const [k, v] of Object.entries(attrs as any)) e.element.setAttributeNS(ns, k, v as string);
}

describe('DSB sld-edit', () => {
  it('mueve un campo en celdas', () => {
    const sub = sample(1);
    const bay = sub.querySelector('Bay[name="Q01"]')!;
    const x0 = parseInt(bay.getAttributeNS(SXY_NS, 'x')!, 10);
    apply(moveEdit(bay, 3, 0));
    expect(parseInt(bay.getAttributeNS(SXY_NS, 'x')!, 10)).to.equal(x0 + 3);
  });

  it('renombrar un campo mantiene las conexiones coherentes', () => {
    const sub = sample(1);
    const bay = sub.querySelector('Bay[name="Q01"]')!;
    apply(renameEdits(bay, 'Linea1'));
    expect(bay.getAttribute('name')).to.equal('Linea1');
    const paths = new Set(
      Array.from(sub.querySelectorAll('ConnectivityNode')).map(c => c.getAttribute('pathName'))
    );
    for (const t of Array.from(sub.querySelectorAll('Terminal')))
      expect(paths.has(t.getAttribute('connectivityNode'))).to.be.true;
    expect(sub.querySelector('Terminal[bayName="Q01"]')).to.equal(null);
  });

  it('renombrar una barra actualiza los terminales de los campos', () => {
    const sub = sample(1);
    apply(renameEdits(sub.querySelector('Bay[name="BB1"]')!, 'Barra1'));
    expect(sub.querySelector('Terminal[connectivityNode="ETSL/J1/Barra1/L1"]')).to.not.equal(null);
    expect(sub.querySelector('Terminal[connectivityNode="ETSL/J1/BB1/L1"]')).to.equal(null);
  });

  it('elimina un equipo', () => {
    const sub = sample(1);
    const qa1 = sub.querySelector('ConductingEquipment[name="QA1"]')!;
    apply(removeEdit(qa1));
    expect(sub.querySelector('ConductingEquipment[name="QA1"]')).to.equal(null);
  });
});

describe('DSB sld-model barras', () => {
  it('las barras de un nivel tienen el mismo largo', () => {
    const m = buildSldModel(sample(2));
    const span = (n: string) => {
      const l = m.groups.find(g => g.kind === 'busbar' && g.label === n)!.prims[0] as any;
      return [l.x1, l.x2];
    };
    expect(span('BB1')).to.deep.equal(span('BB2'));
  });
});
