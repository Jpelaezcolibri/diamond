-- El panel "Posibles ventas" del CRM (Juan, 2026-08-21) necesita poder
-- confirmar o descartar cada aviso, y que quede guardado — no solo el
-- mensaje de WhatsApp que ya le llega. Mismo criterio que
-- group_signals.estado: validacion en la app (src/data/visitas.js), no un
-- CHECK en la base, para no atarse a una migracion nueva cada vez que se
-- agregue un estado.
--
-- Correr a mano en Supabase. Idempotente.

alter table visita_venta_alertas add column if not exists estado text not null default 'pendiente';
alter table visita_venta_alertas add column if not exists actualizado_por uuid;
alter table visita_venta_alertas add column if not exists actualizado_at timestamptz;

-- La visita que disparo la alerta, guardada tal cual estaba al momento de
-- avisar — no se recalcula despues. src/data/visitas.js#recientes solo mira
-- los ultimos 30 dias: sin esto, un aviso viejo perderia el dato de que
-- visita fue cuando la ventana ya paso. `titulo`/`link` de la propiedad NO
-- se guardan aca: esos se leen de `properties` por `ref` al mostrar el
-- panel, para no arrastrar un dato que puede cambiar (precio, disponible).
alter table visita_venta_alertas add column if not exists visita_quien text;
alter table visita_venta_alertas add column if not exists visita_origen text;
alter table visita_venta_alertas add column if not exists visita_fecha_hora_iso timestamptz;

comment on column visita_venta_alertas.estado is
  'pendiente | confirmada | descartada. Lo marca Juan desde el panel "Posibles ventas" del CRM (/grupos).';
