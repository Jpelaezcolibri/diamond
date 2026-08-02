-- Learning Domain — el Event Store de Radar.
--
-- Preserva la cadena que define el producto (P14):
--
--   Mensaje -> Senal -> Accion del asesor -> Resultado -> Aprendizaje
--
-- Hasta hoy la cadena se cortaba en el tercer eslabon: `group_signals.estado`
-- decia si alguien habia mirado una senal, y nada mas. Que paso despues —si
-- hubo conversacion, si hubo visita, si termino en negocio o por que no— no se
-- guardaba en ningun lado. Ese dato no se puede reconstruir despues: una
-- decision real de un asesor, en el momento exacto en que ocurrio, es
-- irrepetible.
--
-- DIRECCION DE LA DEPENDENCIA (regla permanente del DEOS):
--   Radar -> Learning Domain     OK
--   Learning Domain -> Radar     NUNCA
-- Nada del producto puede leer de esta tabla para funcionar. Se puede borrar
-- entera y Radar sigue detectando, cruzando y mandando el digest igual.
--
-- Correr a mano en Supabase. Idempotente.

-- ── 1. El Event Store ────────────────────────────────────────────────────
--
-- APPEND-ONLY. Nunca se actualiza, nunca se borra (P15). No es un log ni una
-- auditoria: es el origen del conocimiento futuro, y por eso la inmutabilidad
-- la hace cumplir la base y no la buena voluntad de quien escriba el codigo.
create table if not exists signal_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  -- La oportunidad de la que habla este evento.
  signal_id uuid not null references group_signals(id) on delete cascade,
  -- Quien REGISTRA el evento. Puede no ser el mismo que observo la senal: un
  -- admin puede cerrar el ciclo de una oportunidad de otro.
  advisor_id uuid references advisors(id) on delete set null,
  -- El recorrido natural de una oportunidad. Radar aprende tanto del fracaso
  -- como del cierre, asi que las dos puntas estan representadas.
  --
  -- `text` con constraint y NO un enum de Postgres a proposito: agregar un
  -- estado nuevo cuando el negocio lo pida es un alter del check, no una
  -- migracion de tipo sobre una tabla que para entonces sera grande.
  tipo text not null,
  -- Por que, cuando el asesor lo dice. Un "PERDIDO" sin motivo ensena la
  -- mitad; el motivo es lo que convierte el fracaso en conocimiento.
  motivo text,
  created_at timestamptz not null default now(),
  constraint signal_events_tipo_valido check (tipo in (
    'SIN_RESPUESTA', 'CONVERSACION', 'VISITA',
    'NEGOCIACION', 'CIERRE', 'PERDIDO', 'DESCARTADO'
  ))
);

-- P16: reconstruir la historia completa de una oportunidad, en orden. Es la
-- consulta que define el Learning Domain, asi que tiene su indice desde el
-- primer dia aunque hoy la tabla este vacia.
create index if not exists idx_signal_events_historia
  on signal_events (signal_id, created_at);

-- La otra pregunta que ya sabemos que vamos a hacer: que le paso a las
-- oportunidades de UN asesor, en orden. "El Radar de Natalia" empieza aca.
create index if not exists idx_signal_events_asesor
  on signal_events (org_id, advisor_id, created_at);

-- ── 2. La inmutabilidad, en la base ──────────────────────────────────────
--
-- P15 dice que los eventos son inmutables. Un principio que solo vive en un
-- comentario no es un principio. Esto lo vuelve imposible de violar por
-- accidente: ni un UPDATE de mantenimiento ni un `.update()` olvidado en el
-- codigo pueden reescribir la historia.
create or replace function signal_events_inmutable()
returns trigger language plpgsql as $$
begin
  raise exception 'signal_events es append-only: la historia de una oportunidad no se reescribe (P15). Registra un evento nuevo.';
end;
$$;

drop trigger if exists signal_events_no_update on signal_events;
create trigger signal_events_no_update
  before update or delete on signal_events
  for each row execute function signal_events_inmutable();

-- ── 3. La senal es una observacion, y las observaciones tienen autor ──────
--
-- El grupo gremial es COMPARTIDO —Natalia y Danna estan en los mismos— pero la
-- interpretacion no lo es. Por eso el autor va en la senal y no en el grupo:
--
--   Grupo -> Interpretacion del asesor -> Senal
--
-- Sin esta columna dos asesores que suben el mismo grupo caen en la misma fila
-- de `whatsapp_groups` y sus senales quedan indistinguibles. Es lo que hace
-- posible preguntar "que vio Natalia" y no solo "que aparecio".
--
-- Nullable: las senales de origen 'reenvio' y las historicas no tienen autor
-- conocido, y una senal sin autor sigue siendo una oportunidad valida.
alter table group_signals
  add column if not exists advisor_id uuid references advisors(id) on delete set null;

-- Cuando el asesor la abrio por primera vez. Distinto de `estado`: `estado`
-- dice si alguien la gestiono, esto dice si llego a mirarla. La diferencia
-- entre "no le sirvio" y "nunca la vio" es la mitad de lo que hay que aprender.
alter table group_signals
  add column if not exists visto_at timestamptz;

create index if not exists idx_group_signals_asesor
  on group_signals (org_id, advisor_id, created_at desc);

-- ── 4. RLS ───────────────────────────────────────────────────────────────
--
-- Mismo patron permisivo que el resto de las tablas de grupos. NO es correcto
-- multi-tenant y esta anotado como deuda Alta en la auditoria: se cierra
-- entero, de una vez, antes del segundo cliente. Dejarlo distinto solo en esta
-- tabla daria una falsa sensacion de seguridad.
alter table signal_events enable row level security;

drop policy if exists "team read" on signal_events;
create policy "team read" on signal_events for select to authenticated using (true);
