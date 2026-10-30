# Plantilla de Meta: `pendientes_contacto`

Para mandarle el Excel de pendientes (spec `docs/superpowers/specs/2026-10-30-pendientes-excel-asesoras-design.md`) a una asesora que tiene la ventana de 24 h cerrada. Sin esta plantilla, los casos de esa asesora le llegan a la que tenga la ventana abierta (hoy, Daiana).

| Campo | Valor |
|---|---|
| Nombre | `pendientes_contacto` |
| Categoría | Utilidad |
| Idioma | Español (`es`) |
| Encabezado | **Documento** (de ejemplo, cualquier .xlsx) |
| Cuerpo | Hola, tienes {{1}} personas por contactar. Escríbeles o llámalas, llena la columna Resultado del Excel y devuélvelo a este chat. |
| Ejemplo de {{1}} | 6 |
| Pie | Diamond Inmobiliaria |
| Botones | Ninguno |

**Cuando Meta la apruebe:** poner `PENDIENTES_EXCEL_PLANTILLA=pendientes_contacto` en Railway (servicio `diamond`).
