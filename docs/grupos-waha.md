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
| `WHATSAPP_RESTART_ALL_SESSIONS` | `True` | Que la sesión vuelva sola tras un redeploy, sin volver a molestar al asesor. |

El webhook **no se configura acá**: lo aplica el bot al crear la sesión, con el
secreto y los eventos correctos (ver `src/lib/waha.js`). Configurarlo también
por variables llevaría a dos fuentes de verdad que se pisan.

**Volumen: no es opcional.** Montá uno en `/app/.sessions`. Sin él, cada
redeploy de Railway borra la sesión y **hay que pedirle al asesor que escanee el
QR otra vez** — y Railway redespliega en cada push a GitHub.

**No le generes dominio público.** Poné WAHA en el mismo proyecto que el bot y
que se hablen por la red privada de Railway. Importa más de lo que parece: WAHA
es quien tiene la sesión de WhatsApp del asesor, y expuesto a internet, quien
consiga la API key puede mandar mensajes haciéndose pasar por él. Sin dominio,
esa superficie no existe.

## 2. Configurar el bot

En las variables del servicio del bot:

```
GROUPS_WEBHOOK_SECRET=<el mismo valor del custom header de WAHA>
GROUPS_ENABLED=true
GROUPS_FLUSH_MIN=5
WAHA_URL=http://waha.railway.internal:8080
WAHA_API_KEY=<el WHATSAPP_API_KEY de WAHA>
BOT_PUBLIC_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
```

Sin `GROUPS_WEBHOOK_SECRET` el canal **no se monta**: un endpoint que recibe
mensajes de WhatsApp sin autenticar no debe existir. Sin `BOT_PUBLIC_URL` el
pareo crea una sesión que no le reporta a nadie.

> ### El puerto es 8080, no 3000
>
> La documentación de WAHA usa 3000 porque ese es su default con Docker suelto.
> **En Railway no.** Railway inyecta su propia variable `PORT` y WAHA la
> respeta, así que termina escuchando en 8080.
>
> El síntoma de equivocarse es `fetch failed` al vincular la línea — que se
> parece mucho a un problema de red privada y manda a uno a exponer WAHA
> públicamente sin necesidad. Antes de tocar nada, mirá los logs de WAHA y
> buscá la línea `WhatsApp HTTP API is running on: http://[::1]:XXXX`. Ese
> número es el que va en `WAHA_URL`.

## 3. Correr las migraciones

En el SQL Editor de Supabase, **en este orden**:

1. `db/migrations/2026-07-28_grupos_whatsapp.sql`
2. `db/migrations/2026-07-28_grupos_fase2.sql`

No hay `db:push` en este repo: se corren a mano.

## 4. El pareo — desde el CRM, con el asesor presente

Todo se hace en **CRM → Grupos**. El QR caduca en segundos y se renueva solo,
así que hay que hacerlo con el asesor delante o en videollamada. Son dos
minutos.

1. Poné un nombre para la sesión (ej. `asesor-andres`) y tocá **Vincular
   línea**. Aparece el QR y se refresca solo.
2. En su teléfono, el asesor va a **⋮ → Dispositivos vinculados → Vincular un
   dispositivo** y apunta al QR.
3. El estado pasa a `WORKING`. **Desde ese instante arranca el corte
   temporal** — la pantalla te muestra la fecha exacta.

> ### El corte temporal
>
> Al vincular, WhatsApp puede sincronizar historial. Ese historial es veneno
> para este caso: una propiedad publicada hace tres meses casi seguro ya se
> vendió, y recomendársela a un cliente real es daño de reputación.
>
> **Nada anterior al pareo se procesa**, y va en dos niveles: la sesión marca
> desde cuándo escucha esa línea, y cada grupo marca desde cuándo lo prendiste.
> Prender hoy un grupo no arrastra lo que se habló ahí la semana pasada. Un
> mensaje sin fecha también se descarta: si no se puede probar que es de hoy,
> no entra.

**Verificá el payload real en el primer mensaje.** El canal asume la forma
documentada de WAHA (`payload.from` = JID del grupo, `payload.participant` =
quien escribió). Si el motor `NOWEB` difiere en algún campo, se ve en los logs
del bot y se ajusta `normalizar()` en
[src/channels/whatsapp-group.js](../src/channels/whatsapp-group.js).

## 5. Importar los grupos y prenderlos de a uno

Con la línea vinculada, tocá **Importar grupos**: trae de una todos los grupos
en los que está esa línea, sin esperar a que llegue un mensaje en cada uno.

**Importar no es escuchar.** Entran todos en `ignorar`. Después los prendés uno
por uno:

| Modo | Qué hace |
|---|---|
| **Ignorar** | Sofi no lo ve. Es el default de todo grupo nuevo. |
| **Sombra** | Detecta y registra, sin avisarle a nadie. Para evaluar si acierta. |
| **Sugerir** | Recomienda de verdad — ver abajo. |

**Arrancá con un solo grupo en sombra durante dos semanas.** Después mirás las
detecciones en el CRM y recién ahí lo pasás a `sugerir`. Prender todo el primer
día es la forma más rápida de descubrir que el léxico necesita ajuste, pero
sobre alertas reales que le llegan al asesor.

## 6. Qué hace el modo `sugerir`

Las dos direcciones del valor, cada una por su lado:

**Una oferta** (un colega publica una propiedad) entra a `ally_properties`. A
partir de ahí, el circuito que **ya corre en producción** la usa solo: cuando
un cliente de Diamond pide algo que no está en el inventario propio, Sofi busca
en la red de aliados y avisa al asesor. No hubo que construir eso — sólo
abastecerlo.

- Caduca a los **30 días** (`ALLY_GRUPO_DIAS`). Una propiedad de grupo se vende
  y nadie avisa; ofrecerla igual es daño de reputación. Cuando el colega la
  republica ("sigue disponible"), la fecha se **refresca** en vez de duplicar
  la fila — que es exactamente lo que esa frase significa. Las que registra un
  asesor a mano **no caducan**: es el comportamiento histórico y no cambia.
- Una oferta sin precio, sin zona o sin tipo **no entra**: sería una fila
  muerta que Sofi nunca podría recomendar. Igual queda registrada como señal.

**Una demanda con match** (un colega busca algo que Diamond tiene) le avisa al
**asesor puente** —el dueño de la línea, que es quien tiene el acceso al grupo
y la relación con ese colega— por el número oficial de Sofi, con las refs que
calzan. Sin match no se avisa: la fatiga de alertas es el riesgo principal de
esta dirección.

El texto llega como **borrador, no como bloque para pegar tal cual**. Si el
asesor pega quince veces el mismo formato milimétrico, el grupo lo huele tan
rápido como a un bot. Que pase por sus manos es parte de la defensa.

**Sofi sigue sin escribir en ningún grupo.** El asesor publica él, desde su
teléfono.

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
