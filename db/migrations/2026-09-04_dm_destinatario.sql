-- A QUIEN se le mando el DM, no solo QUE se le mando (Juan, 2026-09-04):
-- "me dejes un registro en el crm de el mensaje enviado a quien y la
-- informacion necesaria para contactarlo en un futuro".
--
-- EL PROBLEMA QUE RESUELVE. `marcarRespondida` guarda el texto, el wamid, el
-- modo y las refs, pero no el destinatario. Para responder "¿por que le
-- escribimos a este colega?" habia que cruzar a mano contra directorio_lids,
-- que se reescribe con cada calentamiento: o sea que a los pocos dias la
-- pregunta ya no se podia responder.
--
-- ══ ALCANCE: ESTO ES AUDITORIA, NO UNA AGENDA DE PROSPECCION ══
--
-- El limite de la Ley 1581 de 2012 trazado en 2026-08-22_colegas_grupos.sql
-- sigue intacto y esta migracion no lo toca: a quien se le escribe lo decide
-- src/groups/politica.js#decidirDm, y solo se le escribe al colega que acaba
-- de publicar un pedido que cruzamos. Estas dos columnas registran una
-- interaccion que YA ocurrio y que el colega inicio.
--
-- Nadie recibe un mensaje por estar aca. Si algun dia se usa esta tabla para
-- iniciar un contacto con alguien que no publico nada, eso es otra cosa y
-- necesita otra decision.
--
-- SOBRE EL LID (verificado el 2026-09-04): WhatsApp SI entrega un DM a un
-- destino `<lid>@lid` cuando el destinatario comparte un grupo con la linea.
-- Se guarda el lid ademas del telefono porque para las cuentas con
-- direccionamiento @lid el numero NO esta disponible — la lista de
-- participantes devuelve solo id y username. Para esos colegas el lid no es un
-- atajo comodo, es la unica via de escritura, y sin registrarlo no queda
-- constancia de por donde salio el mensaje.
--
-- Correr a mano en Supabase. Idempotente.

alter table group_signals
  add column if not exists respuesta_destino_telefono text,
  add column if not exists respuesta_destino_lid text;

comment on column group_signals.respuesta_destino_telefono is
  'Telefono al que salio el DM. Auditoria de una respuesta que el colega inicio, NO una lista de contactos para prospectar.';

-- OJO CON EL NOMBRE (corregido en la revision final, 2026-09-04). La columna
-- NO guarda "el lid por el que se enruto el DM": hoy ninguna via de envio pasa
-- la opcion `lid` a waha.enviarDm, asi que el chatId real siempre termina en
-- `<telefono>@c.us`. Lo que se guarda es el identificador del AUTOR en el
-- grupo, que segun como WhatsApp lo presente puede ser un @lid o un telefono.
-- El DM automatico lo guarda crudo (con su sufijo, que es lo que distingue los
-- dos casos); los dos caminos manuales solo tienen los digitos, porque
-- group_signals.autor_telefono ya guardo el identificador sin sufijo.
--
-- Un comentario que miente sobre una columna de auditoria es peor que no
-- tenerlo: quien la lea manana tiene que poder confiar en lo que dice.
comment on column group_signals.respuesta_destino_lid is
  'Identificador del autor en el grupo al que se le respondio: un @lid o un telefono, segun como lo presente WhatsApp. NO es necesariamente un lid ni la via de enrutamiento del DM.';
