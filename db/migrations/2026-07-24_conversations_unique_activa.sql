-- Migracion: evita conversaciones "activa" duplicadas para el mismo lead.
-- Correr a mano en el SQL Editor de Supabase. Idempotente.
--
-- conversations.findOrCreate era select-then-insert: dos mensajes casi
-- simultaneos del mismo cliente (patron normal de un chat real) podian crear
-- DOS conversaciones "activa" para el mismo lead_id — el historial quedaba
-- partido entre ambas y Sofi respondia con la mitad del contexto (o el
-- cliente recibia dos respuestas de dos turnos distintos entrelazadas).
--
-- 1) Dedupe de lo que ya pueda existir en produccion: cierra ("cerrada")
--    todas las "activa" de un lead salvo la mas reciente, antes de que el
--    indice unico de abajo no deje crearlo si hay duplicados.
with duplicadas as (
  select id, lead_id,
         row_number() over (partition by lead_id order by created_at desc) as rn
  from conversations
  where estado = 'activa'
)
update conversations set estado = 'cerrada'
where id in (select id from duplicadas where rn > 1);

-- 2) De aqui en adelante, a nivel de base de datos, es imposible tener dos
--    conversaciones "activa" para el mismo lead. src/data/conversations.js
--    (findOrCreate) ya sabe recuperarse del error 23505 si dos inserts
--    concurrentes chocan contra este indice.
create unique index if not exists conversations_one_activa_per_lead
  on conversations(lead_id) where estado = 'activa';
