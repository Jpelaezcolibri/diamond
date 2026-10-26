# Sofi le pregunta al asesor hasta tener la respuesta — diseño

Fecha: 2026-10-25 · Estado: diseño aprobado por Juan (2026-10-25) · Rama: `sofi-pregunta-al-asesor`

## 1. Por qué

Los colegas con un cliente en la mano hacen preguntas que Sofi no puede contestar, y se quedan
sin respuesta. Casos reales de la línea del radar, del 21 al 23-oct:

- **Andrea Strauch:** "Favor averiguar precio final, me puede servir para 2 clientes" (ref 10013037;
  Wasi dice $450 M y la descripción, $480 M).
- **Alberto Posada:** links "con nombre unidad". Nadie sabe si la 10229646 está en unidad cerrada.
- **AG Valores:** preguntó tres veces cómo se paga la comisión.

Las visitas tienen el mismo hueco del otro lado: la escalera rota la cita entre asesores, pero
**al llegar el plazo la cancela**, aunque el colega siga esperando.

**La regla de Juan (2026-10-24/25):** "cuando un colega está esperando una confirmación de un
asesor debes preguntar cuantas veces sea necesario para que tengas la información para
contestarle", para las visitas y para cualquier pregunta que Sofi no pueda contestar.

Decisiones de Juan (2026-10-25):

| Pregunta | Respuesta |
|---|---|
| ¿Dónde contesta el asesor? | **En los dos lados:** CRM o WhatsApp. Lo primero que llega cierra la pregunta. |
| ¿A quién y cada cuánto? | **Como la escalera de visitas:** el asesor de turno, se le repite a los 15 min, cada hora pasa al siguiente, sin límite; pausa de 8 p. m. a 8 a. m. y los domingos. |
| ¿Visita sin confirmar al llegar el plazo? | **Sigue hasta 2 h antes:** aviso único al colega "seguimos confirmando"; a 2 h de la visita sin confirmar, se cancela y se le ofrecen horarios nuevos. |

## 2. Alcance

**Entra:**
- Preguntas sobre una propiedad que Sofi no puede contestar con la ficha ni con sus herramientas
  (precio final o negociación, unidad o conjunto, administración, otro dato de la propiedad), de
  colegas **y** de clientes que escriben a la línea de Sofi (Cloud API). Es el mismo código; el
  caso de Juan es el colega.
- El nuevo final de la escalera de visitas.
- La pregunta y la respuesta en el CRM ("Para atender").

**No entra:**
- La línea del radar (WAHA). Ahí Sofi no contesta mientras `RADAR_SOFI_LINEA` esté apagado; cuando
  se encienda, se conecta en otra spec.
- Comisiones y condiciones comerciales. Sofi no las pregunta por esta vía: la regla vigente es
  "se confirma con el asesor" (Juan, 2026-10-24), y Sofi sigue diciendo eso.
- Que Sofi redacte la respuesta del asesor con sus palabras. Se pasa **literal** (§5.4): con números
  de por medio, reescribir es la forma de inventar.

## 3. Arquitectura

Enfoque elegido: **tabla nueva + escalera propia**, reutilizando las piezas de la escalera de citas.
Las visitas siguen en `leads.cita`.

```
colega ──► Sofi (engine, prompt colega/cliente)
             │ tool preguntar_al_asesor
             ▼
        preguntas_asesor (fila 'pendiente', asesor de turno)
             │ avisarAsesor(motivo 'pregunta')  ──► campana + push + "Para atender"
             │ mensaje con la pregunta           ──► WhatsApp del asesor (texto; plantilla si la ventana está cerrada)
             ▼
   scheduler preguntas-escalera (cada 5 min): reaviso 15 min · rota 60 min · pausa noche/domingo
             ▲
   respuesta ─┤ CRM: POST /api/preguntas/responder
              └ WhatsApp: asesor → engine (prompt asesor) → tool responder_pregunta
             │
             ▼
   entregarRespuesta ──► colega por la línea de Sofi (texto; plantilla si la ventana está cerrada)
```

### Unidades

| Archivo | Qué hace | Depende de |
|---|---|---|
| `db/migrations/2026-10-25_preguntas_asesor.sql` | Tabla e índices | — |
| `src/data/preguntas-asesor.js` | CRUD: `crear` (sin duplicar), `pendientesDeOrg`, `pendientesDeAsesor`, `porWamid`, `marcarRespondida`, `marcarEntregada`, `descartar`, `actualizar` | supabase / memory |
| `src/lib/preguntas-escalera.js` | Lógica **pura**: `pasoDePregunta({pregunta, ciclo, ahora})` → `nada` \| `reaviso` \| `rotar(nuevo)` | `agenda-reglas.enPausa` |
| `src/lib/pregunta-asesor.js` | Orquestación: `registrar` (crea y avisa), `avisar` (campana + WhatsApp), `responder` (cierra y entrega), `entregarRespuesta`, `textoRespuesta` | data, avisarAsesor, whatsapp, identidad-publica |
| `src/scheduler/preguntas-escalera.js` | Tick de 5 min: aplica `pasoDePregunta` a cada pendiente | lib, data, rotacion-citas |
| `src/agent/tools.js` | Tools `preguntar_al_asesor` (colega/cliente) y `responder_pregunta` (asesor) | lib |
| `src/agent/prompts.js` | Regla nueva en colega y cliente; bloque "PREGUNTAS PENDIENTES" en el prompt del asesor | — |
| `src/channels/whatsapp.js` | Respuesta citada: `context.id` = `wamid_aviso` de una pregunta → se la pasa al engine | data |
| `src/api/crm.js` | `POST /api/preguntas/responder` y `POST /api/preguntas/descartar` | lib |
| `src/scheduler/citas-escalera.js` | Nuevo final con `CITAS_SIN_CORTE` (§6) | — |
| CRM: `pendientes/page.tsx`, componente nuevo `pregunta-pendiente.tsx`, ruta `app/api/preguntas/route.ts` | Tarjeta con la pregunta, "Responder a Sofi", "Descartar" | `crm/lib/bot.ts` |

## 4. Datos

```sql
create table if not exists preguntas_asesor (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  ref text,                       -- propiedad por la que pregunta (puede faltar)
  tipo text not null default 'otro' check (tipo in ('precio','unidad','administracion','otro')),
  pregunta text not null,         -- en palabras de Sofi, corta: "¿Precio final de la ref 10013037?"
  estado text not null default 'pendiente'
    check (estado in ('pendiente','respondida','entregada','descartada')),
  asesor_id uuid references advisors(id),   -- asesor de turno
  asignada_at timestamptz not null default now(),
  reaviso_at timestamptz,
  wamid_aviso text,               -- wamid del WhatsApp al asesor (para la respuesta citada)
  respuesta text,
  respondida_por text,            -- nombre real del asesor (hacia adentro)
  respondida_via text check (respondida_via in ('crm','whatsapp')),
  respondida_at timestamptz,
  entregada_at timestamptz,
  entrega_error text,             -- por qué no le llegó al colega (ventana cerrada sin plantilla, solo llamada…)
  descartada_por text,
  created_at timestamptz not null default now()
);
create index if not exists preguntas_asesor_pendientes on preguntas_asesor (org_id, estado);
create index if not exists preguntas_asesor_wamid on preguntas_asesor (wamid_aviso);
create index if not exists preguntas_asesor_lead on preguntas_asesor (lead_id, estado);
alter table preguntas_asesor enable row level security;
```

- **Sin duplicados:** si el mismo `lead_id` tiene una fila `pendiente` o `respondida` (sin entregar)
  con la misma `ref` y el mismo `tipo`, `crear` devuelve esa fila y no avisa de nuevo.
- `leads.atencion_pendiente = 'pregunta'` mientras haya una pendiente (lo pone `avisarAsesor`; lo limpia
  `responder`/`descartar` si no queda otra pendiente en ese lead).
- La corre Juan; se verifica por REST antes de encender (regla del CLAUDE.md).

## 5. Flujo de una pregunta

### 5.1 Sofi pregunta (tool `preguntar_al_asesor`)

Entrada: `{ pregunta, ref?, tipo }`. Solo existe en el prompt de colega y de cliente, con
`SOFI_PREGUNTA_ASESOR` encendido.

Regla nueva en los dos prompts:

> Si te preguntan un dato de una propiedad que no está en la ficha ni en tus herramientas (precio final
> o si negocian, nombre de la unidad o si es unidad cerrada, administración u otro dato de la propiedad),
> NO lo inventes ni lo deduzcas: llama `preguntar_al_asesor` y dile "Le pregunto al asesor y apenas me
> responda te escribo." Nunca prometas una hora. Si es sobre comisión o condiciones, la respuesta sigue
> siendo que eso se confirma con el asesor; no uses la herramienta.

La tool devuelve a Sofi: `Pregunta registrada (N). Dile que le preguntas al asesor y le escribes apenas
responda. No prometas hora. No le des nombres ni números del equipo.`

### 5.2 Aviso al asesor

`registrar` elige el asesor de turno: el primero del ciclo (`rotacion.asesoresDelCiclo`, el mismo de las
citas) que esté activo. Después:

1. `avisarAsesor({ motivo: 'pregunta' })` con un motivo nuevo en `MOTIVOS`:
   `pregunta: { atencion: true, asigna: false, tipo: 'pregunta_asesor', whatsapp: 'una pregunta de un colega' }`.
   Título: `Pregunta de {quien} · Ref {ref}`; cuerpo: la pregunta. Link al chat.
2. **WhatsApp con la pregunta**, para que pueda contestar citándolo:
   `enviarYRegistrar` de `src/lib/mensaje-asesor.js` (texto, queda en su hilo del panel Equipo; con `permitirRepetido` en el reaviso) con
   `"Pregunta de un colega — Ref {ref}: {pregunta}\nRespóndeme este mensaje con el dato y se lo paso."`.
   Si la ventana del asesor está cerrada (`VENTANA_CERRADA`) y existe `SOFI_PREGUNTA_ASESOR_PLANTILLA`,
   va por esa plantilla (`pregunta_asesor`: `{{1}}` ref, `{{2}}` pregunta). Si no hay plantilla, queda
   solo la campana (el aviso `aviso_app` de `avisarAsesor` ya le avisa que mire el CRM).
   El `wamid` que se logre guardar va a `wamid_aviso`.
   **Sin datos del cliente** en el WhatsApp: ni nombre ni teléfono del colega (opción b de Juan).

### 5.3 La escalera (`pasoDePregunta`, pura)

Para cada fila `pendiente`:

- `enPausa(ahora)` (8 p. m.–8 a. m. y domingos) → `nada`.
- Pasaron ≥ 60 min (`PREGUNTA_PASO_MIN`) desde `asignada_at` y hay otro asesor activo en el ciclo
  → `rotar` al siguiente (orden del ciclo, circular). Se reinician `asignada_at`, `reaviso_at` y
  `wamid_aviso`, y se repite §5.2 con el nuevo. Al anterior le llega por la campana "ya la tiene {nombre}".
- Pasaron ≥ 15 min (`PREGUNTA_REAVISO_MIN`) desde `asignada_at`, y `reaviso_at` es null o anterior a
  `asignada_at` → `reaviso`: campana "Sigue pendiente: pregunta de {quien}" y el mismo WhatsApp otra vez.
- Si el ciclo tiene un solo asesor, `rotar` no aplica: se le repite cada 60 min (reaviso por paso).
- **Sin límite:** la pregunta sigue hasta que la contesten o la descarten en el CRM.

Fuera de la pausa, el tick corre cada `PREGUNTA_INTERVALO_MIN` (5). Tope por tick: 20 acciones (si hay más,
siguen en el próximo).

### 5.4 El asesor contesta

**Por el CRM:** tarjeta "Pregunta de colega" en "Para atender" (y en el panel del chat), con la pregunta,
la ref con su link de Wasi, desde cuándo espera y quién la tiene. Campo de texto "Responder a Sofi" y
botón "Descartar". La ruta del CRM llama al bot (`crm/lib/bot.ts`) con `{ preguntaId, respuesta, authUserId }`.
El bot exige un asesor activo (mismo criterio que `/api/citas/accion`); descartar también lo puede hacer
un admin.

**Por WhatsApp:** el asesor le escribe a Sofi.
- Si **cita** el aviso: `whatsapp.js` busca `preguntas_asesor.wamid_aviso = context.id` y le pasa al engine
  `preguntaId`. El prompt del asesor lleva: `RESPONDE LA PREGUNTA {id}: {pregunta}`.
- Si no cita: el prompt del asesor lleva el bloque "PREGUNTAS PENDIENTES" (todas las de la org, porque
  cualquiera del ciclo puede contestar, igual que con las citas), numeradas y con ref. Con una sola
  pendiente, se asume esa; con varias y sin forma de saber cuál, Sofi le pregunta cuál (en texto) antes de
  registrar. **Cambio frente al diseño presentado:** ahí decía "con botones"; en texto es más simple y sirve
  igual, porque el asesor ya está en una conversación abierta.
- Tool `responder_pregunta({ pregunta_id, respuesta })`, solo en el prompt del asesor. La regla: en
  `respuesta` van **las palabras del asesor**, sin reescribirlas ni completarlas.

Lo primero que llega cierra: `marcarRespondida` solo actualiza si `estado = 'pendiente'`. El segundo intento
recibe "Esa pregunta ya la respondió {nombre}".

### 5.5 Sofi le contesta al colega (`entregarRespuesta`)

Texto determinista, sin modelo de por medio:

```
Hola {nombre}, ya tengo la respuesta sobre la Ref {ref}:
{respuesta}
```

(sin ref: "sobre lo que me preguntaste"). Sin nombre del asesor ni celular (identidad pública).

- Por la línea de Sofi con `sendWhatsApp`. OK → `entregada`, `entregada_at`.
- Ventana de 24 h cerrada y existe `SOFI_RESPUESTA_LISTA_PLANTILLA` → plantilla `respuesta_lista`
  (`{{1}}` nombre, `{{2}}` ref): "ya tengo la respuesta sobre la Ref {{2}}. ¿Te la paso?". Queda `respondida`
  con `entrega_error='esperando_ventana'`. Cuando el colega escribe, el engine le agrega al contexto
  "RESPUESTA PENDIENTE DE ENTREGAR: …" y, después de que Sofi responde, se envía el texto de arriba y queda
  `entregada`.
- Sin plantilla, o si falla: `entrega_error` con el motivo, campana al asesor que contestó: "No le pude
  pasar la respuesta a {quien}: escríbele desde el chat". En el CRM la tarjeta queda en "Sin entregar".
- Colega "solo llamada" (`colegas.esSoloLlamada`): no se le escribe; `entrega_error='solo_llamada'` y
  campana: "Llámalo y dale la respuesta".

## 6. Visitas: el nuevo final de la escalera

Con `CITAS_SIN_CORTE` encendido, en `citas-escalera.js`:

- **Al llegar `corte_at` sin confirmar:** ya no se cancela. Se marca `cita.aviso_espera_at` y Sofi le
  escribe una vez al cliente/colega: "Seguimos confirmando tu visita del {cuándo} con el asesor. Te aviso
  apenas la confirme." (con la ventana cerrada no se manda nada: no hay plantilla para esto y no se crea
  una nueva). La escalera sigue rotando como siempre.
- **A 2 h de la visita** (`CITAS_CANCELAR_HORAS_ANTES`, 2) sin confirmar: se cancela por el camino de hoy
  (`cortar`: plantilla `cita_no_confirmada` y campana). Esto corre **aunque sea de noche o domingo**:
  es la última oportunidad de avisarle al colega.
- La pausa de noche y domingo sigue frenando la rotación y los reavisos, no el cancelar.
- Apagado (`CITAS_SIN_CORTE` sin definir): todo igual que hoy.

## 7. Interruptores y configuración

| Variable | Default | Efecto |
|---|---|---|
| `SOFI_PREGUNTA_ASESOR` | apagado | Expone las dos tools y arranca `preguntas-escalera`. Apagado: nada de esto existe. |
| `SOFI_PREGUNTA_ASESOR_PLANTILLA` | vacío | Nombre de la plantilla `pregunta_asesor` en Meta (para el asesor con la ventana cerrada). |
| `SOFI_RESPUESTA_LISTA_PLANTILLA` | vacío | Nombre de la plantilla `respuesta_lista` (para el colega con la ventana cerrada). |
| `PREGUNTA_PASO_MIN` / `PREGUNTA_REAVISO_MIN` / `PREGUNTA_INTERVALO_MIN` | 60 / 15 / 5 | Ritmo de la escalera. |
| `CITAS_SIN_CORTE` | apagado | Nuevo final de la escalera de visitas (§6). |
| `CITAS_CANCELAR_HORAS_ANTES` | 2 | Horas antes de la visita en que se cancela si nadie confirmó. |

Interruptor sin excepciones (regla de Juan): apagado, ningún camino nuevo envía nada.

**Plantillas que crea Juan en Meta (categoría Utilidad):**
- `pregunta_asesor`: "Tienes una pregunta de un colega sobre la Ref {{1}}: {{2}}. Respóndeme este mensaje con el dato y se lo paso."
- `respuesta_lista`: "Hola {{1}}, ya tengo la respuesta sobre la Ref {{2}}. ¿Te la paso?"

Sin plantillas, todo funciona por la campana del CRM y dentro de las ventanas abiertas.

## 8. Errores y casos borde

- **Fallo al avisar** (WhatsApp o campana): la pregunta queda creada igual; la escalera la vuelve a intentar en
  el próximo paso. Nunca se le dice al colega que ya respondieron.
- **Ningún asesor en el ciclo:** la pregunta se crea sin `asesor_id` (`notificar` no avisa sin asesor), se loguea
  `[preguntas] sin asesor en el ciclo`, se ve en "Para atender" para los admins y la escalera reintenta asignarla en
  cada paso. Sofi igual dice "le pregunto al asesor".
- **El lead se borra:** `on delete cascade`.
- **Respuesta vacía o de un solo carácter** desde el CRM: 400.
- **Asesor contesta una pregunta descartada o ya entregada:** "Esa pregunta ya está cerrada".
- **Doble respuesta simultánea:** gana la que actualiza primero (`where estado='pendiente'`).
- **Tabla ausente** (migración sin correr): la tool devuelve "no pude registrar la pregunta; dile que lo consultas
  con el equipo" y loguea `[preguntas] tabla preguntas_asesor no existe`; la escalera no arranca. Falla cerrado.

## 9. Pruebas

`node:test`, con dependencias inyectables como en `citas-escalera`:

1. `pasoDePregunta`: pausa de noche y domingo; reaviso a los 15 min (una sola vez por asignación); rotación a
   los 60 min en orden circular; ciclo de uno (reaviso por paso); sin límite de vueltas.
2. `preguntas-asesor.crear`: no duplica por lead + ref + tipo; sí crea con otra ref.
3. `registrar`: avisa con motivo `pregunta`; el WhatsApp no lleva nombre ni teléfono del colega; plantilla con
   la ventana cerrada; sin plantilla, solo campana.
4. `responder`: CRM y WhatsApp; la segunda respuesta no pisa; limpia `atencion_pendiente` solo si no queda otra.
5. `entregarRespuesta`: texto literal y sin alias ni celular; ventana cerrada con y sin plantilla; solo llamada.
6. `whatsapp.js`: una respuesta citada a `wamid_aviso` llega al engine con `preguntaId`.
7. Prompts: la regla está en colega y cliente; no hay voseo en los textos nuevos (el test de tuteo existente);
   con el interruptor apagado no aparece la tool.
8. `citas-escalera` con `CITAS_SIN_CORTE`: en el corte no cancela y avisa una sola vez; a 2 h cancela aunque sea
   de noche; apagado, igual que hoy.
9. API: 403 sin asesor activo; descartar de admin; 409 si ya está cerrada.
10. Suite completa en verde y `tsc --noEmit` del CRM.

## 10. Despliegue

1. Mockup de la tarjeta del CRM (`docs/superpowers/mockups/`) y aprobación de Juan antes del código del CRM.
2. Juan corre `2026-10-25_preguntas_asesor.sql`; se verifica por REST (`select id from preguntas_asesor limit 1`).
3. Merge y push a `main` con los interruptores apagados.
4. Encender `SOFI_PREGUNTA_ASESOR` y probar con una pregunta real (o la de Andrea); mirar `[preguntas]` en el log.
5. Encender `CITAS_SIN_CORTE`.
6. Cuando Meta apruebe las plantillas, poner los dos nombres en Railway.
