-- Que propiedades se le AVISARON a la asesora, ref por ref.
--
-- POR QUE (Juan, 2026-09-02): "cada vez que el bot envie un dm con una
-- respuesta necesito que quede marcado el match en la propiedad que se envio
-- con el bot de manera automatica y cuales se avisaron".
--
-- Hoy la señal solo guarda `respuesta_refs`: las refs que SALIERON en el DM al
-- colega. Lo que se le mando a la asesora para que lo trabaje a mano no queda
-- registrado por propiedad — se puede leer el texto del aviso y adivinar, nada
-- mas. Con eso no se puede responder la pregunta que importa: "esta propiedad,
-- ¿ya se ofrecio, y por que via?".
--
-- Con las dos columnas, cada señal dice exactamente:
--   respuesta_refs  -> se las mando el BOT al privado del colega (automatico)
--   aviso_refs      -> se le pasaron a la ASESORA para que decida
--
-- Son conjuntos distintos a proposito: el bot manda solo lo que aprueba la
-- compuerta de calidad, y a la asesora se le pasa todo lo que tenga dato
-- usable. Una misma propiedad puede estar en las dos si primero se avisó y
-- despues se aprobó.
--
-- Sin correr esta migracion el bot funciona igual: el insert degrada solo
-- (marcarAvisoEnviado reintenta sin la columna) y el CRM lee con select("*").

alter table group_signals
  add column if not exists aviso_refs jsonb;

comment on column group_signals.aviso_refs is
  'Refs de las propiedades incluidas en el aviso a la asesora. Complemento de respuesta_refs, que son las que salieron en el DM automatico al colega.';
