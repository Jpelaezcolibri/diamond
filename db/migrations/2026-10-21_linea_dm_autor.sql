-- Quien escribio cada salida de la linea del radar (Juan, 2026-10-21).
-- Sofi contesta hasta 3 mensajes por colega en esa linea y calla para siempre
-- si una persona del equipo escribio en el chat. Spec:
-- docs/superpowers/specs/2026-10-21-sofi-en-linea-radar-design.md
--
-- 'sofi'   = lo envio Sofi (src/groups/sofi-linea.js)
-- 'humano' = lo escribio una persona desde el celular (webhook message.any)
-- null     = entradas del colega, y salidas viejas (todas de una persona: antes
--            de esto la linea no guardaba sus propios envios)
alter table linea_dm add column if not exists autor text;
alter table linea_dm drop constraint if exists linea_dm_autor_check;
alter table linea_dm add constraint linea_dm_autor_check check (autor is null or autor in ('sofi', 'humano'));
