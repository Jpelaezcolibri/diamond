# Auditoría del ecosistema Diamond — por qué no genera visitas ni ventas

**Fecha:** 2026-08-01 · **Alcance:** bot Sofi + CRM + DMAP + landing REF + módulo
grupos · **Método:** datos de la Supabase de producción y Railway, contrastados
contra `ARCHITECTURE.md`, los specs de `docs/superpowers/specs/` y el informe
maestro de investigación de mercado.

Este documento no evalúa si el software está bien construido —lo está, y la
auditoría forense del 23-jul ya lo dijo—. Evalúa **por qué un sistema que
funciona no produce negocio**, que es una pregunta distinta.

---

## Resumen ejecutivo

El ecosistema está técnicamente sano y comercialmente inerte. Los cuatro
servicios están desplegados, el sync corre perfecto, los dos críticos de
seguridad de la auditoría anterior están cerrados. Y sin embargo:

**Cero de los 15 leads históricos vino de un anuncio. Cero vino de la landing.**

Ese dato, y no otro, es el diagnóstico. El `ARCHITECTURE.md` define a Sofi en su
primera línea como el agente que atiende a "personas que hicieron click en una
publicación de una propiedad (click-to-WhatsApp ad)". **Ese click nunca ha
ocurrido.** El sistema entero está construido río abajo de una fuente de
tráfico que jamás se abrió. La premisa central del producto no ha fallado: no
ha sido probada.

Los tres problemas por orden de impacto:

1. **No hay tráfico pago.** 0/15 leads con `ad_referral`. La verificación de
   empresa ante Meta —tarea de papeleo, no de código— es lo único que separa al
   sistema de su primera prueba real.
2. **Nada en el ecosistema crea demanda.** Sofi convierte, el CRM gestiona,
   DMAP publica presencia orgánica, la landing recibe. Las cinco piezas son
   aguas abajo. No existe una pieza aguas arriba.
3. **El esfuerzo de desarrollo apunta en dirección contraria a la estrategia
   decidida.** 41 commits en 7 días construyendo una función a medida y de alto
   riesgo para el cliente ancla, dos días después de que la investigación
   concluyera pivotar a producto autoservicio para independientes.

---

## 1. La medición, sin interpretación

| Métrica | 7 días | Histórico |
|---|---|---|
| Leads con `ad_referral` (vinieron de pauta) | 0 | **0 de 15** |
| Leads de la landing REF | 0 | **0** |
| Mensajes de clientes reales | ~0 | — |
| Mensajes totales | 15 (3 días) | 257 |
| Publicaciones generadas | **0** | 32 |
| Posts en Meta | **0** (último 16-jul) | 28 |
| Filas en `post_metrics` | 0 | **0 desde que existe el proyecto** |
| Corridas de sync | 7/7 OK | 69 |
| Commits | **41** | — |
| Negocios cerrados con valor registrado | 0 | **0** |

Los 15 leads históricos se reparten en: 9 `whatsapp` orgánico, 5 cargados por
un asesor, 1 `telegram` de prueba. El único `cerrado_ganado` tiene
`valor_cierre` en null y `closed_at` en null.

**No existe un solo peso de ingreso atribuible al sistema, ni la capacidad de
demostrarlo si existiera.**

---

## 2. Hallazgos

### 🔴 H1 — El embudo no tiene boca

**Categoría:** arquitectura de producto · **Evidencia:** `leads.ad_referral`
null en 15/15; ningún lead con `source` de landing

El flujo documentado en `ARCHITECTURE.md:98` es:

```
click en ad → wa.me con ref → webhook → lead → ficha → calificación → asesor
```

Todo desde el segundo paso está construido, probado y desplegado. El primer
paso no existe. La columna `ad_referral` se creó el 6 de julio precisamente
para medir esto y lleva 26 días midiendo cero.

**Por qué importa acá:** cada mejora que se le haga a Sofi, al CRM o a DMAP
multiplica por cero. Un sistema de conversión sin tráfico no tiene un problema
de conversión.

**Qué lo desbloquea:** la verificación de empresa ante Meta, listada como
bloqueante #3 en el informe maestro y como pendiente de negocio en `CLAUDE.md`
desde el 7 de julio. No es trabajo de ingeniería.

---

### 🔴 H2 — El documento de valor a los socios afirma cosas que los datos no sostienen

**Categoría:** riesgo comercial · **Ubicación:**
`diamond-os/valor-ecosistema-diamond.md`

| Afirmación | Realidad medida |
|---|---|
| "Publica de forma automatizada… sosteniendo presencia constante" | 0 posts en 16 días; 6 propiedades nuevas no generaron ninguna publicación pese a `auto_generate_on_new_property: true` |
| "Diamond sabe qué anuncio genera negocio y cuál trae ruido" | `post_metrics` = 0 filas históricas; 0 leads atribuidos a pauta |
| "Agenda citas en el calendario del asesor" | 5 recordatorios, cargados a mano |
| "Captura de datos de cada visitante" de la landing | 0 leads de la landing |

Matiz justo: la **capacidad** existe y está bien construida. La API de
Conversiones está implementada server-side en `web/services/tracking.ts` con
timeout y degradación limpia; el píxel está montado. Lo que no existe es el
dato, porque nunca pasó un lead por ahí.

**Por qué importa acá:** este documento es el sustento de la relación con los
socios y la base del pitch del pivote. Un socio que pida ver el tablero de
"qué anuncio genera negocio" encuentra una pantalla vacía. La credibilidad del
conjunto se juega en eso, y hoy el documento describe el sistema que se diseñó,
no el que está operando.

**Acción:** reescribir la sección 2.5 y las de medición en tiempo potencial
("está construido para…") hasta que haya datos, o —mejor— generar los datos
primero. No dejarlo como está.

---

### 🟠 H3 — El inventario no puede sostener el negocio que el sistema promete

**Categoría:** datos de dominio · **Evidencia:** 114 propiedades, `operacion` =
Venta en las 114; 17 con `zona` vacía

Dos problemas distintos:

**No hay arriendo.** Cero propiedades. Verifiqué que **no es un bug del sync**:
`dmap/src/sync/wasi-api.source.ts:248` hace dos pasadas explícitas
(`for_sale` y `for_rent`). Diamond simplemente no tiene arriendo cargado en
Wasi. Consecuencia: la regla de dominio #3 y #5 del `ARCHITECTURE.md` (nunca
mezclar venta y arriendo, transferir por especialidad), la migración de
rotación de asesores, y los asesores de arriendo en la tabla `advisors` sirven
a un caso que no ocurre.

Comercialmente pesa más: **la venta es un ciclo largo, de baja frecuencia y
ticket alto.** Con 114 propiedades y sin tráfico, la probabilidad de un cierre
en un trimestre es estructuralmente baja. El arriendo es el negocio de volumen
y de ingreso recurrente — y es el que llenaría el CRM de actividad medible.

**17 de 114 propiedades (15%) tienen la zona vacía.** Eso las hace invisibles
para la búsqueda de Sofi por zona, para el `match.js` de grupos (que compara
zona por token exacto) y para el copy de DMAP. Es el 15% del inventario
apagado, en silencio.

---

### 🟠 H4 — DMAP se detuvo solo y nadie se enteró en 16 días

**Categoría:** resiliencia / fallos silenciosos · **Evidencia:** última
publicación 16-jul; `org_marketing_settings.auto_generate_on_new_property` =
true; 6 propiedades creadas en la ventana sin generar nada

Es exactamente el patrón que la auditoría forense marcó como problema #3:
"fallos silenciosos como patrón… settings de DMAP que se guardan pero no hacen
nada". La conexión de Meta está sana (token validado el 30-jul), el sync entrega
eventos `created`, y aun así el pipeline no produce. Nadie tiene una alarma que
diga "hace dos semanas que no sale un post".

**Refactor:** un chequeo diario que compare eventos de inventario contra
publicaciones generadas y avise por el canal de Sofi si la razón es cero.
Barato y cierra la clase entera de fallo, no este caso.

---

### 🟠 H5 — El multi-tenant sigue siendo aspiracional, y ahora es prerrequisito

**Categoría:** violación de la regla del repo · **Evidencia:** ~20 políticas
`using (true)` en `db/migrations/`; `crm/lib/marketing.ts:147`
(`getDefaultOrgId` con `.limit(1)`)

`CLAUDE.md` cierra con "Multi-tenant siempre: no hardcodear datos de Diamond
donde debería resolverse por `org_id`". La realidad: cualquier usuario
autenticado lee leads, conversaciones y mensajes de todas las organizaciones, y
el CRM resuelve la org tomando la primera fila de la tabla.

Esto no duele con un tenant. El informe maestro lo dice sin ambigüedad: con el
pivote a 40 clientes pequeños **"pasa de deuda postergable a prerrequisito"**.
No se ha tocado.

---

### 🟠 H6 — La semana de desarrollo contradijo la decisión estratégica de la semana anterior

**Categoría:** gobernanza · **Evidencia:** 41 commits (28-30 jul) sobre el
módulo de grupos, contra el informe maestro del 26-jul

La investigación concluyó: pivotar a independientes, precio $110–250k,
**entrega autoservicio**, multi-tenant como prerrequisito, y —textual— *"Es otra
empresa: producto con embudo, churn y soporte, no consultoría. Con un
desarrollador se puede hacer bien una de las dos."*

Dos días después arrancó una función **a medida, para el cliente ancla, de
riesgo alto y no replicable** — la definición de consultoría. Terminó con el
WhatsApp de una persona baneado y 2.900 filas borradas.

No es un reproche al código, que es bueno. Es el señalamiento de que la
decisión estratégica no está gobernando la asignación de tiempo, que es el
único recurso escaso acá.

---

### 🟡 H7 — El registro de cierres no permite demostrar ROI

`leads` tiene `valor_cierre`, `closed_at` y `motivo_perdida` desde la migración
`2026-07-11_leads_cierre.sql`. El único lead en `cerrado_ganado` tiene los tres
en null. Mientras eso no se llene, la pregunta "¿cuánto dinero generó el
sistema?" no tiene respuesta posible — ni para los socios de Diamond, ni para
el pitch del pivote, donde el caso de éxito es literalmente el activo comercial.

---

## Lo que está bien hecho

No es cortesía: es lo que hay que **no** tocar.

- **El sync de Wasi.** 69 corridas, 7/7 exitosas esta semana, 0 errores, dos
  pasadas para venta y arriendo, hashes de contenido e imágenes. Es la pieza más
  confiable del ecosistema.
- **Los dos críticos de seguridad están cerrados.** C1 (firma HMAC de Meta) hoy
  vive en `src/lib/signature.js` y se aplica en `whatsapp.js:181`; C2 (endpoints
  `/test`) está gateado con `requireTestApiKey`. La auditoría del 23-jul se
  ejecutó.
- **La cola por usuario** (`src/lib/user-queue.js`) resolvió A2, que era el bug
  que rompía el camino feliz del producto.
- **El spec de grupos** es de una calidad poco común: declaró el riesgo por
  adelantado, diseñó cuatro invariantes de privacidad con test, y dejó escrito
  el límite honesto ("ninguno protege de un baneo ya ocurrido"). Falló la
  premisa, no el rigor.
- **La investigación de mercado.** 530 afiliados contados, 264 sitios
  analizados, 40+ competidores con precio verificado, y —lo más valioso— dos
  autocorrecciones documentadas, incluido el error de filtro circular.

---

## 3. Cómo se generan visitas y ventas — plan priorizado

Ordenado por impacto sobre esfuerzo. Los tres primeros no son de código.

### Paso 1 — Abrir la boca del embudo (S, no es código)

Cerrar la verificación de empresa ante Meta y lanzar **una** campaña CTWA sobre
las 3 propiedades exclusivas, optimizada a cliente potencial y no a
conversación (regla ya establecida en el playbook).

El instrumental de medición ya está: `ad_referral` captura la atribución en el
primer mensaje, la CAPI está implementada, el píxel montado. **Este es el único
paso que convierte todo lo demás en algo medible.** Hasta que ocurra, cualquier
otra mejora es especulativa.

Criterio de decisión a las 2 semanas: si 30 clicks pagos no producen ≥1 lead
calificado, el problema es Sofi o la oferta, y ahí sí hay trabajo de producto.
Hoy no se sabe cuál de los dos, porque no hay dato.

### Paso 2 — Cargar arriendo y arreglar las 17 zonas vacías (S, no es código)

El arriendo es el volumen. Las zonas vacías son el 15% del inventario invisible.
Ambas se resuelven en Wasi, del lado del cliente. Sin esto, el paso 1 pauta
sobre un catálogo incompleto.

### Paso 3 — Cerrar el circuito de la prueba (S)

Llenar `valor_cierre` y `closed_at` del negocio ganado, y hacer obligatorio el
campo al mover un lead a `cerrado_ganado` en el CRM. Es el activo comercial del
pivote: un caso de éxito con cifra.

### Paso 4 — Detector de silencio en DMAP (S)

Chequeo diario: eventos de inventario vs. publicaciones generadas. Si el
cociente es cero, avisar. Cierra H4 y la clase entera de fallos silenciosos.

### Paso 5 — Decidir Diamond vs. producto, en voz alta (M)

Las dos rutas son legítimas y excluyentes con un desarrollador:

- **Profundizar en Diamond** — cerrar el caso de éxito con cifras, hacer que la
  pauta funcione, y vender ese caso. Riesgo: un solo cliente.
- **Ejecutar el pivote** — multi-tenant real (H5) como primer sprint, entrega
  autoservicio, Embedded Signup. Riesgo: Diamond deja de recibir atención y el
  caso de éxito se enfría antes de estar probado.

Mi lectura: **los pasos 1–4 sirven a las dos rutas** —producen el caso de éxito
con números que el pivote necesita para vender—, así que la decisión puede
esperar 3 semanas. Lo que no puede seguir pasando es que se ejecuten las dos a
la vez sin decidir, que es lo que ocurrió en julio.

---

## 4. El módulo de grupos, sin riesgo de baneo

### Lo que el baneo enseñó, y que el spec no podía saber

El spec razonó que leer es seguro porque el riesgo era "que el número quede
marcado como spammer". Los logs demostraron otra cosa: la huella
`["Ubuntu","Chrome","22.04.4"]` desde IP de datacenter, `stream:error 503`, y
la cuenta caída 11 horas después.

**WhatsApp no sancionó una conducta. Sancionó un cliente no autorizado.** Da
igual leer, escribir o no hacer nada.

De ahí se deriva la única regla que importa:

> **Toda ruta que implique un cliente no oficial hablando el protocolo de
> WhatsApp está muerta, sin importar cuántas mitigaciones se le pongan
> encima.** WAHA, Baileys, pasarelas pagas que por dentro son Baileys, proxies
> residenciales: todas comparten el vector. El proxy residencial baja la
> detección; no elimina la huella del cliente.

Eso deja exactamente dos familias de soluciones viables: **que un humano saque
el dato del grupo**, o **que el dato se lea fuera del protocolo, en un
dispositivo con la app genuina.**

### Las rutas, evaluadas

| Ruta | Riesgo de baneo | Cobertura | Tiempo real | Esfuerzo | Veredicto |
|---|---|---|---|---|---|
| **A. Reenvío a Sofi** | **Cero** | Solo lo que el asesor decide | Sí | Ya existe | **Implementar** |
| **B. Export nativo del chat** | **Cero** | Total del grupo, en lote | No | Parser ya construido | **Implementar** |
| **C. Búsqueda en la red de inmobiliarias** | **Cero** | 58 sitios públicos | Sí | PoC validada | **Implementar** |
| **D. Dispositivo dedicado + lector local** | Bajo, no cero | Total | Sí | Alto | Solo si A/B/C se quedan cortas |
| ~~E. WAHA / Baileys / pasarela~~ | **Alto, demostrado** | Total | Sí | Hecho | **Prohibida** |
| ~~F. Groups API oficial~~ | Cero | Ninguna | — | — | Imposible (máx. 8 miembros, prohíbe grupos de terceros) |

### El replanteo que resuelve el 80% del problema sin tocar un grupo

El spec separó el valor en dos direcciones. Vale la pena releer su propia tabla:

| | **Oferta** (colega publica propiedad) | **Demanda** (colega busca algo) |
|---|---|---|
| Naturaleza | Acumulativa, persistente | Efímera, un solo tiro |
| Latencia | Irrelevante | Importa |
| Valor | Inventario que se acumula | Alerta que muere |

**La dirección de oferta —la de mayor valor por su propia definición— no
necesita los grupos.** Ya existe una fuente pública, legal y estructurada:
el spec `2026-07-26-busqueda-red-inmobiliarias-design.md`, con prueba de
concepto validada: **58 sitios en 11,5 segundos, 23 con resultados, 162
propiedades.**

Comparado con lo que daban los grupos, es mejor dato en todas las dimensiones:

| | Grupos (WAHA) | Red de sitios Wasi |
|---|---|---|
| Datos | Texto libre, sin precio/zona en gran parte | Estructurados: ref, precio, zona, fotos |
| Frescura | Caduca a 7 días, nadie avisa si se vendió | El sitio se actualiza solo |
| Dedup | Problema abierto (sin `ref`) | Resuelto por `ref` |
| Riesgo | Cuenta baneada | Ninguno |
| Contacto | `@lid`, no marcable — así se perdieron los 100 colegas | Publicado en el sitio |

Y hay un dato del propio desmantelamiento que lo confirma: de **1.630 mensajes
capturados automáticamente, solo 26 eran accionables (1,6%)**. El canal caro y
riesgoso producía casi puro ruido.

### El plan recomendado

**Fase A — ahora, riesgo cero, casi todo ya construido**

1. **Búsqueda en red** para la dirección de oferta. Es el spec ya validado; le
   da a Sofi "tu inventario es toda la ciudad" sin depender de nadie. Para el
   pivote a independientes —que no tienen inventario propio— esto no es un
   complemento, es el producto.
2. **Reenvío a Sofi.** Ya funciona: `registrar_propiedad_aliado` alimentó los
   21 aliados que sobrevivieron. Falta solo la pieza fácil: pedirlo
   explícitamente a los asesores y darles el hábito. Filtra mejor que la IA —
   el humano no reenvía los 1.604 mensajes de ruido.
3. **Carga de export `.txt` desde el CRM.** El parser está en
   `scripts/group-mining/`. Un asesor exporta 5 grupos clave los lunes: tres
   minutos, función nativa, cero riesgo. Cubre la oferta en lote.

Todo el motor de valor sobrevive intacto y es independiente del canal:
`src/groups/match.js` está validado contra datos reales (zona por token exacto,
precio como banda, "lo desconocido no descalifica"), la distinción entre aliado
verificado y visto en grupo, y los links siempre a la landing propia.

**Fase B — solo si la demanda en tiempo real demuestra valer**

Si tras 4–6 semanas de Fase A se comprueba que los pedidos de colegas en tiempo
real son un negocio real y no una intuición, entonces se evalúa la ruta D:

> **Un teléfono Android de la empresa, con su propia línea, con la app genuina
> de WhatsApp instalada, y un lector local que lee las notificaciones del
> sistema operativo.**

Por qué es categóricamente distinto a WAHA: **no habla el protocolo de
WhatsApp.** Los servidores de Meta ven un teléfono normal con la app oficial —
no hay huella de cliente no autorizado, que es exactamente lo que disparó el
baneo. La lectura ocurre del lado del sistema operativo, sobre notificaciones
que el dispositivo ya recibió.

Condiciones no negociables si se llega ahí:

- **Línea y equipo de la empresa. Nunca la línea principal de una persona.** Un
  baneo cuesta $400.000 y una SIM, no la red de contactos de un ser humano.
- **Canario obligatorio:** el dispositivo opera 3 semanas en un grupo de prueba
  antes de tocar un grupo gremial.
- **Watchdog desde el día uno.** El baneo anterior se descubrió porque Juan
  abrió una pantalla.
- **Kill switch verificado en logs, no asumido.** `GROUPS_ENABLED=false` no
  paró WAHA; lo único que lo detuvo fue bajar el servicio.

Límites honestos de la ruta D, para no repetir el optimismo del spec anterior:
las notificaciones llegan truncadas en mensajes largos; **los grupos silenciados
no notifican** —y los gremiales suelen estarlo—, lo que puede obligar a leer la
pantalla en vez de la notificación, que es más frágil; y para un producto
vendido a terceros, pedirle a un cliente que instale una app con permisos de
accesibilidad es una fricción de venta seria. **Por eso va después de probar el
valor, no antes.**

**Fase C — nunca**

Escritura automática en grupos por cualquier vía. El spec ya lo había cerrado y
el baneo lo confirmó.

### Regla que queda escrita

> **Ninguna línea de WhatsApp de una persona —asesor, cliente o propia— se
> conecta jamás a un cliente no oficial. Si una función lo exige, la función no
> se construye.**

Vale doble con el pivote: banearle el WhatsApp a un asesor independiente le
destruye el negocio, y al nuestro con él.

---

## 5. Secuencia sugerida

| # | Acción | Esfuerzo | Cierra |
|---|---|---|---|
| 1 | Verificación Meta + 1 campaña CTWA medida | S (no código) | H1 |
| 2 | Cargar arriendo + 17 zonas vacías en Wasi | S (no código) | H3 |
| 3 | Cerrar el negocio ganado con cifra; hacer el campo obligatorio | S | H7 |
| 4 | Detector de silencio de DMAP | S | H4 |
| 5 | Corregir `valor-ecosistema-diamond.md` a lo que es hoy | S | H2 |
| 6 | Grupos Fase A: búsqueda en red + reenvío + carga de export | M | grupos sin riesgo |
| 7 | Decidir Diamond vs. pivote, por escrito | — | H6 |
| 8 | Si sale pivote: multi-tenant real como primer sprint | L | H5 |

Los pasos 1 a 5 suman menos de una semana de trabajo y ninguno es un desarrollo
mayor. Tres de ellos no son de código. **Esa es la medida de cuánto del
problema actual no es técnico.**
