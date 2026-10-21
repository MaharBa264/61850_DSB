/**
 * DSB — modelo GOOSE extraído de un documento SCL.
 *
 * Función pura (sin dependencias de UI): recibe un `Document`/`Element` SCL y
 * devuelve IEDs, bloques de control GSEControl (publicadores) y los enlaces
 * publicador → suscriptor deducidos de los `ExtRef` (y de LGOS, "late binding").
 *
 * Mantener este archivo libre de Lit/OpenSCD para poder testearlo y reutilizarlo
 * (por ejemplo, desde el backend o desde la futura exportación).
 */

export interface GooseControl {
  /** Nombre del IED publicador */
  ied: string;
  ldInst: string;
  /** Nombre del GSEControl */
  name: string;
  datSet: string | null;
  /** Atributo GSEControl@appID (GoID). En ABB es el nombre del bloque; en otros fabricantes puede ser un texto libre */
  appId: string | null;
  /** APPID de capa 2 (hex) tomado de Communication/.../GSE/Address/P[@type='APPID'] */
  appIdL2: string | null;
  confRev: string | null;
  /** Dirección de comunicación (Communication/.../GSE), si existe */
  mac: string | null;
  vlanId: string | null;
  vlanPriority: string | null;
  /** Cantidad de entradas (FCDA) del DataSet */
  fcdaCount: number;
}

export interface GooseSignal {
  intAddr: string | null;
  desc: string | null;
  /** Referencia al dato publicado (ldInst/prefix lnClass lnInst.doName.daName) */
  src: string;
}

export interface GooseLink {
  publisher: string;
  publisherLdInst: string | null;
  cbName: string;
  subscriber: string;
  /** Señales suscriptas (ExtRef agrupados) */
  signals: GooseSignal[];
  /** true si el GSEControl referenciado no existe en el SCL (típico "Subscriber NV") */
  unresolved: boolean;
  /** Origen del enlace */
  via: 'ExtRef' | 'LGOS';
}

export interface GooseIed {
  name: string;
  desc: string | null;
  role: 'publisher' | 'subscriber' | 'both' | 'none';
}

export interface GooseModel {
  ieds: GooseIed[];
  controls: GooseControl[];
  links: GooseLink[];
}

function attr(el: Element, name: string): string | null {
  const v = el.getAttribute(name);
  return v === null || v === '' ? null : v;
}

/** Nombre de IED del ancestro de un elemento */
function iedOf(el: Element): Element | null {
  return el.closest('IED');
}

function ldInstOf(el: Element): string | null {
  return el.closest('LDevice')?.getAttribute('inst') ?? null;
}

function controlKey(ied: string, ldInst: string | null, cb: string): string {
  return `${ied}\u0000${ldInst ?? ''}\u0000${cb}`;
}

function fcdaRef(fcda: Element): string {
  const ld = fcda.getAttribute('ldInst') ?? '';
  const ln = `${fcda.getAttribute('prefix') ?? ''}${
    fcda.getAttribute('lnClass') ?? ''
  }${fcda.getAttribute('lnInst') ?? ''}`;
  const dat = [attr(fcda, 'doName'), attr(fcda, 'daName')]
    .filter(Boolean)
    .join('.');
  return `${ld}/${ln}.${dat}`;
}

/** Referencia al dato publicado que describe un ExtRef */
function extRefSrc(ext: Element): string {
  const ld = ext.getAttribute('ldInst') ?? '';
  const ln = `${ext.getAttribute('prefix') ?? ''}${
    ext.getAttribute('lnClass') ?? ''
  }${ext.getAttribute('lnInst') ?? ''}`;
  const dat = [attr(ext, 'doName'), attr(ext, 'daName')]
    .filter(Boolean)
    .join('.');
  return `${ld}/${ln}.${dat}`;
}

function extractControls(scl: ParentNode): GooseControl[] {
  const controls: GooseControl[] = [];

  // Direcciones de comunicación indexadas por ied+ldInst+cbName
  const gseAddr = new Map<
    string,
    { mac: string | null; appIdL2: string | null; vlanId: string | null; vlanPriority: string | null }
  >();
  scl.querySelectorAll('Communication > SubNetwork > ConnectedAP').forEach(ap => {
    const ied = ap.getAttribute('iedName');
    if (!ied) return;
    ap.querySelectorAll(':scope > GSE').forEach(gse => {
      const cb = gse.getAttribute('cbName');
      if (!cb) return;
      const p = (type: string): string | null =>
        Array.from(gse.querySelectorAll(':scope > Address > P')).find(
          e => e.getAttribute('type') === type
        )?.textContent?.trim() ?? null;
      gseAddr.set(controlKey(ied, gse.getAttribute('ldInst'), cb), {
        mac: p('MAC-Address'),
        appIdL2: p('APPID'),
        vlanId: p('VLAN-ID'),
        vlanPriority: p('VLAN-PRIORITY'),
      });
    });
  });

  scl.querySelectorAll('IED').forEach(iedEl => {
    const ied = iedEl.getAttribute('name');
    if (!ied) return;
    iedEl.querySelectorAll('LDevice').forEach(ld => {
      const ldInst = ld.getAttribute('inst') ?? '';
      ld.querySelectorAll(':scope > LN0 > GSEControl').forEach(gc => {
        const name = gc.getAttribute('name');
        if (!name) return;
        const datSet = attr(gc, 'datSet');
        const ds = datSet
          ? Array.from(
              gc.parentElement!.querySelectorAll(':scope > DataSet')
            ).find(d => d.getAttribute('name') === datSet)
          : undefined;
        const addr = gseAddr.get(controlKey(ied, ldInst, name)) ??
          gseAddr.get(controlKey(ied, null, name)) ?? {
            mac: null,
            appIdL2: null,
            vlanId: null,
            vlanPriority: null,
          };
        controls.push({
          ied,
          ldInst,
          name,
          datSet,
          appId: attr(gc, 'appID'),
          appIdL2: addr.appIdL2,
          confRev: attr(gc, 'confRev'),
          mac: addr.mac,
          vlanId: addr.vlanId,
          vlanPriority: addr.vlanPriority,
          fcdaCount: ds ? ds.querySelectorAll(':scope > FCDA').length : 0,
        });
      });
    });
  });
  return controls;
}

export function extractGooseModel(scl: ParentNode): GooseModel {
  const controls = extractControls(scl);
  const byKey = new Map<string, GooseControl>();
  const byIedAndName = new Map<string, GooseControl>();
  for (const c of controls) {
    byKey.set(controlKey(c.ied, c.ldInst, c.name), c);
    byIedAndName.set(controlKey(c.ied, null, c.name), c);
  }
  const resolve = (
    ied: string,
    ldInst: string | null,
    cb: string
  ): GooseControl | undefined =>
    byKey.get(controlKey(ied, ldInst, cb)) ??
    byIedAndName.get(controlKey(ied, null, cb));

  const linkMap = new Map<string, GooseLink>();
  const addSignal = (
    publisher: string,
    publisherLdInst: string | null,
    cbName: string,
    subscriber: string,
    signal: GooseSignal,
    via: GooseLink['via']
  ): void => {
    const key = `${publisher}\u0000${publisherLdInst ?? ''}\u0000${cbName}\u0000${subscriber}`;
    let link = linkMap.get(key);
    if (!link) {
      link = {
        publisher,
        publisherLdInst,
        cbName,
        subscriber,
        signals: [],
        unresolved: !resolve(publisher, publisherLdInst, cbName),
        via,
      };
      linkMap.set(key, link);
    }
    link.signals.push(signal);
  };

  // 1) ExtRef con referencia explícita al control (srcCBName)
  scl.querySelectorAll('IED ExtRef').forEach(ext => {
    const cb = attr(ext, 'srcCBName');
    const publisher = attr(ext, 'iedName');
    const subscriber = iedOf(ext)?.getAttribute('name');
    if (!cb || !publisher || !subscriber) return;
    const serviceType = attr(ext, 'serviceType');
    if (serviceType && serviceType !== 'GOOSE') return;
    const srcLd = attr(ext, 'srcLDInst') ?? attr(ext, 'ldInst');
    // Sin serviceType solo aceptamos si el control existe como GSEControl
    if (!serviceType && !resolve(publisher, srcLd, cb)) return;
    addSignal(
      publisher,
      srcLd,
      cb,
      subscriber,
      { intAddr: attr(ext, 'intAddr'), desc: attr(ext, 'desc'), src: extRefSrc(ext) },
      'ExtRef'
    );
  });

  // 2) Late binding: LGOS/DOI[GoCBRef]/DAI[setSrcRef]/Val = "<IED><LD>/LLN0.<cb>"
  scl.querySelectorAll('IED LN[lnClass="LGOS"]').forEach(ln => {
    const subscriber = iedOf(ln)?.getAttribute('name');
    if (!subscriber) return;
    const val = ln
      .querySelector('DOI[name="GoCBRef"] > DAI[name="setSrcRef"] > Val')
      ?.textContent?.trim();
    if (!val) return;
    const hit = controls.find(
      c => val === `${c.ied}${c.ldInst}/LLN0.${c.name}`
    );
    // si el mismo enlace ya existe vía ExtRef, no duplicamos señales
    const dupKey = `${hit?.ied}\u0000${hit?.ldInst ?? ''}\u0000${hit?.name}\u0000${subscriber}`;
    if (hit && !linkMap.has(dupKey)) {
      addSignal(
        hit.ied,
        hit.ldInst,
        hit.name,
        subscriber,
        {
          intAddr: null,
          desc: ln.getAttribute('desc'),
          src: `LGOS ${ln.getAttribute('inst') ?? ''}`.trim(),
        },
        'LGOS'
      );
    }
  });

  const links = Array.from(linkMap.values());
  const pubs = new Set(controls.map(c => c.ied));
  const subs = new Set(links.map(l => l.subscriber));
  // un IED que solo figura como publicador de un enlace sin control también cuenta
  links.forEach(l => pubs.add(l.publisher));

  const ieds: GooseIed[] = Array.from(scl.querySelectorAll('IED'))
    .map(e => {
      const name = e.getAttribute('name') ?? '';
      const p = pubs.has(name);
      const s = subs.has(name);
      return {
        name,
        desc: attr(e, 'desc'),
        role: (p && s ? 'both' : p ? 'publisher' : s ? 'subscriber' : 'none') as GooseIed['role'],
      };
    })
    .filter(i => i.name);

  // Publicadores citados en ExtRef pero ausentes en el SCL (IED fantasma)
  const known = new Set(ieds.map(i => i.name));
  for (const l of links) {
    if (!known.has(l.publisher)) {
      known.add(l.publisher);
      ieds.push({ name: l.publisher, desc: null, role: 'publisher' });
    }
  }

  return { ieds, controls, links };
}

export { fcdaRef };
