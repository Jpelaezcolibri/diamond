# Sofi en los grupos de WhatsApp de inmobiliarias — diseño

**Fecha:** 2026-07-28 · **Estado:** pendiente de aprobación · **Alcance:** Fase 0
(banco de pruebas offline). Las fases 1 y 2 quedan diseñadas pero no se
implementan hasta pasar la compuerta de la Fase 0.

## Problema

El gremio inmobiliario de Medellín se mueve por grupos de WhatsApp. Ahí los
colegas publican dos cosas de valor directo para Diamond:

- **Demanda:** "tengo cliente para apto 3 alcobas en Laureles hasta 400M".
- **Oferta:** propiedades propias que buscan comisión compartida.

Un asesor de Diamond está en **15+ grupos con más de 1.000 mensajes diarios**.
En la práctica no los lee. El negocio no se pierde por contestar lento: se
pierde porque **el mensaje bueno se traspapela entre mil saludos**.

Hoy Sofi no puede ayudar: su número corre sobre la Cloud API de Meta, que no
tiene acceso a grupos de terceros.

## Solución

Un **embudo de filtrado** que lee los grupos a través de la línea de un asesor
—en modo estrictamente de solo lectura—, descarta el ruido, clasifica lo que
queda como demanda u oferta, lo cruza contra el inventario de Diamond y le
entrega al asesor la oportunidad ya redactada, por el canal oficial de Sofi.

**El asesor sigue siendo quien envía el mensaje al grupo.** El sistema no
escribe nunca en WhatsApp por la línea de nadie.

## Hallazgo que condiciona todo el diseño

Meta lanzó una **Groups API oficial en 2026**, pero es inservible para este
caso, por diseño y no por implementación:

| Restricción oficial | Realidad de los grupos gremiales |
|---|---|
| Máximo **8 participantes** por grupo | Tienen entre 100 y 250 |
| Requiere **Official Business Account** (tick verde) | Diamond tiene la verificación de empresa pendiente |
| **No se puede entrar a grupos creados por terceros** — Meta lo trata como problema de privacidad. Solo se pueden crear grupos propios | Todos los grupos gremiales los crearon terceros |

Conclusión: **la vía oficial está cerrada de forma permanente.** La única ruta
técnica es el protocolo de WhatsApp Web (dispositivo vinculado), vía Baileys /
WAHA / pasarela paga. Eso está fuera de los ToS de WhatsApp y el número es
baneable — de ahí que la mitad de este documento sea contención de riesgo.

Fuentes: [Groups API — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups) ·
[WhatsApp Groups API 2026 Guide — imBee](https://www.imbee.io/resource/whatsapp-groups-api-business-guide-2026) ·
[Cloud API vs unofficial libraries](https://whatsapp.checkleaked.cc/blog/whatsapp-cloud-api-vs-unofficial)

## Decisiones tomadas

| Decisión | Valor | Por qué |
|---|---|---|
| Transporte | **WAHA self-hosted** (Docker en Railway, servicio aparte) | Emite webhooks con la misma forma que Meta ⇒ entra como un canal más en `src/channels/`. Si falla, migrar a pasarela paga es cambiar una URL. |
| Línea que escucha | **La de un asesor que ya está en los grupos** | Cero fricción social: no hay que pedirle a ningún admin que agregue a nadie. Un baneo daña a un asesor, no a Juan ni a producción. |
| Capacidad de escritura | **Ninguna. El módulo WAHA no implementa envío** | No es un flag apagado que alguien pueda prender con prisa: la función no existe. Test que lo verifica. |
| Quién publica en el grupo | **El asesor, a mano, desde su teléfono** | Riesgo de baneo ≈ 0 y riesgo social ≈ 0. Cuesta ~20 s por oportunidad. |
| Canal de aviso al asesor | **Número oficial de Sofi (Cloud API)**, vía `buildAdvisorAlert` | Camino legítimo, ya en producción, riesgo cero. |
| Default de un grupo nuevo | **`ignorar`** | Garantía de privacidad: un grupo solo existe para el sistema si Juan lo prendió a mano. |
| Multi-línea | **Sí, desde el día uno** | Leer no suma riesgo ⇒ la escucha escala sumando asesores. Diez líneas leyendo son tan seguras como una. |
| Tenant | Multi-tenant por `org_id` | Regla del repo. |

## Arquitectura — el embudo de 4 etapas

Esta es la pieza que sobrevive a todas las fases: el transporte puede cambiar,
el embudo no.

### Etapa 0 — Prefiltro (código puro, cero tokens)

Descarta sin gastar un token:

- mensajes de sistema ("X añadió a Y", cambios de asunto);
- multimedia sin texto (`<Multimedia omitido>`, stickers, audios);
- mensajes de menos de ~4 palabras;
- todo lo que no tenga **ninguna** señal inmobiliaria: ni palabra del léxico
  (`apto`, `busco`, `tengo cliente`, `se arrienda`, `permuta`…), ni cifra con
  forma de precio, ni zona conocida (reutiliza `zonaTokens` de
  `src/data/properties.js`).

**Deliberadamente tosco y permisivo.** Prefiere dejar pasar basura —cuesta
centavos— antes que matar una oportunidad —cuesta millones—. Su tasa de
descarte es la primera métrica del reporte, porque define el costo real.

### Etapa 1 — Clasificación y extracción (Claude Haiku, en lotes de ~20)

Los sobrevivientes van agrupados en un solo prompt; **el batching es lo que
hace que esto cueste centavos y no decenas de dólares.** Salida estructurada
por mensaje:

```json
{
  "id": "...", "clase": "demanda | oferta | ruido", "confianza": 0.0,
  "operacion": null, "tipo": null, "zona": null, "ciudad": null,
  "precio_min": null, "precio_max": null, "habitaciones": null,
  "contacto": null, "notas": null
}
```

`ruido` es una salida esperada y frecuente: la Etapa 0 es tosca a propósito.

### Etapa 2 — Cruce (código, gratis)

- `demanda` → [`properties.search()`](../../../src/data/properties.js) contra el
  inventario de Diamond, más `ally_properties`.
- `oferta` → se normaliza al shape de
  [`ally-properties.create()`](../../../src/data/ally-properties.js).
  **En Fase 0 no se escribe nada en la base**, solo se reporta.

### Etapa 3 — Salida

- **Fase 0:** un reporte HTML con métricas y la tabla cruda de detecciones.
- **Fase 1:** el mismo reporte, alimentado en vivo (modo sombra).
- **Fase 2:** alerta al asesor por el número oficial de Sofi, con borrador listo.

### La cuenta del costo

Con 1.000 mensajes/día y un descarte del 85% en la Etapa 0 quedan 150 → en
lotes de 20 son ~8 llamadas diarias a Haiku → **menos de 1 USD/mes**. Aun con
un descarte de solo el 50% no llega a 3 USD. **El embudo convierte el mayor
riesgo de costo en un no-problema, y la Fase 0 lo demuestra con datos reales.**

## Las dos direcciones del valor — no son el mismo problema

El embudo es común hasta la Etapa 1. De ahí en adelante, `oferta` y `demanda`
se comportan de forma opuesta y necesitan tratamiento distinto.

| | **Dirección 1 — Oferta** | **Dirección 2 — Demanda** |
|---|---|---|
| Qué es | Un colega publica una propiedad disponible | Un colega busca algo específico para su cliente |
| Para qué sirve | Recomendársela a un cliente propio de Diamond cuando el inventario no da | Ofrecerle a ese colega lo que Diamond sí tiene |
| Naturaleza | **Acumulativa y persistente** — se guarda y espera | **Efímera y de un solo tiro** — se alerta y muere |
| Latencia | Irrelevante: sirve dentro de tres semanas | Importa: a los tres días ya no vale |
| Destino | Fila en `ally_properties` | Alerta al asesor, sin persistencia de valor |
| Estado del código | **Ya existe y corre en producción** (`tools.js:229` → `allyProperties.search` → `buildAllyClientMatchAlert`). Solo le falta abastecimiento | **No existe.** Es el camino nuevo: `properties.search` + `buildAdvisorAlert` |
| Riesgo principal | Recomendar algo **desactualizado** a un cliente real | **Fatiga de alertas** en el asesor |

### Dirección 1 — brechas de integración detectadas

Enchufar los grupos al circuito de `ally_properties` que ya corre en producción
abre tres huecos que hay que cerrar **antes** de escribir la primera fila:

**1. La alerta se muere en silencio.** `tools.js:235` solo dispara la alerta
`if (ctx.allyMatch.registrado_por)`. Una propiedad detectada por Sofi en un
grupo no tiene asesor que la haya registrado ⇒ el match ocurre y nadie se
entera. **Decisión propuesta:** atribuirla al **asesor dueño de la sesión que
la detectó** — es su grupo y su relación con ese colega, así que es la
atribución natural y además justa para la comisión.

**2. Caducidad.** Una propiedad de un grupo se vende y nadie avisa.
Recomendarle a un cliente real algo que ya no existe es daño de reputación,
no un bug menor. **Decisión propuesta:** columna `visto_en_grupo_at` y
vencimiento automático a los **30 días**, filtrado dentro de
`allyProperties.search()` para que ninguna consulta pueda saltárselo. Las
registradas a mano por un asesor no caducan — solo las de origen grupo.

**3. Deduplicación sin `ref`.** El índice único actual es
`(org_id, contacto_telefono, ref)`, pero los mensajes de grupo casi nunca
traen referencia y los colegas republican la misma propiedad cada semana
("¡sigue disponible!"). **Decisión propuesta:** clave alternativa
`(org_id, contacto_telefono, tipo, zona, precio)` para las de origen grupo; una
republicación **refresca `visto_en_grupo_at`** en vez de crear una fila nueva —
que es exactamente lo que significa "sigue disponible".

Estas tres decisiones son propuestas del diseño y se implementan en la Fase 2,
cuando se empiece a escribir en la base. **La Fase 0 no escribe nada**, pero sí
mide si la extracción da datos lo bastante buenos como para que valga la pena.

## Multi-sesión y deduplicación

Cada asesor que suma su línea es una **sesión WAHA independiente** que aporta
sus grupos. Consecuencia inmediata: si dos asesores están en el mismo grupo,
el mismo mensaje entra dos veces.

**Deduplicación por `(org_id, group_id, wa_message_id)` antes de la Etapa 1.**
Sin esto se paga la IA dos veces y el asesor recibe la alerta duplicada. Va
desde el día uno: es barato ahora y molesto de retrofitear después.

Fallback si el `wa_message_id` no resultara estable entre dispositivos:
`(group_id, autor, timestamp redondeado a minuto, hash del texto)`.

## Límites de privacidad — no negociables

Un dispositivo vinculado recibe **todos** los chats, no solo los grupos. Es
inherente al protocolo: no hay forma de pedirle a WhatsApp que mande solo
grupos. Los mensajes privados del asesor **van a llegar al servidor**.

La única defensa honesta es arquitectónica. Estas cuatro invariantes se
escriben desde el primer commit y cada una lleva su test:

1. El webhook descarta cualquier `chatId` que no termine en `@g.us`
   **en su primera línea**, antes de cualquier log, consulta o escritura.
2. Descarta cualquier grupo que no esté en la lista blanca con modo distinto de
   `ignorar`.
3. El cliente WAHA **no exporta ninguna función de envío**.
4. Los mensajes clasificados como `ruido` **no se persisten** — mueren en
   memoria. Solo se guarda lo que es señal.

Esta es la promesa que le hacés al asesor para que acepte. Si se rompe una, se
rompe el trato.

## Fases y compuertas

| Fase | Qué hace | Riesgo | Compuerta para pasar |
|---|---|---|---|
| **0** | Export manual `.txt`, todo offline | **Cero** — la línea ni se toca | Criterio numérico (abajo) |
| **1** | Escucha en vivo, modo sombra. Sofi no avisa a nadie: llena un reporte que revisa Juan | **≈ Cero** | 2 semanas sin incidentes y con detecciones que valen |
| **2** | Escucha de los grupos que valgan, modo sugerir. Sofi avisa al asesor; **el humano envía** | **≈ Cero** | — **Este es el estado final del sistema** |
| ~~3~~ | Escritura automática en grupos | Alto | **No se construye** (ver abajo) |

## Fase 0 en detalle — lo que se implementa ahora

### Insumo

En cada grupo: `⋮ → Más → Exportar chat → Sin archivos`. Con 3 o 4 grupos
representativos alcanza. Los `.txt` van a una carpeta **fuera del repo**
(contienen datos de terceros) — se pasa la ruta por argumento.

### Archivos

```
scripts/group-mining/
  run.js            CLI: node scripts/group-mining/run.js <carpeta-exports>
  parse-export.js   parser del .txt de WhatsApp (multilínea, formato es-CO)
  lexico.js         léxico inmobiliario del prefiltro
  prefilter.js      Etapa 0  ← se promueve a src/ tal cual en Fase 1
  classify.js       Etapa 1  ← se promueve a src/ tal cual en Fase 1
  match.js          Etapa 2  — envuelve properties.search / ally-properties
  report.js         Etapa 3  — genera el HTML
```

`prefilter.js` y `classify.js` son el activo de largo plazo: están diseñados
para moverse a `src/` sin cambios cuando llegue la Fase 1. El resto es
descartable. No se crea estructura en `src/` todavía, por YAGNI: la Fase 0
existe precisamente para poder cancelar el proyecto barato.

Tests en `test/`, sobre el parser y el prefiltro (son determinísticos; la
clasificación no se testea contra la API real).

### Reporte

Un HTML con:

- **Métricas de embudo:** total de mensajes, descartados en Etapa 0 (%),
  clasificados como demanda / oferta / ruido, matches encontrados.
- **Proyección de costo** mensual en vivo, extrapolada del volumen real.
- **Tabla cruda de detecciones, separada por dirección** — mensaje original,
  clasificación, campos extraídos y refs que hicieron match. Es la que Juan
  revisa a mano. Las `oferta` marcan explícitamente cuáles quedarían
  **inutilizables** por falta de precio, zona o contacto.
- **Muestra de 100 mensajes descartados en Etapa 0**, para cazar falsos
  negativos. Es la sección más importante del reporte.

### Criterio de decisión — Fase 0 → Fase 1

Se pasa solo si **todas** se cumplen:

Se mide **cada dirección por separado**: pueden pasar las dos, una sola, o
ninguna. Si solo pasa una, se construye solo esa mitad — el embudo es el mismo.

**Comunes:**

| Métrica | Umbral | Por qué |
|---|---|---|
| Descarte en Etapa 0 | **≥ 70%** | Debajo de eso el costo deja de ser trivial y hay que rediseñar el léxico |
| Costo proyectado | **≤ 5 USD/mes** | Restricción de presupuesto del equipo |

**Dirección 2 — Demanda:**

| Métrica | Umbral | Por qué |
|---|---|---|
| Demandas reales detectadas | **≥ 5/día**, normalizado sobre el rango de fechas real del export | Menos que eso no justifica el sistema. Los exports abarcan meses: el reporte divide por días transcurridos, no por días con actividad |
| Demandas con ≥1 match en inventario | **≥ 30%** | Es la métrica de negocio: detectar sin poder responder no sirve |

**Dirección 1 — Oferta:**

| Métrica | Umbral | Por qué |
|---|---|---|
| Ofertas detectadas | **≥ 10/día**, normalizado igual | Es un inventario que se acumula: importa el caudal, no el pico |
| Ofertas con datos **utilizables** (tipo + zona + precio + contacto) | **≥ 60%** de las clasificadas como oferta | Una oferta sin precio o sin zona no se le puede recomendar a un cliente: es una fila muerta en `ally_properties` |
| Ofertas que sobrevivirían la dedup a 30 días | Se reporta, sin umbral | Mide el inventario real vs. el bruto. Sirve para dimensionar, no para decidir |

**Transversales:**

| Métrica | Umbral | Por qué |
|---|---|---|
| Precisión de clasificación | **≥ 80%** sobre una muestra de 100 mensajes **clasificados como demanda u oferta**, revisada por Juan | Mide falsos positivos: cuántas alertas serían basura para el asesor |
| **Falsos negativos** | **≤ 10%** sobre la muestra de 100 descartados en Etapa 0 | **La que más importa**: un mensaje bueno que el embudo mató es un negocio perdido y además invisible |

Si alguna falla: se ajusta léxico o prompt y se vuelve a correr — es offline y
gratis iterar. Si tras dos o tres iteraciones sigue fallando, **el proyecto se
cancela** habiendo gastado dos días y cero dólares de infraestructura.

## Modelo de datos (Fase 1, no se crea todavía)

```sql
whatsapp_sessions       (id, org_id, advisor_id, label, estado, created_at)
whatsapp_groups         (id, org_id, jid, nombre, modo, activo, created_at)
                        -- modo: 'ignorar' (default) | 'sombra' | 'sugerir'
whatsapp_group_sessions (group_id, session_id)   -- N:M
group_signals           (id, org_id, group_id, wa_message_id, autor_nombre,
                         autor_telefono, clase, confianza, operacion, tipo,
                         zona, ciudad, precio_min, precio_max, habitaciones,
                         contacto, texto_original, matches jsonb, estado,
                         created_at)
                        UNIQUE (org_id, group_id, wa_message_id)
```

Retención: `group_signals` se purga a los 90 días. Nada más almacena texto crudo.

## Lo que NO se construye — y por qué

**Escritura automática en los grupos (ex-Fase 3).** Se evaluaron tres rutas y
las tres se descartaron:

1. **Publicar desde la línea del asesor.** Técnicamente trivial y de riesgo
   más bajo de lo que sugiere la estadística genérica —5 mensajes contextuales
   diarios desde un número con años de historial no es el perfil que Meta
   banea—. Pero la **forma** del riesgo lo mata: probabilidad baja, impacto
   catastrófico (el asesor pierde su WhatsApp de trabajo con todo su historial
   de clientes), a cambio de ahorrar 15 segundos por oportunidad. Nadie firma
   ese trato.
2. **Una línea B desechable** (SIM prepago dedicada, riesgo transferido a un
   activo de $3.000). Elegante en el papel, **bloqueada por la realidad**: meter
   un número nuevo a estos grupos es muy difícil, los admins no agregan
   desconocidos.
3. **La Groups API oficial.** Imposible, ver arriba.

**El único camino realista a una línea que publique no es técnico sino de
negocio:** cuando un segundo asesor de Diamond entre a esos grupos por su
cuenta, como profesional, esa línea estará adentro legítimamente. Si eso pasa,
se reabre la discusión. No se fuerza.

**Consecuencia de diseño:** las fases 0, 1 y 2 no necesitan ninguna línea que
escriba y se construyen exactamente igual. **El 100% del valor de detección
está en pie sin asumir un gramo de riesgo de escritura.**

## Reversibilidad

Cuatro niveles, del más fino al más bruto:

| Nivel | Acción | Quién | Tiempo |
|---|---|---|---|
| 1 | Bajar un grupo a `sombra` o `ignorar` en el CRM | Juan | segundos |
| 2 | `GROUPS_ENABLED=false` — el servicio sigue vivo pero inerte | Juan | segundos |
| 3 | **WhatsApp → Dispositivos vinculados → Cerrar sesión** | **El asesor, solo, desde su teléfono** | un toque |
| 4 | Borrar el servicio de Railway | Juan | minutos |

El nivel 3 es el que hace esto vendible puertas adentro: **el asesor tiene el
interruptor en su propio bolsillo.** Al cerrar sesión el servidor queda ciego al
instante, y su WhatsApp sigue idéntico, con todo su historial — como cerrar
WhatsApp Web.

**Límite honesto:** los cuatro niveles protegen de arrepentirse. Ninguno
protege de un baneo ya ocurrido — Meta banea el número, no el dispositivo
vinculado. Es exactamente por eso que ninguna línea escribe.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Baneo de la línea del asesor | No escribe nunca. Un dispositivo vinculado que solo recibe es indistinguible de WhatsApp Web abierto. |
| Fuga de chats privados del asesor | Cuatro invariantes de privacidad con test, aplicadas en la primera línea del webhook. |
| WAHA se rompe al cambiar WhatsApp el protocolo | Interfaz de webhook igual a la de Meta ⇒ migrar a pasarela paga es cambiar una URL. |
| Costo de IA se dispara | Etapa 0 + batching + dedup. La Fase 0 lo mide antes de gastar. |
| Falsos negativos (el peor: invisible) | Sección dedicada del reporte con muestra de descartados. Umbral duro ≤10%. |
| Sesión desconectada sin aviso | Detector de humo: si la sesión cae o WhatsApp pide re-pareo repetido, alerta a Juan. Señal temprana. |
| El sistema no encuentra nada de valor | Es literalmente lo que la Fase 0 existe para descubrir, a costo cero. |

## Relación con otros módulos

- **`ally_properties`** — las `oferta` detectadas son el alimentador masivo que
  le faltaba a esa tabla. **El circuito de consumo ya corre en producción**
  (`tools.js:229` → `search` → alerta al asesor); este diseño solo lo abastece.
  Requiere cerrar las tres brechas de la sección "Dirección 1" —atribución,
  caducidad y dedup sin `ref`— antes de escribir la primera fila.
- **[Búsqueda en la red de inmobiliarias](2026-07-26-busqueda-red-inmobiliarias-design.md)**
  — complementario, no solapado: ese resuelve *buscar oferta cuando ya sabés qué
  necesitás*; este resuelve *enterarte de lo que se mueve sin preguntar*.
- **`src/notifications/advisor.js`** — el canal de aviso al asesor ya existe
  (`buildAdvisorAlert`, `buildAllyClientMatchAlert`). Se reutiliza, no se
  duplica.
- **Bot, CRM, DMAP, web** — sin acoplamiento. El servicio de grupos vive aparte
  en Railway, con su propia sesión y credenciales. Nada de lo que pase ahí puede
  tumbar producción.
