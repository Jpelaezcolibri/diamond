-- Migracion: la venta queda a cargo de Catherine Uribe. Correr a mano en el
-- SQL Editor de Supabase. Idempotente.
--
-- Decision de Juan 2026-08-14, que REEMPLAZA la de 2026-07-25
-- (2026-07-25_advisor_rotacion.sql): alli la rotacion de venta quedo entre
-- Natalia y Danna, y Catherine quedo fuera. Ahora es al reves.
--
-- Se usa recibe_transferencias = false y NO activo = false: Natalia y Danna
-- conservan usuario del CRM, inbox y los leads de las propiedades marcadas a
-- su nombre (captador_id). Volver atras es poner true.

-- 1. Natalia y Danna salen de la rotacion de venta.
--    La fila de Danna que se toca es la de venta; sus filas de arriendo y
--    vehiculos quedan intactas (ids distintos, misma persona).
update advisors set recibe_transferencias = false where id in (
  'f2ad2c41-71e4-4ff6-9e7e-54a53f6979a7', -- Natalia Velez (venta)
  'f63ca64b-80de-41b5-9dba-fd5dc4a138dc'  -- Danna Ospina (venta)
);

-- 2. Catherine queda como unica candidata de la rotacion de venta.
--    Es la fila con login del CRM (auth_user_id 772b8e14...), creada
--    2026-08-14. La fila vieja 9070e115 ("Catherine Uribe", mismo telefono,
--    sin login) se deja en false a proposito: si entrara a la rotacion,
--    Catherine contaria dos veces en el round-robin.
update advisors set recibe_transferencias = true
  where id = '293768b1-e4b6-4f86-8606-b3352b817fa6'; -- katherine Uribe (venta)

-- 3. Agenda de Catherine: se habilitan sabado y domingo.
--    `dias` es 0=domingo..6=sabado (WEEKDAY_INDEX en src/data/appointments.js).
--    El horario es UNA sola franja para todos los dias del arreglo: el schema
--    no admite una ventana distinta por dia, asi que el fin de semana queda
--    con la misma que entre semana.
--    Ojo: una visita dura 60 min y debe CABER completa antes de `hasta`
--    (appointments.js:51), de modo que la ultima cita agendable arranca 17:00.
update advisors set horario = jsonb_build_object(
    'dias', jsonb_build_array(0, 1, 2, 3, 4, 5, 6),
    'desde', '08:00',
    'hasta', '18:00'
  )
  where id = '293768b1-e4b6-4f86-8606-b3352b817fa6';

-- Verificacion: debe devolver UNA sola fila, katherine Uribe, con los 7 dias.
-- select name, recibe_transferencias, horario from advisors
--   where especialidad = 'venta' and activo and recibe_transferencias;
