-- Que refs de propiedad quedaron DENTRO del mensaje que el radar publico o
-- redacto (modo auto/sombra). group_signals.matches guarda TODAS las
-- candidatas que vio el motor; sin esto no hay forma de saber, desde el
-- panel, cuales de esas candidatas fueron las que de verdad se ofrecieron y
-- cuales quedaron descartadas por la compuerta de calidad (Juan, 2026-08-19).
--
-- El codigo ya degrada limpio sin esta columna (ver esColumnaFaltante en
-- src/data/group-signals.js): marcarRespondida sigue guardando texto/wamid/
-- modo igual, solo que respuesta_refs queda null hasta que esto corra.

alter table group_signals add column if not exists respuesta_refs jsonb;

comment on column group_signals.respuesta_refs is
  'Refs de las propiedades incluidas en respuesta_texto (subconjunto de matches). Null si no se registro (o si la respuesta fue anterior a esta migracion).';
