-- Celular de contacto que deja un colega o cliente en el chat (Juan, 2026-11-09:
-- "si el colega ya dio el número telefónico que se actualice en la cita, busca
-- la forma de que no se pierda la información").
--
-- Caso Norha Vélez: WhatsApp le oculta el número (leads.phone = "CO.1622…",
-- que es su identificador para contestarle y NO se toca). Escribió su celular
-- en el chat y quedó solo en el texto; los avisos seguían diciendo "sin celular
-- visible".
--
-- El bot (src/lib/celular-contacto.js) lo guarda aquí al entrar el mensaje y,
-- si hay cita, también en cita.celular_contacto. Sin esta columna el bot sigue
-- funcionando: lo guarda solo en la cita y avisa una vez en el log.
--
-- No borra ni reescribe nada: agrega una columna y completa un solo lead.

alter table leads add column if not exists celular text;

comment on column leads.celular is
  'Celular de contacto que la persona dejó en el chat (57XXXXXXXXXX). Manda sobre phone para llamar; phone sigue siendo el identificador de WhatsApp.';

-- Norha dejó su celular el 9-nov a las 6:16 p. m., antes de esta captura.
update leads
   set celular = '573105100165',
       cita = cita || '{"celular_contacto": "573105100165"}'::jsonb
 where id = '4798810d-2a1d-4553-9c0e-42357437a757'
   and celular is null;

-- Verificación: debe devolver una fila con los dos valores.
-- select celular, cita->>'celular_contacto' from leads where id = '4798810d-2a1d-4553-9c0e-42357437a757';
