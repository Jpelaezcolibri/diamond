-- Migracion: registro de transferencia en leads + mensajes de sistema en el historial
-- Fecha: 2026-07-23
-- Correr a mano en el SQL Editor de Supabase (no hay db:push en este proyecto).
-- Idempotente: se puede correr mas de una vez sin danar datos.

-- ── 1) Columnas de transferencia en leads ────────────────────────────────
-- Quien recibio el lead y cuando. Nombre denormalizado para que el CRM no
-- necesite join (y siga funcionando si el asesor se borra).
alter table leads add column if not exists transferido_advisor_id uuid references advisors(id) on delete set null;
alter table leads add column if not exists transferido_a_nombre text;
alter table leads add column if not exists transferido_at timestamptz;

-- ── 2) Mensajes de sistema en el historial de Sofi ───────────────────────
-- El check actual solo permite 'user' | 'assistant'. Se agrega 'system' para
-- notas de eventos (ej. "Transferido a ...") que quedan guardadas en la
-- conversacion y visibles en el CRM.
alter table messages drop constraint if exists messages_role_check;
alter table messages add constraint messages_role_check check (role in ('user', 'assistant', 'system'));

-- ── 3) Backfill del historial con datos VERDADEROS ───────────────────────
-- Fuente primaria: el mensaje real de despedida de Sofi, que siempre incluye
-- el link wa.me/<telefono> del asesor. De ahi salen (a) la fecha/hora exacta
-- de la transferencia (created_at del mensaje) y (b) el asesor (match del
-- telefono contra advisors de la misma org). No se inventa ningun dato.
with primer_link as (
  select distinct on (c.lead_id)
         c.lead_id,
         m.created_at as transfer_at,
         substring(m.content from 'wa\.me/(\d+)') as advisor_phone
  from messages m
  join conversations c on c.id = m.conversation_id
  where m.role = 'assistant'
    and m.content ~ 'wa\.me/\d+'
  order by c.lead_id, m.created_at asc
),
con_asesor as (
  -- El match con advisors se resuelve aqui (no en el UPDATE) porque Postgres
  -- no permite referenciar la tabla actualizada dentro del JOIN del FROM.
  select p.lead_id, p.transfer_at, a.id as advisor_id, a.name as advisor_name
  from primer_link p
  join leads lx on lx.id = p.lead_id
  left join advisors a on a.org_id = lx.org_id and a.phone = p.advisor_phone
)
update leads l
set transferido_at         = coalesce(l.transferido_at, s.transfer_at),
    transferido_advisor_id = coalesce(l.transferido_advisor_id, s.advisor_id),
    transferido_a_nombre   = coalesce(l.transferido_a_nombre, s.advisor_name)
from con_asesor s
where l.id = s.lead_id
  and l.estado in ('transferido', 'cerrado_ganado', 'cerrado_perdido');

-- Fallback: leads transferidos sin mensaje wa.me (casos viejos). El asesor
-- sale del owner_id real; la FECHA se deja null a proposito (no hay evidencia
-- de cuando fue) — el CRM mostrara solo el nombre.
update leads l
set transferido_advisor_id = coalesce(l.transferido_advisor_id, a.id),
    transferido_a_nombre   = coalesce(l.transferido_a_nombre, a.name)
from advisors a
where a.org_id = l.org_id
  and a.auth_user_id = l.owner_id
  and l.owner_id is not null
  and l.transferido_a_nombre is null
  and l.estado in ('transferido', 'cerrado_ganado', 'cerrado_perdido');

-- ── 4) Nota de sistema retroactiva en cada conversacion transferida ──────
-- Inserta el mensaje "Transferido a ..." con created_at = fecha real de la
-- transferencia, para que aparezca en su lugar correcto del historial.
-- Solo donde hay fecha verificada; guard anti-duplicados por conversacion.
insert into messages (conversation_id, role, content, created_at)
select c.id,
       'system',
       'Transferido a ' || l.transferido_a_nombre || ' — '
         || to_char(l.transferido_at at time zone 'America/Bogota', 'DD/MM/YYYY, HH12:MI ')
         || case when to_char(l.transferido_at at time zone 'America/Bogota', 'AM') = 'AM' then 'a. m.' else 'p. m.' end,
       l.transferido_at
from leads l
join conversations c on c.lead_id = l.id
where l.transferido_at is not null
  and l.transferido_a_nombre is not null
  and not exists (
    select 1 from messages m
    where m.conversation_id = c.id
      and m.role = 'system'
      and m.content like 'Transferido a %'
  );

-- ── Verificacion rapida (opcional, solo lectura) ─────────────────────────
-- select estado, transferido_a_nombre, transferido_at
-- from leads where estado in ('transferido','cerrado_ganado','cerrado_perdido')
-- order by transferido_at desc nulls last;
