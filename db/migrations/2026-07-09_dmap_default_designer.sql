-- El motor por defecto para orgs nuevas pasa de 'ai' (GPT Image, ~$0.34 por
-- publicacion) a 'designer' (satori + Claude, $0) — es el motor que la UI de
-- Configuracion marca como recomendado y el que menos rechazos del critico
-- genera (el texto nunca se deforma). No toca el valor ya elegido por las
-- orgs existentes.
alter table org_marketing_settings
  alter column creative_engine set default 'designer';
