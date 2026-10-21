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

## Hoja de ruta (propuesta)

1. [x] Editor GOOSE de solo lectura (grafo IED -> IED, detalle por enlace, enlaces sin GSEControl en rojo)
2. [ ] Editor GOOSE editable: crear/borrar enlaces escribiendo `ExtRef` mediante el sistema de acciones/undo de OpenSCD
3. [ ] Vista MMS (reportes/datasets) con el mismo enfoque de bloques
4. [ ] Unifilar editable
5. [ ] Backend: usuarios, proyectos, versiones, colaboración
6. [ ] Validaciones de ingeniería (ej. confRev, APPID/MAC/IP duplicados **por subred**, FCDA inexistentes)
7. [ ] Instanciador de RTU desde ICD plantilla (nombre, IP, MAC/APPID, sustitución de GoID/rptID)
8. [ ] Soporte SV / merging units (requiere ICD/SCD de Siemens e Hitachi para verificar)
