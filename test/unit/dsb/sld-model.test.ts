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

import {
  cascadeRows,
  createBay,
  createPowerTransformer,
  suggestTransformerBayName,
  transformerPlacement,
} from '../../../src/dsb/lib/project-model.js';

function etapa(): { doc: XMLDocument; sub: Element } {
  const doc = new DOMParser().parseFromString(
    '<SCL xmlns="http://www.iec.ch/61850/2003/SCL" xmlns:sxy="http://www.iec.ch/61850/2003/SCLcoordinates" version="2007" revision="B" release="4"><Header id="t"/></SCL>',
    'application/xml'
  );
  const sub = createSubstation(doc, { name: 'ETSL', description: '', location: '' });
  doc.documentElement.appendChild(sub);
  [['J1', 132], ['J2', 33], ['J3', 13.2]].forEach(([n, kv], i) =>
    sub.appendChild(createVoltageLevel(doc, 'ETSL', { name: n as string, kV: kv as number, busbars: 1 }, 1 + 12 * i))
  );
  const vls = Array.from(sub.querySelectorAll('VoltageLevel'));
  const column = suggestColumn(vls[0]);
  const windings = vls.map((vl, i) => {
    const lv = vl.getAttribute('name')!;
    const bayName = suggestTransformerBayName('TR1', vl.querySelector('Voltage')!.textContent!);
    vl.appendChild(
      createBay(doc, { substation: 'ETSL', voltageLevel: lv }, {
        name: bayName, busbars: listBusbars(vl), column: suggestColumn(vl), template: 'trafo', inverted: i > 0,
      })
    );
    return { voltageLevel: lv, bayName };
  });
  const pos = transformerPlacement(vls[0], column);
  sub.insertBefore(
    createPowerTransformer(doc, 'ETSL', { name: 'TR1', desc: '132/33/13.2 kV', windings }, pos.x, pos.y),
    sub.querySelector('VoltageLevel')
  );
  for (const r of cascadeRows(sub)) r.element.setAttributeNS(SXY_NS, 'sxy:y', String(r.y));
  return { doc, sub };
}

describe('DSB plantillas de trafo y alimentador', () => {
  it('nombra el campo de trafo sin puntos', () => {
    expect(suggestTransformerBayName('TR1', 13.2)).to.equal('TR1_13_2');
  });

  it('el transformador tiene 3 arrollamientos conectados a nodos existentes', () => {
    const { sub } = etapa();
    const pt = sub.querySelector('PowerTransformer')!;
    expect(pt.querySelectorAll('TransformerWinding')).to.have.length(3);
    const paths = new Set(Array.from(sub.querySelectorAll('ConnectivityNode')).map(c => c.getAttribute('pathName')));
    for (const t of Array.from(pt.querySelectorAll('Terminal')))
      expect(paths.has(t.getAttribute('connectivityNode')), t.getAttribute('connectivityNode')!).to.be.true;
    // PowerTransformer debe preceder a VoltageLevel (orden del esquema SCL)
    expect(sub.firstElementChild!.tagName).to.equal('PowerTransformer');
  });

  it('el campo de trafo tiene interruptor y TC pero no seccionador de línea', () => {
    const { sub } = etapa();
    const bay = sub.querySelector('Bay[name="TR1_132"]')!;
    const types = Array.from(bay.querySelectorAll('ConductingEquipment')).map(e => e.getAttribute('type'));
    expect(types).to.deep.equal(['DIS', 'CBR', 'CTR']);
  });

  it('el alimentador no lleva puesta a tierra ni TV', () => {
    const { doc, sub } = etapa();
    const vl = sub.querySelector('VoltageLevel[name="J3"]')!;
    const bay = createBay(doc, { substation: 'ETSL', voltageLevel: 'J3' }, {
      name: 'F01', busbars: listBusbars(vl), column: suggestColumn(vl), withVT: true, template: 'alimentador',
    });
    const types = Array.from(bay.querySelectorAll('ConductingEquipment')).map(e => e.getAttribute('type'));
    expect(types).to.deep.equal(['DIS', 'CBR', 'CTR', 'DIS']);
  });

  it('el modelo dibuja el transformador y conecta sus 3 arrollamientos', () => {
    const { sub } = etapa();
    const m = buildSldModel(sub);
    const tr = m.groups.find(g => g.kind === 'transformer')!;
    expect(tr.prims.filter(p => p.k === 'circle')).to.have.length(3);
    const wires = m.groups.find(g => g.kind === 'wire')!;
    // cada arrollamiento aporta una ruta de varios tramos: más que solo las de barra
    expect(wires.prims.filter(p => p.k === 'line').length).to.be.greaterThan(15);
    expect(m.groups.filter(g => g.kind === 'bay')).to.have.length(3);
  });

  it('los campos inferiores cuelgan encima de la barra (TC, interruptor, seccionador)', () => {
    const { sub } = etapa();
    const bay = sub.querySelector('Bay[name="TR1_33"]')!;
    const types = Array.from(bay.querySelectorAll('ConductingEquipment')).map(e => e.getAttribute('type'));
    expect(types).to.deep.equal(['CTR', 'CBR', 'DIS']);
    // el TC conecta al nodo L3 (lado transformador) y el seccionador a la barra
    expect(bay.querySelector('ConductingEquipment[name="TC1"] Terminal[name="T1"]')!.getAttribute('cNodeName')).to.equal('L3');
    expect(bay.querySelector('ConductingEquipment[name="QB1"] Terminal[name="T2"]')!.getAttribute('connectivityNode')).to.equal('ETSL/J2/BB1/L1');
  });

  it('los niveles se apilan en cascada y el transformador queda alineado con el TC superior', () => {
    const { sub } = etapa();
    const ys = Array.from(sub.querySelectorAll('VoltageLevel')).map(v => parseInt(v.getAttributeNS(SXY_NS, 'y')!, 10));
    expect(ys[1] - ys[0]).to.equal(15);
    expect(ys[2]).to.be.greaterThan(ys[1]);
    const m = buildSldModel(sub);
    const tc = m.groups.find(g => g.id === 'ETSL/J1/TR1_132/TC1')!;
    const tr = m.groups.find(g => g.kind === 'transformer')!;
    const cxTc = (tc.prims[0] as any).x1;
    const cxTr = (tr.prims[0] as any).x1; // terminal superior del transformador
    expect(cxTr).to.equal(cxTc);
  });

  it('el tercer arrollamiento baja por un corredor a la izquierda de los campos', () => {
    const { sub } = etapa();
    const m = buildSldModel(sub);
    const bayLeft = 4 * CELL; // VL en x=1 + primera columna de campos (3)
    const wires = (m.groups.find(g => g.kind === 'wire')!.prims.filter(p => p.k === 'line') as any[]);
    const corridor = wires.filter(l => l.x1 === l.x2 && l.x1 < bayLeft && Math.abs(l.y2 - l.y1) > 4 * CELL);
    expect(corridor.length).to.be.greaterThan(0);
  });
});
