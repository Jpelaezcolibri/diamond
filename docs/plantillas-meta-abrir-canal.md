# Plantilla de Meta: `abrir_canal_asesora`

Para abrir la ventana de 24 h de las asesoras que no la tienen (Claudia y Catherine; la de Daiana la mantiene `ventana-asesora.js`). Pedido de Juan del 2026-11-15.

| Campo | Valor |
|---|---|
| Nombre | `abrir_canal_asesora` |
| Categoría | Utilidad |
| Idioma | Español (`es`) |
| Cuerpo | Hola {{1}}, hoy te pueden llegar visitas por confirmar y casos de colegas. Toca Estoy disponible para recibirlos por este chat durante el día. |
| Ejemplo de {{1}} | Claudia |
| Pie | Diamond Inmobiliaria |
| Botón | Respuesta rápida: **Estoy disponible** |

**Creada por la API el 2026-11-15** (id `1663678715240179`, estado `PENDING`). Script: `scripts/create-abrir-canal-template.mjs`.

Cómo funciona: la plantilla sola NO abre la ventana; la abre el toque de la asesora en **Estoy disponible** (entra como mensaje de ella). `src/scheduler/abrir-canal-asesoras.js` la manda de lunes a sábado a las 7 a. m. (`CANAL_ASESORAS_HORA`) solo a las del ciclo con la ventana cerrada, una vez al día; `src/lib/canal-asesora.js` registra el toque y le contesta.

**Al aprobarse:** poner `CANAL_ASESORAS_PLANTILLA=abrir_canal_asesora` en Railway (servicio `diamond`). Verificar el estado:

```
curl -s "https://graph.facebook.com/v21.0/1702397800906189/message_templates?name=abrir_canal_asesora&fields=status" -H "Authorization: Bearer $WHATSAPP_TOKEN"
```
