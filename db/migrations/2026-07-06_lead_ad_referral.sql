-- Guarda el "referral" nativo que WhatsApp Cloud API adjunta al PRIMER mensaje
-- de una conversacion que se origino desde un anuncio de clic-a-WhatsApp
-- (Click-to-WhatsApp Ads / CTWA). Permite separar en el CRM los leads que
-- llegaron por un anuncio pago de los que llegaron organicamente (landing,
-- WhatsApp directo, etc.) sin tocar la tabla `source` (canal: whatsapp |
-- telegram | test), que es un concepto distinto.
--
-- Forma real del objeto que manda Meta (ver docs de WhatsApp Cloud API,
-- "message.referral"): { source_type: "ad"|"post", source_id, source_url,
-- headline, body, media_type, image_url|video_url, thumbnail_url, ctwa_clid }

alter table leads add column if not exists ad_referral jsonb;

comment on column leads.ad_referral is
  'Referral de Meta (Click-to-WhatsApp Ads) del primer mensaje de la conversacion — null si el lead no vino de un anuncio de WhatsApp.';
