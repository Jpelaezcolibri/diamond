-- Las zonas COMPLETAS que nombra un pedido, y las que excluye.
--
-- POR QUE (caso Camilo Loaiza, 2026-09-02): el colega pidio "Solo estos
-- sectores porfavor: Brujas, Escobero, Esmeraldal, Chocho, Cumbres". El
-- clasificador extrae las cinco (classify.js#zonas) y el motor de cruce las
-- usa todas (match.js#zonasPedidas), pero la señal guardaba solo `zona`, que
-- es la PRIMERA de la lista. Efecto: en el CRM se lee un pedido que no es el
-- que hizo el colega, y cualquier reevaluacion posterior parte de un dato
-- recortado.
--
-- `zonas_excluidas` tenia el mismo problema y es peor: un pedido que dice
-- "❌ No Loma del Indio" se guardaba sin esa exclusion, asi que nada impedia
-- volver a ofrecer justo lo que el colega rechazo.
--
-- Es exactamente el mismo hueco que se cerro el 2026-08-24 con area_min,
-- banos, garajes y estrato: el dato se extraia, se usaba, y no se guardaba.
--
-- Sin correr esta migracion el bot sigue funcionando: el insert de
-- src/data/group-signals.js reintenta sacando la columna que falte y avisa
-- una vez en el log. El CRM lee con select("*"), asi que tampoco se rompe.

alter table group_signals add column if not exists zonas text[];
alter table group_signals add column if not exists zonas_excluidas text[];

comment on column group_signals.zonas is
  'Todos los barrios/sectores que nombra el pedido. `zona` es el primero de esta lista, se conserva por compatibilidad.';
comment on column group_signals.zonas_excluidas is
  'Zonas que el pedido excluye explicitamente ("No Loma del Indio", "menos Robledo").';
