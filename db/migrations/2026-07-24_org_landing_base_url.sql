-- Migracion: dominio de landing por organizacion.
-- Correr a mano en el SQL Editor de Supabase. Idempotente.
--
-- organizations.landing_base_url: antes src/config.js#landingBaseUrl era un
-- unico valor global (env LANDING_BASE_URL, default diamondinmobiliaria.com)
-- que src/data/properties.js aplicaba a TODAS las propiedades de TODAS las
-- orgs. El dia que exista una org #2, sus fichas enlazarian igual al dominio
-- de Diamond. Si esta columna es null (org nueva sin configurar), el codigo
-- sigue cayendo al env global — no rompe nada, solo deja de ser el unico camino.
alter table organizations add column if not exists landing_base_url text;
