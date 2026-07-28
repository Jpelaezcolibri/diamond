# Vincular una línea para que Sofi escuche los grupos

Guía operativa de la **Fase 1** del diseño en
[docs/superpowers/specs/2026-07-28-sofi-grupos-whatsapp-design.md](superpowers/specs/2026-07-28-sofi-grupos-whatsapp-design.md).

Sofi escucha los grupos gremiales a través de un **dispositivo vinculado** a la
línea de un asesor — el mismo mecanismo que WhatsApp Web. **Ninguna línea
escribe nunca**: el sistema sólo lee.

> **Por qué no la API oficial.** Meta lanzó una Groups API en 2026 pero es
> inservible acá: máximo 8 participantes, exige tick verde, y prohíbe entrar a
> grupos creados por terceros. Los grupos gremiales tienen 100-250 miembros y
> los creó otra gente. La única vía técnica es el protocolo de WhatsApp Web,
> que está fuera de los ToS y hace baneable al número. De ahí que todo el
> diseño sea contención de riesgo.

---

## 1. Desplegar WAHA en Railway

Imagen: `devlikeapro/waha`. Desde 2026.6.1 es enteramente gratis y open source,
incluidas las sesiones múltiples.

**Variables:**

| Variable | Valor | Por qué |
|---|---|---|
| `WHATSAPP_DEFAULT_ENGINE` | `NOWEB` | **Crítico.** El motor por defecto (`WEBJS`) levanta un Chromium entero y pide 1 GB+ de RAM: no cabe en el plan de ~5 USD/mes. `NOWEB` habla el protocolo por websocket, sin navegador. |
| `WHATSAPP_API_KEY` | (generá uno largo) | Protege el API de WAHA. |
| `WHATSAPP_HOOK_URL` | `https://<bot>/webhook/grupos` | A dónde manda los mensajes. |
| `WHATSAPP_HOOK_EVENTS` | `message` | Sólo mensajes. Nada de `message.ack`, presencia ni typing: es ruido y superficie de exposición. |
| `WAHA_WEBHOOK_CUSTOM_HEADERS` | `[{"name":"x-api-key","value":"<GROUPS_WEBHOOK_SECRET>"}]` | El secreto con el que el bot autentica el webhook. |

**Volumen: no es opcional.** Montá uno en `/app/.sessions`. Sin él, cada
redeploy de Railway borra la sesión y **hay que pedirle al asesor que escanee el
QR otra vez** — y Railway redespliega en cada push a GitHub.

## 2. Configurar el bot

En las variables del servicio del bot:

```
GROUPS_WEBHOOK_SECRET=<el mismo valor del custom header>
GROUPS_ENABLED=true
GROUPS_FLUSH_MIN=5
```

Sin `GROUPS_WEBHOOK_SECRET` el canal **no se monta**: un endpoint que recibe
mensajes de WhatsApp sin autenticar no debe existir.

## 3. Correr la migración

`db/migrations/2026-07-28_grupos_whatsapp.sql` en el SQL Editor de Supabase.
No hay `db:push` en este repo: se corre a mano.

## 4. El pareo — con el asesor presente

**El QR caduca en segundos y se refresca.** No es algo que se le mande por
chat: hay que hacerlo con él delante, o en videollamada. Son dos minutos.

```bash
# 1. Crear la sesión
curl -X POST https://<waha>/api/sessions \
  -H "X-Api-Key: $WHATSAPP_API_KEY" -H "Content-Type: application/json" \
  -d '{"name":"asesor1","start":true}'

# 2. Abrir el QR en el navegador (se refresca solo)
#    https://<waha>/api/asesor1/auth/qr?format=image

# 3. Confirmar que quedó vinculada
curl https://<waha>/api/sessions/asesor1 -H "X-Api-Key: $WHATSAPP_API_KEY"
#    -> "status": "WORKING"
```

En su teléfono, el asesor va a **⋮ → Dispositivos vinculados → Vincular un
dispositivo** y apunta al QR.

**Verificá el payload real en el primer mensaje.** El canal asume la forma
documentada de WAHA (`payload.from` = JID del grupo, `payload.participant` =
quien escribió). Si el motor `NOWEB` difiere en algún campo, se ve en los logs
del bot y se ajusta `normalizar()` en
[src/channels/whatsapp-group.js](../src/channels/whatsapp-group.js).

## 5. Prender los grupos, de a uno

Al principio **no pasa nada**: todo grupo nace en modo `ignorar`. A medida que
lleguen mensajes, los grupos se van registrando solos (sólo el JID — nunca el
contenido) y aparecen en el CRM, en **Grupos**.

Ahí los prendés uno por uno:

| Modo | Qué hace |
|---|---|
| **Ignorar** | Sofi no lo ve. Es el default de todo grupo nuevo. |
| **Sombra** | Detecta y registra, sin avisarle a nadie. **Es el modo de la Fase 1.** |
| **Sugerir** | Avisaría al asesor con el borrador. Fase 2 — todavía no manda nada. |

Arrancá con **un solo grupo en sombra** durante dos semanas. Después mirás las
detecciones en el CRM y decidís.

---

## Lo que le prometés al asesor

Vale la pena decírselo con estas palabras, porque es literal:

> Un dispositivo vinculado recibe **todos** tus chats, no sólo los grupos — eso
> es inherente a WhatsApp, no hay forma de pedirle otra cosa. Tus mensajes
> privados van a llegar al servidor. Lo que hacemos es descartarlos en la
> primera línea del código, antes de cualquier registro, consulta o escritura:
> no llegan a existir en ningún lado. Y el sistema no puede escribir en tu
> WhatsApp: esa función no está apagada, no existe.

Las cuatro invariantes que sostienen eso están en el encabezado de
[src/channels/whatsapp-group.js](../src/channels/whatsapp-group.js), y cada una
tiene su test en [test/group-canal.test.js](../test/group-canal.test.js).

**Y el interruptor lo tiene él**: en cualquier momento, desde su teléfono,
**Dispositivos vinculados → Cerrar sesión**. El servidor queda ciego al
instante y su WhatsApp sigue idéntico, con todo su historial. No necesita
pedirle permiso a nadie ni esperar a que vos hagas nada.

## Reversibilidad

| Nivel | Acción | Quién | Tiempo |
|---|---|---|---|
| 1 | Bajar un grupo a `ignorar` en el CRM | Juan | segundos |
| 2 | `GROUPS_ENABLED=false` — el canal ni se monta | Juan | un redeploy |
| 3 | **WhatsApp → Dispositivos vinculados → Cerrar sesión** | **El asesor** | un toque |
| 4 | Borrar el servicio WAHA de Railway | Juan | minutos |

**Límite honesto:** los cuatro protegen de arrepentirse. Ninguno protege de un
baneo ya ocurrido — Meta banea el número, no el dispositivo vinculado. Por eso
ninguna línea escribe.

## Detector de humo

```bash
curl https://<bot>/webhook/grupos/estado -H "x-api-key: $GROUPS_WEBHOOK_SECRET"
```

Devuelve mensajes recibidos, descartados por el prefiltro, señales guardadas,
duplicados, lotes fallidos y el costo acumulado. Si la sesión se cae o WhatsApp
empieza a pedir re-pareo, es la señal temprana de que algo se torció.

## Qué NO hace la Fase 1

No avisa a nadie. No escribe en ningún grupo. No alimenta `ally_properties`
todavía. Todo eso es Fase 2, y se decide con las detecciones de estas dos
semanas a la vista.
