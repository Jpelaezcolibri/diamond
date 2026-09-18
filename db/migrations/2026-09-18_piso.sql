-- El piso que exige el pedido del colega.
--
-- POR QUE (2026-09-18): 255 de los 1.000 pedidos capturados entre el 1-ago y
-- el 18-sep nombran el piso ("Sólo hasta 3° piso", "Sin ascensor máximo
-- segundo", "Nivel de piso máximo 7"), y hasta hoy el clasificador ni siquiera
-- lo extraia. Con la regla nueva -- "lo que es zonas, pisos, parqueaderos, etc
-- hazlo literal" (Juan) -- el piso descarta, asi que tiene que quedar guardado
-- para que el CRM, el aviso a la asesora y cualquier recalculo vean lo mismo
-- que vio el motor en vivo.
--
-- Dos columnas y no una: el pedido lo dice en las dos direcciones. "Solo hasta
-- 3er piso" es un techo; "piso alto" es un piso minimo.
--
-- ENTEROS CON 0 = "no lo pidio", igual que banos/garajes/estrato en esta misma
-- tabla. Un null obligaria a comprobarlo en cada lector.
--
-- Sin correr esta migracion el bot sigue funcionando: el insert de
-- src/data/group-signals.js reintenta sacando la columna que falte y avisa una
-- vez en el log; la compuerta del motor no depende de la base porque cruza con
-- el clasificado en memoria. Lo que se pierde es la trazabilidad.

alter table group_signals add column if not exists piso_max integer;
alter table group_signals add column if not exists piso_min integer;

comment on column group_signals.piso_max is
  'Piso mas alto que acepta el pedido. 0 = no lo pidio.';
comment on column group_signals.piso_min is
  'Piso mas bajo que acepta el pedido. 0 = no lo pidio.';
