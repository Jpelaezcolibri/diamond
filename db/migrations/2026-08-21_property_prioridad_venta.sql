-- Bandera manual de urgencia de venta por propiedad (Juan, 2026-08-21):
-- Catherine registro el apto ref 8989725 (El Poblado, sector Palmas) como
-- "Directa de Diamond, con urgencia de venta". El pedido fue que ESA
-- propiedad puntualmente le llegue a mas pedidos del radar de grupos, sin
-- bajar el umbral general para el resto del inventario. src/groups/match.js
-- le suma GRUPOS_BONUS_PRIORIDAD_VENTA (15 por defecto) al puntaje solo
-- cuando esta columna es true.
alter table properties add column if not exists prioridad_venta boolean not null default false;

comment on column properties.prioridad_venta is
  'Urgencia de venta marcada a mano. Suma puntaje extra en el cruce del radar de grupos (src/groups/match.js) solo para esta propiedad.';

update properties set prioridad_venta = true where ref = '8989725';
