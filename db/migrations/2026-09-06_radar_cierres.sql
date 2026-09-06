-- El cierre del dia: la numeracion que se le mando a la asesora, guardada.
--
-- POR QUE (Juan, 2026-09-06): "el asesor no sabe de que propiedad estan
-- hablando... necesito que al final del dia se le haga una sola encuesta o
-- algo que al asesor le den ganas de responder sabiendo que propiedades
-- fueron las que se hizo gestion".
--
-- EL PROBLEMA QUE RESUELVE. El recordatorio por pedido citaba
-- `texto_original`, o sea lo que escribio el COLEGA en el grupo. La asesora no
-- gestiona pedidos ajenos: gestiona sus propiedades, y las reconoce por
-- referencia. Ademas, los pedidos que Sofi ya le habia mandado sola al colega
-- nunca entraban al circuito (pendientesDeAviso exige respondida_at null): en
-- septiembre salieron 54 mensajes y hay 1 solo resultado registrado.
--
-- ══ POR QUE UNA TABLA Y NO VOLVER A CALCULAR LA LISTA ══
--
-- El cierre le pide a la asesora que responda POR NUMERO ("1 no servia, 3 hubo
-- visita"). Ese numero tiene que significar lo mismo cuando ella contesta que
-- cuando se envio. Si la lista se recalcula al recibir la respuesta, cualquier
-- señal que entre entre las 18:30 y su contestacion corre la numeracion y el
-- resultado queda registrado sobre la propiedad equivocada. Registrar mal es
-- peor que no registrar: es exactamente lo que registrarResultadoRadar ya evita
-- negandose a adivinar cuando hay varios pendientes.
--
-- El unique (org_id, advisor_id, fecha) es ademas el reclamo atomico del envio:
-- dos corridas del mismo dia no pueden mandar dos cierres. Mismo patron que
-- claimRecordatorio en src/data/group-signals.js.
--
-- `items` guarda la referencia ELEGIDA, no todas las candidatas: es la
-- propiedad por la que se pregunto, y sin ella el registro no seria auditable
-- mañana. Se agrupa POR REFERENCIA, asi que un item puede cubrir varias
-- señales (la misma propiedad ofrecida a dos colegas es un solo numero).
--
-- Correr a mano en Supabase. Idempotente.

-- ══ POR QUE TODO VA CALIFICADO CON `public.` (2026-09-06) ══
--
-- Al correrla, el editor devolvio: ERROR 42P01: relation "organizations" does
-- not exist. La tabla SI existe en el proyecto qwqmlmyyswpdypdfvmiv, esquema
-- public, verificado por REST el mismo dia. O sea que el error no era sobre la
-- base sino sobre la SESION: o `public` no estaba en el search_path, o el
-- editor estaba apuntando a otro proyecto.
--
-- Calificar el esquema mata la primera causa para siempre. Si el error vuelve
-- despues de esto, la causa es la segunda y no se arregla con SQL: hay que
-- cambiar de proyecto en el dashboard. Para saber en cual estas parado:
--
--   select current_database(), current_schema(), (select count(*) from public.organizations);
--
-- En el proyecto correcto eso devuelve 1 organizacion (Diamond).

create table if not exists public.radar_cierres (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  advisor_id uuid not null references public.advisors(id),
  fecha date not null,
  items jsonb not null default '[]'::jsonb,
  enviado_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, advisor_id, fecha)
);

comment on table public.radar_cierres is
  'Un cierre del dia por asesora: la lista numerada de propiedades que se le mando, para poder resolver "1 no servia" contra la propiedad correcta.';

comment on column public.radar_cierres.items is
  'Array [{n, signal_ids, ref, titulo, colega}] en el orden EXACTO en que se numero en el mensaje. signal_ids es una lista: la misma propiedad ofrecida a dos colegas es UN numero que cubre las dos señales. No se recalcula.';

comment on column public.radar_cierres.enviado_at is
  'Null cuando el cierre se armo pero WhatsApp no lo entrego (ventana de 24h cerrada). Se deja la fila para que ese dia se vea, en vez de desaparecer.';

-- La consulta del cobro: el ultimo cierre de esta asesora, ventana de 3 dias.
create index if not exists radar_cierres_asesora_fecha
  on public.radar_cierres (org_id, advisor_id, fecha desc);
