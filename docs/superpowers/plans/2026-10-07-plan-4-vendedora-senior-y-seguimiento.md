# Plan 4 — Sofi vendedora senior, memoria del colega y seguimientos

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Sofi atienda al colega como vendedora senior (resuelve dudas, ofrece similares, cierra con una pregunta de avance), que recuerde sus pedidos, lo que se le mandó y sus citas, y que haya seguimiento: +4 h del DM (plantilla si hay teléfono, línea de grupos si solo hay lid), +3 h y +24 h en la línea oficial.

**Architecture:** Prompt de colega reescrito en `src/agent/prompts.js`; `groupSignals.historialColega` + bloque volátil "LO QUE YA HABLAMOS"; el worker existente `followups.js` distingue al colega (3 h y tono de colega); worker nuevo `src/scheduler/seguimiento-colega.js` para el +4 h del DM y el +24 h por plantilla.

**Tech Stack:** Node.js, `node:test`, WhatsApp Cloud API, WAHA.

Spec: `docs/superpowers/specs/2026-10-07-sofi-vendedora-y-agenda-design.md` §5. Plantilla `seguimiento_colega` aprobada: `{{1}}` nombre, `{{2}}` pedido corto.

## Global Constraints

- Similares respetan las reglas literales del motor (zona, piso, parqueaderos literales; precio con margen): se buscan con `buscar_propiedades`, nunca inventadas.
- No repetir refs ya enviadas a ese colega (las del historial).
- Seguimientos: uno por pedido (+4 h DM), y en la línea oficial +3 h (texto) y +24 h (plantilla), y ahí para. Respetan `solo_llamada` y horas de silencio (20:00–08:00).
- +4 h por la línea de grupos: tope diario `RADAR_SEGUIMIENTO_TOPE_DIA` (default 30) y se frena si la cuota de WhatsApp está ≥ 80 %. Interruptores: `RADAR_SEGUIMIENTO_DM` y `SOFI_SEGUIMIENTO_COLEGA` (default `true`).
- Firma "— Sofi, asistente virtual"; sin nombres ni celulares de asesores.
- `npm test` en verde (baseline 2112).

### Task 1: Prompt de colega en rol de vendedora senior
**Files:** `src/agent/prompts.js` (bloque estable de `promptColega`); Test `test/prompt-colega-senior.test.js`
- Reemplazar "Tono profesional entre pares, sin discurso de ventas." por "Tono profesional entre pares, de vendedora senior: conocés el inventario, resolvés dudas con datos de la ficha y empujás el negocio sin presionar."
- Reemplazar "- No le cierres cada mensaje con una pregunta comercial." por "- Cerrá con UNA pregunta de avance concreta y fácil de responder (¿agendamos una visita?, ¿te paso más opciones?, ¿alguna duda de esta?). Una sola, sin presionar."
- Agregar a "QUE SI PODES HACER": "- Si lo que le mandamos no le sirve, preguntá qué falló (zona, precio, área, piso, parqueadero) y buscá SIMILARES con buscar_propiedades con ese ajuste. No le repitas refs que ya le mandamos (están abajo, en LO QUE YA HABLAMOS)." y "- Si llega con un link de agendar visita, preguntale a cuál de las opciones del pedido y el día y la hora."
- Test: el estable contiene "vendedora senior", "UNA pregunta de avance", "SIMILARES", "LO QUE YA HABLAMOS"; no contiene "sin discurso de ventas" ni "No le cierres cada mensaje".

### Task 2: Memoria del colega
**Files:** `src/data/group-signals.js` (`historialColega(orgId, { lid, telefono }, n = 5)`), `src/agent/prompts.js` (param `historial`), `src/agent/engine.js`; Test `test/historial-colega.test.js`
- `historialColega`: señales `demanda` con `respondida_at` cuyo `respuesta_destino_lid` (con o sin `@lid`) o `respuesta_destino_telefono`/`autor_telefono` sean del colega; últimas `n` por `created_at` desc; campos `created_at, texto_original, zona, tipo, operacion, respuesta_refs`.
- Bloque volátil: `LO QUE YA HABLAMOS (más reciente primero):` una línea por pedido: `- {fecha corta}: {tipo} {operación} en {zona} — le mandamos refs {refs}`; más `Citas: ...` si el lead tiene `cita` (estado + fecha + ref).
- `engine.js`: si hay `colega`, `historial = await groupSignals.historialColega(org.id, { lid: colega.lid, telefono: phone }).catch(() => [])` y pasarlo a `buildSystemPrompt`.
- Tests: memoria (dos señales del colega por lid con y sin sufijo, una de otro) → devuelve las dos; el prompt con `historial` contiene "LO QUE YA HABLAMOS" y las refs; sin historial no aparece el bloque.

### Task 3: Seguimiento de Sofi al colega a las 3 h
**Files:** `src/scheduler/followups.js`; Test `test/followups-colega.test.js`
- Para `lead.source === "colega"`: solo si el último mensaje (de Sofi) tiene ≥ `SOFI_COLEGA_SILENCIO_MIN` (180) min; `buildFollowupSystemPrompt(org, lead)` agrega: "Es un COLEGA de otra inmobiliaria, no un cliente: preguntale si alguna de las opciones le sirvió a su cliente y ofrecele buscar similares o agendar visita. No le preguntes presupuesto." Si `SOFI_SEGUIMIENTO_COLEGA=false`, los colegas se saltan.
- Respeta `solo_llamada` (`colegas.esSoloLlamada`): no se le escribe.
- Tests: el prompt de un colega trae la frase; un colega con 90 min de silencio no califica; con 200 sí (función pura `colegaListoParaSeguimiento(lead, last, ahora)`).

### Task 4: Worker seguimiento-colega (+4 h del DM y +24 h por plantilla)
**Files:** `src/scheduler/seguimiento-colega.js` (nuevo), `src/server.js`, `src/data/group-signals.js` (`listParaSeguimientoDm`, `marcarSeguimientoDm`), `.env.example`; Test `test/seguimiento-colega.test.js`
- `listParaSeguimientoDm(ahora)`: señales con `respuesta_modo='auto'`, `respondida_at` entre 4 h y 24 h atrás, `seguimiento_dm_at` null, `colega_escribio_at` null.
- Para cada una: si el colega respondió por la línea (`linea_dm` con `senal_id` = id o `remitente_lid` = lid después de `respondida_at`) → marcar `seguimiento_dm_canal='no_hizo_falta'` y seguir. Si `solo_llamada` → `'solo_llamada'`.
- Teléfono = `respuesta_destino_telefono` o `colegas_grupos.telefono` por lid. Con teléfono → plantilla `seguimiento_colega` `[primer nombre, pedido corto]` por la línea oficial (`'plantilla'`). Sin teléfono → texto por WAHA a `<lid>@lid` (`waha.enviarDm(sesion, null, texto, { lid, orgId })`): "Hola {nombre}, ¿te sirvió alguna de las opciones que te mandé? Si querés más o tenés dudas, escribile a Sofi 👉 {link con código}" (`'linea_grupos'`), solo si el tope diario no se pasó y `waha.cuotaDeLinea` < 0.8.
- Sofi +24 h: leads `source='colega'` cuyo último mensaje es de Sofi con ≥ 24 h, `seguimiento.t24_sent_at` puesto (ya salió el de 3 h) y `seguimiento.colega_24h_at` null → plantilla `seguimiento_colega`; marcar `colega_24h_at`.
- Horas de silencio: no corre de 20:00 a 08:00. Interruptores de Global Constraints. Cada 15 min.
- Tests (con deps inyectadas): con teléfono sale plantilla; solo lid sale por línea de grupos con el link y el código; si respondió no sale; tope diario lleno no sale por línea; de noche no corre.

### Task 5: Integración y despliegue
- `npm test`; merge a `main`; push; deploy SUCCESS; logs `[seguimiento-colega] activo`.
