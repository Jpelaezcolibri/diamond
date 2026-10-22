# Sofi en la línea del radar — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la línea del radar (WAHA) conteste hasta 3 mensajes por colega como "Sofi, la asistente virtual de Diamond Inmobiliaria", y calle si una persona del equipo escribió en ese chat.

**Architecture:** Módulo nuevo `src/groups/sofi-linea.js` con dependencias inyectables (mismo patrón que `puente-sofi.js`). `linea-dm.js` gana la columna `autor` y una lectura del estado de la conversación. `dm.js` llama a `sofi-linea` cuando `RADAR_SOFI_LINEA` está encendido y cae al puente de hoy si no.

**Tech Stack:** Node.js (CommonJS), `node:test`, Supabase, Anthropic SDK (`src/lib/anthropic.js`).

**Spec:** `docs/superpowers/specs/2026-10-21-sofi-en-linea-radar-design.md`

## Global Constraints

- Interruptor `RADAR_SOFI_LINEA`, apagado por defecto (solo `true`/`1`/`si`/`on` lo encienden).
- Tope: 3 respuestas de Sofi por identidad en 7 días.
- Persona en el chat: cualquier fila `direccion='salida'` con `autor` distinto de `'sofi'` (incluye `null`: antes de este cambio la línea nunca guardaba sus propios envíos) → Sofi calla para siempre.
- Sin la columna `autor`: falla cerrado al puente de hoy.
- Texto: tuteo, sin voseo; "asistente virtual"; sin nombres ni celulares de asesoras; ningún link fuera de los `linkWasi` de las fichas y el link oficial; el link oficial NO lleva el texto del colega.
- Pausa aleatoria de 8–20 s antes de enviar.
- Commits en español con prefijo convencional y la línea Co-Authored-By.

## Archivos

- Create `db/migrations/2026-10-21_linea_dm_autor.sql` — columna `autor`.
- Modify `src/data/linea-dm.js` — `create` acepta `autor`; nueva `estadoConversacion(orgId, identidad, { desdeIso })`.
- Modify `src/channels/whatsapp-group.js` — la salida humana se guarda con `autor: "humano"`.
- Modify `src/groups/puente-sofi.js` — exporta `SALUDA_A_SOFI`.
- Create `src/groups/sofi-linea.js` — decide, redacta, envía, avisa.
- Modify `src/groups/dm.js` — usa `sofi-linea` con el interruptor encendido.
- Create `test/sofi-linea.test.js`, `test/linea-dm-autor.test.js`.
- Create `scripts/sofi-linea-en-seco.js` — prueba en seco con la clave de producción.

### Task 1: columna `autor` en `linea_dm`

**Interfaces — Produces:**
- `lineaDm.create(orgId, { ..., direccion: "salida", autor: "sofi"|"humano" })`
- `lineaDm.estadoConversacion(orgId, identidad, { desdeIso })` → `{ faltaAutor: boolean, humano: boolean, respuestasSofi: number, hilo: Array<{ direccion, autor, texto, created_at }> }` (hilo: últimos 10, más viejo primero).

- [ ] Test (`test/linea-dm-autor.test.js`, memoria sin Supabase): una salida con `autor:"sofi"` cuenta en `respuestasSofi`; una salida con `autor:"humano"` o sin autor pone `humano=true`; una respuesta de Sofi más vieja que `desdeIso` no cuenta; el hilo trae entrada y salida en orden.
- [ ] Correr: `node --test test/linea-dm-autor.test.js` → falla (`estadoConversacion` no existe).
- [ ] Migración:
```sql
alter table linea_dm add column if not exists autor text;
alter table linea_dm drop constraint if exists linea_dm_autor_check;
alter table linea_dm add constraint linea_dm_autor_check check (autor is null or autor in ('sofi','humano'));
```
- [ ] `create`: `row.autor = fields.autor || undefined` (solo si viene). Si Supabase responde columna faltante con `/autor/`: marca `faltaAutor`; una fila `autor:"sofi"` NO se guarda (se leería como persona); otra se reintenta sin `autor`.
- [ ] `estadoConversacion`: lee `direccion, autor, texto, created_at` de la identidad, últimos 50. Si falta la columna `autor` → `{ faltaAutor: true, ... }`.
- [ ] Webhook (`whatsapp-group.js`, salida humana): agrega `autor: "humano"`.
- [ ] Tests pasan; commit `feat(linea): linea_dm sabe si la salida la escribio Sofi o una persona`.

### Task 2: `src/groups/sofi-linea.js`

**Interfaces:**
- Consumes: `lineaDm.estadoConversacion`, `lineaDm.create`, `puente.SALUDA_A_SOFI`, `linkContactoOficial`, `quitarLinksInventados`, `envio-colega.enviarAlColega`.
- Produces: `activo()`, `responder(org, { mensaje, señal, identidad }, deps?)` → `{ resultado: "apagado"|"sin_senal"|"falta_autor"|"humano_atiende"|"tope"|"respondido"|"respondido_fijo"|"envio_fallido" }`, `nombreParaSaludo(remitenteNombre, texto)`, `textoFijo(nombre, link)`, `SISTEMA`, `MAX_RESPUESTAS = 3`.

- [ ] Tests (`test/sofi-linea.test.js`, deps inyectadas):
  - apagado → `apagado`, no envía.
  - ni señal, ni colega, ni le habla a Sofi → `sin_senal`.
  - `faltaAutor` → `falta_autor`, no envía.
  - `humano=true` → `humano_atiende`, no envía, avisa por la campana.
  - `respuestasSofi=3` → `tope`, no envía, campana con "te toca".
  - camino feliz → envía el texto del modelo, guarda salida `autor:"sofi"`, campana; resultado `respondido`.
  - el modelo devuelve null → envía `textoFijo` con "asistente virtual" y el link; `respondido_fijo`.
  - el modelo devuelve un link inventado → se reemplaza; el `linkWasi` de la ficha y el link oficial pasan.
  - el link oficial lleva "PEDIDO (cód. 7S63)" y NO el texto del colega.
  - `nombreParaSaludo("Projency Inmobiliaria", "soy Luz Amparo Restrepo de Projency")` → `"Luz Amparo"`; `nombreParaSaludo("Projency Inmobiliaria", "hola")` → `null`; `nombreParaSaludo("Isabel Restrepo", "hola")` → `"Isabel"`.
  - `SISTEMA` y `textoFijo` sin voseo, dicen "asistente virtual", no nombran a Daiana/Claudia/Catherine.
  - envío falla → `envio_fallido`, no guarda salida.
- [ ] Implementación (resumen; el código va en el commit):
  - elegibilidad igual a `puente-sofi` (señal || colega || `SALUDA_A_SOFI`).
  - `desdeIso = ahora - 7 días`; orden: falta_autor → humano → tope → redactar.
  - contexto del modelo: número de respuesta (1..3), nombre para saludo, pedido (`texto_original`), fichas reales (`findByRef` de `respuesta_refs`, hasta 3, con `linkWasi`), hilo, link oficial, línea de comisión.
  - modelo `config.claudeModel`, `paramsDeModelo(m, { maxTokens: 600, sinThinking: true, outputConfig: { format: { type: "json_schema", schema } } })`, schema `{ texto: string }`.
  - pausa `deps.dormir(8000 + rand*12000)`; envío; `lineaDm.create(..., direccion:"salida", autor:"sofi", waMessageId: wamid || "sofi-<ts>")`; `respuestas-publicacion.marcarPuente`.
  - nunca lanza.
- [ ] Tests pasan; commit `feat(sofi): contesta hasta 3 mensajes en la linea del radar y calla si escribe una persona`.

### Task 3: conectar en `dm.js`

- [ ] Test (`test/sofi-linea.test.js`, cableado por lectura del fuente NO: con `require.cache` de `sofi-linea` y `puente-sofi` reemplazados): con `RADAR_SOFI_LINEA=true`, `procesarMensaje` llama a `sofiLinea.responder` y no a `tenderPuente`; si `responder` devuelve `falta_autor` o `apagado`, llama a `tenderPuente`.
- [ ] Implementación: en `dm.js`, en lugar de la llamada directa al puente:
```js
const sofiLinea = require("./sofi-linea");
let r = sofiLinea.activo()
  ? await sofiLinea.responder(org, { mensaje, señal, identidad }).catch((e) => ({ resultado: "error", error: e.message }))
  : { resultado: "apagado" };
if (r.resultado === "apagado" || r.resultado === "falta_autor") {
  r = await require("./puente-sofi").tenderPuente(org, { mensaje, señal, identidad, dmId: guardado.id }).catch((e) => ({ resultado: "error", error: e.message }));
}
```
- [ ] Suite completa `npm test` en verde; commit `feat(radar): la linea del radar pasa por Sofi con el interruptor encendido`.

### Task 4: prueba en seco

- [ ] `scripts/sofi-linea-en-seco.js`: arma el hilo de Luz Amparo (señal `d2bc1469-…`, sus 3 mensajes reales) y una pregunta de administración; llama a `responder` con `enviar`/`create`/`notificar`/`dormir` falsos e imprime los textos.
- [ ] Correr: `railway run --service diamond node scripts/sofi-linea-en-seco.js` y leer las respuestas.
- [ ] Commit `test(sofi): prueba en seco de Sofi en la linea del radar`.
