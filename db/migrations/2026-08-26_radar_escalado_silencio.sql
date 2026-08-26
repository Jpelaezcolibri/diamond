-- Marca de escalado por silencio en group_signals: si el aviso al asesor
-- principal (Natalia) no se contesta en el tiempo configurado
-- (RADAR_SILENCIO_MIN), se escala a Catherine UNA sola vez. Sin esta columna
-- no hay forma de saber que una señal ya se escalo y evitar mandarla de
-- nuevo en cada corrida del scheduler.
alter table group_signals add column if not exists escalado_silencio_at timestamptz;

comment on column group_signals.escalado_silencio_at is
  'Cuando se escalo a Catherine por silencio del asesor principal. Null = nunca se escalo por esta via (puede seguir pendiente, o ya tener resultado).';
