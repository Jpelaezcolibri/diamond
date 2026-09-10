# Colega "solo llamada", y un DM que dice a qué pedido responde

**Decisiones de Juan, 2026-09-10.** Diseño aprobado en conversación; este
documento es la fuente de verdad de lo acordado. Implementación en un plan
aparte. Son dos cambios en la misma rama porque comparten una pieza
(`numeroPedido`, §4.9):

- **A.** Un colega marcado "solo llamada" no recibe ningún DM; cada pedido
  suyo va al aviso de la asesora para que lo llame (§1–§4.8).
- **B.** Todo DM a un colega dice a qué pedido le estamos contestando (§4.9).

## 1. El caso que lo motivó

Ángela Moscoso (colega, nombre de WhatsApp "tengotuinmueblecomercial1")
le escribió a Sofi por la línea oficial el 2026-09-09 a las 4:12 p. m.
Verificado contra producción ese mismo día y el siguiente:

- Su queja de entrada: *"de la empresa me están enviando opciones pero no me
  describen para qué pedido es"*, *"es imposible revisarlo si no me envían
  los números de pedidos"*.
- Pidió *"que se comuniquen directamente a mi número telefónico 314 639 9667
  para hablar, no mensajes de texto"*. Sofi llamó `registrar_demanda_colega`
  y a Natalia le llegó el aviso con esa preferencia a las 4:13 p. m.
- Pidió después *"que no me envíen nada hasta que no me contacten
  telefónicamente"*. Sofi contestó "Ya está anotado" **sin llamar ninguna
  herramienta**. No quedó en ningún lado, y no había dónde guardarlo.
- A las 6:14 p. m. el radar le mandó un DM automático por el pedido 642 con la
  ref 10013129 (la cuarta vez que se la ofrecíamos), **sin decir a qué
  número de pedido respondía**.
- El 8-sep ya había escrito cuatro veces a la línea de Natalia ("Por favor
  quién me está mandando toda esta información", "?", "👆", "👆"). Nadie
  contestó: esa bandeja solo lee.

Medido el 2026-09-10 sobre las 1.240 demandas desde el 10-ago: **solo 47
(3,8 %) traen número de pedido**, y de las 297 que respondimos por DM, 20. El
número solo no alcanza: al 96 % hay que describirle el pedido.

## 2. Lo que decidió Juan

1. **Permanente.** No es "hasta que la llamen": es su forma de trabajar.
2. **Ningún DM** a un colega marcado, por ningún camino — ni automático ni
   manual.
3. **Cada pedido suyo que tenga algo para ofrecer va al aviso de la asesora**
   para que ella la llame.
4. **Su forma de pedir información es el número de pedido.** El aviso tiene
   que traerlo a la vista.
5. **Que el @lid no quede disponible y se filtren mensajes** (Juan, antes de
   correr la migración): marcar al colega por una llave y que el DM salga por
   la otra es exactamente la fuga a cerrar.
6. **La respuesta por DM a cualquier colega lleva el número del pedido
   original o su descripción**, para que sepa a qué pedido le contestamos
   (opción A de §4.9: número cuando exista + descripción corta siempre).

## 3. Lo que ya existe, verificado

| Pieza | Dónde | Qué aporta |
|---|---|---|
| La marca | `db/migrations/2026-09-10_colega_solo_llamada.sql` | **Corrida por Juan y verificada por REST el 2026-09-10**: el filtro `solo_llamada=true` responde, la fila de Ángela aparece marcada buscando por lid y por teléfono. |
| El colega con sus dos llaves | `colegas_grupos` (`lid`, `telefono`) · `src/data/colegas.js` | Una fila por colega, unique `(org_id, lid)`. |
| Lid ↔ teléfono | `directorio_lids` | El cruce entre las dos llaves. |
| El freno del DM automático | `src/groups/politica.js#decidirDm` | Código puro; todo "no" desvía al aviso de la asesora. |
| El aviso a la asesora | `src/groups/alerta-asesor.js#construir` + tabla `PORQUE` | Ya explica "por qué no salió solo", escala a Catherine, respeta el ritmo. |
| Resumen del pedido | `src/groups/alerta-asesor.js#queBusca` | Arma la línea "Busca:" del aviso con lo que clasificó el radar. |
| La única puerta de los DM | `src/lib/waha.js#enviarDm` | 7 llamadas en 5 archivos; todo DM a un privado pasa por aquí. |
| El texto del DM | `src/groups/redactar.js#mensajeGrupo` | Lo usan los cinco lugares que le escriben al colega: DM automático (`vivo.js#textoParaColega`), `aprobarManual`, `responderPorDmManual`, `prepararAviso` (página del aviso) y `alerta-asesor.js#mensajeListoParaReenviar`. |
| Número escrito en el pedido | `src/lib/contacto.js#telefonoEnTexto` (ya lo usa `alerta-asesor.js#contactoPara`) | Ya extrae el celular que el colega firma en su pedido. |

**Identidades de Ángela (verificado 2026-09-10):** una sola. Lid
`266150634110990` ↔ teléfono `573146399667`, igual en `directorio_lids`,
`colegas_grupos`, `leads`, sus 17 pedidos de grupo, los 8 DM que le mandamos
(los 8 por lid) y sus 4 mensajes a la línea de Natalia. Nadie más publica
pedidos con su número.

## 4. El diseño

### 4.1 Quién está marcado: tres llaves, no una

Una sola función en `src/data/colegas.js`:

```
esSoloLlamada(orgId, { lid, telefono, textoPedido }) -> true | false | null
```

- `true` si hay una fila de la org con `solo_llamada = true` que coincida por
  **cualquiera** de:
  1. el **lid** (dígitos, sin sufijo `@lid`);
  2. el **teléfono** (con las variantes de `variantesTelefono`), incluido el
     que `directorio_lids` asocia al lid, y el lid que asocia al teléfono;
  3. el **celular escrito en el pedido** (`telefonoEnTexto(textoPedido)`).
     Cubre que el colega publique desde otra cuenta de WhatsApp (otro lid).
     Un falso positivo solo desvía el pedido a la asesora, que es el lado
     seguro.
- `false` si se pudo consultar y no hay coincidencia.
- `null` si la consulta falló. **Falla cerrado:** quien la llama lo trata
  como marcado (no sale DM), con su propio motivo para que el aviso diga la
  verdad.

Y `marcarSoloLlamada(orgId, { telefono })` para la herramienta de Sofi
(§4.8).

### 4.2 El DM automático (`decidirDm`)

`decidirDm` recibe `soloLlamada` y lo revisa **primero**, antes de elegir la
vía (lid o teléfono):

- `true` → `no("colega_solo_llamada")`.
- `null` → `no("solo_llamada_no_verificable")`.

`vivo.js#asistir` resuelve el dato antes de llamar a `decidirDm`, con el lid
del autor, el teléfono resuelto y el texto del pedido. Las dos correcciones
de motivo que vienen después (compuerta de calidad y carril de arriendo)
solo pisan un motivo `"ok"`, así que este sobrevive tal cual. El pedido cae
al aviso de siempre: escalado a Catherine, freno de ritmo, bandeja de
salida, link del aviso.

### 4.3 Los caminos manuales

`vivo.js#aprobarManual` y `vivo.js#responderPorDmManual` consultan la marca
apenas tienen la señal y devuelven `{ resultado: "colega_solo_llamada",
telefono }` **sin enviar nada** y sin marcar la señal como respondida. La
consulta fallida (`null`) devuelve el mismo resultado.

Cada lugar que traduce esos resultados a palabras suma el suyo:
`src/agent/tools.js#aprobarPedidoRadar`,
`src/agent/sofi-comando-tools.js#aprobarPedidoRadarComando`,
`crm/components/senales-grupos.tsx` (el mapa de resultados del DM manual).
Texto: *"Este colega pidió que lo contacten SOLO por llamada. Llamalo al …"*.

### 4.4 Citas: cancelar y reprogramar

`src/groups/cancelar-cita.js#avisarAlColega` sale primero por la **Cloud API
oficial** (que no pasa por `enviarDm`) y después por WAHA. Si el colega está
marcado (por `lead.phone`, sea teléfono o lid), no intenta ninguno de los dos
y le avisa al equipo: *"Cita cancelada — llamá a X al … para avisarle (pidió
solo llamadas)"*. Devuelve `"solo_llamada"`. El registro de la cita cambia
igual, como hoy (regla 1 de ese archivo).

### 4.5 El candado final en `waha.enviarDm`

Todo DM a un privado pasa por `waha.enviarDm`. Adentro, antes de tocar la
red, consulta `esSoloLlamada` con el destino que va a usar (lid o teléfono).
Si está marcado, o la consulta falla, devuelve `{ ok: false, error:
"colega_solo_llamada", previoAlEnvio: false }` — `previoAlEnvio: false` para
que ningún llamador reintente por la otra vía.

Para consultar la marca por org, `enviarDm` exige `orgId` en las opciones;
sin `orgId` no envía. Las 7 llamadas actuales tienen la org a mano
(verificado, incluida `src/scheduler/ventana-asesora.js#runParaOrg`). El test
`group-canal.test.js`, que fija la cantidad de llamadas a `/api/sendText` en
`waha.js`, no cambia.

Los caminos de §4.2–4.4 ya frenan antes; este candado existe para que un
camino nuevo, o el endpoint de prueba `POST /api/grupos/waha/prueba-lid`,
no la esquive.

### 4.6 El aviso que le llega a la asesora

En `alerta-asesor.js#construir`, cuando el motivo es `colega_solo_llamada`:

- Cabecera: **`📞 LLAMAR — Pedido N° 645`** en vez de "Oportunidad en un
  grupo" / "OPORTUNIDAD APROBADA".
- `Contacto:` el número para marcar (`+57 314 639 9667`), no un link
  `wa.me`.
- `Por qué no salió solo:` *"Pidió que la contacten SOLO por llamada — nada
  de mensajes. Llamala vos."* (entrada nueva en `PORQUE`).
- Se quitan el bloque "⚡ mandale ESTO YA por su privado" y la invitación a
  escribirle a Sofi.
- El resto se queda igual: lo que busca, lo que escribió, las propiedades,
  las dudosas, lo apartado y "Sofi dice".

`solo_llamada_no_verificable` usa el mismo formato con otra razón: *"No
pudimos confirmar si este colega acepta mensajes, así que el bot no le
escribió. Llamalo vos."*

**Número de pedido, en todos los avisos** (no solo en los de ella): con
`numeroPedido` (§4.9) el aviso suma la línea `Pedido: N° 645`. Si el texto no
trae número, la línea no sale.

Las otras dos tablas de motivos suman las entradas nuevas:
`src/groups/digest-avisos.js` y el mapa de `crm/components/senales-grupos.tsx`.

**Un pedido sin nada que ofrecer no genera aviso**, igual que hoy: no habría
de qué llamarla.

### 4.7 La página del aviso (`/aviso/[token]`)

`vivo.js#prepararAviso` devuelve `soloLlamada: true` y el teléfono. En
`crm/components/aviso-celular.tsx`, para ese colega:

- El botón verde "💬 Enviar por WhatsApp" / "📋 Copiar y abrir WhatsApp" se
  reemplaza por **"📞 Llamar a {nombre}"** (`tel:`).
- No se muestra el mensaje redactado.
- Una franja arriba: *"Pidió que la contacten solo por llamada."*
- Tocar "Llamar" registra la gestión igual que hoy (`envio`), con la etiqueta
  "Ya la llamaste".

**Mockup en HTML antes de tocar el componente** (regla de Juan para cambios
visuales del CRM).

### 4.8 Sofi

Herramienta nueva `marcar_colega_solo_llamada`, definida junto a las demás
en `src/agent/tools.js`. Solo se ejecuta con `ctx.colega`; con cualquier otro
interlocutor devuelve un rechazo.

- Busca al colega por `ctx.lead.phone` (el teléfono desde el que escribe) en
  `colegas_grupos` y, si no aparece, por el lid que `directorio_lids` le
  asocia.
- **Si lo encuentra:** lo marca, le avisa a la asesora principal del radar
  (*"{nombre} pidió que la contacten solo por llamada. Desde ahora sus
  pedidos te llegan a vos para llamarla: +57 …"*) y le devuelve a Sofi un
  texto para confirmárselo.
- **Si no lo encuentra** (colega sin fila en los grupos): no marca nada, le
  avisa igual a la asesora con esa aclaración, y le devuelve a Sofi un texto
  que **no** dice "anotado".

`promptColega` suma una regla: si el colega pide que no le escriban o que
solo lo llamen, usar la herramienta; nunca decir "quedó anotado" sin su
resultado.

### 4.9 El DM dice a qué pedido responde

**El número.** `numeroPedido(texto) -> string | null`, en un módulo
compartido de `src/groups/` (lo usan el DM y el aviso de §4.6). Reconoce los
formatos reales medidos en producción:

- la palabra "pedido" seguida del número, con cualquier adorno en el medio
  (hasta 8 caracteres que no sean letras ni dígitos): `PEDIDO 👉 645`,
  `_*PEDIDO 👉 645*_`, `Pedido #201`, `Pedido 12026`, `Pedido 02👈`;
- el código `C_647`.

Un `#123` **suelto** no se acepta: puede ser una dirección ("Calle 10 #43")
o un número de apartamento, y un número de pedido equivocado confunde más
que no ponerlo. El número se devuelve tal como lo escribió el colega
(`"02"`, no `"2"`).

**La descripción.** Se arma con los mismos campos del clasificador que ya
usa la línea "Busca:" del aviso (`queBusca`, que se mueve a un lugar
compartido para que el DM y el aviso describan el pedido igual), redactada
como frase: tipo (y "en arriendo" si es arriendo), zonas unidas con "o",
tope de precio y alcobas. Ej.: *"apartamento en Laureles, Poblado o Fátima,
hasta $400.000.000, 2 alcobas"*.

**El saludo de `redactar.js#mensajeGrupo`** reemplaza "vi tu solicitud":

- Con número: *"Hola Ángela, te respondo tu PEDIDO 645 (apartamento en
  Envigado, Itagüí, La Estrella o Sabaneta, hasta $350.000.000, 2
  alcobas)."*
- Sin número: *"Hola Eugenia, te respondo tu pedido de apartamento en
  Laureles, Poblado o Fátima, hasta $400.000.000, 2 alcobas."*
- Sin descripción usable (el clasificador no sacó tipo, zona ni precio): las
  primeras palabras de su propio texto, limpias de emojis y asteriscos y
  cortadas en ~60 caracteres: *"te respondo tu pedido «Busco bodega para
  renta…»"*.
- Sin nada de lo anterior: el saludo de hoy, "vi tu solicitud".
- Si el DM sale **otro día** que el pedido (los caminos manuales pueden
  mandarlo días después): *"tu pedido del 8 de septiembre"*.

Para eso `vivo.js#pedidoDe` suma `numero`, `operacion`, `tipo`,
`precio_max`, `texto` y `fecha` a lo que ya pasa (zonas, zona, habitaciones,
areaMin — `redactar.desvios` sigue leyendo lo mismo), y
`alerta-asesor.js#mensajeListoParaReenviar` pasa lo mismo en su `pedido`.
Como los cinco lugares que le escriben al colega usan `mensajeGrupo`, el
cambio los cubre a todos.

**Regla del mensaje blanqueado** (el colega puede reenviarle el DM a su
cliente): no se agrega "Diamond" ni el nombre del grupo.

## 5. Fuera de alcance

- La misma ref ofrecida en varios pedidos del mismo colega (10013129, cuatro
  veces).
- El saludo con el nombre de WhatsApp tal cual ("Hola
  Tengotuinmueblecomercial").
- Contestar desde el sistema lo que llega a la línea de Natalia.
- Quitar la marca desde el CRM. Es permanente; si hace falta, se quita por
  SQL.
- Marcar desde el lado del asesor ("Sofi, marcá a X").

Revisado, no hace falta tocarlo:
- El seguimiento de Sofi (`src/scheduler/followups.js`) solo escribe a leads
  en `en_conversacion`/`calificado`; un colega nunca sale de `nuevo`.
- `src/groups/cruce-leads.js` le avisa a asesores, no a leads.
- `src/groups/dm.js` (el inbox de la línea) no le escribe al colega; solo
  alerta al equipo.
- `waha.enviarTexto` solo acepta chats `@g.us`.

## 6. Errores

- **Consulta de la marca fallida:** no sale DM (§4.1). En §4.2 queda el
  motivo `solo_llamada_no_verificable` y el aviso lo explica.
- **Columna ausente:** la migración ya está corrida y verificada. Si algún
  entorno no la tiene, todos los DM se frenan y se desvían: ruidoso, no
  silencioso, y del lado seguro.
- **Asesora sin teléfono para el aviso de la herramienta de Sofi:** se cae
  al escalado de siempre (`advisors.listElegibles`).
- **Descripción del pedido:** es texto armado con datos ya guardados; si
  falta todo, cae al saludo de hoy. Nunca frena ni demora el envío.

## 7. Pruebas

- `test/group-politica.test.js`: `soloLlamada` true / null / false, y que
  corta antes de elegir la vía.
- `test/colegas-data*.test.js`: `esSoloLlamada` por lid, por teléfono (con
  variantes), por el cruce de `directorio_lids`, por el número del texto, y
  `null` ante un error de la base.
- `test/group-vivo.test.js` / `test/group-asistido.test.js`: un pedido de un
  colega marcado → `enviarDm` **nunca se llama**, la señal queda con
  `colega_solo_llamada` y sale el aviso.
- Caminos manuales: devuelven `colega_solo_llamada` sin llamar a `enviarDm`
  y sin `marcarRespondida`.
- `waha.enviarDm`: marcado por lid, marcado por teléfono, consulta fallida y
  sin `orgId` → no toca `/api/sendText`.
- `test/cancelar-cita.test.js`: colega marcado → ni Cloud API ni WAHA, alerta
  al equipo, la cita queda cancelada.
- `test/alerta-asesor.test.js`: cabecera "📞 LLAMAR", sin `wa.me`, sin bloque
  de reenvío ni invitación a Sofi; línea "Pedido: N° …" con y sin número.
- `numeroPedido`: cada formato real de §4.9, el `#` suelto rechazado, el
  número tal como vino (`"02"`), texto sin número → `null`.
- `test/group-redactar.test.js`: saludo con número, sin número, con
  fragmento del texto, sin nada (queda "vi tu solicitud") y con fecha cuando
  el pedido es de otro día. Hoy hay 12 aserciones sobre "vi tu solicitud" en
  7 archivos; se actualizan a lo que corresponda a cada caso.
- Herramienta de Sofi: marca y avisa; sin fila, no dice "anotado"; rechazo
  sin `ctx.colega`.
- Suite completa (`npm test`) en verde antes de mergear.

## 8. Cómo sabemos que funcionó

Después del deploy, en producción:

- **Cero** filas de `group_signals` con `respuesta_destino_lid =
  '266150634110990@lid'` o `respuesta_destino_telefono = '573146399667'`
  con `respondida_at` posterior al deploy.
- El próximo pedido de Ángela que tenga propiedades para ofrecer queda con
  `politica_motivo = 'colega_solo_llamada'`, `respondida_at` en null y
  `aviso_advisor_id` = Natalia, y el aviso trae "📞 LLAMAR — Pedido N° …".
- Todo `respuesta_texto` de un DM posterior al deploy empieza con "te
  respondo tu PEDIDO …" o "te respondo tu pedido …" (salvo el caso sin
  ningún dato, que debería ser raro).
