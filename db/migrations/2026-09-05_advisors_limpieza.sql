-- Deja en `advisors` solo a las personas reales del equipo (Juan, 2026-09-05:
-- "limpialos deja solo los que aparecen en mi pestaña de usuarios").
--
-- QUE HABIA. Diez filas para cinco personas: Danna Ospina repetida TRES veces,
-- Catherine Uribe DOS (una activa y una inactiva), mas dos filas de prueba
-- ("Asesor Prueba QA", "QA Conflict 1") que quedaron de julio.
--
-- POR QUE NO ES COSMETICO. src/lib/mensaje-asesor.js#estaDadoDeBaja corta todo
-- envio a un asesor con `activo = false`, y resuelve por TELEFONO. Con dos
-- filas del mismo numero y distinto `activo`, que los mensajes a esa persona
-- salgan o se descarten en silencio depende de cual devuelva la consulta
-- primero. Hoy devolvia la activa de Catherine — pero eso es suerte, no
-- diseño, y un aviso perdido en silencio es exactamente el modo de falla que
-- este sistema ya sufrio en septiembre.
--
-- El mismo mecanismo ya estaba mordiendo: la fila de Juan Carlos Pelaez
-- (573016981200, el destino del vigilante) estaba en `activo = false`, asi que
-- cualquier alerta que pasara por mensaje-asesor hacia su numero se descartaba
-- sin dejar rastro. Se corrigio por API el mismo dia; queda aca por si esta
-- migracion se corre sobre una base restaurada.
--
-- Correr a mano en Supabase. Idempotente: se puede correr dos veces.

-- ── 1. Primero la historia, despues el borrado ────────────────────────────
-- Tres leads tienen `transferido_advisor_id` apuntando a la fila DUPLICADA de
-- Catherine. Borrarla sin esto perderia (o rompería) ese dato. Es la misma
-- persona: se repuntan a su fila real, la que tiene auth_user_id.
update leads
   set transferido_advisor_id = '293768b1-e4b6-4f86-8606-b3352b817fa6'
 where transferido_advisor_id = '9070e115-61ea-420a-9e46-f9474356ff17';

-- ── 2. Las filas que sobran ───────────────────────────────────────────────
-- Verificado el 2026-09-05 contra produccion: ninguna de estas queda
-- referenciada por group_signals (advisor_id, aviso_advisor_id),
-- ally_properties (puente_advisor_id) ni mandatos_compra (advisor_id).
-- La unica referencia que existia era la de leads, resuelta arriba.
delete from advisors
 where id in (
   '9070e115-61ea-420a-9e46-f9474356ff17',  -- Catherine Uribe (duplicada, inactiva)
   '46ad3a81-d545-4615-8b1c-ef073207e83c',  -- Danna Ospina (duplicada)
   'f2e09cc1-ae92-45ea-9124-acb3e8b83677',  -- Danna Ospina (duplicada)
   '6b639d16-c0a7-4627-9ce9-ec4241ea394e',  -- Asesor Prueba QA (de prueba)
   'fa7ecbce-3dc3-42b2-85e8-59fac390110e'   -- QA Conflict 1 (de prueba)
 );

-- ── 3. Nadie del equipo queda con los envios bloqueados ───────────────────
update advisors set activo = true
 where id = '89a56024-b14d-45cf-8bb5-020fe6184227';  -- Juan Carlos Pelaez

-- ── Como queda (las 5 personas de la pestaña Usuarios) ────────────────────
--   Danna Ospina       573011880668  f63ca64b-80de-41b5-9dba-fd5dc4a138dc
--   Claudia Valencia   573003418113  261900e0-5828-43fc-b0df-05ce1f7803b2
--   Natalia Velez      573001878024  f2ad2c41-71e4-4ff6-9e7e-54a53f6979a7
--   Catherine Uribe    573028536489  293768b1-e4b6-4f86-8606-b3352b817fa6
--   Juan Carlos Pelaez 573016981200  89a56024-b14d-45cf-8bb5-020fe6184227
--
-- Verificacion despues de correrla:
--   select name, phone, activo from advisors order by name;  -- deben ser 5
--   select count(*) from leads where transferido_advisor_id
--     = '9070e115-61ea-420a-9e46-f9474356ff17';              -- debe ser 0
