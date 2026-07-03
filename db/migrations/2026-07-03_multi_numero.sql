-- Soporte multi-numero: cada conversacion recuerda por cual numero de WhatsApp
-- entro el cliente, para que las respuestas (de Sofi o del asesor via CRM)
-- salgan siempre por el mismo numero — asi se pueden conectar varios numeros
-- de publicidad a la misma organizacion sin romper el hilo de conversacion.
alter table conversations add column if not exists whatsapp_phone_id text;
