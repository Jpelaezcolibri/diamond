# Bot Inmobiliario — Agente WhatsApp con Claude

Agente conversacional multi-tenant para inmobiliarias. Atiende por WhatsApp a personas que hicieron click en una publicación (click-to-WhatsApp ad), asesora, envía fichas de propiedades desde la base de datos, califica el interés del lead (presupuesto, zona, urgencia) y lo transfiere al asesor humano con un resumen cuando el interés es genuino.

La decisión de arquitectura está documentada en [ARCHITECTURE.md](ARCHITECTURE.md).

## Setup

```bash
npm install
cp .env.example .env   # completar valores
npm run dev
```

Con solo `ANTHROPIC_API_KEY` en el `.env`, el bot arranca en **modo demo**: datos en memoria con la org "Paraiso Inmobiliario" y 4 propiedades seed. Para producción, crear un proyecto en Supabase, ejecutar [db/schema.sql](db/schema.sql) en el SQL Editor y agregar `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` al `.env`.

## Probar local sin WhatsApp

```bash
# Simula el click en la publicación de AP001
curl -X POST http://localhost:3000/test -H "Content-Type: application/json" \
  -d '{"phone":"573001112233","message":"Hola, me interesa la propiedad AP001"}'

# Reiniciar la conversación de un número
curl -X DELETE http://localhost:3000/test/573001112233
```

La respuesta incluye `reply`, el `lead` con su score/estado y `transfer` si se disparó la transferencia al asesor.

## Canales

- **WhatsApp** (`/webhook`): webhook de Meta Cloud API. Multi-tenant: el `phone_number_id` entrante resuelve la organización en la tabla `organizations` (token y asesor propios por org). Configurar la URL del webhook y el `VERIFY_TOKEN` en el panel de Meta.
- **Telegram** (`/telegram`): canal de pruebas/demo. Deep link `https://t.me/<bot>?start=AP001` simula el click en una publicación. Registrar el webhook con `https://api.telegram.org/bot<TOKEN>/setWebhook?url=<URL>/telegram`.

## Flujo del lead

```
click en ad → wa.me con ref prellenada → agente responde con ficha
→ conversa y captura presupuesto/zona/urgencia (tools de Claude)
→ lead calificado → transferir_a_asesor → estado "transferido"
→ asesor recibe alerta con resumen + cliente recibe link directo wa.me
```

Estados del lead: `nuevo → en_conversacion → calificado → transferido` (o `descartado`).

## Tests

```bash
npm test
```

## Deploy (Railway/Render)

Servicio web Node con `npm start`. Variables de entorno del `.env.example`. El puerto lo asigna la plataforma vía `PORT`.
