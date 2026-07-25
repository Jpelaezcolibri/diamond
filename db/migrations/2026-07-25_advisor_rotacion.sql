-- Migracion: rotacion de transferencias organicas por asesor. Ejecutar en el
-- SQL Editor de Supabase.
--
-- recibe_transferencias: si el asesor entra a la ROTACION de leads organicos
-- de su especialidad (round-robin uno a uno). false = solo recibe leads por
-- propiedad marcada a su nombre (captador_id, migracion 2026-07-24) — sigue
-- activo para captador, citas y CRM, pero no le caen organicos.
-- Sin esta columna el codigo trata a todos como true (comportamiento previo).
alter table advisors add column if not exists recibe_transferencias boolean not null default true;

-- Datos Diamond (decision de Juan 2026-07-25): la rotacion de venta queda
-- SOLO entre Natalia y Danna. Claudia y Catherine reciben unicamente por
-- propiedad marcada. Juan Carlos queda inactivo (ya aplicado por script; se
-- repite aqui idempotente para trazabilidad).
update advisors set recibe_transferencias = false where id in (
  '261900e0-5828-43fc-b0df-05ce1f7803b2', -- Claudia Valencia
  '9070e115-61ea-420a-9e46-f9474356ff17'  -- Catherine Uribe (numero 573028536489, antes "Asesor de Ventas Diamond")
);
update advisors set activo = false where id = '89a56024-b14d-45cf-8bb5-020fe6184227'; -- Juan Carlos Pelaez
