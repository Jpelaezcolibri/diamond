-- Por que el radar calló un pedido en modo auto/sombra (Juan, 2026-08-20).
--
-- Bug real: Camilo Loaiza pidió un apartamento en Envigado y el motor
-- encontró un match del 100%, pero la política de conducta lo calló por
-- fuera_de_horario. Ese motivo SOLO quedaba en el feed del admin
-- (command_messages, vía src/groups/feed-comando.js) — trazabilidad_radar no
-- lo tenía, así que cuando Juan le preguntó a Sofi "por qué no se envió esto",
-- Sofi no pudo leer la razón real y terminó inventando una (confundió el
-- concepto de modo asistido con el determinista de auto, y afirmó que el
-- grupo "no tenía la configuración activa" — falso, el modo es de toda la
-- organización, no por grupo).
--
-- El codigo ya degrada limpio sin esta columna (ver esColumnaFaltante en
-- src/data/group-signals.js): vivo.js sigue funcionando igual, solo que
-- politica_motivo queda null hasta que esto corra.

alter table group_signals add column if not exists politica_motivo text;
alter table group_signals add column if not exists politica_traza jsonb;

comment on column group_signals.politica_motivo is
  'Motivo que devolvio src/groups/politica.js#decidir cuando el radar callo en modo auto/sombra (fuera_de_horario ya no existe, pero confianza_baja, sin_propiedades_publicables, etc. si). Null si publico, o si la senal es anterior a esta migracion.';
comment on column group_signals.politica_traza is
  'Traza completa de politica.decidir: cada paso que se verifico, en orden, para auditar despues por que el bot hablo o se callo.';
