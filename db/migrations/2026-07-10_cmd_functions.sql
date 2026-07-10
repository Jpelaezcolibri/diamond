-- Migracion: funciones de consulta del Centro de Comando (Sofi-Comando).
-- Ejecutar en el SQL Editor de Supabase.
--
-- Principio: "la base calcula, la IA conversa". Cada funcion recibe el alcance
-- del usuario (org + uid + si es admin) y aplica el filtro DENTRO, devolviendo
-- JSON compacto (nunca filas crudas). Asi el asesor solo ve lo suyo
-- (owner_id = uid) y el admin ve toda la org, sin que el modelo decida nada.
--
-- Solo el bot (service_role) puede ejecutarlas: se revoca EXECUTE a public para
-- que un usuario autenticado no pueda llamarlas por PostgREST pasando
-- p_is_admin = true. El bot deriva p_is_admin del rol validado por el CRM.

-- Cast seguro de texto a timestamptz: si el valor esta malformado (una cita con
-- fecha_hora invalida escrita por el modelo), devuelve null en vez de lanzar y
-- tumbar toda la consulta de seguimientos.
create or replace function safe_ts(p text) returns timestamptz
language plpgsql
immutable
as $$
begin
  return p::timestamptz;
exception when others then
  return null;
end;
$$;

-- ── Metricas de leads del periodo (por defecto: hoy en Colombia) ──────────
create or replace function cmd_metricas_leads(
  p_org uuid,
  p_uid uuid,
  p_is_admin boolean,
  p_desde timestamptz default null,
  p_hasta timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_desde timestamptz;
  v_hasta timestamptz;
  v_result jsonb;
begin
  -- "Hoy" resuelto en zona horaria de Colombia (medianoche local -> medianoche local + 1 dia).
  v_desde := coalesce(p_desde, (date_trunc('day', now() at time zone 'America/Bogota')) at time zone 'America/Bogota');
  v_hasta := coalesce(p_hasta, v_desde + interval '1 day');

  with scoped as (
    select *
    from leads
    where org_id = p_org
      and (p_is_admin or owner_id = p_uid)
      and created_at >= v_desde
      and created_at < v_hasta
  )
  select jsonb_build_object(
    'desde', v_desde,
    'hasta', v_hasta,
    'nuevos', (select count(*) from scoped),
    'por_estado', coalesce(
      (select jsonb_object_agg(estado, c)
         from (select estado, count(*) c from scoped group by estado) s), '{}'::jsonb),
    'por_fuente', coalesce(
      (select jsonb_object_agg(source, c)
         from (select source, count(*) c from scoped group by source) s), '{}'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- ── Leads que necesitan seguimiento ──────────────────────────────────────
-- Calificados o transferidos que llevan >= p_dias sin actividad en su
-- conversacion, o con cita proxima/vencida (siguientes 48 h). Top 10.
create or replace function cmd_seguimientos(
  p_org uuid,
  p_uid uuid,
  p_is_admin boolean,
  p_dias int default 3
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  with scoped as (
    select l.id, l.nombre, l.phone, l.estado, l.score, l.cita,
           (select max(c.last_activity_at) from conversations c where c.lead_id = l.id) as last_activity
    from leads l
    where l.org_id = p_org
      and (p_is_admin or l.owner_id = p_uid)
      and l.estado in ('calificado', 'transferido')
  ),
  flagged as (
    select *,
      case when last_activity is not null
           then floor(extract(epoch from (now() - last_activity)) / 86400)::int
           else null end as dias_inactivo,
      safe_ts(cita->>'fecha_hora') as cita_fecha
    from scoped
  ),
  needing as (
    select *,
      (dias_inactivo is null or dias_inactivo >= p_dias) as inactivo,
      (cita_fecha is not null and cita_fecha < now() + interval '48 hours') as cita_relevante
    from flagged
  )
  select jsonb_build_object(
    'total', (select count(*) from needing where inactivo or cita_relevante),
    'items', coalesce((
      select jsonb_agg(row_to_json(t))
      from (
        select id as lead_id, nombre, phone, estado, score, dias_inactivo, cita_fecha,
               case when cita_relevante then 'cita'
                    when inactivo then 'sin_actividad'
                    else 'seguimiento' end as motivo
        from needing
        where inactivo or cita_relevante
        order by cita_relevante desc, score desc, dias_inactivo desc nulls last
        limit 10
      ) t
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- Solo el bot (service_role) ejecuta estas funciones.
revoke all on function cmd_metricas_leads(uuid, uuid, boolean, timestamptz, timestamptz) from public;
grant execute on function cmd_metricas_leads(uuid, uuid, boolean, timestamptz, timestamptz) to service_role;

revoke all on function cmd_seguimientos(uuid, uuid, boolean, int) from public;
grant execute on function cmd_seguimientos(uuid, uuid, boolean, int) to service_role;
