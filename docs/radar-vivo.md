# Radar en vivo — operación

Escucha de grupos gremiales por una línea vinculada, y respuesta automática
dentro del grupo. Este documento es para operarlo, no para entenderlo: el
diseño y el porqué están en los comentarios de cada módulo y en
[diamond-os/deep-dive-group-gateway-2026-08.md](../diamond-os/deep-dive-group-gateway-2026-08.md).

## Lo que hay que saber antes de encenderlo

**WAHA es un cliente NO oficial de WhatsApp.** El 2026-07-30 WhatsApp baneó la
línea de una asesora con este mismo montaje, y ese montaje **solo leía**. Lo que
se sanciona es el cliente, no la conducta: no existe una configuración "prudente"
que vuelva esto seguro. Responder en el grupo, que es lo que hace ahora, es
**más** riesgoso que aquello, no menos.

Lo único que protege es que la línea sea sacrificable.

| Línea | ¿Se puede vincular? |
|---|---|
| Secundaria de la empresa, sin clientes | **Sí** — es la única válida |
| La de Sofi (Cloud API) | **No.** Técnicamente imposible, y rompería la integración oficial |
| La de Catherine o cualquier asesor | **No.** Es la operación comercial |
| La de un cliente | **No** |

Se anota en `whatsapp_sessions.rol`. Si algún día hay que romper esta regla,
la función no se construye.

## Los tres interruptores, del más duro al más blando

1. **`GROUPS_WEBHOOK_SECRET` vacío** → el canal no se monta. La ruta no existe
   en el proceso.
2. **`GROUPS_ENABLED` ≠ `"true"`** → igual, y además los cuatro endpoints que
   hablan con WAHA responden `423`. *Este es el que faltaba en julio:* frenaba
   el webhook pero dejaba abierto "Vincular línea", así que un clic podía
   re-parear el número mientras Meta revisaba la cuenta suspendida.
3. **`GRUPOS_RESPUESTA_MODO`** → `sombra` redacta y registra sin publicar;
   `auto` publica; cualquier otro valor apaga la respuesta. Sigue escuchando.

Y dos permisos por grupo, independientes: `modo ≠ 'ignorar'` para escuchar,
`responde = true` para publicar. **Ambos nacen apagados.** Importar una línea
trae todos sus grupos de golpe — la asesora de julio tenía 80.

## Apagar de emergencia

Bajar el bot **no detiene WAHA**. Se comprobó en julio:
`WHATSAPP_RESTART_ALL_SESSIONS=False` tampoco — al redesplegar levanta la sesión
igual (`Restarting STOPPED session...`).

```bash
railway down --service waha
```

Y después **verificarlo en los logs, no asumirlo**. El baneo anterior se
descubrió porque Juan abrió una pantalla, no porque una alarma avisara.

Para apagar solo la respuesta sin perder la escucha, `GRUPOS_RESPUESTA_MODO=sombra`
y redesplegar. Para apagar un grupo puntual, `POST /api/grupos/responde` con
`responde: false` — no requiere deploy y funciona aunque el radar esté apagado.

## Encendido, en orden

1. Correr `db/migrations/2026-08-16_radar_vivo.sql` a mano en Supabase.
   Verificación: `select count(*) from whatsapp_groups where responde;` → `0`.
2. Levantar el servicio WAHA (motor `NOWEB`; `WEBJS` levanta Chromium y no cabe
   en el presupuesto). Sin dominio público, red privada de Railway.
3. Poner `GROUPS_WEBHOOK_SECRET`, `WAHA_URL`, `WAHA_API_KEY`, `BOT_PUBLIC_URL`
   y `GROUPS_ENABLED=true`. Dejar `GRUPOS_RESPUESTA_MODO=sombra`.
4. Vincular la línea dedicada por QR e importar sus grupos.
5. Habilitar **un** grupo de prueba propio: primero `modo`, después `responde`.
6. Dejarlo en sombra 24–48 h y revisar en `group_signals` lo que *habría*
   publicado (`respuesta_texto`, `respuesta_modo = 'sombra'`).
7. Solo entonces `GRUPOS_RESPUESTA_MODO=auto`, y solo en ese grupo.

## Qué revisar en la sombra

```sql
select fecha_mensaje, texto_original, respuesta_texto
from group_signals
where respuesta_modo = 'sombra'
order by respondida_at desc;
```

La pregunta no es si el mensaje se ve bien, es si **cada dato es cierto**:
precio, área, zona y disponibilidad, contra Wasi, propiedad por propiedad. Un
dato malo publicado ante 80 competidores se ve una vez y no se borra.

Para probar sin esperar a que entre un pedido:

```bash
node scripts/preview-respuesta-grupo.js --zona laureles --max 900000000
```

## Salud

`GET /webhook/grupos/estado` (con el header `x-api-key`) devuelve el modo y los
contadores del proceso: `recibidos`, `prefiltrados`, `difundidos`, `publicados`,
`sombra`, `callados`, `errores`.

Los contadores viven en memoria y se reinician con cada deploy. Lo que sí
persiste es `group_signals`: ahí está el texto de todo lo que se publicó.

## Límites que aplica solo

| Control | Variable | Default |
|---|---|---|
| Puntaje mínimo para publicar | `GRUPOS_RESPUESTA_UMBRAL` | 70 |
| Confianza mínima del clasificador | `GRUPOS_RESPUESTA_CONFIANZA` | 0.85 |
| Respuestas por grupo y día | `GRUPOS_RESPUESTA_MAX_DIA` | 3 |
| Minutos entre respuestas | `GRUPOS_RESPUESTA_COOLDOWN_MIN` | 20 |
| Horario (Colombia) | `GRUPOS_RESPUESTA_HORA_DESDE/HASTA` | 8–19 |
| Refs bloqueadas | `GRUPOS_REFS_BLOQUEADAS` | `9921388` |

Sobre el umbral: la escala de `match.js` va **de 55 a 100**, no de 0 a 100 — un
match necesita pasar operación, tipo, token exacto de zona y banda de precio
solo para existir con 55. Medido contra el inventario real el 2026-08-16, el
techo sin pedir alcobas es **73**; con el umbral en 80 el bot queda mudo.

El mismo aviso difundido a varios grupos se responde **una sola vez**
(`GROUPS_DEDUP_HORAS`, default 6). Medido el 2026-07-29: de 494 señales, 312
eran repeticiones.

## Lo que no hace, a propósito

- No responde ofertas de colegas, solo demandas.
- No publica inventario de aliados: el aliado puede estar leyendo ese grupo.
- No publica una propiedad sin precio, sin zona, sin área, no disponible, o con
  el sync viejo — ver `src/groups/publicable.js`.
- No se hace pasar por una persona: el mensaje se firma como automático.
- No reintenta un envío fallido. Un reintento ciego sobre algo que quizá sí
  salió es la forma más fácil de publicar dos veces en un grupo.
