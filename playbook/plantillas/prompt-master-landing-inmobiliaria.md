# Prompt Maestro — Landing Page Inmobiliaria (para pauta de Meta Ads)

Plantilla independiente del Playbook de Diamond. Para usar con otra inmobiliaria: reemplazar los campos entre `[CORCHETES]` antes de pegar el prompt en Claude. El objetivo de esta landing es un único destino de pauta (Meta Ads → landing → WhatsApp/formulario), no un sitio corporativo completo.

## Cuándo usar esta landing vs. Clic-a-WhatsApp directo

Esta landing tiene sentido cuando quieres:
- Medir con Pixel + CAPI antes de que el cliente llegue a WhatsApp (embudo más largo, mejor atribución).
- Mostrar catálogo/inventario con filtros antes del contacto.
- Dar una imagen de marca más premium que un simple clic a chat.

Si el objetivo es solo "clic a WhatsApp" simple sin catálogo, no necesitas landing — usa el flujo de Clic-a-WhatsApp directo del [Playbook de Meta Ads](../03-meta-ads-playbook.md).

## El prompt (copiar y pegar en Claude/Claude Code)

```
Actúa como diseñador UI/UX senior y desarrollador frontend experto en landing pages de alta conversión para inmobiliarias de lujo (referencia de nivel: Sotheby's International Realty, Compass, SERHANT). Vas a construir la landing page de [NOMBRE_INMOBILIARIA], que va a recibir tráfico pagado de Meta Ads (Instagram/Facebook), así que cada segundo y cada scroll debe justificar el costo por clic.

CONTEXTO DEL NEGOCIO
- Inmobiliaria: [NOMBRE_INMOBILIARIA], operando en [ZONA_PRINCIPAL], [PAÍS].
- Productos: venta, arriendo tradicional[, renta corta si aplica].
- Canal de cierre: WhatsApp con [ASISTENTE_VIRTUAL_NOMBRE] (ej. "Sofi"), un agente conversacional que califica al lead automáticamente. Número: [TELÉFONO_WHATSAPP].
- Tono de marca: cálido, profesional, sin tecnicismos, colombiano/[país] neutro — nunca genérico ni corporativo frío.
- Inventario real de propiedades disponible vía API/base de datos (no inventar propiedades ni precios en el diseño — usar datos de ejemplo claramente marcados como placeholder hasta conectar la fuente real).

OBJETIVO DE CONVERSIÓN (elegir uno o combinar)
[ ] Captación directa a WhatsApp (botón flotante + CTAs a lo largo de la página, con mensaje precargado por propiedad)
[ ] Formulario de lead (nombre, teléfono, interés venta/arriendo, presupuesto) que dispara evento de conversión para Meta CAPI
[ ] Ambos, con el formulario como paso intermedio antes de redirigir a WhatsApp

ESTRUCTURA OBLIGATORIA DE LA LANDING (en este orden)

1. Hero
   - Titular de alto impacto emocional (no "Bienvenido a X" — vender el resultado: encontrar el hogar/inversión ideal).
   - Subtítulo con la propuesta de valor diferencial (ej. velocidad de respuesta, atención personalizada, inventario verificado).
   - CTA primario inmediato (WhatsApp o "Ver propiedades") visible sin hacer scroll.
   - Imagen o video de fondo de altísima calidad (usar placeholders de Unsplash con temática de arquitectura/interiores de lujo si no hay fotos reales todavía).
   - Barra de búsqueda rápida: operación (venta/arriendo) + zona + rango de precio.

2. Barra de confianza (trust bar)
   - Métricas reales o marcadas como placeholder: años en el mercado, propiedades gestionadas, tiempo promedio de respuesta, calificación de clientes.

3. Catálogo de propiedades destacadas
   - Grid de tarjetas (mínimo 6, diseño tipo Compass/Sotheby's: foto grande, precio, ubicación, badges de habitaciones/baños/área).
   - Cada tarjeta con estos campos exactos (mapear 1:1 a la tabla `properties`): ref, titulo, tipo, operacion (Venta/Arriendo), precio, area, habitaciones, banos, garaje, estrato, administracion, zona, ciudad, link.
   - Filtro funcional por operación (Venta/Arriendo) y por zona.
   - CTA en cada tarjeta: "Hablar por WhatsApp sobre esta propiedad" → link wa.me con mensaje precargado que incluya la referencia (ref) de la propiedad, igual al patrón ya usado en `playbook/links-whatsapp-inventario.md`.

4. Por qué elegirnos / diferenciales
   - 3-4 bloques con ícono + texto corto, basados en los diferenciales reales del negocio (no genéricos tipo "calidad y confianza").

5. Cómo funciona (proceso)
   - 3-4 pasos ilustrados: "Nos escribes → Sofi te asesora al instante → Agendamos visita → Cerramos" (ajustar según el flujo real).
   - Mencionar explícitamente la atención inmediata vía WhatsApp como diferencial de velocidad.

6. Testimonios / prueba social
   - Diseño tipo carrusel o grid, con foto (o placeholder), nombre, y resultado obtenido (comprar/arrendar/vender en X tiempo).

7. Formulario de contacto (si el objetivo incluye captación de leads)
   - Campos mínimos: nombre, teléfono (con validación de formato), operación de interés, zona de interés, presupuesto aproximado.
   - Al enviar: disparar evento `Lead` de Meta Pixel + llamada a Conversions API (server-side) y luego redirigir a WhatsApp con los datos precargados en el mensaje.
   - Mensaje de confirmación cálido, no un simple "Enviado".

8. CTA final + footer
   - Último CTA grande antes del footer.
   - Footer con: datos de contacto, redes sociales, [disclaimer legal si aplica renta corta/regulación local], política de privacidad (obligatorio por el formulario que recolecta datos personales).

9. Botón flotante de WhatsApp
   - Fijo en las 4 esquinas inferior derecha en desktop y mobile, visible en todo momento tras el primer scroll, con mensaje precargado genérico ("Hola, quiero información sobre propiedades en [ZONA_PRINCIPAL]").

REQUISITOS TÉCNICOS
- Stack: Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui — coherente con el resto del ecosistema de proyectos.
- Mobile-first estricto: el 80-90% del tráfico de Meta Ads llega desde el feed de Instagram/Facebook en celular.
- Performance: imágenes optimizadas (next/image), lazy loading fuera del viewport inicial, LCP < 2.5s — el CPC ya pagado se desperdicia si la página tarda en cargar.
- Integrar Meta Pixel (base code) + preparar el evento server-side para Conversions API (no implementar credenciales, dejar el punto de integración claro con un comentario `// TODO: CAPI`).
- SEO básico: metadata (title, description, Open Graph con imagen para que el anuncio y el share se vean bien), favicon con la marca.
- Accesibilidad: contraste AA mínimo, textos alternativos en imágenes, formulario navegable por teclado.
- Animaciones sutiles al hacer scroll (fade/slide), nunca intrusivas ni que retrasen la interacción.
- El catálogo debe estar preparado para consumir datos reales desde una API/base de datos (dejar el punto de fetch claramente aislado en un solo lugar, con datos mock tipados mientras tanto según el shape de la tabla `properties` descrita arriba).

LO QUE NO DEBE PASAR
- Nada de stock photos genéricas de "gente feliz dando la mano" — solo arquitectura/interiores/exteriores de alta calidad.
- Nada de precios o disponibilidad inventados en el copy — todo lo que parezca dato real debe venir claramente marcado como placeholder.
- No mezclar operación Venta y Arriendo en la misma tarjeta o CTA — son mensajes de conversión distintos.
- No bloquear el CTA de WhatsApp detrás de scroll largo — debe estar accesible desde el primer segundo.

ENTREGABLE
Construye la landing completa y funcional en este proyecto, lista para conectar con Meta Pixel/CAPI y con la base de datos real de propiedades. Antes de escribir código, dime en 3-4 líneas tu plan de componentes y estructura de carpetas para que lo valide.
```

## Datos a reemplazar antes de usar

```
[NOMBRE_INMOBILIARIA] =
[ZONA_PRINCIPAL] =
[PAÍS] = Colombia
[ASISTENTE_VIRTUAL_NOMBRE] =
[TELÉFONO_WHATSAPP] =
```

## Después de generar la landing

1. Conectar Pixel + CAPI (ver checklist de puesta en marcha del [Playbook de Meta Ads, sección 6](../03-meta-ads-playbook.md)).
2. Verificar el dominio de la landing en Business Settings antes de lanzar campaña.
3. Probar el flujo completo formulario → evento de conversión → redirección a WhatsApp con un lead de prueba antes de poner presupuesto real.
