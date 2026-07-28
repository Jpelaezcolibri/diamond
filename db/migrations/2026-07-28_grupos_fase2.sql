-- Migracion: corte temporal del pareo + las ofertas de grupos alimentando
-- ally_properties (Fase 2). Ejecutar DESPUES de 2026-07-28_grupos_whatsapp.sql
-- en el SQL Editor de Supabase.

-- ── Corte temporal ───────────────────────────────────────────────────────
--
-- Al vincular un dispositivo, WhatsApp puede sincronizar historial. Ese
-- historial es veneno para este caso: una propiedad publicada hace tres meses
-- casi seguro ya se vendio, y recomendarsela a un cliente real es dano de
-- reputacion. Nada anterior a este instante se procesa.
--
-- Va en DOS niveles a proposito: la sesion marca desde cuando esa linea
-- escucha, y cada grupo marca desde cuando fue prendido. Prender un grupo hoy
-- no puede arrastrar lo que se hablo ahi la semana pasada.
alter table whatsapp_sessions add column if not exists escucha_desde timestamptz;
alter table whatsapp_groups add column if not exists escucha_desde timestamptz;

-- ── Ofertas de grupos como propiedades de aliados ────────────────────────
--
-- El circuito de consumo ya corre en produccion (src/agent/tools.js: cuando
-- Sofi no encuentra nada en el inventario propio, busca en ally_properties y
-- avisa al asesor). Lo unico que le faltaba era abastecimiento. Esto lo
-- conecta, cerrando las tres brechas del diseno.

-- Brecha 1 — la alerta se moria en silencio. tools.js solo avisa si la
-- propiedad tiene registrado_por (un asesor con login que la registro a mano).
-- Una propiedad cazada en un grupo no tiene eso. Se le atribuye al asesor
-- dueno de la sesion que la detecto, en el rol de PUENTE: es su grupo y su
-- relacion con ese colega. Puente no es dueno del negocio — de quien es la
-- comision es decision de Juan, y el esquema no la asume.
alter table ally_properties add column if not exists puente_advisor_id uuid references advisors(id) on delete set null;

-- De donde vino. 'asesor' es el comportamiento historico y sigue igual.
alter table ally_properties add column if not exists origen text not null default 'asesor';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ally_properties_origen_valido') then
    alter table ally_properties add constraint ally_properties_origen_valido check (origen in ('asesor', 'grupo'));
  end if;
end $$;

alter table ally_properties add column if not exists group_id uuid references whatsapp_groups(id) on delete set null;

-- Brecha 2 — caducidad. Una propiedad de grupo se vende y nadie avisa. Se
-- refresca cada vez que el colega la republica ("sigue disponible"), que es
-- justo lo que esa frase significa. Las registradas a mano por un asesor NO
-- caducan: es el comportamiento de hoy y no cambia.
alter table ally_properties add column if not exists visto_en_grupo_at timestamptz;

-- Brecha 3 — dedup sin ref. El indice historico depende de (contacto_telefono,
-- ref), pero los mensajes de grupo casi nunca traen referencia y los colegas
-- republican la misma propiedad cada semana. Para las de origen grupo la clave
-- es el colega + las caracteristicas; una republicacion refresca en vez de
-- duplicar.
create unique index if not exists idx_ally_properties_dedup_grupo
  on ally_properties (
    org_id,
    coalesce(contacto_telefono, ''),
    coalesce(tipo, ''),
    coalesce(zona, ''),
    coalesce(precio, '')
  )
  where origen = 'grupo';

create index if not exists idx_ally_properties_grupo_frescas
  on ally_properties (org_id, visto_en_grupo_at desc) where origen = 'grupo';
