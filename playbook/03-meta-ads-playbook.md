# Capítulo 3 — Playbook de Meta Ads (Estado 2026)

## 1. Objetivo

Construir el manual operativo de Meta Ads para Diamond — desde la configuración de cuenta hasta la estructura de campañas por producto (venta, alquiler, renta corta) — reflejando el estado real de la plataforma en 2026, no técnicas de 2019-2023 que hoy rinden peor.

## 2. Investigación (verificado contra documentación oficial de Meta y fuentes de la industria, 2026)

### 2.1 Business Manager / Business Portfolio
No se fusionaron en un solo nombre: coexisten con roles distintos. Meta Business Suite es la operación diaria (publicaciones, mensajes, bandeja de Facebook/Instagram, ahora con Meta AI integrada). Business Manager, también llamado "Business Portfolio", es la capa de administración estructural: activos (páginas, cuentas publicitarias, catálogos), permisos de equipo y accesos sin compartir contraseñas. Flujo típico: crear el portafolio → reclamar la página de Facebook → conectar Instagram → crear cuenta publicitaria → asignar accesos por rol.

### 2.2 Advantage+ — el cambio más importante de 2026 (afecta directamente al Capítulo 2)
La segmentación manual detallada por intereses está en fuerte retroceso. El 15 de enero de 2026, Meta eliminó decenas de categorías de interés detallado (salud, religión, política); desde febrero de 2026 las selecciones de "detailed targeting" son sugerencias para la IA, no filtros estrictos — el sistema puede mostrar el anuncio fuera de lo seleccionado si predice mejor rendimiento. Meta preselecciona Advantage+ (audiencia, ubicaciones, presupuesto, creatividad) por defecto en campañas de ventas/conversión, y reporta internamente hasta 32% menor CPA con Advantage+ Audience vs. segmentación manual.

Implicación directa: las personas del Capítulo 2 alimentan el creativo y las audiencias propias (CRM, remarketing), no filtros manuales estrictos.

### 2.3 Pixel + Conversions API (CAPI)
Vigente y reforzado: Pixel (browser) + CAPI (server-side) juntos, con deduplicación por event_id. Novedad 2026: "Meta-enabled CAPI" de un clic — dentro de Events Manager, botón "Activate Conversions API", Meta aloja toda la infraestructura server-side, sin desarrollador. Meta reporta ~17,8% menor costo por resultado con CAPI activo vs. solo Pixel.

### 2.4 Lead Ads (formularios nativos)
Siguen siendo la vía recomendada para captación de baja fricción. Integración con CRM vía Business Suite → Integrations → Lead Access (Salesforce, HubSpot, Zapier, Webhooks — hasta 100.000 eventos gratis vía Zapier hacia CAPI). Novedad 2026: verificación de teléfono por SMS dentro del formulario.

### 2.5 Housing Special Ad Category — NO aplica a Colombia (confirmado contra documentación oficial)
Verificado en developers.facebook.com: la restricción de Housing (igual que Employment y Credit) aplica únicamente a anunciantes en o apuntando a EE.UU., Canadá y Europa. Colombia y Latinoamérica no están incluidas — la segmentación por edad, género e intereses sigue técnicamente disponible sin las restricciones de Fair Housing. El límite real a la segmentación viene de 2.2 (Advantage+), no de una obligación legal.

### 2.6 Benchmarks Colombia/Real Estate 2026
- CPM Colombia: promedio 2,74 USD (rango 1,79-4,22 USD) — 80-90% más barato que el promedio global.
- CPC Real Estate (global): subió de 0,74 USD (jun. 2025) a 2,60 USD (jun. 2026), +249% interanual.
- CPL Lead Ads (global): promedio 27,66 USD, CVR promedio 7,72%; el sector inmobiliario tiene CVR más alto, 10,68%.
- No existe benchmark combinado "inmobiliaria + Colombia" verificado — no usar esa cifra combinada.

## 3. Análisis

1. El cambio de Advantage+ obliga a redefinir el éxito de la campaña: ya no es afinar tanto el targeting que solo lo vea el público ideal, sino darle al algoritmo señales de conversión tan buenas (CAPI + Lead Ads con verificación) que encuentre solo al público ideal.
2. Que Housing no aplique a Colombia es una ventaja competitiva real frente a agencias que replican playbooks de EE.UU. con miedo a segmentar por edad/género.
3. El CPM de Colombia (2,74 USD) es muy competitivo — el cuello de botella de Diamond será la calidad del creativo y de la calificación del lead, donde entra Sofi calificando cada lead por WhatsApp.
4. El CVR más alto del sector inmobiliario (10,68% vs 7,72% promedio) sugiere que Lead Ads funciona particularmente bien en este vertical — debe ser el formato principal de captación.

## 4. Recomendaciones

- Estructura de campaña por objetivo de conversión, no por intereses manuales: Advantage+ Audience + CBO, con muchas variaciones de creativo dentro de pocos ad sets.
- Activar CAPI de un clic desde el día 1.
- Lead Ads con verificación SMS como formato principal de captación, integrado directamente al bot Sofi vía webhook para calificación automática instantánea.
- Separar objetivos por línea de negocio: venta (conversión/ciclo largo, remarketing sostenido), alquiler (volumen/CPL bajo, alta rotación de creativos), renta corta (con disclaimer legal obligatorio).

## 5. Tablas

### 5.1 Estructura de campaña recomendada por producto

| Producto | Objetivo Meta | Formato principal | Optimización | Rotación de creativo |
|---|---|---|---|---|
| Venta | Conversiones (landing / WhatsApp) | Video + carrusel | CAPI + evento de "contacto calificado" | Cada 2-3 semanas |
| Alquiler | Leads (formulario nativo) | Lead Ads con SMS | Volumen de leads calificados | Semanal |
| Renta corta | Leads + Mensajes | Video con disclaimer legal visible | CAPI + evento de "consulta calificada" | Cada 2-3 semanas |

## 6. Checklists

**Puesta en marcha (una sola vez):**
- [ ] Business Portfolio creado, página de Facebook reclamada, Instagram conectado
- [ ] Cuenta publicitaria creada y método de pago validado
- [ ] Pixel instalado en el sitio/landing
- [ ] CAPI activado (un clic)
- [ ] Dominio verificado
- [ ] Catálogo de propiedades cargado (si aplica)
- [ ] Formulario de Lead Ads con verificación de teléfono activada
- [ ] Integración Lead Ads → CRM/bot Sofi probada con un lead de prueba

**Antes de lanzar cualquier campaña:**
- [ ] Evento de conversión definido y probado
- [ ] Presupuesto diario suficiente para salir de la fase de aprendizaje
- [ ] Si es renta corta: disclaimer legal del Capítulo 1 incluido

## 7. Buenas prácticas

- No editar el ad set constantemente durante la fase de aprendizaje (primeros ~50 eventos de conversión).
- Dejar que Advantage+ trabaje con audiencia amplia; invertir el esfuerzo humano en creativo y evento de conversión.
- Usar audiencias personalizadas (CRM Diamond/Sofi, visitantes del sitio) como base de Lookalike.

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| Presupuesto diario muy bajo nunca sale de fase de aprendizaje | Definir presupuesto mínimo por campaña (Capítulo 8) |
| Editar la campaña constantemente reinicia el aprendizaje | Disciplina de cambios semanal |
| Creativo de renta corta sin disclaimer legal | Checklist obligatorio |
| Depender 100% de la plataforma sin datos propios | Priorizar audiencias propias vía CRM/Sofi |

## 9. Conclusiones

Meta Ads en 2026 premia las señales de conversión de calidad por encima de la segmentación manual. Colombia tiene ventaja de costo y flexibilidad legal, y el sector inmobiliario convierte mejor que el promedio en Lead Ads. La ejecución debe apoyarse en la integración directa con Sofi.

## 10. Acciones recomendadas

1. Completar el checklist de puesta en marcha esta semana.
2. Conectar el formulario de Lead Ads directamente al bot Sofi (ya existe la infraestructura en `src/api/crm.js`).
3. Preparar 3-5 variaciones de creativo por persona antes del primer lanzamiento (Capítulo 4).

---

**Próximo capítulo**: 4. Biblioteca de Creativos y Copywriting.
**Dependencias**: Usa las personas del Capítulo 2 y las reglas legales de renta corta del Capítulo 1.
