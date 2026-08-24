-- Numero de contacto oficial de Sofi por organizacion (Juan, revision
-- 2026-08-24). Correr a mano en el SQL Editor de Supabase. Idempotente.
--
-- POR QUE. src/lib/contacto.js#linkContactoOficial arma el link "escribile a
-- Sofi" que se ofrece en los avisos del radar de grupos leyendo
-- process.env.CONTACT_WHATSAPP_NUMBER — UNA sola variable de Railway para
-- todo el proceso. Este repo es multi-tenant por diseño (todo lleva org_id):
-- con una organizacion B, ese aviso le estaria ofreciendo la linea oficial
-- de Diamond.
--
-- Columna NULLABLE y sin default: el codigo ya degrada limpio si esta vacia
-- o si la migracion todavia no corrio (organizations.select("*") no falla
-- por una columna de mas o de menos) — cae al env, que es el comportamiento
-- de hoy. Mismo patron que organizations.grupos_respuesta_modo usa para
-- GRUPOS_RESPUESTA_MODO (ver 2026-08-18_grupos_respuesta_modo.sql).
--
-- No se llena para Diamond aca a proposito: seguira sirviendose del env
-- (CONTACT_WHATSAPP_NUMBER en Railway) hasta que Juan decida moverlo a la
-- fila explicitamente.

alter table organizations
  add column if not exists contact_whatsapp_number text;

comment on column organizations.contact_whatsapp_number is
  'Numero de WhatsApp (solo digitos, con indicativo, sin +) que se ofrece como linea oficial de contacto en los avisos del radar de grupos. NULL = usa el env CONTACT_WHATSAPP_NUMBER (single-tenant, comportamiento historico). Ver src/lib/contacto.js#linkContactoOficial.';

-- Verificacion: debe mostrar NULL para las orgs existentes (nada cambia hasta
-- que se llene a mano).
-- select id, name, contact_whatsapp_number from organizations;
