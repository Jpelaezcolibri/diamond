# Plantillas de Meta para las visitas (2026-10-21)

Para qué sirven: WhatsApp solo deja escribirle libremente a alguien durante las 24 h siguientes a su último mensaje. Fuera de esa ventana solo salen plantillas aprobadas por Meta. Sin estas tres, Sofi recuerda la visita, pregunta cómo le fue y confirma la cita SOLO si el cliente escribió en las últimas 24 h.

Dónde se crean: Meta Business Suite → WhatsApp Manager → Plantillas de mensajes → Crear plantilla, en la cuenta de WhatsApp de Sofi (la línea oficial).

Para las tres:
- **Categoría:** Utilidad (Utility). Son avisos sobre una cita que la persona pidió, no publicidad.
- **Idioma:** Español (es). El código manda `language: "es"`.
- **Encabezado:** ninguno. **Pie de página:** opcional ("Diamond Inmobiliaria").
- **Botones:** ninguno. La persona responde escribiendo y le contesta Sofi.
- Meta pide un valor de ejemplo para cada variable `{{n}}`. Abajo van los que puedes usar.

---

## 1. `recordatorio_visita`

**Cuándo sale:** 2 horas antes de una visita CONFIRMADA.

**Cuerpo:**

```
Hola {{1}}, te recuerdo tu visita de hoy a las {{2}} a la propiedad Ref {{3}} en {{4}}. Te recibe {{5}}. Si necesitas moverla, responde este mensaje y la reagendamos.
```

| Variable | Qué es | Ejemplo para Meta |
|---|---|---|
| {{1}} | Nombre | Laura |
| {{2}} | Hora | 10:00 a. m. |
| {{3}} | Referencia | 10505566 |
| {{4}} | Zona | El Poblado |
| {{5}} | Quién la recibe | Asesor 1 |

Variable de Railway después de la aprobación: `SOFI_RECORDATORIO_PLANTILLA=recordatorio_visita`

---

## 2. `postvisita`

**Cuándo sale:** 3 horas después de la visita.

**Cuerpo:**

```
Hola {{1}}, ¿cómo les fue en la visita a la propiedad Ref {{2}}? Cuéntame qué les pareció y te ayudo con el siguiente paso.
```

| Variable | Qué es | Ejemplo para Meta |
|---|---|---|
| {{1}} | Nombre | Laura |
| {{2}} | Referencia | 10505566 |

Variable de Railway después de la aprobación: `SOFI_POSTVISITA_PLANTILLA=postvisita`

---

## 3. `cita_confirmada`

**Cuándo sale:** cuando la asesora confirma la visita y la ventana de 24 h ya se cerró. Hoy, en ese caso, el sistema le pide a la asesora que avise a mano.

**Cuerpo:**

```
Hola {{1}}, tu visita del {{2}} a la propiedad Ref {{3}} quedó confirmada. Te recibe {{4}}. Si necesitas cambiarla, responde este mensaje.
```

| Variable | Qué es | Ejemplo para Meta |
|---|---|---|
| {{1}} | Nombre | Laura |
| {{2}} | Día y hora | jueves 23 de octubre a las 10:00 a. m. |
| {{3}} | Referencia | 10505566 |
| {{4}} | Quién la recibe | Asesor 1 |

Variable de Railway después de la aprobación: `SOFI_CITA_CONFIRMADA_PLANTILLA=cita_confirmada`

---

## Consejos para que Meta las apruebe

- Copia el cuerpo tal cual. Ninguno empieza ni termina con una variable; Meta rechaza las que sí.
- No agregues links, precios ni palabras como "oferta" o "promoción": eso las vuelve Marketing y cambia el costo y la aprobación.
- Si Meta cambia la categoría a Marketing, apélalo diciendo que es un recordatorio de una cita que el cliente solicitó.
- Cuando estén **Aprobadas**, avísame. Pongo las variables en Railway y verifico el primer envío en el log.
