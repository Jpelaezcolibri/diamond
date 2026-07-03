# Documento Guía Reutilizable — Lanzamiento de Campaña en Meta Ads

Plantilla independiente del Playbook de Diamond. Para usar con otra inmobiliaria: reemplazar solo los campos entre `[CORCHETES]`. El proceso no cambia.

## Datos a reemplazar por cliente

```
[NOMBRE_INMOBILIARIA] =
[ZONA_PRINCIPAL] =
[TELÉFONO_WHATSAPP] =
[URL_LANDING] =
[PRESUPUESTO_DIARIO_INICIAL_USD] =
[PAÍS] = Colombia (ajustar si aplica Housing Special Ad Category — solo obligatoria en EE.UU./Canadá/Europa)
```

## Paso a paso (válido para cualquier inmobiliaria)

**Fase 1 — Cuenta (una sola vez)**
1. Crear Business Portfolio en business.facebook.com.
2. Reclamar/crear la página de Facebook de [NOMBRE_INMOBILIARIA].
3. Conectar la cuenta de Instagram.
4. Crear la cuenta publicitaria y validar método de pago.
5. Verificar el dominio de [URL_LANDING] en Business Settings.

**Fase 2 — Medición**
6. Instalar el Pixel de Meta en [URL_LANDING].
7. Activar CAPI de un clic (Events Manager → Activate Conversions API) — sin necesidad de desarrollador.
8. Definir y probar el evento de conversión principal (ej. clic en WhatsApp, envío de formulario).

**Fase 3 — Captación**
9. Crear formulario de Lead Ads con verificación de teléfono por SMS activada.
10. Conectar el formulario al CRM/bot de atención vía webhook o Zapier (probar con un lead ficticio antes de lanzar).

**Fase 4 — Primera campaña**
11. Objetivo: Conversiones o Leads (según el producto — ver tabla de estructura de campaña del Capítulo 3 del Playbook base).
12. Audiencia: Advantage+ (amplia), sin restringir manualmente por intereses — dejar que el algoritmo aprenda.
13. Presupuesto: [PRESUPUESTO_DIARIO_INICIAL_USD], suficiente para acumular ~50 eventos de conversión en la primera semana.
14. Creativos: mínimo 3-5 variaciones (video + imagen + carrusel), sin editar la campaña durante la fase de aprendizaje.
15. Si el producto es renta corta u otro producto regulado: verificar que todo creativo incluya el disclaimer legal correspondiente al país/ciudad del cliente.

**Fase 5 — Optimización semanal**
16. Revisar CPL, CVR y calidad del lead (no solo volumen) una vez por semana.
17. Rotar creativos según cadencia por producto.
18. No tocar la segmentación manual — ajustar presupuesto y creativo, no intereses.

## Checklist rápido de lanzamiento (copiar/pegar por cliente)
- [ ] Business Portfolio + página + Instagram conectados
- [ ] Pixel + CAPI activos
- [ ] Dominio verificado
- [ ] Lead Ads con verificación SMS
- [ ] Integración CRM probada
- [ ] Evento de conversión definido y probado
- [ ] 3-5 creativos listos
- [ ] Disclaimer legal si aplica

## Nota de mantenimiento

Meta cambia esta plataforma con frecuencia (el mayor ejemplo: el giro de segmentación manual a Advantage+ de enero-febrero 2026). Antes de reutilizar esta guía con un cliente nuevo, verificar si hubo cambios de producto relevantes en Meta Business Help Center — no asumir que el estado descrito aquí (fechado en 2026) sigue vigente sin revisión.
