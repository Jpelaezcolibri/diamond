-- Lo que el colega pidio de verdad: area, baños, garajes, estrato y si acepta
-- una alcoba menos (Juan, 2026-08-24). Correr a mano en el SQL Editor de
-- Supabase. Idempotente.
--
-- POR QUE. src/groups/classify.js YA extrae estos campos y
-- src/groups/match.js YA los usa para puntuar (son cinco de las seis
-- exigencias de evaluarCandidata). Lo unico que faltaba era guardarlos: la
-- señal solo persistia operacion, tipo, zona, ciudad, precio y habitaciones.
--
-- Dos consecuencias reales, las dos vistas el 2026-08-24 en el pedido de
-- Edwin Ramirez ("Area minima desde 98m2 ... 2 o mas baños ... 2 garaje y
-- cuarto util"):
--
--   1. EL PANEL MIENTE POR OMISION. El recuadro "Lo que pide" mostraba
--      operacion, tipo, zona, presupuesto y alcobas — y nada mas. Catherine
--      leia un pedido recortado y no podia entender por que una propiedad
--      puntuaba lo que puntuaba. Peor desde que el puntaje castiga quedarse
--      corto (ver CASTIGO_CORTO en match.js): la razon dice "1 garaje
--      (pediste 2)" y el pedido de al lado no mencionaba garajes.
--   2. NO SE PUEDE MEDIR NADA SOBRE HISTORICO. Al calibrar el castigo por
--      cumplir corto solo se pudo verificar el efecto en alcobas y precio,
--      que son los unicos que la señal guarda. Los otros tres quedaron
--      estimados en vez de medidos.
--
-- Columnas NULLABLE y sin default: el codigo degrada limpio si la migracion
-- todavia no corrio (ver COLUMNAS_NUEVAS / esColumnaFaltante en
-- src/data/group-signals.js — el insert reintenta sin la columna que falte en
-- vez de tumbar la captura), y el CRM lee con select("*"), asi que la
-- pantalla no se rompe: los campos salen undefined y no se dibujan.
--
-- Nada se rellena hacia atras: las señales anteriores a esta fecha no tienen
-- de donde sacar el dato (habria que reclasificar el texto con la IA). Se
-- quedan en NULL y el panel simplemente no muestra esas filas, igual que hoy.

alter table group_signals
  add column if not exists area_min int,
  add column if not exists banos int,
  add column if not exists garajes int,
  add column if not exists estrato int,
  add column if not exists flexible_habitaciones boolean;

comment on column group_signals.area_min is
  'Metros cuadrados minimos que pidio el colega. NULL = no lo menciono (o la señal es anterior a 2026-08-24). Lo extrae src/groups/classify.js y lo usa src/groups/match.js#evaluarCandidata.';
comment on column group_signals.banos is
  'Baños minimos que pidio el colega. NULL = no lo menciono.';
comment on column group_signals.garajes is
  'Parqueaderos minimos que pidio el colega. NULL = no lo menciono.';
comment on column group_signals.estrato is
  'Estrato minimo que pidio el colega. NULL = no lo menciono. Unica exigencia sin gabela: su compuerta es dura (ver match.js).';
comment on column group_signals.flexible_habitaciones is
  'true si el pedido acepta una alcoba/baño/garaje MENOS ("3 alcobas o 2 con estudio", "para inversion"). Explica por que una propiedad corta pudo entrar. NULL = no se sabe.';

-- Verificacion: las señales viejas quedan en NULL; las nuevas empiezan a
-- traer lo que el colega pidio de verdad.
-- select id, habitaciones, area_min, banos, garajes, estrato, flexible_habitaciones
--   from group_signals where clase = 'demanda' order by created_at desc limit 10;
