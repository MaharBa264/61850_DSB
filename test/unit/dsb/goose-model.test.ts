import { expect } from '@open-wc/testing';

import { extractGooseModel } from '../../../src/dsb/lib/goose-model.js';

async function load(path: string): Promise<XMLDocument> {
  const text = await (await fetch(path)).text();
  return new DOMParser().parseFromString(text, 'application/xml');
}

describe('DSB goose-model', () => {
  it('extrae publicador, suscriptor y señales de un ExtRef', async () => {
    const m = extractGooseModel(
      await load('/test/testfiles/editors/MessageBindingGOOSE2007B4.scd')
    );
    expect(m.ieds.map(i => i.name)).to.include.members(['IED1', 'IED2', 'IED4']);
    expect(m.links).to.have.length(1);
    const l = m.links[0];
    expect(l.publisher).to.equal('IED2');
    expect(l.subscriber).to.equal('IED1');
    expect(l.cbName).to.equal('GCB');
    expect(l.signals).to.have.length(3);
    expect(l.unresolved).to.be.false;
  });

  it('marca roles: publicador, suscriptor y ambos', async () => {
    const m = extractGooseModel(
      await load('/test/testfiles/editors/MessageBindingGOOSE2007B4.scd')
    );
    const role = (n: string) => m.ieds.find(i => i.name === n)?.role;
    expect(role('IED2')).to.equal('publisher');
    expect(role('IED1')).to.equal('both');
  });

  it('incorpora late binding (LGOS) sin duplicar señales de ExtRef', async () => {
    const m = extractGooseModel(
      await load('/test/testfiles/editors/LaterBindingGOOSE-LGOS.scd')
    );
    const key = (l: { publisher: string; cbName: string; subscriber: string }) =>
      `${l.publisher}|${l.cbName}|${l.subscriber}`;
    const byKey = new Map(m.links.map(l => [key(l), l]));
    expect(byKey.get('GOOSE_Publisher|GOOSE2|GOOSE_Subscriber1')?.signals).to.have.length(4);
    expect(byKey.get('GOOSE_Publisher2|GOOSE2|GOOSE_Subscriber1')?.signals).to.have.length(2);
    expect(byKey.get('GOOSE_Publisher|GOOSE1|GOOSE_Subscriber1')?.via).to.equal('LGOS');
  });

  it('detecta enlaces cuyo GSEControl no existe', () => {
    const xml = `<SCL xmlns="http://www.iec.ch/61850/2003/SCL"><IED name="A"><AccessPoint name="P1"><Server><LDevice inst="LD"><LN0 lnClass="LLN0" inst="">
      <Inputs><ExtRef iedName="B" srcLDInst="LD" srcCBName="NOPE" serviceType="GOOSE" intAddr="x"/></Inputs></LN0></LDevice></Server></AccessPoint></IED></SCL>`;
    const m = extractGooseModel(new DOMParser().parseFromString(xml, 'application/xml'));
    expect(m.links).to.have.length(1);
    expect(m.links[0].unresolved).to.be.true;
    // publicador fantasma agregado como nodo
    expect(m.ieds.map(i => i.name)).to.include('B');
  });
});
