-- Migracion: funciones RPC para claims atomicos en los schedulers del bot.
-- Correr a mano en el SQL Editor de Supabase. Idempotente (create or replace).
--
-- followups.js y reminders.js hacian select-de-candidatos + update por
-- separado: si dos ticks corrieran a la vez (o, a futuro, dos replicas de
-- Railway), ambos podian ver el mismo lead como candidato y enviarle el
-- mismo aviso dos veces. Estas funciones hacen el "marcar como enviado" y
-- el "verificar que nadie mas lo haya marcado ya" en una sola sentencia
-- atomica de Postgres (UPDATE ... WHERE ... RETURNING) — algo que un
-- UPDATE del cliente de Supabase no puede expresar sobre un campo dentro
-- de un jsonb. Devuelven true solo para quien gana el claim; null/false
-- para el resto (ver src/data/leads.js#claimFollowup / claimAppointmentReminder).

create or replace function claim_followup(p_lead_id uuid)
returns boolean
language sql
as $$
  update leads
  set seguimiento = coalesce(seguimiento, '{}'::jsonb) || jsonb_build_object('t24_sent_at', now())
  where id = p_lead_id
    and (seguimiento ->> 't24_sent_at') is null
  returning true;
$$;

create or replace function claim_appointment_reminder(p_lead_id uuid)
returns boolean
language sql
as $$
  update leads
  set cita = jsonb_set(coalesce(cita, '{}'::jsonb), '{recordatorio_enviado}', 'true'::jsonb)
  where id = p_lead_id
    and coalesce((cita ->> 'recordatorio_enviado')::boolean, false) = false
  returning true;
$$;
