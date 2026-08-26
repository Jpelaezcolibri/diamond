-- Guarda el texto EXACTO del aviso que se le mando al asesor, para poder
-- reenviarlo identico a Catherine si hay que escalar por silencio -- en vez
-- de reconstruirlo, que podria divergir del original si algun dato cambio
-- entretanto (la oferta caduco, el mandato se edito).
alter table mandato_match_alerts add column if not exists texto text;

comment on column mandato_match_alerts.texto is
  'El cuerpo exacto del WhatsApp que se le mando al asesor. Se reenvia igual si hay que escalar por silencio.';
