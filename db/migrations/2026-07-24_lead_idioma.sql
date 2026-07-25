-- Migracion: idioma del lead para la atencion bilingue de Sofi. Ejecutar en
-- el SQL Editor de Supabase.
--
-- idioma: null = español (default historico). 'en' = el cliente llego desde
-- la landing traducida (prellenado EN de WhatsApp) o escribio organicamente
-- en ingles — Sofi lo atiende 100% en ingles, el link cliente→asesor sale en
-- ingles, y las alertas al asesor (siempre en español) avisan "Idioma: INGLES".
-- Se estampa UNA vez desde el primer mensaje (src/agent/engine.js); el codigo
-- es best-effort: sin esta columna el bot sigue funcionando solo en español.
alter table leads add column if not exists idioma text;
