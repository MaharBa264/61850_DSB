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

## Despliegue previsto en Rocky 8.10 (PLAN — aún no probado)

- Compilar con `pnpm install && pnpm build` (Node 22 + pnpm 11) en CI o en una máquina de build; en el
  servidor solo se publica el contenido de `dist/`.
- Servir con nginx (paquete del propio Rocky) o con el contenedor de `distribution/Dockerfile` vía
  podman (viene en Rocky 8). `nginx/default.conf.template` es la configuración de referencia.
- Nota: `pnpm install` descarga plugins externos desde `transnetbw-openscd.github.io` en el postinstall;
  el servidor de build necesita salida a esa URL (o hay que vendorizarlos).
- Backend futuro (usuarios/proyectos): detrás del mismo nginx, en `/api`.

## Hoja de ruta (propuesta)

1. [x] Editor GOOSE de solo lectura (grafo IED -> IED, detalle por enlace, enlaces sin GSEControl en rojo)
2. [ ] Editor GOOSE editable: crear/borrar enlaces escribiendo `ExtRef` mediante el sistema de acciones/undo de OpenSCD
3. [ ] Vista MMS (reportes/datasets) con el mismo enfoque de bloques
4. [ ] Unifilar editable
5. [ ] Backend: usuarios, proyectos, versiones, colaboración
6. [ ] Validaciones de ingeniería (ej. confRev, APPID/MAC duplicados, FCDA inexistentes)
