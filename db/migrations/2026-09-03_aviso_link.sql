-- El link en el aviso a la asesora (Juan, 2026-09-02, opcion D del spec
-- docs/superpowers/specs/2026-09-02-radar-que-paso-despues-del-aviso.md).
--
-- POR QUE: "por revisar" media clics en el CRM que nadie hace (212 de 213).
-- Abrir el link es el dato; tocar el boton de envio es la gestion. Reemplaza
-- esa medida por dos reales: vistos y gestionados.
--
--   aviso_token    irrepetible por señal; es la URL /aviso/<token> y tambien
--                  la autorizacion (sin login). Resuelve la org solo.
--   visto_at       primera apertura del link. Un hecho, no un contador.
--   gestionado_at  toco un boton adentro.
--   gestion        'envio' (toco el boton de mandar) | 'no_sirve' (lo descarto).
--
-- Sin correrla, el bot funciona igual: asegurarToken devuelve null y el aviso
-- sale sin link. Correr a mano en Supabase. Idempotente.

alter table group_signals add column if not exists aviso_token text;
alter table group_signals add column if not exists visto_at timestamptz;
alter table group_signals add column if not exists gestionado_at timestamptz;
alter table group_signals add column if not exists gestion text;

create unique index if not exists idx_group_signals_aviso_token
  on group_signals(aviso_token) where aviso_token is not null;

comment on column group_signals.aviso_token is
  'Token irrepetible del link /aviso/<token> que va en el aviso a la asesora. Es la autorizacion de esa pagina.';
comment on column group_signals.gestion is
  'envio = toco el boton de mandar · no_sirve = lo descarto desde la pagina';
