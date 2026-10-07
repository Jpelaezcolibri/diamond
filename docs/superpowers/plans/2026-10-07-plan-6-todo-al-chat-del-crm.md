# Plan 6 — Todo al chat del CRM (el asesor atiende desde la app)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que toda transferencia, pedido de asesor y visita por confirmar se atienda en el chat del CRM (la conversación con el número de Sofi), asignada al asesor, con "Tomar conversación" / "Devolver a Sofi", confirmación de visitas dentro del chat y, por WhatsApp al asesor, solo un aviso corto de respaldo.

**Decisión de Juan (2026-10-07):** "toda comunicación de Sofi o de cualquier persona que escriba al número de Sofi y solicite un asesor, cualquier colega o cualquier agenda se haga directamente al chat que se va a crear en el CRM y que desde ahí se pueda tomar control". WhatsApp al celular del asesor: opción **b** — un aviso corto sin datos ("Tenés un pendiente en la app…"), plantilla `aviso_app`.

**Architecture:** Columna `leads.atencion_pendiente` (+ `atencion_desde`) marca por qué un chat espera a un asesor. Un único módulo del bot, `src/notifications/avisar-asesor.js`, asigna, marca, notifica (campana + push con link al chat) y manda el aviso corto. Reemplaza los textos completos al celular del asesor (transferencia, pedido de asesor, visita, captador, aliado). El CRM ordena el Inbox con los pendientes arriba, muestra la tarjeta de la visita con Confirmar / Otro horario y el tiempo que queda de ventana de 24 h; al tomar la conversación se limpia el pendiente.

## Global Constraints
- El cliente/colega nunca recibe un número de asesor; todo sale por el número de Sofi.
- El aviso por WhatsApp al asesor no lleva datos del cliente.
- Ventana de 24 h: el asesor escribe libre hasta 24 h después del último mensaje del cliente; el chat lo muestra.
- La rotación horaria de visitas sigue igual (lo que rota es el chat asignado).
- Bot `npm test` en verde; CRM `npm run build` sin errores.

### Task 1: Migración `2026-10-07_atencion_pendiente.sql`
`leads.atencion_pendiente text` (`pide_asesor` | `visita` | `transferido`), `leads.atencion_desde timestamptz`.

### Task 2: `avisar-asesor.js`
`avisarAsesor({ org, advisor, motivo, lead, titulo, cuerpo })`: si `motivo` es de atención, `leads.update(atencion_pendiente, atencion_desde, transferido_advisor_id = advisor.id)` (visita: no toca `transferido_advisor_id`, la dueña es `cita.asesor_id`); link `/inbox/<conversación activa>`; `notificar(...)`; plantilla `aviso_app` con el motivo legible (fallback: texto corto). Tests con deps.

### Task 3: Reemplazos en el bot
- `aviso-cita.js` → `avisarAsesor(motivo "visita")` (sin plantilla con datos).
- `pedirContactoAsesora` → `avisarAsesor(motivo "pide_asesor")`; sin texto completo ni copia al escalado.
- Transferencia (`whatsapp.js`) → `avisarAsesor(motivo "transferido")`.
- Captador / aliado → `avisarAsesor(motivo "aviso")` (informativo: no marca atención).
- Escalera y confirmar: sin textos al celular (quedan las notificaciones).
- Endpoint del bot `POST /api/citas/accion` (`x-api-key`) `{ leadId, accion, authUserId }` → `confirmar` / `pedirOtroHorario`; al pasar a `modo: humano` se limpia `atencion_pendiente`.

### Task 4: CRM
- Inbox: pendientes primero con insignia (🙋 / 📅 / 🔁) y pestaña "Pendientes".
- Chat: franja del motivo pendiente; tarjeta "📅 Visita por confirmar" con Confirmar / Otro horario (ruta `app/api/citas/accion` → bot); "Quedan X h para responder libre" o "Ventana cerrada: solo plantilla".
- `npm run build`.

### Task 5: Despliegue y verificación
Juan corre la migración; push; deploys; prueba con su número como colega.
