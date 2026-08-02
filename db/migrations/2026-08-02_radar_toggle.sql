-- Interruptor del motor de Radar.
--
-- Radar cuesta plata cada vez que corre: la clasificacion son llamadas a
-- Claude, y el digest son plantillas de Meta cobradas por envio. Hasta hoy la
-- unica forma de pararlo era una variable de entorno, que exige un redeploy y
-- que solo puede tocar quien tenga acceso a Railway.
--
-- Esta columna lo vuelve una decision de negocio, tomada desde el CRM, que
-- surte efecto en el siguiente segundo.
--
-- QUE APAGA: lo que se paga — clasificar un export y mandar el digest.
-- QUE NO APAGA: leer lo ya detectado. Apagar el motor no puede esconder las
-- señales que ya existen, ni impedir que un asesor cierre el ciclo de una
-- oportunidad que venia trabajando.
--
-- Default true: una org existente no cambia de comportamiento por correr esto.
--
-- Correr a mano en Supabase. Idempotente.

alter table organizations
  add column if not exists radar_activo boolean not null default true;

comment on column organizations.radar_activo is
  'Interruptor del motor de Radar. false = no se clasifica ni se manda digest (no se gasta). Lo ya detectado se sigue viendo.';
