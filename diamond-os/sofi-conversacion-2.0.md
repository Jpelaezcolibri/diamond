# Sofi Conversación 2.0 — "La asesora que conversa, no la que informa"

**Fecha:** 2026-07-11 · **Estado:** propuesta, pendiente de aprobación de Juan
**Basado en:** benchmark de 5 plataformas de IA inmobiliaria (Structurely, Ylopo,
EliseAI, La Haus, Zillow AI Mode) + guías de mejores prácticas del sector.

---

## 1. Qué hacen los mejores (benchmark)

### Structurely (EE.UU. — texto + voz, 350M de conversaciones)
- Conversación de calificación en dos vías por SMS/email, seguimiento por
  **más de 12 meses** sin abandonar el lead.
- **Live transfer**: cuando el lead está caliente lo pasa en vivo al humano.
- Números locales para subir la tasa de respuesta (+31% según ellos).
- Claim de marketing: 48.8% de conversión IA (tomar con pinzas, es su cifra).

### Ylopo / rAIya (EE.UU. — el playbook más documentado)
- **Primer texto en <5 minutos** desde que entra el lead.
- Tres modos: proactivo (drip a leads nuevos y fríos), conductual (reacciona a
  lo que el lead hace en la web) y responsivo (conversación real al contestar).
- Pregunta presupuesto, zona y tiempos **una pregunta a la vez**.
- **Sistema de tags para el handoff**: AI_NEEDS_FOLLOW_UP (llamar hoy, ideal
  <4-6h), AI_ENGAGED (monitorear y presentarse), AI_NOT_INTERESTED (parar).
  Distribución esperada mes 1: 10% listos / 20% enganchados / 20% no / 50% aún
  sin responder → los siguen trabajando meses.
- Nurture de largo plazo: **mínimo 2 toques al mes, 12+ meses**.
- Persona: el bot se presenta como "asistente de [agente]" — transparencia sin
  perder cercanía. Horario de silencio 8pm-8am. Respeta opt-out de inmediato.

### EliseAI (EE.UU. — arriendo/multifamily, el más grande en leasing)
- Omnicanal (texto, email, chat, voz) con memoria única: el cliente **nunca
  repite información** al cambiar de canal.
- Todo empuja hacia UNA conversión concreta: **agendar el tour**. Dato
  publicado con Zillow (jun 2026): renters que usan su AI tienen 43% más
  probabilidad de aplicar.

### La Haus (Latam/EE.UU. — el espejo más cercano a Diamond: WhatsApp)
- "78% de los leads se van con el primer agente que responde."
- Su aprendizaje central (webinar jul 2026): el comprador tarda **6-9 meses**
  en cerrar → el lead que no contestó no es basura, es un cliente futuro.
  Al reactivar bases con IA, los cierres por reactivación pasaron del 10% al
  **55% de sus ventas**, con CAC casi nulo.
- Tres pilares de su seguimiento: segmentación (por origen del lead),
  personalización y persistencia. Meta explícita: que cada mensaje "se sienta
  como una conversación, no un cold call".
- Handoff: notifican al asesor por WhatsApp apenas el lead está caliente.

### Mejores prácticas transversales (Spur, MindStudio, Retell, HBR/Chili Piper)
- Velocidad lo es casi todo: responder en <5 min ≈ 100x más probabilidad de
  contactar; <1 min = +391% conversión vs 5 min (Chili Piper).
- **Una pregunta por mensaje** + progressive disclosure (soltar info por capas,
  no de golpe).
- Scoring transparente de leads (reglas claras, no caja negra) + handoff
  humano bien definido. La IA califica y agenda; el humano cierra.
- La IA nunca finge ser humana, y el opt-out se respeta al instante.

---

## 2. Diagnóstico honesto de Sofi hoy

Lo que ya está a nivel mundial (no tocar):
- Respuesta instantánea 24/7 por WhatsApp ✅ (la ventaja #1 del sector)
- Calificación natural una pregunta a la vez, registro de datos, handoff con
  especialidad ✅
- Venta de estilo de vida, empatía táctica, cierre de alternativa ✅ (reglas
  7-12 del prompt actual)

Lo que nos separa de los mejores — y NO es "falta historia":
1. **La ficha es un volcado.** La regla 6 obliga a entregar TODA la ficha al
   primer contacto con una propiedad. Resultado: un bloque de 15 líneas que
   informa pero no conversa (el pantallazo del 11-jul lo muestra). Ninguno de
   los 5 referentes hace esto: todos sueltan la información por capas.
2. **Sofi es 100% reactiva.** Si el cliente deja de escribir, la conversación
   muere ahí. Ylopo hace 2+ toques/mes por 12 meses; La Haus construyó el 55%
   de sus ventas sobre reactivación. Este es el gap más grande y el de mayor
   plata: hoy Diamond ya pagó por esos leads que se enfriaron.
3. **Un solo mensaje por turno.** Los humanos en WhatsApp mandan 2-3 mensajes
   cortos seguidos; Sofi manda un bloque. El ritmo es parte de la cercanía.
4. **El turno con tool pega textos** ("Perfecto, déjame consultar..." +
   "¡Perfecto! 😊...") — se nota el robot justo donde queremos que no se note.

Sobre "contar una historia": la evidencia NO respalda mandar párrafos
narrativos largos. Lo que sí funciona es la **micro-historia anclada al
cliente**: 1-2 frases que lo ponen a él dentro de la propiedad, usando lo que
ya contó ("para trabajar desde casa, ese balcón del piso 9 con luz todo el
día te cambia el día a día"). Historia sí, novela no.

---

## 3. El método propuesto: "Conversación en capas"

### Capa A — Ritmo humano (cambios al prompt + engine)
- **Ficha progresiva:** primera mención de una propiedad = gancho (título
  emocional + precio + 1 micro-historia anclada al cliente + link de fotos) y
  UNA pregunta. La ficha técnica completa se entrega cuando el cliente pide
  detalles o antes de agendar visita. (Reemplaza la regla 6/16 actual.)
- **Mensajes fraccionados:** el engine parte la respuesta en 2-3 burbujas
  cortas (saludo/reacción · contenido · pregunta) con pausa breve entre ellas,
  como escribe una persona.
- **Micro-historia obligatoria en propiedades:** 1-2 frases en segunda persona
  que conecten UN atributo con la vida que el cliente describió. Prohibido el
  inventario de amenidades sin dueño ("tiene piscina, gimnasio, portería...").
- **Fix del turno con tool:** eliminar el texto pre-tool o fusionarlo para que
  no queden dos arranques pegados.

### Capa B — Sofi proactiva (el diferenciador real; requiere plantillas +
método de pago en Meta)
- **Seguimiento 24h/72h/7d:** si el lead calificado o interesado deja de
  responder, Sofi retoma con contexto ("¿pudiste ver las fotos del apto de
  Envigado? Me quedé pensando que también te podría gustar...").
- **Reactivación de base fría:** barrido mensual de leads viejos con mensaje
  segmentado por origen y por lo que buscaban (el playbook La Haus).
- Cadencia con tope y opt-out inmediato; horario de silencio 8pm-8am.

### Capa C — Handoff nivel Ylopo (CRM)
- Tags de prioridad en el CRM: NECESITA_SEGUIMIENTO (contactar <4-6h),
  ENGANCHADO, NO_INTERESADO — con la conversación resumida para el asesor.

### Qué NO vamos a hacer (decisiones explícitas)
- No párrafos narrativos largos: la evidencia favorece brevedad + capas.
- No fingir que Sofi es humana.
- No presionar: la cadencia de seguimiento tiene tope y respeta el "no".

### Orden de implementación sugerido
1. Capa A (solo prompt + engine, sin infraestructura nueva) → medible ya.
2. Capa C (tags en CRM) — pequeña.
3. Capa B (necesita worker de seguimientos + plantillas aprobadas por Meta +
   método de pago) → la de mayor impacto en plata, pero con dependencias.

### Métricas para saber si funciona
- % de leads que responden después de la primera ficha (hoy vs nuevo formato)
- % de conversaciones que llegan a cita/transferencia
- Ventas atribuibles a reactivación (norte: La Haus llegó a 55%)

---

## 4. Fuentes
- ylopo.zendesk.com — "AI Text Overview" (comportamiento operativo completo)
- structurely.com (claims de producto)
- eliseai.com/platform-overview + nota EliseAI-Zillow (BusinessWire, jun 2026)
- lahaus.ai — landing y webinar "Cómo convertir tus bases de datos en una mina de oro" (jul 2026)
- spurnow.com — "AI Chatbot for Real Estate Lead Qualification (2026)"; Chili Piper (391% <1min); HBR (caída 400% de 5→10 min)
- Nota: las cifras de cada vendor son marketing propio; direccionalmente
  coinciden entre fuentes independientes, pero no son auditadas.
