-- El mapa lid -> telefono de los participantes visibles de los grupos.
--
-- POR QUE (Juan, 2026-09-02): "los numeros que ya se pueden ver en todos los
-- grupos como base de datos para que no tenga que ir a waha a revisar en cada
-- respuesta, si no que se crucen con el id del colega".
--
-- EL PROBLEMA QUE RESUELVE. Resolver el telefono de quien publica un pedido
-- dependia de preguntarle a WAHA en ese instante. Medido el 2026-09-02: WAHA
-- alterna entre devolver 735 participantes y devolver CERO, sin error y sin
-- aviso. Cuando devuelve cero, el pedido se desvia al camino manual aunque el
-- numero fuera perfectamente visible diez minutos antes. Ese dia se perdio asi
-- el pedido de Katalina Patino: la propiedad estaba aprobada, la linea tenia
-- 1 de sus 150 mensajes del dia, el pedido tenia 4 segundos, y la traza de la
-- decision dice una sola cosa: NO:sin_telefono.
--
-- Con esta tabla, la resolucion pasa a ser una consulta local. WAHA solo se
-- consulta para DESCUBRIR pares nuevos, en el calentamiento de fondo
-- (src/scheduler/radar-directorio.js), nunca en el camino critico de una
-- respuesta.
--
-- ══ ALCANCE: ESTO NO CAMBIA A QUIEN SE LE ESCRIBE ══
--
-- La migracion 2026-08-22_colegas_grupos.sql limito a proposito el respaldo a
-- los colegas que PUBLICAN un pedido, citando la Ley 1581 de 2012: guardar y
-- usar datos de contacto de terceros con fines comerciales cae bajo esa ley, y
-- acotarlo a la interaccion real es lo que lo hace defendible.
--
-- Ese limite SIGUE EN PIE y no lo toca esta tabla, porque vive en otro lado:
-- quien recibe un mensaje lo decide src/groups/politica.js#decidirDm, que solo
-- habilita el DM al colega que acaba de publicar un pedido que cruzamos. Esta
-- tabla es una CACHE DE RUTEO —como saber a que numero corresponde una
-- extension telefonica— no una lista de contactos para prospectar. Nadie
-- recibe un mensaje por estar aca.
--
-- Consecuencia practica de esa separacion:
--   · colegas_grupos  = con quien tuvimos una interaccion real. No cambia.
--   · directorio_lids = como enrutar una respuesta. Se puede vaciar entera y
--     el sistema sigue funcionando, solo que volviendo a preguntarle a WAHA.
--
-- No se guarda nada mas que lo necesario para enrutar: el lid, el telefono y
-- cuando se vio por ultima vez. Sin nombres, sin grupos, sin historial.
--
-- Correr a mano en Supabase. Idempotente.

create table if not exists directorio_lids (
  org_id uuid not null references organizations(id) on delete cascade,
  -- El identificador oculto con el que WhatsApp presenta a alguien en un
  -- grupo. Es la clave estable: el telefono puede aparecer despues, el lid no
  -- cambia.
  lid text not null,
  -- Solo digitos, con indicativo. Solo entra si pasa esCelularColombiano.
  telefono text not null,
  actualizado_at timestamptz not null default now(),
  primary key (org_id, lid)
);

-- La consulta inversa (¿de quien es este telefono?) no la usa el radar, pero
-- si haria falta para depurar un caso puntual.
create index if not exists directorio_lids_telefono_idx
  on directorio_lids (org_id, telefono);

comment on table directorio_lids is
  'Cache de ruteo lid -> telefono de participantes visibles de los grupos. NO es una lista de contactos: a quien se le escribe lo decide src/groups/politica.js#decidirDm. Se puede vaciar sin perder nada.';
