# Plantilla de Meta: `pendientes_contacto`

Para mandarle el Excel de pendientes (spec `docs/superpowers/specs/2026-10-30-pendientes-excel-asesoras-design.md`) a una asesora que tiene la ventana de 24 h cerrada. Sin esta plantilla, los casos de esa asesora le llegan a la que tenga la ventana abierta (hoy, Daiana).

| Campo | Valor |
|---|---|
| Nombre | `pendientes_contacto` |
| Categoría | Utilidad |
| Idioma | Español (`es`) |
| Encabezado | **Documento** (de ejemplo, cualquier .xlsx) |
| Cuerpo | Hola, tienes {{1}} por contactar. Comunícate con cada una (celular y WhatsApp en el Excel), llena la columna Resultado y devuélvelo a este chat. |
| Ejemplo de {{1}} | 6 personas |

**Ojo (2026-11-07):** el parámetro {{1}} ya trae la palabra ("1 persona", "6 personas"), para que nunca salga "1 personas". Si la plantilla ya se había creado con "{{1}} personas", hay que editarla en Meta.
| Pie | Diamond Inmobiliaria |
| Botones | Ninguno |

**Creada por la API el 2026-11-07** (id `1872340423937542`, estado `PENDING` al crearla) con el cuerpo de arriba. Meta solo acepta un PDF como ejemplo del encabezado de documento (con un .xlsx responde el error 2388084 "Tipo de archivo no compatible"); el Excel real sí sale después. Script: `crear-plantilla-pendientes.js` (sube el ejemplo por la Resumable Upload API de la app `1727749525019938` y crea la plantilla en la WABA `1702397800906189`).

**Aprobada por Meta el 2026-11-09** (`status: APPROVED`). `PENDIENTES_EXCEL_PLANTILLA=pendientes_contacto` quedó puesta en Railway (servicio `diamond`) el mismo día; el primer Excel por plantilla sale cuando una asesora tenga la ventana cerrada a las 8 a. m. Verificar el estado:

```
curl -s "https://graph.facebook.com/v21.0/1702397800906189/message_templates?name=pendientes_contacto&fields=status" -H "Authorization: Bearer $WHATSAPP_TOKEN"
```
