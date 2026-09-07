-- Lo que el pedido dice sobre muebles y sobre el plazo del arriendo.
--
-- POR QUE (2026-09-07): el radar llevaba 155 demandas de arriendo capturadas y
-- CERO respondidas. "Amoblado" no existia para el motor -- Wasi solo lo pone en
-- el titulo de la propiedad, no en las caracteristicas -- asi que el cruce no
-- podia fallar de una sola manera sino de dos opuestas: ofrecer un vacio a
-- quien pidio amoblado, u ofrecer un amoblado a quien lo rechazo. El segundo
-- caso ya estaba en la base: "*Busco CASA para arriendo en el Poblado* 3
-- alcobas mas servicio $9.000.000 *SIN muebles*".
--
-- `amoblado` es TEXTO y no boolean a proposito: los tres valores ('si','no','')
-- son distintos. Un booleano no distingue "no lo pidio" de "lo rechazo".
--
-- `periodo` cubre el caso que hoy pasa sin que nada lo frene: "$4.500.000 por
-- 15 dias" calza perfecto contra un amoblado mensual del mismo precio.
--
-- Sin correr esta migracion el bot sigue funcionando: el insert de
-- src/data/group-signals.js reintenta sacando la columna que falte y avisa una
-- vez en el log. El CRM lee con select("*"), asi que tampoco se rompe.

alter table group_signals add column if not exists amoblado text;
alter table group_signals add column if not exists periodo text;

comment on column group_signals.amoblado is
  'Que dice el pedido sobre muebles: si | no | "" (no lo menciona). Texto y no boolean: "no lo pidio" y "lo rechazo" son distintos.';
comment on column group_signals.periodo is
  'Plazo del arriendo pedido: mes | corta | "" . "corta" = por noches, dias o semanas.';
