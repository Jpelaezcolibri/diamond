-- Periodo del canon de arriendo, tal como lo marca Wasi (rents_type_label:
-- Monthly / Daily). Lo escribe el sync de DMAP; lo usa el publicador de grupos
-- en vez de adivinar por el texto si el precio es por noche o por mes.
-- Solo agrega. Sin ella el sync sigue igual (omite la columna y lo avisa).
alter table properties add column if not exists periodo_precio text
  check (periodo_precio is null or periodo_precio in ('mensual', 'diario', 'semanal'));
