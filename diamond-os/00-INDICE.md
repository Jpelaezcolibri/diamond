# Diamond OS — Programa de investigación y diseño

Sistema Operativo Autónomo para Inmobiliarias de Latinoamérica.
Este folder es el **Knowledge Base** del programa: cada expediente se
investiga, se revisa, se aprueba y pasa a formar parte de esta base.
Las investigaciones nuevas parten de los documentos ya aprobados y se
enfocan en una sola pregunta concreta.

**Regla de oro del Nivel 1:** no se diseña ninguna solución hasta haber
demostrado con evidencia que el problema existe y tiene impacto.

## Estructura

| Carpeta | Contenido |
|---|---|
| `nivel-1-investigacion/` | Evidencia y entendimiento del mercado (sin soluciones) |
| `nivel-2-benchmark/` | Cómo resuelven esos problemas los mejores del mundo |
| `nivel-3-diseno/` | Cómo debería funcionar Diamond OS |
| `nivel-4-implementacion/` | Épicas, historias de usuario, roadmap técnico |

Cada expediente lleva estado en su encabezado: `BORRADOR` → `EN REVISIÓN` → `APROBADO`.
Solo los documentos `APROBADO` alimentan expedientes posteriores.

## Documento rector

- [**DIAMOND OS BLUEPRINT V1**](DIAMOND-OS-BLUEPRINT-V1.md) — estado: BORRADOR. **Constitución del producto.** Arquitectura funcional completa: capacidades, dominios, flujo de información, objetos de núcleo y motores centrales, construida exclusivamente a partir de los dos modelos de referencia y de la arquitectura ya desplegada (bot, CRM, DMAP, landing). Es un mapa de referencia — no un plan de construcción literal (ver auditoría).

## Validación y alcance de construcción

- [Auditoría adversarial del Blueprint V1](auditoria-blueprint-v1.md) — estado: BORRADOR. Veredicto: **SI, CON CAMBIOS**. 12 hallazgos estructurales (dominios mal definidos, objetos sin dueño, motores duplicados, y el hallazgo central: el mapa está dimensionado para una operación enterprise, no para la real de 1 desarrollador).
- [Diamond OS V1 — Alcance comercial mínimo](diamond-os-v1-alcance-comercial.md) — estado: BORRADOR. **La hoja de ruta real de construcción.** Corta el Blueprint a una sola capacidad nueva (recaudo + liquidación dentro de Administración de Activos) para 6 meses / 1 desarrollador, justificando cada inclusión y exclusión con los hallazgos de la auditoría.

## Diseños funcionales por capacidad

- [SOFI — Centro de Comando Conversacional](sofi-centro-comando.md) — estado: BORRADOR (arquitectura base aprobada 2026-07-10). Diseño funcional que desdobla a SOFI en dos actores (Sofi-Cliente, la existente, y Sofi-Comando, copiloto interno de asesores/admins): permisos ADMIN/ASESOR, catálogo de herramientas, capa de consulta en base ("la base calcula, la IA conversa"), memoria en tres niveles, y la **Red de Colegas / Memoria de Mercado** (formalización de `ally_properties`). Ampliación de alcance decidida por el dueño del producto el 2026-07-10; sin código hasta su aprobación.
- [SOFI EXPERIENCE V1](sofi-experience-v1.md) — estado: BORRADOR (aprobado como línea base 2026-07-10). Diseño de **experiencia** (no de capacidades): convierte a Sofi-Comando de reactiva a proactiva reensamblando las herramientas ya aprobadas alrededor del ritmo de la jornada — parte del día, plan priorizado, contexto arrastrado, conversaciones que se inician solas, detección temprana para el admin, colapso de la navegación. **No agrega ninguna tabla, API, herramienta ni motor**; cada movimiento se justifica por problema/tiempo/fricción/adopción. Depende de la arquitectura de sofi-centro-comando.md.
- [SOFI — Backlog de Experiencia](sofi-experience-backlog.md) — estado: BORRADOR. **Backlog de ejecución priorizado por ROI** para inmobiliaria de 1–5 asesores. Principio rector permanente: "¿qué debería ocurrir automáticamente sin que el usuario lo pida?" y métrica única: *acciones útiles que SOFI inicia sin que se las pidan*. 13 mejoras (EXP-001…EXP-013) sobre inicio de jornada, durante la jornada, conocimiento compartido y fin de jornada — cada una con evento disparador, reutilización de arquitectura existente y justificación de por qué NO requiere motores/capacidades nuevas.
- [SOFI — Experiencias de Usuario (demo)](sofi-experiencias-demo.md) — estado: BORRADOR. Reagrupa las 13 historias del backlog en **5 experiencias completas** demostrables en <5 min cada una (El Día Resuelto · Cero Leads Perdidos · Siempre un Paso Adelante · El Equipo con un Solo Cerebro · El Dueño que Ve Antes). Cada una con nombre comercial, problema, flujo, guion de demo, historias que la componen, criterios de aceptación y valor comercial. Orienta desarrollo, demo comercial y pruebas con cliente alrededor de experiencias, no de funciones. No cambia prioridades ni agrega historias.

## Modelos de referencia

- [Modelo Operacional de una Inmobiliaria Colombiana](modelo-operacional-inmobiliaria.md) — estado: BORRADOR. Modela el negocio como un sistema de decisiones humanas continuas (actores, eventos, grafo de decisión). Insumo del Blueprint.
- [Modelo de Gobernanza de Decisiones](modelo-gobernanza-decisiones.md) — estado: BORRADOR. Clasifica cada decisión del Modelo Operacional en Humana / Asistida / Autónoma, con criterios razonados y líneas rojas. Insumo del Blueprint — el motor de decisión del sistema (§6.2) es su traducción directa a comportamiento.

## Expedientes de investigación (Nivel 1) — en pausa por decisión explícita

El programa pivotó de "investigar antes de construir" a "construir sobre lo
ya investigado" (decisión del 2026-07-10): con los dos modelos de referencia
y la arquitectura existente como evidencia suficiente, se congela la
apertura de nuevos expedientes de investigación y el esfuerzo se concentra en
el Blueprint y su implementación. Los expedientes 1.2–1.10 quedan definidos
pero no se ejecutan salvo que una duda concreta del Blueprint lo justifique.

- [1.1 — Plan maestro de investigación: dolores operativos de las inmobiliarias colombianas](nivel-1-investigacion/expediente-1.1-dolores-operativos.md) — estado: EN REVISIÓN (en pausa)
- 1.2 a 1.9 — un expediente por área, definidos en 1.1 — en pausa
- 1.10 — Síntesis: mapa priorizado de dolores — en pausa

### Niveles 2–4 (benchmark, diseño de producto, implementación)
Reemplazados en la práctica por el Blueprint (diseño) y sus siguientes
etapas de especificación por dominio. No se reactivan Nivel 1/2 salvo
necesidad puntual y explícita.

## Investigación de canal — WhatsApp y grupos gremiales (ago-2026)

- [Investigación: matching inmobiliario sobre WhatsApp con mínimo riesgo de bloqueo](investigacion-whatsapp-matching-2026-08.md) — estado: APROBADO COMO EVIDENCIA. Estado oficial de la plataforma a ago-2026 (Cloud API, Groups API, Coexistence, OBA, 15 BSPs, productos "group inbox", librerías no oficiales, Ley 1581), con veredicto: no existe vía oficial a grupos existentes; arquitectura recomendada = la captura segura ya desplegada + automatización oficial máxima. Confirma y precisa D9 del EPE.
- [Deep dive: Group Gateway → Sofi → Wasi → respuesta](deep-dive-group-gateway-2026-08.md) — estado: APROBADO COMO EVIDENCIA. Continuación quirúrgica de la anterior: veredicto por superficie (READ/RECEIVE/WRITE/REPLY), auditoría de 25+ proveedores con su tecnología real, diseño del Gateway como contrato transporte-agnóstico sobre los módulos existentes, política anti-spam, y las 5 respuestas ejecutivas.

## Contexto ya construido (no redescubrir)

El repo ya documenta lo existente; los expedientes lo referencian en vez
de re-investigarlo:
- Bot Sofi: [ARCHITECTURE.md](../ARCHITECTURE.md)
- CRM: [crm/ARCHITECTURE.md](../crm/ARCHITECTURE.md)
- DMAP (growth engine): [dmap/ARCHITECTURE.md](../dmap/ARCHITECTURE.md)
- Landing REF: [web/README.md](../web/README.md)
- Playbook comercial: [playbook/00-INDICE.md](../playbook/00-INDICE.md)

Nota: los expedientes de Nivel 1 y 2 son deliberadamente agnósticos de
Diamond — describen mercado y problema, no nuestra solución.
