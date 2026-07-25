# Sofi bilingüe (ES/EN) — Design

**Fecha:** 2026-07-24 · **Estado:** PLAN pendiente de aprobación de Juan — sin código todavía.

## Problema

La landing ya tiene toggle ES/EN, pero el puente a WhatsApp está roto en inglés:
un visitante que navega en inglés y toca "Continue on WhatsApp" o "I want to
see it" llega a Sofi con un mensaje prellenado **en español** ("Hola, me
interesa la propiedad 9702941"), y Sofi lo atiende en español. Juan quiere que
si el cliente viene de la página en inglés, **Sofi sepa de dónde viene y lo
atienda en inglés desde el primer mensaje** — sin preguntas, atención inmediata.

## Estado actual (verificado en el código)

- `web/lib/whatsapp.ts` arma los `wa.me` con `config.contact.whatsapp.
  {propertyMessage, generalMessage, sellerMessage}` — strings en español fijos,
  resueltos en el **servidor** (no ven el idioma del cliente).
- `web/app/wa/[ref]/route.ts`: link corto para captions de Meta, mismo mensaje es.
- Bot: `engine.js:58-61` ya detecta la ref del mensaje prellenado
  (`property_ref_origen`) del PRIMER mensaje — el mismo patrón sirve para el
  idioma. No existe `leads.idioma` ni ninguna regla de idioma en los prompts.
- `buildClientLink` (notifications/advisor.js): el texto con el que el cliente
  contacta al asesor también es español fijo.

## Diseño

**Principio: el mensaje prellenado ES el canal del idioma.** Si la landing está
en inglés, el prellenado sale en inglés → el primer mensaje que recibe Sofi ya
viene en inglés → detección determinística (los prellenados son NUESTROS, los
conocemos exactos) + heurística de respaldo → se estampa `leads.idioma = 'en'`
una sola vez (igual que `property_ref_origen`) → el prompt instruye a Sofi a
atender 100% en inglés. Sin tokens extra de LLM para detectar, sin latencia.

### 1. Landing (`web/`)

- **Schema del tenant:** `whatsapp.propertyMessage/generalMessage/sellerMessage`
  pasan a `LocalizedString` (mismo patrón `{ es, en }` retrocompatible que ya
  quedó en `tenant-schema.ts`).
- **Links conscientes del idioma:** los CTAs a `wa.me` se resuelven en el
  cliente con el idioma activo. Nuevo hook `useWhatsAppUrl()` (o componente
  cliente `<WaLink>`) que arma la URL con el mensaje localizado; los server
  components le pasan número + par de mensajes en props. Afecta: header,
  mobile-nav, whatsapp-fab, footer, CTAs de la ficha de propiedad, hero/CTAs
  de secciones, success del lead-form.
- **Mensajes EN de Diamond:** `propertyMessage: "Hi, I'm interested in
  property {ref}"`, `generalMessage: "Hi, I'd like information about your
  properties"`, `sellerMessage: "Hi, I want to sell my property with you"`.
- **Lead form:** el POST del formulario suma `idioma` (del provider) para que
  el lead nazca marcado aun antes de abrir WhatsApp.
- `/wa/[ref]` acepta `?lang=en` (opcional, para futuros captions EN — baja
  prioridad, va al final).

### 2. Bot — detección y persistencia

- **Migración** `db/migrations/<fecha>_lead_idioma.sql`: `alter table leads
  add column if not exists idioma text;` (null = español, valor `'en'`).
  Best-effort en código, como todas las columnas nuevas.
- **`detectClientLanguage(text)`** (en `src/agent/intent.js`, junto a
  `detectSellerIntent` — mismo espíritu determinístico):
  1. Match exacto/prefijo de NUESTROS prellenados EN → `'en'` (100% confiable).
  2. Heurística de respaldo para quien escribe orgánicamente en inglés: señales
     léxicas ("hi", "hello", "I'm looking for", "apartment", "rent", "buy") sin
     señales españolas → `'en'`. Conservadora: ante la duda, español.
- **`engine.js`:** en el primer mensaje (mismo bloque de `property_ref_origen`),
  si `!lead.idioma` y detecta `'en'` → persistir. Nunca se reescribe solo (si
  el cliente pide cambiar de idioma, Sofi cambia conversacionalmente y una
  regla del prompt le dice que use `registrar_dato_lead`… **no**: para no
  crecer el alcance, v1 solo estampa en el primer mensaje; el cambio manual
  queda fuera de alcance).

### 3. Bot — atención en inglés

- **Prompt (`prompts.js`):** en el bloque volátil: si `lead.idioma === 'en'` →
  "EL CLIENTE VIENE DE LA PÁGINA EN INGLÉS: atiéndelo COMPLETAMENTE en inglés
  (saludos, fichas, preguntas de calificación, despedidas). Los datos de las
  propiedades (título/descripción) están en español: tradúcelos tú al
  presentarlos. Si el cliente cambia a español, síguelo en español." Regla
  estable adicional: responder siempre en el idioma del cliente.
- **`buildClientLink`:** cuando `lead.idioma === 'en'`, el texto prellenado
  cliente→asesor sale en inglés ("Hi, I'm Carlos. I'm interested in this
  property: …", "…I want to confirm the visit for…").
- **Alertas al asesor: SIEMPRE en español** (el equipo es hispanohablante),
  con una línea nueva bien visible: `Idioma: INGLÉS — este cliente se atiende
  en inglés`. Aplica a `buildAdvisorAlert`, `buildAppointmentAlert` y
  `buildCaptadorInterestAlert`.
- **Worker de seguimiento (2h):** el mensaje de follow-up al cliente respeta
  `lead.idioma` (plantilla EN espejo de la ES).

### 4. CRM (mínimo)

- Badge "EN" junto al nombre del lead en inbox/ficha (columna nueva leída con
  fallback — blindar el SELECT, gotcha conocido de migraciones pendientes).
  Opcional v1: puede diferirse.

## Fuera de alcance (v1)

- Cambio de idioma a mitad de conversación por comando explícito (Sofi lo hace
  conversacionalmente por el prompt, pero no re-persiste `idioma`).
- Traducir el contenido de las propiedades en la base (Sofi traduce al vuelo).
- Otros idiomas además de EN.
- Sofi-Comando (interno) en inglés — el equipo habla español.

## Testing

- `test/language-detect.test.js`: prellenados EN exactos → 'en'; español → null;
  mensajes ambiguos/cortos ("ok", "hola") → null; orgánico inglés → 'en'.
- `test/engine-idioma.test.js` (o dentro de tests existentes): estampa una vez,
  no re-estampa; best-effort si la columna no existe.
- `buildClientLink` EN con y sin cita; alertas asesor con línea de idioma.
- Follow-up EN.
- Suite completa `npm test` + `tsc`/build de `web/`.

## Verificación end-to-end

1. Migración a mano en Supabase (`leads.idioma`).
2. Landing local en EN → tocar "I want to see it" → el wa.me abre con el
   prellenado en inglés.
3. Enviar ese mensaje al número de prueba → Sofi responde en inglés, ficha
   traducida, calificación en inglés.
4. Transferir → alerta al asesor en español con "Idioma: INGLÉS"; link del
   cliente en inglés.
5. Cliente en español (flujo actual) → cero cambios de comportamiento.

## Orden de implementación propuesto

1. Migración + `detectClientLanguage` + estampado en engine (TDD).
2. Prompt + `buildClientLink` + alertas con línea de idioma (TDD).
3. Landing: mensajes bilingües + links client-side.
4. Follow-up worker EN.
5. (Opcional) badge EN en CRM.
6. Verificación e2e + deploy.
