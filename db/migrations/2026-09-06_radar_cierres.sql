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
-- `items` guarda la referencia ELEGIDA por señal, no todas sus candidatas: es
-- la propiedad por la que se pregunto, y sin ella el registro no seria
-- auditable mañana.
--
-- Correr a mano en Supabase. Idempotente.

create table if not exists radar_cierres (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  advisor_id uuid not null references advisors(id),
  fecha date not null,
  items jsonb not null default '[]'::jsonb,
  enviado_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, advisor_id, fecha)
);

comment on table radar_cierres is
  'Un cierre del dia por asesora: la lista numerada de propiedades que se le mando, para poder resolver "1 no servia" contra la propiedad correcta.';

comment on column radar_cierres.items is
  'Array [{n, signal_id, ref, titulo, colega}] en el orden EXACTO en que se numero en el mensaje. No se recalcula.';

comment on column radar_cierres.enviado_at is
  'Null cuando el cierre se armo pero WhatsApp no lo entrego (ventana de 24h cerrada). Se deja la fila para que ese dia se vea, en vez de desaparecer.';

-- La consulta del cobro: el ultimo cierre de esta asesora, ventana de 3 dias.
create index if not exists radar_cierres_asesora_fecha
  on radar_cierres (org_id, advisor_id, fecha desc);
