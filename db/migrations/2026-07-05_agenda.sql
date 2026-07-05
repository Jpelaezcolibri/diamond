-- Migracion: intencion del lead + agendamiento de citas.
-- Ejecutar en Supabase SQL Editor.
-- El bot ya funciona sin esta migracion (link y alerta correctos van en memoria);
-- esta migracion PERSISTE la intencion y la cita para el CRM y para la futura
-- integracion con el calendario del asesor.

-- 1. Intencion del cliente: define el mensaje al asesor (comprar vs vender).
--    comprar | arrendar | vender | vehiculos | otro
alter table leads add column if not exists intencion text;

-- 2. Cita/preferencia de contacto, estructurada para el calendario:
--    { descripcion: "manana a las 8 am", fecha_hora: "2026-07-05T08:00:00-05:00",
--      tipo: "llamada|visita|asesoria", estado: "solicitada", creada_at: "..." }
alter table leads add column if not exists cita jsonb;
