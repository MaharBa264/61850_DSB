# DSB (61850_DSB) — Arquitectura y decisiones

Fork de [CoMPAS OpenSCD](https://github.com/com-pas/compas-open-scd) (Apache-2.0) para ingeniería
IEC 61850 en EDESAL. Remotes: `origin` = este repo, `upstream` = com-pas/compas-open-scd.

## Decisiones tomadas

| # | Decisión | Motivo |
|---|---|---|
| 1 | **Solo web** por ahora (standalone queda fuera de alcance) | Prioridad del usuario |
| 2 | Uso interno en EDESAL, sin distribución externa | Habilita usar libIEC61850 (GPLv3) si hiciera falta |
| 3 | Código propio **aislado en `src/dsb/`**; ediciones al código de CoMPAS limitadas a 3 puntos de enganche (`src/open-scd.ts`, `public/js/plugins.js`, `web-test-runner.config.mjs`) | Poder hacer `git merge upstream/main` sin conflictos |
| 4 | **Modernización del frontend gradual** (lit-element 2.5 / mwc 0.22 hoy). Nada de migraciones masivas | No perder actualizaciones de upstream |
| 5 | Backend propio y liviano (usuarios, proyectos, versiones del SCD) en una fase posterior | Los servicios Java de CoMPAS son pesados de operar |
| 6 | Servidor de producción: **172.17.1.170, Rocky Linux 8.10** | Dato del usuario |
| 7 | **172.17.1.171** (GPU L4, Ubuntu más nuevo): reservado para funciones de IA, **no inmediato** | Dato del usuario |

## Estructura del código propio

```
src/dsb/
  dsb-plugins.ts            registro de plugins DSB (equivalente a compas-plugins.ts)
  lib/goose-model.ts        SCL -> {IEDs, GSEControl, enlaces publicador->suscriptor}. Función pura, sin UI
  lib/project-model.ts      proyecto, niveles de tensión y plantilla de campo de línea (SCL + coordenadas sxy). Función pura
  editors/ProjectEditor.ts  pestaña "Proyecto (DSB)": datos del proyecto, niveles de tensión, alta de campos
  lib/sld-model.ts          SCL (sxy) -> primitivas de dibujo con símbolos IEC (CBR, DIS, ERS, CTR, VTR, trafo). Pura
  lib/sld-export.ts         primitivas -> SVG y DXF (capas EQUIPOS, BARRAS, CONEXIONES, TRANSFORMADORES, TEXTOS_CAMPO)
  lib/sld-edit.ts           ediciones EditV2: mover, renombrar (mantiene rutas/terminales), eliminar
  editors/SldEditor.ts      pestaña "Unifilar (DSB)": visor/editor propio (seleccionar, arrastrar con grilla, renombrar, eliminar, exportar)
  editors/GooseGraph.ts     editor gráfico GOOSE (fase 1: solo lectura)
test/unit/dsb/              tests (wtr)
docs/dsb/                   esta documentación
```

Para agregar un plugin: crear el componente, registrarlo en `dsb-plugins.ts` (enum + mapa) y
sumar su entrada en `public/js/plugins.js` bajo el comentario `DSB`.

## Sincronizar con upstream

```bash
git fetch upstream
git merge upstream/main   # los conflictos esperables son solo los 3 puntos de enganche
```

## Despliegue en Rocky 8.10

Ver [`deploy/README.md`](../../deploy/README.md). Resumen: el workflow `DSB Build` genera `dsb-dist.tar.gz`
en cada push a `main`; `deploy/install-rocky.sh` lo publica con un nginx dedicado (`dsb-nginx`) en el **puerto 8095** (el 80 lo usa otra app del servidor). App 100 % estática por ahora.
(Los scripts aún no se probaron en un Rocky real.)

## Contexto operativo (dato del usuario)

- Cada RTU se instala en una red capa 2 independiente (salvo contadas excepciones). Por lo tanto, MAC/APPID
  GOOSE repetidos entre RTUs **no** son un problema; los validadores de duplicados deben acotarse **por subred**.
- IEDs objetivo: Siemens DIGSI 4 y 5 (7SJ8xx, 7UTxxx, 7SAxx), ABB REF615/REU615/REX615, Hitachi RET670/RET650,
  y merging units de esas marcas. RTUs Schneider Saitel CPU866e (ICD plantilla `TEMPLATE`).
- Archivos de referencia analizados: SCD de ABB PCM600 (ETSL, 32 IEDs) e ICD Saitel. Son datos de la red de EDESAL:
  **no se versionan en el repo**.

## Flujo de trabajo objetivo (acordado 2026-10-22)

Principio: **un único modelo SCL que madura**; SSD, SCD y entregables son proyecciones del mismo proyecto.
Niveles: Especificación (SSD) -> Diseño (IEDs asignados) -> Configuración (SCD). Cada uno se exporta en cualquier momento.
Lo que SCL no cubre (coordenadas, catálogo, switches, notas) va en elementos `Private` de DSB.

Decisiones del usuario:
- Unifilar: plantillas de campo con edición libre posterior; simbología IEC; ET típica = 2 trafos 132/33/13,2 kV (3 arrollamientos), 3 campos de línea 132 kV, 5 de 33 kV, 5 de 13,2 kV (~35-50 IEDs).
- Salidas: DXF (AutoCAD) + PDF/SVG; no hay cajetín/capas estándar de EDESAL (definimos uno propio, configurable).
- Prioridad: presupuestar (SSD + catálogo) y configurar (SCD) al mismo tiempo.
- Catálogo de IEDs: sin ICD para muchos modelos; carga manual de funciones y E/S. Sin catálogo ni estándar de switches: catálogo propio, editable, genérico.
- Red: hoy solo bus de estación (topología por definir); modelar SV/bus de proceso desde el diseño aunque se use a futuro. Direccionamiento y validaciones por subred (L2 independiente).

Etapas:
| Etapa | Entregable |
|---|---|
| A (hecho) | Proyecto (nombre obligatorio; ubicación, descripción, niveles de tensión) + convención de nomenclatura |
| B (en curso: plantilla de campo de línea y visor/editor propio con símbolos IEC, exportación SVG/DXF hechos; plantillas de línea, alimentador y transformador de 2/3 arrollamientos hechas; falta PDF y alta de equipos sueltos) | Editor de unifilar con plantillas de campo, simbología IEC, edición libre; capas/bloques DXF definidos desde el inicio |
| C | Funciones ANSI->LN por equipo (LNode iedName="None"); exportación SSD y lista de funciones para presupuesto |
| D | Catálogo de IEDs (manual + ICD) y switches; verificación de capacidad |
| E | RTU + red asistida (topología, IP/MAC/APPID/VLAN, carga, validación por subred) |
| F | MMS y GOOSE editables (base: grafo de solo lectura ya hecho) |
| G | Salidas: SCD, DXF, PDF/SVG, matriz GOOSE, lista de señales, tabla de direccionamiento |

## Hoja de ruta técnica previa

1. [x] Editor GOOSE de solo lectura (grafo IED -> IED, detalle por enlace, enlaces sin GSEControl en rojo)
2. [ ] Editor GOOSE editable: crear/borrar enlaces escribiendo `ExtRef` mediante el sistema de acciones/undo de OpenSCD
3. [ ] Vista MMS (reportes/datasets) con el mismo enfoque de bloques
4. [ ] Unifilar editable
5. [ ] Backend: usuarios, proyectos, versiones, colaboración
6. [ ] Validaciones de ingeniería (ej. confRev, APPID/MAC/IP duplicados **por subred**, FCDA inexistentes)
7. [ ] Instanciador de RTU desde ICD plantilla (nombre, IP, MAC/APPID, sustitución de GoID/rptID)
8. [ ] Soporte SV / merging units (requiere ICD/SCD de Siemens e Hitachi para verificar)

## Notas de la etapa B

- El visor "Diagrama unifilar" de CoMPAS dibuja líneas y conexiones pero **no dibuja los símbolos** de interruptor, seccionador, TC, etc. (solo el transformador). Se verificó también con un SCD de prueba propio de upstream. Por eso DSB trae su propio visor (`Unifilar (DSB)`); el de CoMPAS se mantiene sin tocar para no divergir de upstream. Las primitivas del visor son la misma fuente de la exportación SVG/DXF.
- Las plantillas generan SCL estándar con `sxy:x/sxy:y` y `Terminal`/`ConnectivityNode`, de modo que el resultado abre en cualquier otra herramienta.
- La puesta a tierra usa `type="ERS"` (lo reconoce OpenSCD); a verificar contra herramientas de terceros.
- La ubicación del proyecto se guarda en `Private type="DSB-Project"` (namespace `urn:edesal:dsb:1`).
- Plantillas de campo: `linea`, `alimentador`, `trafo` (en `lib/project-model.ts`).
- Dibujo en cascada del transformador (`PowerTransformer`, 2 o 3 arrollamientos): el nivel de mayor tensión lleva su campo de transformador colgando de la barra; el transformador queda debajo, alineado con el TC; el 2.º arrollamiento baja recto al campo del nivel siguiente, que cuelga *encima* de su barra (`inverted`, `sxy:y` negativo). El 3.º arrollamiento sale por la izquierda y baja por un corredor a la izquierda de los campos hasta el tercer nivel. Los niveles se reubican con `cascadeRows` (15 filas entre el 1.º y el 2.º, 12 entre los siguientes).
- Con 2 transformadores en paralelo, el corredor del 2.º cruza la barra del nivel intermedio (cruce sin conexión). Conviene crear primero los transformadores y luego los demás campos.
- Sugerencia de nombre del campo de trafo: `<trafo>_<kV>` (ej. `TR1_132`, `TR1_13_2`).
