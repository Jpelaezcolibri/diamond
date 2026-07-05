-- Migracion: roles del CRM + ownership de leads. Ejecutar en el SQL Editor de Supabase.

-- 1. Vincular advisors con el login del CRM (auth.users). Nullable: un advisor
--    puede existir solo para el bot (wa.me) sin tener cuenta en el CRM.
alter table advisors add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
create unique index if not exists idx_advisors_auth_user on advisors(auth_user_id) where auth_user_id is not null;

-- 2. Ownership de leads: quien puede editar. Ver siempre es de todo el equipo,
--    editar solo del owner (o admin).
alter table leads add column if not exists owner_id uuid references auth.users(id) on delete set null;
alter table leads add column if not exists owner_assigned_at timestamptz;
create index if not exists idx_leads_owner on leads(owner_id);

-- 3. Asesor de ventas solicitado: Juan Carlos Pelaez, celular 3016981200.
--    Se agrega como fila en advisors (cola de venta); si mas adelante crea su
--    login en /usuarios con el mismo celular, el sistema la vincula automaticamente.
--    Una sola organizacion por ahora (igual que el resto del CRM): se usa la primera.
insert into advisors (org_id, name, phone, especialidad)
select o.id, 'Juan Carlos Pelaez', '573016981200', 'venta'
from (select id from organizations order by created_at limit 1) o
where not exists (
  select 1 from advisors x where x.org_id = o.id and x.phone = '573016981200'
);
