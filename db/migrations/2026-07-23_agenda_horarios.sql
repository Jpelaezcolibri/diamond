-- Migracion: horario laboral por asesor para la validacion de agenda.
-- Ejecutar en el SQL Editor de Supabase.
--
-- horario: franja laboral del asesor, usada para que Sofi no agende visitas
-- fuera de hora ni en dias que el asesor no trabaja. Forma:
--   { "dias": [1,2,3,4,5], "desde": "08:00", "hasta": "18:00" }
--   dias: 0=domingo .. 6=sabado (hora local America/Bogota).
-- Nullable: si es null, el codigo usa el default L-V 08:00-18:00
-- (DEFAULT_HORARIO en src/data/appointments.js).
alter table advisors add column if not exists horario jsonb;

-- Las citas siguen en leads.cita (jsonb, migracion 2026-07-05_agenda.sql). A
-- ese objeto se le suma en codigo el campo `advisor_id` (uuid del auth.users
-- del asesor dueno de la agenda), estampado al agendar para poder detectar
-- choques y pintar el calendario grupal por asesor. No requiere cambio de
-- schema (cita es jsonb libre); se documenta aqui el nuevo campo.
