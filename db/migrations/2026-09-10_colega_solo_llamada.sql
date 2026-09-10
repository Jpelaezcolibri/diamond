-- db/migrations/2026-09-10_colega_solo_llamada.sql
--
-- COLEGAS QUE SOLO SE CONTACTAN POR LLAMADA (Juan, 2026-09-10). Caso que lo
-- motivo: Angela Moscoso le pidio a Sofi el 2026-09-09 "que se comuniquen
-- directamente a mi numero telefonico para hablar, no mensajes de texto" y
-- "que no me envien nada hasta que no me contacten telefonicamente". Sofi le
-- contesto "ya esta anotado", pero no habia donde anotarlo: dos horas despues
-- el radar le mando un DM automatico por el pedido 642. Decision de Juan:
-- PERMANENTE — ningun DM a un colega marcado; cada pedido suyo va al aviso de
-- la asesora para que ella lo llame.
--
-- Va en colegas_grupos porque esa fila ya tiene las dos llaves que se
-- necesitan: `lid` (con el que el radar reconoce al autor del pedido en el
-- grupo) y `telefono` (con el que Sofi lo reconoce cuando escribe por la
-- linea oficial). Ninguna consulta nueva necesita indice propio: se busca por
-- (org_id, lid), que ya es unique, o por telefono, que ya tiene
-- idx_colegas_grupos_telefono.
--
-- Correr a mano en Supabase ANTES de desplegar el codigo que la lee: sin la
-- columna, la consulta falla y el radar deja de mandar TODOS los DM (falla
-- cerrado) y los desvia a la asesora. Idempotente.

alter table colegas_grupos add column if not exists solo_llamada boolean not null default false;
alter table colegas_grupos add column if not exists solo_llamada_at timestamptz;

comment on column colegas_grupos.solo_llamada is
  'El colega pidio que lo contacten SOLO por llamada. Con true, el radar nunca le manda DM (ni automatico ni manual): el pedido va al aviso de la asesora para que lo llame.';
comment on column colegas_grupos.solo_llamada_at is
  'Cuando se marco solo_llamada. Null mientras no este marcado.';
