/**
 * Catálogo de funciones (etapa C): código ANSI -> clase de nodo lógico IEC 61850.
 * Los ingenieros piensan en ANSI; la norma habla en LN. La interfaz muestra ambos.
 */

/** A qué tipo de objeto del unifilar se puede asignar una función. */
export type TargetKind = 'CBR' | 'DIS' | 'ERS' | 'CTR' | 'VTR' | 'PTR' | 'BAY';

export type FunctionGroup = 'Protección' | 'Automatismo' | 'Control' | 'Medición' | 'Equipo';

export interface FunctionDef {
  id: string;
  /** Código ANSI/IEEE (vacío si no aplica). */
  ansi: string;
  name: string;
  lnClass: string;
  group: FunctionGroup;
  targets: TargetKind[];
}

const D = (
  id: string,
  ansi: string,
  name: string,
  lnClass: string,
  group: FunctionGroup,
  targets: TargetKind[]
): FunctionDef => ({ id, ansi, name, lnClass, group, targets });

export const FUNCTIONS: FunctionDef[] = [
  // Protección
  D('ptoc-51', '50/51', 'Sobrecorriente de fase', 'PTOC', 'Protección', ['CBR']),
  D('ptoc-51n', '50N/51N', 'Sobrecorriente de neutro (residual)', 'PTOC', 'Protección', ['CBR']),
  D('pioc-50', '50', 'Sobrecorriente instantánea', 'PIOC', 'Protección', ['CBR']),
  D('ptoc-46', '46', 'Sobrecorriente de secuencia negativa', 'PTOC', 'Protección', ['CBR']),
  D('pdoc-67', '67', 'Sobrecorriente direccional de fase', 'PDOC', 'Protección', ['CBR']),
  D('pdoc-67n', '67N', 'Sobrecorriente direccional de neutro', 'PDOC', 'Protección', ['CBR']),
  D('pdis-21', '21', 'Protección de distancia', 'PDIS', 'Protección', ['CBR']),
  D('pdif-87l', '87L', 'Diferencial de línea', 'PDIF', 'Protección', ['CBR']),
  D('pdif-87t', '87T', 'Diferencial de transformador', 'PDIF', 'Protección', ['PTR']),
  D('pdif-87b', '87B', 'Diferencial de barras', 'PDIF', 'Protección', ['BAY']),
  D('rbrf-50bf', '50BF', 'Falla de interruptor', 'RBRF', 'Protección', ['CBR']),
  D('ptuv-27', '27', 'Mínima tensión', 'PTUV', 'Protección', ['CBR', 'BAY']),
  D('ptov-59', '59', 'Máxima tensión', 'PTOV', 'Protección', ['CBR', 'BAY']),
  D('ptuf-81u', '81U', 'Mínima frecuencia', 'PTUF', 'Protección', ['CBR', 'BAY']),
  D('ptof-81o', '81O', 'Máxima frecuencia', 'PTOF', 'Protección', ['CBR', 'BAY']),
  D('pttr-49', '49', 'Imagen térmica', 'PTTR', 'Protección', ['PTR', 'CBR']),
  D('ptrc-94', '94', 'Lógica de disparo', 'PTRC', 'Protección', ['CBR']),
  // Automatismo
  D('rrec-79', '79', 'Reenganchador', 'RREC', 'Automatismo', ['CBR']),
  D('rsyn-25', '25', 'Verificación de sincronismo', 'RSYN', 'Automatismo', ['CBR']),
  D('atcc-90', '90', 'Regulación automática de tensión', 'ATCC', 'Automatismo', ['PTR']),
  // Control
  D('cswi', '', 'Control de equipo de maniobra', 'CSWI', 'Control', ['CBR', 'DIS', 'ERS']),
  D('cilo', '', 'Enclavamientos', 'CILO', 'Control', ['CBR', 'DIS', 'ERS']),
  // Medición y señalización
  D('mmxu', '', 'Medición (I, U, P, Q, f)', 'MMXU', 'Medición', ['BAY']),
  D('mmtr', '', 'Medición de energía', 'MMTR', 'Medición', ['BAY']),
  D('ggio', '', 'Entradas/salidas genéricas', 'GGIO', 'Medición', ['BAY']),
  // Equipo de proceso
  D('xcbr', '', 'Interruptor (equipo)', 'XCBR', 'Equipo', ['CBR']),
  D('xswi', '', 'Seccionador / puesta a tierra (equipo)', 'XSWI', 'Equipo', ['DIS', 'ERS']),
  D('tctr', '', 'Transformador de corriente (equipo)', 'TCTR', 'Equipo', ['CTR']),
  D('tvtr', '', 'Transformador de tensión (equipo)', 'TVTR', 'Equipo', ['VTR']),
  D('yptr', '', 'Transformador de potencia (equipo)', 'YPTR', 'Equipo', ['PTR']),
  D('yltc', '', 'Cambiador de tomas (equipo)', 'YLTC', 'Equipo', ['PTR']),
];

export function functionById(id: string): FunctionDef | undefined {
  return FUNCTIONS.find(f => f.id === id);
}

export function functionsFor(target: TargetKind): FunctionDef[] {
  return FUNCTIONS.filter(f => f.targets.includes(target));
}

export const GROUP_ORDER: FunctionGroup[] = ['Protección', 'Automatismo', 'Control', 'Medición', 'Equipo'];

export type BayKind = 'linea' | 'alimentador' | 'trafo';

/** Funciones por objeto del campo: clave = tipo de equipo (`CBR`...) o `BAY`. */
export type Package = Partial<Record<TargetKind, string[]>>;

const SWITCH_CTRL = ['cswi', 'cilo'];

/**
 * Paquete de funciones típico de un campo, según su tipo y su tensión (kV).
 * Es un punto de partida editable, no una norma de EDESAL.
 */
export function typicalPackage(kind: BayKind, kV: number): Package {
  const hv = kV >= 66;
  if (kind === 'linea')
    return {
      CBR: [
        ...(hv ? ['pdis-21', 'pdoc-67', 'pdoc-67n', 'rsyn-25'] : ['ptoc-51', 'ptoc-51n']),
        'rrec-79', 'rbrf-50bf', 'ptrc-94', ...SWITCH_CTRL, 'xcbr',
      ],
      DIS: ['xswi', ...SWITCH_CTRL],
      ERS: ['xswi', ...SWITCH_CTRL],
      CTR: ['tctr'],
      VTR: ['tvtr'],
      BAY: ['mmxu'],
    };
  if (kind === 'alimentador')
    return {
      CBR: ['ptoc-51', 'ptoc-51n', 'rrec-79', 'ptuf-81u', 'ptrc-94', ...SWITCH_CTRL, 'xcbr'],
      DIS: ['xswi', ...SWITCH_CTRL],
      CTR: ['tctr'],
      BAY: ['mmxu'],
    };
  return {
    CBR: ['ptoc-51', 'ptoc-51n', 'rbrf-50bf', 'ptrc-94', ...SWITCH_CTRL, 'xcbr'],
    DIS: ['xswi', ...SWITCH_CTRL],
    CTR: ['tctr'],
    BAY: ['mmxu'],
  };
}

/** Funciones típicas del transformador de potencia en sí. */
export const TRANSFORMER_PACKAGE: string[] = ['pdif-87t', 'pttr-49', 'yptr', 'yltc', 'atcc-90'];
