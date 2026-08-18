-- Radar asistido: Sofi revalida y le avisa a la asesora.
--
-- Modo intermedio entre "sombra" (redacta y no publica) y "auto" (publica en el
-- grupo). En asistido NO se publica nada: el bot lee, el motor cruza, Sofi da su
-- veredicto sobre las candidatas y, si aprueba, le escribe a la asesora.
--
-- POR QUE SE GUARDA EL VEREDICTO ENTERO. Es el dato con el que se calibra. Cada
-- oportunidad queda con tres cosas comparables:
--
--   1. el puntaje del motor      (deterministico, ya estaba en `matches`)
--   2. el veredicto de Sofi      (esta migracion)
--   3. lo que la asesora hizo    (signal_events, ya existia)
--
-- Con esas tres se puede responder la pregunta que hoy no tiene respuesta: si el
-- umbral de 70 esta bien puesto, o si esta dejando pasar oportunidades buenas.
-- Sofi ve TODAS las candidatas, tambien las de puntaje bajo, justamente para que
-- los falsos negativos —invisibles por definicion— dejen de serlo.
--
-- Correr a mano en el SQL Editor de Supabase. Idempotente.

alter table group_signals
  add column if not exists revalidacion jsonb;

-- El aviso a la asesora reusa `enviado_at`, que ya existia para las alertas de
-- la Fase 2: si quedo en null, el aviso NO salio y sigue pendiente. Esa es la
-- cola que se vacia cuando ella escribe y se reabre la ventana de 24 h.
--
-- Indice para encontrarlas rapido: las que Sofi aprobo y todavia no salieron.
create index if not exists idx_group_signals_aviso_pendiente
  on group_signals (org_id, created_at desc)
  where revalidacion is not null and enviado_at is null;

-- Verificacion: al correrla no deberia haber ninguna revalidada todavia.
--   select count(*) from group_signals where revalidacion is not null;  -- 0
