# Sofi super agente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Que Sofi lleve cada conversación a una visita. Ofrece dos horarios reales, recuerda la visita y pregunta cómo le fue, su ficha vende, el seguimiento trae algo nuevo, el trato con el colega es claro y nadie espera sin que alguien se entere.

**Architecture:** Cambios acotados sobre módulos existentes. La agenda (`agenda-reglas`, `tools.js`) y la ficha (`buscar_propiedades`, `prompts.js`) cambian por dentro. El seguimiento del colega (`seguimiento-colega.js`) y la redacción (`redactar.js`) también. Se suman dos schedulers nuevos con interruptor (`visita-cliente.js`, `lead-esperando.js`).

**Tech Stack:** Node.js CommonJS, `node --test`, Supabase, Cloud API de WhatsApp, WAHA.

Spec: `docs/superpowers/specs/2026-10-21-sofi-super-agente-design.md` (LÉELA: secciones 1 a 4).

## Global Constraints

- Seguimiento solo hasta 24 h (regla de Juan). Nada nuevo le escribe al colega o al cliente después de eso, salvo el recordatorio y el mensaje posterior a una visita CONFIRMADA (sección 2.3 de la spec).
- Todo texto que sale va en tuteo profesional y cercano. El test de voseo (`test/dm-separados.test.js` y similares) debe cubrir los textos nuevos.
- Sofi nunca confirma una cita sola. Ofrecer horarios libres está bien. Decir "confirmada" o "agendada en firme", no.
- Nunca se inventa un dato. Los cálculos (`precio_m2`) los hace el código, no el modelo.
- A la asesora solo le llega por WhatsApp lo de visitas. Los avisos nuevos van por la campana del CRM (`notificar`). Las alertas técnicas van a Juan (`enviarAlertaTecnica`, `ALERTA_TECNICA_TO`).
- La ventana de 24 h de la Cloud API se respeta. Fuera de la ventana solo sale una plantilla configurada por env; si no hay plantilla, no sale nada y queda en el log.
- Interruptores con estos valores por defecto:
  - `SOFI_RECORDATORIO_VISITA`, `SOFI_POSTVISITA` y `RADAR_SEGUIMIENTO_CON_OPCION`: apagados.
  - `SOFI_ALERTA_ESPERA`: encendido.
  - `CITAS_ANTICIPACION_ARRIENDO_H`: 6.
  - `RADAR_LINEA_COMISION`: vacío, que deja el texto de hoy.
- Multi-tenant: todo se resuelve por `org`.
- Nada contra producción en tests. Commits en español con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Suite: `npm test` (base de esta rama: verificar al empezar; ~2.583).

---

### Task 1: Horarios ofrecidos y anticipación por operación

**Files:** `src/lib/agenda-reglas.js`, `src/agent/tools.js` (tool nueva `horarios_disponibles` + `agendar_cita`), `src/data/rotacion-citas.js` si hace falta, `src/agent/prompts.js` (reglas 34-A/34-B y su equivalente en el prompt de colega), tests.

- `agenda-reglas`: la anticipación mínima depende de la operación (venta = `CITAS_ANTICIPACION_MIN_H`, por defecto 24; arriendo = `CITAS_ANTICIPACION_ARRIENDO_H`, por defecto 6). Cambio retrocompatible: sin operación se comporta como hoy.
- `agendar_cita`: deduce la operación desde la propiedad (`ref`) o, si no hay, desde `lead.categoria` (alquiler → arriendo). Usa la anticipación que corresponde.
- Tool `horarios_disponibles({ ref?, operacion? })`:
  - Devuelve los próximos 3 espacios libres con `reglas.alternativas` sobre las citas ocupadas de los asesores del ciclo de rotación, igual que el camino de rotación de `agendar_cita` (tools.js ~l.488-492). Sin ciclo, usa el asesor principal.
  - Respuesta: `{ horarios: [{ iso, texto }] }`, con `texto` en español ("jueves 23 de octubre, 10:00 a. m.", hora de Bogotá).
  - Sin espacios en 14 días: `{ horarios: [], motivo }`.
- Prompt:
  - Reemplazar la 34-B por la regla de la spec §2.1: ofrece DOS opciones concretas de `horarios_disponibles` en un solo mensaje; si la persona propone otra hora, se usa la suya; luego `agendar_cita`.
  - Mantener la 34-A (una franja no se convierte en hora sin preguntar) y la 36 (queda SOLICITADA).
  - Lo mismo en el prompt de colega ("SI QUIERE LLEVAR A SU CLIENTE A VER UN INMUEBLE").
- Tests:
  - Anticipación por operación.
  - `horarios_disponibles` con ocupación de dos asesores, horario y anticipación.
  - `agendar_cita` de arriendo a 8 h sale y de venta a 8 h no.
  - El prompt contiene la regla nueva y no la vieja.
- Commit: `feat(sofi): ofrece dos horarios libres y la anticipacion depende de venta o arriendo`.

### Task 2: La ficha de Sofi vende

**Files:** `src/agent/tools.js` (`buscar_propiedades` ~l.654-687), `src/agent/prompts.js` (`FICHA_FORMAT` ~l.4-15 y reglas de cierre), tests.

- `buscar_propiedades` agrega a cada propiedad `precio_m2` (solo venta: `formato.parsearPrecio(precio) / formato.parsearArea(area)`, redondeado a miles, `null` si falta alguno o da algo absurdo) sin quitar campos.
- `FICHA_FORMAT` y el cierre, según la spec §2.4: gancho en la primera línea, sacado solo de datos de la ficha; precio con "(≈ $X por m²)" cuando haya `precio_m2`; cierre "¿Te la muestro esta semana? Te propongo dos horarios." en vez de "Responde SI".
- El prompt sigue en tuteo. Revisar que no queden instrucciones contradictorias ("Responde SI" en otras reglas).
- Tests: `precio_m2` (venta normal, arriendo → null, área faltante → null); el prompt contiene el cierre nuevo.
- Commit: `feat(sofi): la ficha trae gancho, precio por m2 y cierra proponiendo la visita`.

### Task 3: Recordatorio y mensaje después de la visita

**Files:** Crear `src/scheduler/visita-cliente.js` y su test; modificar `src/server.js`.

- Spec §2.3 completa: horarios (2 h antes y 3 h después), textos exactos, canal (Cloud API del org, `sendWhatsApp`; fuera de la ventana usa la plantilla de `SOFI_RECORDATORIO_PLANTILLA` / `SOFI_POSTVISITA_PLANTILLA` con `sendWhatsAppTemplate` si están, si no, no sale), una vez por cita (marca en `leads.cita`), excepciones e interruptores.
- Para saber si la ventana está abierta, usar el último mensaje del usuario en la conversación, con el mismo criterio y margen que `followups.js` (`ventanaAbierta`).
- El texto distingue cliente y colega (`lead.source === 'colega'` o como lo resuelva el engine). El alias público sale de `src/lib/identidad-publica.js`.
- Dependencias inyectables; tests con reloj falso.
- Commit: `feat(sofi): recordatorio de visita y pregunta despues de la visita`.

### Task 4: Seguimiento al colega con una opción nueva

**Files:** `src/scheduler/seguimiento-colega.js`, `src/groups/redactar.js` (si hace falta un formato corto de ficha), tests.

- Spec §2.5: en el toque de +4 h por la línea (lid, texto libre) y con `RADAR_SEGUIMIENTO_CON_OPCION=true`:
  - Se reconstruye el pedido desde la señal y se corre `match.cruzarDemanda` + `publicable.filtrar` (con aclaración si `publicable.dmConAclaracionActivo()`).
  - Se excluyen `respuesta_refs` y lo enviado en 7 días (fallar CERRADO: si no se puede saber qué se envió, no se agrega opción).
  - Se agrega UNA ficha corta al texto y se guarda la ref en `respuesta_refs`.
- Sin opción nueva, el texto queda como hoy. La plantilla de +24 h no cambia.
- Tests: con opción nueva, sin opción, ref ya enviada excluida, lookup que falla → sin opción, interruptor apagado → idéntico a hoy.
- Commit: `feat(radar): el seguimiento al colega trae una opcion nueva si la hay`.

### Task 5: Línea de comisión configurable

**Files:** `src/groups/redactar.js` (~l.396, 544, 557 y `postGrupo` ~l.602), `src/agent/prompts.js` (regla COMISION del prompt de colega), tests.

- Helper `lineaComision(org)`: devuelve `RADAR_LINEA_COMISION` si está definida, si no, el texto de hoy. Lo usan los tres sitios del DM y el post de grupo (en el post, si la variable está vacía, se mantiene "Comparto comisión con colegas 🤝").
- Prompt de colega: si la variable está definida, Sofi puede repetir ese texto exacto cuando le pregunten por la comisión. Si no, la regla de hoy.
- Tests: con y sin variable, en el DM y en el post. El texto fijo del clasificador (`classify.js`, `lexico.js`) NO se toca.
- Commit: `feat(radar): la linea de comision del DM y del post es configurable`.

### Task 6: Nadie espera sin que alguien se entere

**Files:** Crear `src/scheduler/lead-esperando.js` y su test; modificar `src/server.js`.

- Spec §2.7 completa: cada 5 min, de 8 a. m. a 8 p. m. Bogotá. Busca conversaciones cuyo último mensaje es del usuario y tiene más de 15 min sin respuesta posterior (la respuesta puede ser de Sofi o de la asesora).
  - Modo bot: una alerta técnica agregada a Juan por episodio ("Sofi no ha contestado a N clientes en 15 min"), que no se repite hasta que Sofi vuelva a contestar.
  - Modo humano: `notificar` a la asesora dueña (tipo `cliente_esperando`, link al chat del CRM), una vez por mensaje (marca en `leads.seguimiento.espera_alertada_msg_id`).
  - Interruptor `SOFI_ALERTA_ESPERA` (encendido por defecto).
- Excluir conversaciones de prueba, de asesores (`source = 'asesor'`) y mensajes que no esperan respuesta (ej. "gracias", "ok", si el engine ya los trata así; revisar cómo lo hace `followups.js`).
- Consulta eficiente: solo conversaciones con actividad en las últimas 48 h.
- Agregar el icono de `cliente_esperando` en `crm/components/campana.tsx`.
- Tests: modo bot, modo humano, una vez, horario, falla de consulta → no alerta.
- Commit: `feat(sofi): alerta cuando un cliente lleva 15 minutos sin respuesta`.
