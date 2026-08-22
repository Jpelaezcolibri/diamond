-- Respaldo de los colegas de los grupos gremiales: su LID y, cuando WhatsApp
-- lo deja ver, su telefono real (Juan, 2026-08-22).
--
-- POR QUE EXISTE. WhatsApp oculta el numero de los participantes de un grupo
-- detras de un LID (identificador oculto). Lo que el radar venia guardando en
-- group_signals.autor_telefono NO son telefonos: son LIDs de 14 a 17 digitos,
-- contra los 12 de un movil colombiano (12 de 12 en las senales del dia).
--
-- Medido en produccion el 2026-08-22 sobre los 12 grupos que se escuchan:
--   · La Lids API de WAHA (/lids/{lid}) resolvio 0 de 45 colegas, y
--     /lids/count no responde. Inservible en esa version.
--   · La lista de participantes SI trae el telefono (`pn`) de ~80% de la gente
--     (706 de 878 en SOLO POBLADO, 660 de 819 en Envigado), y con eso se
--     resuelven 30 de 45 colegas reales: 67%.
--   · El indice completo da ~1.012 colegas distintos con telefono visible.
--
-- Dos usos, un solo dato:
--   1. Poder responderle al privado al colega que publica un pedido (Fase 2).
--   2. Saber que quien le escribe a Sofi es un COLEGA y no un cliente, para que
--      lo atienda como par (src/agent/prompts.js#promptColega). Sale del mismo
--      problema que la deteccion de asesores: el 2026-07-29 Sofi trato a su
--      propia companera como clienta y dejo un lead falso en el embudo.
--
-- Y de paso el seguro que pidio Juan: si banean la linea del radar, los
-- contactos con los que hubo negocio siguen aca.
--
-- ALCANCE DELIBERADO: se escribe cuando el colega PUBLICA un pedido que
-- cruzamos, no barriendo los 1.012 participantes que se pueden ver. Guardar y
-- usar datos de contacto de terceros para fines comerciales cae bajo la Ley
-- 1581 de 2012; limitarlo a la interaccion real es lo que hace defendible el
-- respaldo, y no cuesta nada en cobertura. Un test sobre el fuente de vivo.js
-- impide que ese limite se corra sin querer.
--
-- Correr a mano en Supabase. Idempotente.

create table if not exists colegas_grupos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  -- El identificador oculto con el que WhatsApp lo presenta en el grupo. Es la
  -- clave estable: el telefono puede aparecer despues, el lid no cambia.
  lid text not null,
  -- Solo digitos, con indicativo y sin '+' (mismo formato que advisors.phone).
  -- Null mientras no se haya podido resolver: la fila igual sirve, deja
  -- constancia de que ese colega existe y de que no es alcanzable todavia.
  telefono text,
  nombre text,
  -- En que grupos se lo vio. Un colega tipico esta en varios: los 6.348
  -- asientos medidos corresponden a ~1.012 personas distintas.
  grupos jsonb not null default '[]'::jsonb,
  primer_visto timestamptz not null default now(),
  ultimo_visto timestamptz not null default now(),
  unique (org_id, lid)
);

comment on table colegas_grupos is
  'Colegas de otras inmobiliarias vistos en los grupos gremiales, con su telefono cuando WhatsApp lo deja ver. Se escribe sobre interaccion real (publico un pedido que cruzamos), nunca barriendo la lista de participantes.';
comment on column colegas_grupos.lid is
  'Identificador oculto de WhatsApp (@lid, sin sufijo). Clave estable del colega.';
comment on column colegas_grupos.telefono is
  'Telefono real en digitos. Null = todavia no resuelto; ese colega necesita respuesta manual.';
comment on column colegas_grupos.grupos is
  'Nombres de los grupos donde se lo vio publicar. Se acumulan, no se reemplazan.';

-- La consulta que define la deteccion de colega: "quien escribe con este
-- telefono". Parcial porque las filas sin telefono no se buscan asi nunca.
create index if not exists idx_colegas_grupos_telefono
  on colegas_grupos (org_id, telefono)
  where telefono is not null;

alter table colegas_grupos enable row level security;

drop policy if exists "team read" on colegas_grupos;
create policy "team read" on colegas_grupos for select to authenticated using (true);
