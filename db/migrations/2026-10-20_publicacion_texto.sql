-- Guarda el texto exacto de cada publicacion para verlo en la pestana Publicaciones del CRM. Solo agrega.
alter table grupo_publicaciones add column if not exists texto text;
