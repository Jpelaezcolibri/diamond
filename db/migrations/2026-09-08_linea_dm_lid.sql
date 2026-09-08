-- db/migrations/2026-09-08_linea_dm_lid.sql
--
-- QUIEN escribe cuando el chat llega por direccionamiento oculto (Juan,
-- 2026-09-08). Los DM del radar salen a `<lid>@lid` (politica.js#decidirDm
-- prefiere el lid siempre que exista: 82 de 82 desde el 4-sep), y la
-- respuesta del colega vuelve por el mismo chat. Hasta hoy
-- src/channels/whatsapp-group.js la descartaba en la primera linea porque
-- solo aceptaba @c.us — por eso linea_dm tenia 0 filas en toda su historia.
--
-- Esta columna es EXCLUYENTE con remitente_telefono: un mensaje llega por
-- @lid o por @c.us, nunca por los dos. Un lid no se guarda como telefono
-- (es el error que 2026-09-04_dm_destinatario.sql advierte) y un telefono
-- no se guarda como lid.
--
-- Correr a mano en Supabase. Idempotente.

alter table linea_dm add column if not exists remitente_lid text;

comment on column linea_dm.remitente_lid is
  'Lid crudo (<digitos>@lid) cuando el chat llego por direccionamiento oculto. Excluyente con remitente_telefono: un mensaje tiene uno u otro, nunca los dos.';

-- El hilo de un colega que escribe por lid: "que dijo este remitente, en
-- orden" — espejo de idx_linea_dm_remitente para la otra identidad.
create index if not exists idx_linea_dm_remitente_lid
  on linea_dm (org_id, remitente_lid, created_at);
