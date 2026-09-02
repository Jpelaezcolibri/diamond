# Grupos: rediseño visual de la página — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Fecha:** 2026-09-02
**Estado:** mockup aprobado por Juan ("me gusta así, dale"), en ejecución
**Spec previa:** [2026-09-02-grupos-dashboard-matches-design.md](../specs/2026-09-02-grupos-dashboard-matches-design.md) (datos, consultas, Realtime — no cambia)
**Mockup aprobado:** artifact privado `claude.ai/code/artifact/71b00490-688e-4800-9a06-49d04fb6ea52`

**Goal:** que `/grupos` deje de ser quince secciones apiladas con el mismo peso y pase a cinco zonas con jerarquía clara, color con significado, y las dos tablas de trabajo (entrada / salida) lado a lado.

**Architecture:** solo capa de presentación del CRM. Ninguna consulta nueva a Supabase, ningún cambio en el bot ni en el schema. `page.tsx` conserva todas sus consultas y el filtro `mias()` tal cual (lo vigila `test/crm-grupos-aislamiento.test.js`); lo que cambia es el JSX de salida y unos componentes que ganan una variante "embebida" para vivir dentro de una tarjeta contenedora.

**Tech Stack:** Next.js 15 (App Router, server components), React 19, Tailwind 4, `next/font/google` para la tipografía de títulos.

## Global Constraints

- Idioma de la UI: español (Colombia). Código en inglés salvo lo que ya está en español en este módulo (se respeta el estilo existente del archivo).
- Tema claro del resto del CRM se mantiene. El único bloque oscuro es la "isla" del dashboard (navy `#0b1526` + dorado `#c9a24b`, los colores de marca que ya usa el header del CRM).
- Cada consulta a `group_signals` sigue envuelta en `mias(` — `node --test test/crm-grupos-aislamiento.test.js` debe seguir en 6/6.
- Nada que hoy es solo-admin pasa a verse por un asesor (Posibles ventas, Inbox de la línea, Mensajes por asesora, Escucha en vivo, Matches sin entregar, métricas del radar).
- Sin librerías nuevas.

## Las cinco zonas (de arriba abajo)

1. **Cabecera compacta.** Título + una línea. A la derecha: chips de estado del radar (encendido/apagado, modo de respuesta) con su acción, y "Cargar grupos" como panel plegable (cerrado por defecto) que contiene el `ImportarExport` de siempre.
2. **Isla oscura — Dashboard de matches.** Dos carriles con sus KPIs de color sólido: Entrada (pedidos con match → índigo, bot resolvió solo → teal, asesora reenvió a mano → ámbar) y Salida (mandatos activos → azul, propiedades con match → verde, sin entregar → rojo con badge "atender", solo admin). Pie: barra de automatización (bot solo vs. a mano) y la tira del radar a N días (solo admin, viene del bot).
3. **Atención hoy** (solo admin): Posibles ventas · Inbox de la línea · Mensajes por asesora, tres tarjetas lado a lado con scroll interno.
4. **Grupos**: la barra plegable que ya existe, con conteo por origen (export / reenvío / en vivo) a la derecha.
5. **Trabajo diario**: carril Entrada | carril Salida, lado a lado, cada uno con encabezado de color, contador grande, filtros rápidos y lista con scroll propio. Cada tarjeta lleva una franja izquierda por estado (índigo nuevo, teal bot, ámbar a mano). Los "Matches sin entregar" (admin) van dentro del carril Salida, en rojo, debajo de los entregados.

Cierre: Mis mandatos de compra en grilla (con cuántos matches tiene cada uno), y "Escucha en vivo" plegada (solo admin).

## Mapa de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `crm/components/panel-plegable.tsx` | crear | Tarjeta plegable genérica con `<details>` nativo (server-safe, sin JS). Usada para Cargar grupos y Escucha en vivo. |
| `crm/components/dashboard-matches.tsx` | crear | La isla oscura: recibe los números ya calculados y pinta carriles, KPIs, barra de automatización y tira del radar. Monta `GruposLiveWatcher`. |
| `crm/components/carril.tsx` | crear | Contenedor de cada carril de trabajo (entrada / salida): encabezado de color, contador, cuerpo con scroll. |
| `crm/app/layout.tsx` | modificar | Carga Bricolage Grotesque con `next/font/google` como variable `--font-display` (no cambia la fuente del cuerpo). |
| `crm/app/(dashboard)/grupos/page.tsx` | modificar | Solo el JSX de retorno: reordena en las cinco zonas. Consultas intactas. |
| `crm/components/radar-toggle.tsx`, `modo-respuesta-toggle.tsx` | modificar | Prop `compacto`: versión chip para la cabecera. Misma lógica de acción y confirmación. |
| `crm/components/posibles-ventas.tsx`, `linea-dm-inbox.tsx`, `mensajes-por-asesora-panel.tsx` | modificar | Prop `embebido`: sin borde/redondeo propio cuando viven dentro de una tarjeta. |
| `crm/components/senales-grupos.tsx` | modificar | Prop `embebido`; filtros rápidos en pills (Con match / Por revisar / Bot resolvió / Todos) en vez del checkbox; franja izquierda por estado en cada `Ficha`; campos opcionales `politica_motivo` y `aviso_advisor_id` en `Signal`. |
| `crm/components/mandatos-panel.tsx` | modificar | `MandatosPanel` en grilla con prop opcional `conteo` (matches por mandato). `MatchesPendientesPanel` sin cambios de contrato. |
| `crm/components/grupos-panel.tsx` | modificar | Conteo por origen en la barra plegada. |

## Tareas

### Task 1: piezas nuevas (panel plegable, isla, carril, fuente)

**Files:** crear los tres componentes de arriba; modificar `crm/app/layout.tsx`.

**Interfaces (produce):**
- `PanelPlegable({ titulo: string; resumen?: ReactNode; abierto?: boolean; children })`
- `DashboardMatches({ admin, mandatosActivos, pedidosConMatch, pedidosPorRevisar, propiedadesConMatch, autoDm, autoDmError, reenvioManual, reenvioManualError, sinEntregar, metricas })` donde `metricas` es el tipo `Metricas` de page.tsx o `null`.
- `Carril({ tono: "entrada" | "salida"; titulo; descripcion; contador; herramientas?: ReactNode; children })`

- [ ] Crear los tres archivos y la fuente. `npx tsc --noEmit` limpio en `crm/`.

### Task 2: variantes de los componentes existentes

- [ ] `compacto` en los dos toggles; `embebido` en los tres paneles de "Atención hoy" y en `SenalesGrupos`; pills de filtro y franja por estado en `SenalesGrupos`; grilla + `conteo` en `MandatosPanel`; conteo por origen en `GruposPanel`.
- [ ] `npx tsc --noEmit` limpio. Ningún uso existente se rompe (las props nuevas son opcionales con el comportamiento previo por defecto).

### Task 3: reordenar `page.tsx`

- [ ] Reemplazar el JSX de retorno por las cinco zonas. No tocar nada por encima del `return`.
- [ ] `node --test test/crm-grupos-aislamiento.test.js` → 6/6.
- [ ] `npx tsc --noEmit` y `npm run build` limpios en `crm/`.

### Task 4: verificación, revisión y despliegue

- [ ] Levantar el CRM local (`diamond-crm` en `.claude/launch.json`) y revisar `/grupos` en el navegador: estructura, que nada solo-admin se filtre a un asesor, responsive a 1280 y a móvil.
- [ ] Revisión de código con subagente (correctness + aislamiento + regresiones de comportamiento en los toggles).
- [ ] Commit por hito (`feat(crm): ...`) y `git push origin main` (Vercel despliega solo). Actualizar la nota de estado en `CLAUDE.md` si aplica.

## Fuera de alcance

- Cambiar la fuente del cuerpo de todo el CRM (solo se agrega la de títulos, y solo se usa en `/grupos`).
- Persistir el estado abierto/cerrado de los paneles plegables.
- Cualquier consulta, migración o cambio del bot.
