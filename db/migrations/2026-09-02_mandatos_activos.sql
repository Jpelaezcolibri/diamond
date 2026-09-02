-- Interruptor del carril de COMPRA (mandatos).
--
-- POR QUE (Juan, 2026-09-02): "quiero tener la posibilidad de desactivar los
-- mandatos, esto con el fin de poder enfocar todas las fuerzas en las
-- propiedades que tenemos para la venta".
--
-- El radar tiene dos carriles y compiten por la atencion de la misma persona:
--
--   VENTA   un colega publica un PEDIDO y le ofrecemos nuestro inventario.
--           Es el que genera comision completa.
--   COMPRA  un colega publica una OFERTA y se la pasamos a un mandato nuestro.
--           Es comision compartida, y con 3 mandatos activos genero 18 avisos
--           en tres horas el 2 de septiembre — mas que todo el carril de venta
--           junto.
--
-- Apagar compra no borra nada: los mandatos siguen guardados, las ofertas que
-- ya cruzaron siguen en la base, y volver a prenderlo no pierde un dia de
-- trabajo. Lo unico que se detiene es el cruce de ofertas nuevas contra
-- mandatos, y con el los avisos que salen de ahi.
--
-- Mismo patron que organizations.radar_activo: se resuelve por organizacion,
-- no por env var, para que se pueda apagar desde el CRM sin redesplegar y para
-- que quede auditable quien lo cambio y cuando.
--
-- Sin correr esta migracion el bot funciona igual que hoy: la lectura degrada
-- a `true`, que es el comportamiento actual.
--
-- Correr a mano en Supabase. Idempotente.

alter table organizations
  add column if not exists mandatos_activos boolean not null default true;

comment on column organizations.mandatos_activos is
  'Carril de compra: si es false, las ofertas de colegas dejan de cruzarse contra los mandatos y no salen esos avisos. Los mandatos y su historial no se tocan.';
