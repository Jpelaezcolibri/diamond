# Sofi contesta en la línea del radar (2026-10-21)

## 1. El caso

Luz Amparo Restrepo (Projency Inmobiliaria) recibió el DM del radar por la
línea de Daiana (pedido cód. 7S63, refs 9944723 y 10113016). Respondió
"Cordial saludo, soy Luz Amparo Restrepo de Projency Inmobiliaria. Cuál es tu
nombre" y la línea le contestó al instante con el texto fijo del puente
(`src/groups/puente-sofi.js`): "¡Hola Projency! Para responderte más rápido te
paso con Sofi…" más un link largo que repetía su saludo. Insistió a las 5:05
p. m. ("Me respondes por favor para saber con quién estoy hablando") y nadie
le contestó hasta las 5:44, cuando Claudia escribió a mano.

Tres fallas: no responde lo que le preguntan, la saluda por el nombre de la
empresa y después del primer mensaje la línea queda muda.

## 2. Lo que decidió Juan

- La línea se presenta como **Sofi, la asistente virtual de Diamond
  Inmobiliaria**, dice quién es y por qué ofrece la línea oficial.
- Sofi contesta **hasta 3 mensajes**, redactados por la IA, en la misma línea
  del radar. Juan acepta el riesgo de un bot conversando por WAHA (el baneo de
  julio fue en grupos; ver `sofi-grupos-whatsapp` en la memoria).
- Si alguien del equipo escribe a mano en ese chat, **Sofi se calla para
  siempre** en ese chat.
- Alcance: responde con el pedido y las fichas que ya se le mandaron (precio,
  zona, alcobas, baños, garajes, área, administración) y para más opciones,
  fotos o una cita **lleva a la línea oficial** con el link. No busca
  inventario nuevo ni agenda por esta línea.

## 3. Diseño

### 3.1 Módulo nuevo: `src/groups/sofi-linea.js`

Una función `responder(org, { mensaje, señal, identidad }, deps)` que reemplaza
el envío fijo de `puente-sofi.tenderPuente` cuando el interruptor está
encendido. `dm.procesarMensaje` la llama en el mismo lugar que hoy llama al
puente (la cola `dm:<chatId>` ya serializa los mensajes de un mismo chat).

Decide en este orden:

1. **Interruptor** `RADAR_SOFI_LINEA` apagado (default) → camino de hoy
   (`tenderPuente`) sin cambios.
2. **Quién escribe.** Las mismas reglas del puente: hay pedido ligado, o es
   colega de los grupos, o le habla a Sofi. Si no, no contesta.
3. **Persona en el chat.** Si `linea_dm` tiene alguna fila `direccion =
   'salida'` con `autor = 'humano'` para esa identidad (cualquier fecha) →
   no contesta; campana a la asesora como hoy. Resultado `humano_atiende`.
4. **Tope.** Si Sofi ya contestó 3 veces a esa identidad en los últimos 7 días
   (`autor = 'sofi'`) → no contesta; campana a la asesora: "Sofi ya le
   contestó 3 veces a {nombre}; te toca" con el último mensaje. Resultado
   `tope`.
5. **Redacta** con una llamada al modelo (`config.claudeModel`, el mismo de
   Sofi) y salida estructurada `{ texto }`. Contexto:
   - quién es Sofi y por qué existe la línea oficial (§3.2);
   - el pedido del colega (`pedidoDe(señal)`) y las fichas que se le mandaron
     (`respuesta_refs` → datos reales de `properties`, con su `linkWasi`), igual
     que el contexto de colega de la línea oficial;
   - el hilo del chat (`linea_dm`, entrada y salida, últimos 10);
   - qué número de respuesta es (1, 2 o 3) y el link a la línea oficial
     (`linkContactoOficial` con el código del pedido, sin copiar el texto del
     colega dentro del link).
6. **Limpia** el texto con `links-verificados.quitarLinksInventados` (fuentes:
   los `linkWasi` de las fichas y el link a la línea oficial).
7. **Envía** por `envio-colega.enviarAlColega` tras una pausa aleatoria de
   8–20 s (que no conteste en el mismo segundo) y guarda la salida en
   `linea_dm` con `direccion = 'salida'`, `autor = 'sofi'`.
8. **Campana** a la asesora principal del radar, igual que el puente hoy, con
   lo que preguntó el colega y lo que contestó Sofi.

### 3.2 Lo que dice Sofi (reglas del prompt)

- Primera respuesta: se presenta ("Soy Sofi, la asistente virtual de Diamond
  Inmobiliaria"), responde primero lo que preguntó si se puede con los datos
  que tiene, y explica la línea oficial: "por esta línea te enviamos las
  fichas de tu pedido; para mostrarte más opciones y agendarte la visita te
  atiendo en nuestra línea oficial 👉 {link}".
- Segunda y tercera: contesta lo que pregunte con el pedido y las fichas. Si
  pide más opciones, fotos, visita o hablar con alguien, repite el link.
- El saludo usa el nombre de la persona si lo dijo ("soy Luz Amparo"); si el
  nombre de WhatsApp es de una empresa ("Projency Inmobiliaria"), saluda sin
  nombre.
- Tuteo profesional, sin voseo. Máximo ~3 frases. Sin nombres ni celulares de
  asesoras (`identidad-publica`). Un dato que no está en la ficha se dice "te
  lo confirmo en la línea oficial", nunca se inventa.
- Comisión: si pregunta, `RADAR_LINEA_COMISION` ("Comisión compartida 50/50").

### 3.3 Datos: migración `2026-10-21_linea_dm_autor.sql`

`alter table linea_dm add column if not exists autor text` con check
`autor in ('sofi','humano')`, nulo para lo viejo y para la entrada. El
webhook que hoy guarda la salida humana (`whatsapp-group.js`, `fromMe` que no
es envío propio) pasa a guardar `autor = 'humano'`.

Sin la columna: `sofi-linea` no puede contar ni detectar a la persona →
falla cerrado y usa el camino de hoy (`tenderPuente`), con un aviso en el log.

### 3.4 Si algo falla

- El modelo no responde o devuelve vacío → sale el texto fijo del puente,
  mejorado: "¡Hola! Soy Sofi, la asistente virtual de Diamond Inmobiliaria.
  Por esta línea te enviamos las fichas de tu pedido; para más opciones y
  agendar la visita te atiendo en nuestra línea oficial 👉 {link}". Cuenta
  como respuesta de Sofi.
- El envío falla → no se guarda la salida; la campana dice "no se le pudo
  contestar".
- Nunca lanza: un error no puede tumbar la escucha de la línea (igual que hoy).

### 3.5 Requisitos antes de encender

1. Juan corre `2026-10-21_linea_dm_autor.sql`; se verifica por REST.
2. Activar `message.any` en la sesión `DaianaDiamond`
   (`waha.actualizarEventos`) y ver en el log una salida humana reconocida.
   Sin esto Sofi no sabe que una persona contestó y puede hablar encima.
3. Despliegue (hoy pausado por el incidente de Railway del 2026-10-21).
4. `RADAR_SOFI_LINEA=true` en Railway.

## 4. Pruebas

- Unitarias (`test/sofi-linea.test.js`, con deps inyectadas, sin red):
  apagado → camino de hoy; persona en el chat → calla; cuarta respuesta →
  calla y avisa; sin columna `autor` → camino de hoy; el modelo falla → texto
  fijo; link inventado → se quita; el link no lleva el texto del colega;
  nombre de empresa → saludo sin nombre.
- Prompt: sin voseo, nombra "asistente virtual", prohíbe nombres de asesoras.
- En seco con la clave de producción: el hilo de Luz Amparo (3 mensajes) y uno
  que pregunta la administración de una ficha. Juan lee las respuestas antes de
  encender.

## 5. Fuera de alcance

- Buscar inventario o agendar por la línea del radar.
- Contestar en grupos.
- Cambiar el puente de las respuestas a publicaciones
  (`scheduler/respuestas-publicacion.js`).
