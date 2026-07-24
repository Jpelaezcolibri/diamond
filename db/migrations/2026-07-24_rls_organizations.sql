-- Migracion: cierra la fuga de whatsapp_token/verify_token en organizations.
-- Correr a mano en el SQL Editor de Supabase. Idempotente.
--
-- 2026-07-02_crm.sql dio a "authenticated" (cualquier asesor logueado al CRM)
-- SELECT sobre la fila COMPLETA de organizations, incluido whatsapp_token
-- (token de la Graph API de Meta en texto plano) y verify_token. Cualquier
-- asesor podia leerlos desde la consola del navegador con la anon key.
--
-- La fila (RLS) esta bien para esta tabla: es multi-tenant por org, pero hoy
-- solo hay una org y el CRM la resuelve leyendo "id" (ver
-- crm/lib/marketing.ts#getDefaultOrgId, crm/app/api/users/route.ts). El
-- problema es de COLUMNAS, no de filas — se cierra con privilegios a nivel
-- de columna (Postgres los aplica junto con RLS, sin depender de que el
-- acceso pase por una vista). El bot sigue leyendo todo con la service key,
-- que ignora tanto RLS como privilegios de columna.
revoke select on organizations from authenticated;
grant select (id, name, advisor_phone, advisor_name, status, created_at) on organizations to authenticated;
