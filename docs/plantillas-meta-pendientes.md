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

**Cuando Meta la apruebe:** poner `PENDIENTES_EXCEL_PLANTILLA=pendientes_contacto` en Railway (servicio `diamond`).
