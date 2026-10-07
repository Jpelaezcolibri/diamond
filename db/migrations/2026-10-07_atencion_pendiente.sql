-- Por que un chat espera a un asesor (Juan, 2026-10-07: "toda comunicacion
-- ... se haga directamente al chat que se va a crear en el CRM y que desde
-- ahi se pueda tomar control de la conversacion").
-- pide_asesor | visita | transferido. Se limpia cuando el asesor toma la
-- conversacion en el CRM. Plan: docs/superpowers/plans/2026-10-07-plan-6-todo-al-chat-del-crm.md
-- Solo agrega columnas; idempotente.
alter table leads add column if not exists atencion_pendiente text;
alter table leads add column if not exists atencion_desde timestamptz;

comment on column leads.atencion_pendiente is
  'Por que el chat espera a un asesor: pide_asesor | visita | transferido. Null = nada pendiente.';
