-- db/migrations/2026-10-28_colega_agente.sql
--
-- COLEGAS QUE SON UN AGENTE AUTOMATICO (Juan, 2026-10-28: "identifica siempre
-- si es un agente para que no tengamos confusiones"). Caso elizabeth muriel:
-- el asistente de otra inmobiliaria le contesto a Sofi en la linea del radar
-- y su "quedamos atentos para coordinar la visita" quedo como cita propuesta,
-- sin fecha, avisada a Daiana.
--
-- Con es_agente=true la linea guarda lo que escribe, pero no lo clasifica, no
-- crea citas ni avisos y Sofi no le contesta. El radar SI le sigue mandando
-- fichas: detras del bot hay una inmobiliaria real que las pasa a su equipo.
--
-- Va en colegas_grupos, igual que solo_llamada: ya tiene lid y telefono.
-- Correr a mano en Supabase. El codigo FALLA ABIERTO sin la columna (sigue
-- detectando por frases en cada hilo, pero no guarda la marca). Idempotente.

alter table colegas_grupos add column if not exists es_agente boolean not null default false;
alter table colegas_grupos add column if not exists es_agente_at timestamptz;
alter table colegas_grupos add column if not exists es_agente_motivo text;

comment on column colegas_grupos.es_agente is
  'Quien escribe es un asistente automatico de otra inmobiliaria. La linea del radar no lo clasifica, no crea citas ni avisos, y Sofi no le contesta.';
comment on column colegas_grupos.es_agente_at is 'Cuando se marco es_agente.';
comment on column colegas_grupos.es_agente_motivo is 'Por que: frases automaticas o lo que dijo el clasificador.';
