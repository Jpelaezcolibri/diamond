# Pendientes por Excel: la asesora contacta, devuelve el Excel y Sofi lo aplica en el CRM

**Fecha:** 2026-10-30 · **Pedido de Juan:** "les puedes enviar un excel con todos los pendientes, con todos los contactos, lo que pidió, lo que se le ofreció, y pide que te devuelva al número de Sofi el documento corregido, validado, y que Sofi tenga la habilidad de guardarlo, revisarlo y poner en el CRM los resultados dependiendo de las respuestas. Yo creo que esa es la mejor opción de tener un seguimiento y un control."

## 1. Problema

Desde el 2026-10-29, `scheduler/sin-respuesta.js` le pasa a una asesora por WhatsApp a quien no le contestó a Sofi. Desde el 2026-10-30 sale de a uno (un caso por asesora cada 15 min). Falta el control: no se sabe si la asesora lo contactó ni qué pasó, y el resultado no vuelve al CRM. Los casos de origen: Clara, Luz Stella, Freddy y Laura V. (pidió asesor el 20-oct y nadie le escribió en 9 días).

## 2. Decisiones de Juan (2026-10-30)

| Tema | Decisión |
|---|---|
| Ritmo | Un Excel a las **8 a. m.** y otro a las **2 p. m.**, de lunes a sábado. |
| Destinataria | **Cada asesora recibe sus casos.** Si tiene la ventana de 24 h cerrada, se le manda por plantilla de Meta con documento; mientras la plantilla no esté aprobada, sus casos van a Daiana. |
| "Agendó visita" | Sofi **crea la cita confirmada** por esa asesora, con la ref (entran el recordatorio de 2 h antes y la pregunta de después). |
| Resultados | La lista de §5. |
| Urgentes | "Pidió asesor" y nota de voz siguen saliendo en el momento, de a uno. |

## 3. Arquitectura

```
sin-respuesta.js ──crea──▶ contactos_pendientes ◀──lee── excel-pendientes.js (8 a. m. / 2 p. m.)
   (urgentes: además                                         │ genera .xlsx por asesora
    WhatsApp de a uno)                                        ▼
                                                      WhatsApp (documento o plantilla)
                                                              │
asesora llena y devuelve el .xlsx al número de Sofi ──▶ engine.js (asesor + documento .xlsx)
                                                              ▼
                                                  lib/pendientes-excel.js: leer → validar → aplicar
                                                              ▼
                                       CRM (cita, estado del lead, nota del chat, atencion_pendiente)
                                                              ▼
                                               Sofi le responde con el resumen y los errores
```

Unidades nuevas, cada una probada por separado:

- **`src/data/contactos-pendientes.js`**: CRUD de la tabla (memoria sin Supabase, como el resto de `src/data`).
- **`src/lib/pendientes-excel.js`**: puro. `armarLibro(casos)` → buffer .xlsx; `leerLibro(buffer)` → filas; `validarFila(fila, contexto)` → `{ ok, accion } | { error }`.
- **`src/lib/aplicar-pendiente.js`**: aplica una acción validada al CRM (reutiliza `confirmar-cita.js`, `leads.update` y `conversations.appendMessage` con rol `system`).
- **`src/scheduler/excel-pendientes.js`**: arma y envía el Excel a las 8 a. m. y a las 2 p. m.
- **Engine**: si quien escribe es asesora y manda un documento .xlsx, se procesa como devolución (§6) antes de pasar a Claude.

Librería: **exceljs** (escribe listas desplegables y protege columnas; también lee).

## 4. Datos: tabla `contactos_pendientes`

Migración `db/migrations/2026-10-30_contactos_pendientes.sql` (la corre Juan; el código falla cerrado sin ella: sin tabla, `sin-respuesta.js` sigue como hoy y no hay Excel).

| Columna | Uso |
|---|---|
| `id` uuid, `codigo` text único por org | El código va en el Excel (`C-0012`, correlativo por org). |
| `org_id`, `lead_id`, `conversation_id` | |
| `asesor_id` | La asesora a la que se le asignó. |
| `motivo` | `no_contesto`, `sin_seguimiento`, `pide_asesor`, `nota_de_voz`. |
| `estado` | `pendiente` → `enviado` (salió en un Excel) → `resuelto` / `cerrado`. |
| `intentos` | Cuántas veces volvió "No contesta". |
| `lote_id`, `enviado_at` | El último Excel en el que salió. |
| `resultado`, `nota`, `resuelto_at`, `resuelto_por` | Lo que devolvió la asesora. |
| `created_at` | |

Un pendiente abierto por lead, a lo sumo: si ya hay uno `pendiente` o `enviado`, `sin-respuesta.js` no crea otro (actualiza el motivo).

## 5. El Excel

Hoja **Pendientes**, una fila por caso; las columnas grises están bloqueadas y las amarillas se llenan:

| Código | Nombre | Colega / cliente | WhatsApp | Por qué | Qué pidió | Qué se le ofreció | Lo último que dijo | Lo último de Sofi | Chat CRM | **Resultado** | **Fecha visita** | **Hora** | **Ref visita** | **Nota** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

- **WhatsApp:** link `wa.me/57…` (o "sin número: escríbele desde el CRM").
- **Qué pidió:** el pedido del colega (`group_signals`, por el código del pedido) o lo que dijo el cliente.
- **Qué se le ofreció:** las refs enviadas con su link de Wasi (`info.wasi.co/…?shared=whatsapp`).
- **Resultado:** lista desplegable (ningún texto lleva coma: Excel la usa para separar) con:
  1. **Agendó visita.** Pide fecha, hora y ref. Sofi crea la cita confirmada por esa asesora y le avisa al colega o cliente con `confirmar-cita.js` (alias "Asesor N").
  2. **Interesado: sigue en conversación.** Nota en el chat. El pendiente se resuelve.
  3. **Quiere otras opciones.** Nota con lo que busca. El pendiente se resuelve y la asesora le busca opciones desde el CRM.
  4. **No contesta.** `intentos + 1` y vuelve en el siguiente Excel. Al tercer intento, el pendiente pasa a `cerrado` y el lead queda en `cerrado_perdido`.
  5. **No le interesa / ya consiguió.** El lead queda en `cerrado_perdido` y el pendiente se resuelve.
  6. **Número equivocado.** El lead queda en `descartado` y el pendiente se resuelve.
- Hoja oculta **_lote** con el `lote_id` y la asesora. Si Google Sheets la suelta, el archivo se acepta igual: lo que manda es el código de cada fila.
- Nombre del archivo: `Pendientes Diamond — Daiana — 30-oct 8am.xlsx`.
- Mensaje que lo acompaña: "Daiana, tienes 6 personas por contactar. Escríbeles o llámalas, llena la columna Resultado y devuélveme el Excel por este chat."
- **Sin casos, no se manda nada.**

### Envío

- **Asesora con la ventana abierta:** documento por Cloud API (`uploadMediaToMeta` + `sendWhatsAppMedia` tipo `document`).
- **Ventana cerrada:** plantilla `pendientes_contacto` (encabezado de documento, cuerpo con el número de pendientes; la crea Juan en Meta) si `PENDIENTES_EXCEL_PLANTILLA` está configurada. Si no, sus casos van al Excel de una asesora con la ventana abierta, y si ninguna la tiene, a campana + `aviso_app`.
- Un caso que salió en el Excel de la mañana y no volvió sale otra vez en el de la tarde: lo que no se devuelve, se repite.

## 6. La devolución

1. **Reconocer.** En `engine.js`, mensaje de una asesora (`advisor`) con documento cuyo MIME es xlsx. Se descarga (`persistIncomingMedia` ya lo guarda en el bucket `media`) y se lee. Si no tiene la columna Código (no es uno de los nuestros), Sofi responde: "Ese Excel no es uno de los que te mandé; devuélveme el que te llegó".
2. **Validar** cada fila con resultado:
   - El código existe, es de esta asesora y está `pendiente` o `enviado`. Una fila de un pendiente ya resuelto se ignora sin error, así que mandar el mismo archivo dos veces no duplica nada.
   - El resultado es uno de los seis.
   - **Agendó visita:**
     - Fecha y hora válidas y en el futuro.
     - La ref existe en el inventario o es la ref de la conversación.
     - La asesora no tiene otra visita a esa hora (`agenda-reglas`).
     - Sin la regla de 24 h: la asesora ya lo acordó con la persona.
3. **Aplicar** lo válido (`aplicar-pendiente.js`), fila por fila y de forma independiente: un error en una fila no frena las demás.
   - La nota y el resultado quedan como mensaje `system` en el chat, por ejemplo "📋 Daiana (Excel 30-oct): Agendó visita jue 31-oct 10 a. m. · ref 9944723 · nota: …".
   - Se limpia `atencion_pendiente` si era `sin_respuesta` o `pide_asesor`.
4. **Responder** en el mismo chat:
   - "Listo, Daiana: apliqué 5 (2 visitas confirmadas, 1 cerrado, 2 con nota). Me faltan 2: fila 4 (C-0015), falta la hora; fila 7 (C-0019), la ref 123 no existe. Corrígelas y devuélvemelo cuando quieras."
   - Las filas sin resultado no son error: siguen pendientes.
5. **Guardar** el archivo devuelto: queda en el bucket `media` y se enlaza en `contactos_pendientes` (`lote_id`) para auditoría.

## 7. Urgentes y convivencia con lo de hoy

- `pide_asesor` y `nota_de_voz`: además de crear el pendiente, sale el WhatsApp individual de a uno, como hoy. También van en el siguiente Excel hasta que se resuelvan.
- `no_contesto` y `sin_seguimiento`: solo Excel. Mientras la tabla no exista o `PENDIENTES_EXCEL=false`, siguen saliendo de a uno como hoy.
- Si la persona vuelve a escribirle a Sofi, el pendiente se resuelve solo ("volvió a escribir") y no sale en el siguiente Excel.

## 8. Errores y frenos

- **Interruptor:** `PENDIENTES_EXCEL`, apagado por defecto hasta la prueba con Daiana.
- **Si el envío del Excel falla:** alerta en el log (`[excel-pendientes]`) y los casos quedan `pendiente`; salen en el siguiente.
- **Si el archivo devuelto no se puede leer** (otro formato, foto del Excel, PDF): Sofi pide el .xlsx y no toca nada.
- **Tope por Excel:** 40 filas. Lo que sobra sale en el siguiente.
- **Este carril no lo apaga `ASESORA_SOLO_VISITAS`** (pedido expreso de Juan).
- **Tuteo** en todo lo que ve la asesora y en lo que va al colega.

## 9. Pruebas

- `pendientes-excel`:
  - Arma un libro y lo vuelve a leer igual.
  - La lista desplegable y el bloqueo de columnas están presentes.
  - Lee archivos mal llenados: código ajeno, fecha en texto ("mañana a las 10"), hora sin fecha, ref inexistente, filas vacías, columnas reordenadas por Excel o Google Sheets.
- `aplicar-pendiente`: cada uno de los 6 resultados. Al aplicar dos veces no se duplica nada. "Agendó visita" crea la cita confirmada con `asesor_id`.
- `excel-pendientes` (scheduler):
  - Sin casos no manda nada.
  - Cada asesora recibe solo los suyos.
  - Con la ventana cerrada y sin plantilla, los casos van a la que la tiene abierta.
  - No corre domingos ni fuera de las 8 a. m. y las 2 p. m.
- **Prueba en seco:** `scripts/excel-pendientes-en-seco.js` genera los Excel en `Claude outputs/` sin enviar nada, para que Juan los vea antes de encender.

## 10. Para encender (en orden)

1. Juan corre `2026-10-30_contactos_pendientes.sql` → verificar por REST.
2. Prueba en seco: Juan revisa el Excel generado.
3. Juan crea la plantilla `pendientes_contacto` en Meta (opcional para arrancar: sin ella, todo va a Daiana).
4. `PENDIENTES_EXCEL=true` en Railway y primera vuelta con Daiana, mirando el log y el chat.

## 11. Fuera de alcance

- La página del CRM para resolver pendientes con botones (enfoque B): si el Excel funciona, puede leer la misma tabla más adelante.
- Que Sofi le escriba al colega con las "otras opciones": la asesora lo hace desde el CRM.

## 12. Cambios del 2026-11-07 (pedido de Juan, capturas de Catherine)

Lo que se vio: a Catherine le llegó el mismo Excel (una sola fila, `C-0011 ·
Andrea Strauch`) el 6-nov a las 2 p. m. y el 7-nov a las 8 a. m. y a las
2 p. m., con el texto "tienes 1 personas por contactar"; en el celular solo se
veían las columnas Código y Nombre.

| Antes | Ahora |
|---|---|
| Excel a las 8 a. m. y a las 2 p. m.; lo que no volvía salía otra vez. | **Una vez al día** (8 a. m., `PENDIENTES_EXCEL_HORA`), lunes a sábado. Solo salen los pendientes **en cola** (`estado = pendiente`). Lo que ya salió (`enviado`) no se repite aunque no vuelva: vuelve a la cola solo si la asesora marca "No contesta", si aparece un **motivo nuevo** (`contactos-pendientes.abrir` lo devuelve a `pendiente`) o si es un pendiente nuevo. |
| Dos columnas congeladas (Código y Nombre). En el celular llenaban la pantalla y Google Sheets no dejaba llegar a las demás. | Solo el encabezado congelado. Celular y WhatsApp van pegados al nombre. |
| 15 columnas. | 18: Código · Nombre · **Celular** (`+57 313 788 4474`) · WhatsApp (link `wa.me`) · Colega / cliente · Por qué · **Desde cuándo** (pendiente desde / su último mensaje) · Qué pidió (el pedido del grupo **literal**, por el código del DM o, si escribió sin código, por su lid o teléfono en `group_signals`; si no, sus mensajes con fecha) · Qué se le ofreció (refs del chat **y** del DM, con link de Wasi `?shared=whatsapp`; una ref que ya no está, se dice) · **Peticiones especiales** (solo llamada, presupuesto, zona, tipo, urgencia, visita pedida, inmueble que ofrece) · Lo último que dijo (con fecha, literal) · Lo último de Sofi · Chat CRM, más las 5 que llena la asesora. Las columnas viven en `caso-pendiente.COLUMNAS_CASO`; la devolución sigue leyendo por nombre. |
| "Catherine, tienes 1 personas por contactar. Escríbeles o llámalas…" | `lib/texto-pendientes.js`: con una persona, nombre y motivo ("tienes 1 persona por contactar: Andrea Strauch (colega), que no le contestó a Sofi y ella ya no alcanza a escribirle"); con varias, el conteo por motivo ("6 no le contestaron a Sofi, 2 pidieron hablar con un asesor…"). La plantilla recibe `{{1}}` = "1 persona" / "6 personas". |
| Campana (nadie con ventana abierta) en cada tick de la media hora, dos veces al día. | Una vez al día por asesora y pasa por `ritmo.puedeEnviar`. |
| Archivo `Pendientes Diamond - Catherine - 7 de nov 8am.xlsx`, lote `L-2026-11-07-8am-…`. | `Pendientes Diamond - Catherine - 7 nov.xlsx`, lote `L-2026-11-07-…`. |

Sin migración: `estado` y `enviado_at` alcanzan. Los 11 pendientes que
salieron el 7-nov quedaron `enviado` y con la regla nueva no vuelven a salir;
si Juan quiere que salgan el lunes con las columnas completas, los devuelve a
la cola con un `update … set estado = 'pendiente' where lote_id like
'L-2026-11-07-%' and estado = 'enviado'` (lo corre él).
