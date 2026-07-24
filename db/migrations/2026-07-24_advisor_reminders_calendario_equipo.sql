-- Migracion: recordatorios con fecha/hora visibles en el Calendario del
-- equipo. Ejecutar en el SQL Editor de Supabase.
--
-- Decision de diseño (confirmada con el negocio 2026-07-24): un
-- advisor_reminder es una nota personal SOLO si no tiene fecha/hora. En
-- cuanto el asesor le da dia/hora a Sofi-Comando ("recuerdame la visita de
-- manana a las 3", "agendame esto"), deja de ser una nota privada y pasa a
-- ser un evento de calendario que todo el equipo debe poder ver — igual que
-- las citas de clientes en leads.cita. La columna fecha_hora ya existe
-- (migracion 2026-07-22_advisor_reminders.sql); esta migracion solo agrega
-- la politica de lectura compartida, sin tocar la tabla.
--
-- Se suma como policy adicional: Postgres compone varias policies de SELECT
-- con OR, asi que "own reminders" (el dueño siempre ve las suyas, con o sin
-- fecha) sigue activa junto a esta.

drop policy if exists "team read calendar reminders" on advisor_reminders;
create policy "team read calendar reminders" on advisor_reminders for select to authenticated
  using (fecha_hora is not null);
