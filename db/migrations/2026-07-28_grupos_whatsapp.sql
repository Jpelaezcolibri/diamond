-- Migracion: Sofi escucha los grupos gremiales de WhatsApp (Fase 1, modo
-- sombra). Ejecutar en el SQL Editor de Supabase.
--
-- Diseno completo:
-- docs/superpowers/specs/2026-07-28-sofi-grupos-whatsapp-design.md
--
-- Contexto que explica por que las tablas son como son: la Groups API oficial
-- de Meta no sirve para este caso (max 8 participantes, exige tick verde y
-- prohibe entrar a grupos de terceros), asi que la unica via es el protocolo
-- de WhatsApp Web via un dispositivo vinculado. NINGUNA linea escribe nunca:
-- el sistema solo lee. De ahi que aca no haya nada para registrar envios.

-- Una sesion = una linea de asesor vinculada como dispositivo (igual que
-- WhatsApp Web). Leer no suma riesgo, asi que la escucha escala sumando
-- sesiones: cada asesor aporta los grupos en los que ya esta.
create table if not exists whatsapp_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  advisor_id uuid references advisors(id) on delete set null,
  -- Nombre de la sesion en WAHA. Es la clave con la que llegan los webhooks.
  nombre text not null,
  estado text not null default 'pendiente', -- pendiente | activa | caida
  ultima_senal_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, nombre)
);

-- Grupos descubiertos por alguna sesion.
--
-- modo 'ignorar' es el DEFAULT y no es una preferencia de UX: es la garantia
-- de privacidad. Un dispositivo vinculado recibe TODOS los chats, no solo los
-- grupos — es inherente al protocolo. Que un grupo solo exista para el sistema
-- cuando alguien lo prendio a mano es lo que impide que un grupo nuevo, o uno
-- al que el asesor entre manana, se filtre por olvido.
create table if not exists whatsapp_groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  -- JID de WhatsApp: 120363...@g.us
  jid text not null,
  nombre text,
  modo text not null default 'ignorar', -- ignorar | sombra | sugerir
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, jid),
  constraint whatsapp_groups_modo_valido check (modo in ('ignorar', 'sombra', 'sugerir'))
);

-- N:M — el mismo grupo puede verse desde varias sesiones (dos asesores en el
-- mismo grupo). Es exactamente el caso que obliga a deduplicar mas abajo.
create table if not exists whatsapp_group_sessions (
  group_id uuid not null references whatsapp_groups(id) on delete cascade,
  session_id uuid not null references whatsapp_sessions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, session_id)
);

-- Senales detectadas: SOLO demanda y oferta. Lo clasificado como ruido no se
-- persiste nunca (invariante de privacidad #4) — muere en memoria.
create table if not exists group_signals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  group_id uuid not null references whatsapp_groups(id) on delete cascade,
  -- id del mensaje que asigna WhatsApp. Es la clave de dedup entre sesiones:
  -- el mismo mensaje visto por dos asesores trae el mismo id.
  wa_message_id text not null,
  autor_nombre text,
  autor_telefono text,
  clase text not null, -- demanda | oferta
  confianza numeric,
  operacion text,
  tipo text,
  zona text,
  ciudad text,
  precio_min bigint,
  precio_max bigint,
  habitaciones int,
  contacto text,
  texto_original text,
  -- Matches contra properties / ally_properties al momento de detectar.
  matches jsonb not null default '[]'::jsonb,
  estado text not null default 'nuevo', -- nuevo | gestionado | descartado
  enviado_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint group_signals_clase_valida check (clase in ('demanda', 'oferta')),
  constraint group_signals_estado_valido check (estado in ('nuevo', 'gestionado', 'descartado'))
);

-- Dedup multi-sesion. Sin esto se paga la IA dos veces por el mismo mensaje y
-- —cuando llegue la Fase 2— el asesor recibe la alerta duplicada.
create unique index if not exists idx_group_signals_dedup
  on group_signals (org_id, group_id, wa_message_id);

create index if not exists idx_group_signals_recientes
  on group_signals (org_id, created_at desc);

create index if not exists idx_group_signals_pendientes
  on group_signals (org_id, clase, estado) where estado = 'nuevo';

-- Lista blanca del webhook: la consulta que corre en la primera linea de cada
-- mensaje entrante.
create index if not exists idx_whatsapp_groups_activos
  on whatsapp_groups (org_id, jid) where activo and modo <> 'ignorar';

-- RLS: mismo patron que el resto del esquema (ver 2026-07-06_ally_properties)
-- — lectura para el equipo logueado, y nada mas. Las escrituras las hace el
-- bot con la service key, que ignora RLS; el CRM cambia el modo de un grupo
-- llamando al API del bot (src/api/crm.js), no escribiendo directo.
--
-- Que el CRM no pueda escribir aca no es incidental: el modo de un grupo es
-- la llave de la privacidad del asesor, y conviene que pase por un solo
-- camino auditable.
alter table whatsapp_sessions enable row level security;
alter table whatsapp_groups enable row level security;
alter table whatsapp_group_sessions enable row level security;
alter table group_signals enable row level security;

drop policy if exists "team read" on whatsapp_sessions;
create policy "team read" on whatsapp_sessions for select to authenticated using (true);

drop policy if exists "team read" on whatsapp_groups;
create policy "team read" on whatsapp_groups for select to authenticated using (true);

drop policy if exists "team read" on whatsapp_group_sessions;
create policy "team read" on whatsapp_group_sessions for select to authenticated using (true);

drop policy if exists "team read" on group_signals;
create policy "team read" on group_signals for select to authenticated using (true);
