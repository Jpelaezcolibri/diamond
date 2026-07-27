# Manual de venta — Diamond OS / Vértice Studio

Derivado de la investigación del 25–26 de julio de 2026. Cada afirmación de este
manual está medida: si no podés respaldarla con el dato, no la digas.

Documentos hermanos:
[informe de validación](validacion-mercado-diamond-os.html) ·
[base de prospectos](prospectos-inmobiliarias-valle-aburra.xlsx) ·
`correos-en-frio.txt` (25 correos ya personalizados)

---

## 1. El único argumento que necesitás

> **De las 22 inmobiliarias más grandes del Valle de Aburrá — las que tienen 180
> propiedades publicadas o más — las 22 publican un número de WhatsApp.
> Ninguna lo tiene automatizado. Cero de 22.**
>
> **Y ninguna de las 22 tiene versión en inglés.**

Es verificable por el prospecto en dos minutos, nadie más se lo ha dicho, y no
es una opinión sobre tu producto: es una observación sobre su mercado.

Datos de respaldo, todos medidos sobre las 177 empresas jurídicas del Valle con
web viva:

| Dato | Valor | Para qué sirve |
|---|---|---|
| Publican WhatsApp en su web | 57,1% | El canal ya existe |
| Tienen chat o bot automatizado | **3,4%** | La herramienta no |
| Tienen Meta Pixel instalado | 7,3% | Casi nadie mide pauta |
| Tienen SEO estructurado inmobiliario | **0,0%** | Google no lee sus fichas |
| Sitios web caídos (de 331 listados) | 48 | Gancho de entrada barato |

---

## 2. Precios

Escalá por **inventario publicado**, no por usuarios: lo podés medir desde afuera
antes de la primera llamada (está en el Excel), correlaciona con el valor, y el
cliente no lo puede maquillar.

| Tier | Rango | Cuentas reales | Incluye | Precio/mes |
|---|---|---|---|---|
| **Esencial** | <80 fichas | ~136 | Sofi (atiende, califica, agenda, guía legal, transfiere) + CRM inbox y kanban | **$590.000** |
| **Pro** | 80–300 fichas | ~26 | + landing REF, sync de inventario, atención bilingüe, seguimiento automático | **$1.190.000** |
| **Completo** | 300+ fichas | ~21 | + DMAP: genera el creativo con IA y publica en Meta | **$2.400.000** |
| **Operado** | a medida | ~5 | Vértice opera la pauta completa | **$3.500.000** o base + % de inversión |

**Implementación: $1.800.000–$2.500.000, una sola vez.** No lo regales. Ventools
cobra $2.200.000–$5.400.000 y Mentora desde $3.900.000 por lo mismo. El fee
filtra curiosos, cubre el montaje real (WABA, verificación de Meta, carga de
inventario, ajuste de prompts) y financia el trabajo de aislamiento multi-tenant.

### Dónde estás parado frente a la competencia

| Producto | Precio/mes | ¿Califica con IA? | ¿Genera y publica pauta? |
|---|---|---|---|
| Newton.AI 🇨🇴 | ~USD 99 | Sí | No |
| VIDA AI 🇨🇴 Medellín | ~USD 129 | Sí | No |
| Inmobo 🇨🇴 | USD 175 + 5/agente | Sí | No |
| YAVE 🇨🇴 | $359.000 + $109.000 módulo IA | Sí | No |
| Yampi.ai 🇨🇴 | $399.000 – $1.999.000 | Sí, + recaudo, + Wasi | No |
| Keybe 🇨🇴 | USD 790 – 2.280 | Sí | Gestiona, **no genera** |
| **Diamond OS** | **$590.000 – $2.400.000** | **Sí** | **Sí — único** |

**Regla:** no compitas por precio en el tier Esencial. Si el prospecto solo quiere
un bot barato, VIDA AI y Newton son más baratos y están bien. Tu terreno es el
Pro y el Completo, donde nadie más genera el creativo y publica.

---

## 3. Cómo entregar sin haber cerrado el multi-tenant

Decisión tomada: vender primero, arreglar al cerrar. Se puede hacer sin riesgo
para los primeros clientes, **aislando por despliegue en vez de por código**:

- Proyecto de Supabase propio por cliente
- Servicio de Railway propio por cliente
- Costo adicional: ~5–10 USD/mes por cliente

Aguanta hasta 3 clientes. Del cuarto en adelante es insostenible y hay que hacer
el sprint de verdad: filtro por `org_id` en las cuatro pantallas del CRM
(`kanban`, `leads`, `inbox`, `aliados`), RLS real en Supabase, y sacar el
`orgId` del payload del cliente en las rutas de Marketing.

**Regla dura: no prometas fecha de arranque sin haber montado el despliegue
aislado.** El día que un cliente nuevo entre a la instancia de Diamond, perdés
los dos clientes.

---

## 4. Guion de llamada (5 minutos)

**Primeros 30 segundos — el dato, no el pitch**

> "Buenos días, habla Juan Peláez de Vértice Studio. Le robo dos minutos.
> Estuve revisando las inmobiliarias del Valle de Aburrá y vi que ustedes tienen
> [N] propiedades publicadas — están entre las más grandes. También vi que
> publican un WhatsApp en la web, pero que no tiene nada que lo conteste solo.
> Eso no es una crítica: miré las 22 más grandes y ninguna lo tiene.
> ¿Hoy quién contesta ese WhatsApp?"

Y **callate**. La respuesta te da el diagnóstico completo.

**Minutos 1 a 3 — preguntar, no presentar**

No hables del producto todavía. Preguntá por el pasado, no por hipótesis:

- ¿Cuántos mensajes les entran por ahí en un día normal?
- ¿Qué pasa con los que llegan un sábado a las 8 de la noche?
- La última vez que perdieron un cliente porque nadie contestó a tiempo,
  ¿qué pasó exactamente?
- ¿Cómo decide hoy un asesor cuál lead atiende primero?
- ¿Cuántos de los que escriben terminan agendando una visita?

Si no puede responder la última, ese es el dolor: **no lo están midiendo.**

**Minutos 3 a 5 — una sola frase de producto y el cierre**

> "Lo que hacemos es esto: Sofi contesta ese WhatsApp 24/7, le pregunta al
> cliente presupuesto, zona y urgencia, le responde dudas de Ley 820 o de
> crédito, y si califica le agenda la visita mirando la agenda real del asesor.
> Lo que no puede, lo pasa al asesor con el resumen hecho.
> ¿Le sirve que le muestre en 15 minutos cómo respondería con sus propias
> propiedades cargadas?"

La demo es el producto. No mandes propuesta antes de la demo.

---

## 5. Las seis objeciones que vas a recibir

### 1. "¿Ustedes no trabajan con Diamond? Es mi competencia."
**La vas a recibir, y es legítima.** No la esquives.

> "Sí, Diamond es cliente. Vértice Studio es una empresa de software, no una
> inmobiliaria — usted sería cliente igual que ellos. Sus datos viven en una
> instancia separada y yo no muevo información entre clientes; si lo hiciera,
> mi negocio se acaba el primer día. Dicho eso, entiendo perfectamente si
> prefiere no trabajar con alguien que atiende a un competidor, y no pasa nada."

Si insiste, ofrecé **exclusividad por zona o por segmento** como cláusula pagada.
Es la única respuesta comercial honesta, y convierte una objeción en un tier
premium. No prometas exclusividad gratis: te bloquea el mercado.

### 2. "Ya tengo Wasi / ya tengo SIMI."
> "Perfecto, no se lo cambio. Sofi se monta encima. Wasi no tiene integración
> con la API de WhatsApp — solo un botón de compartir ficha. Nosotros leemos su
> inventario de Wasi por su API y Sofi contesta con sus propiedades reales.
> Usted sigue trabajando igual."

Verificado: la API de Wasi no tiene un solo endpoint de mensajería.

### 3. "Vi uno más barato" (VIDA AI, Newton, Yampi)
No mientas diciendo que son malos. Son buenos y son más baratos.

> "Sí, hay opciones desde 99 dólares y funcionan. Tres diferencias concretas:
> Sofi responde dudas legales colombianas verificadas —Ley 820, escrituración,
> gastos notariales, crédito—, agenda validando contra el horario real de cada
> asesor en vez de prometer cualquier hora, y respeta al asesor que captó la
> propiedad. Y atiende en inglés, que ninguna de las 22 grandes de acá hace hoy.
> Si lo que necesita es solo un bot que conteste, dígamelo y le recomiendo cuál."

Esa última frase te hace ganar más negocios de los que pierde.

### 4. "No pautamos en Meta."
> "Entonces no le vendo eso. Vaya al plan Esencial, que es Sofi y el CRM."

El 92,7% del mercado no tiene píxel. No pelees contra ese dato: segmentá con él.

### 5. "¿Y si Wasi lanza esto mañana?"
> "Lo revisé a fondo. Su API no tiene ningún endpoint de mensajería, su única IA
> son descripciones de inmuebles con cuota semanal, y su feed de novedades son
> integraciones de portales. Además les conviene no hacerlo: su API abierta es
> lo que les retiene clientes."

### 6. "Somos pequeños, eso es para los grandes."
> "Las 22 más grandes del Valle tampoco lo tienen. No es un tema de tamaño, es
> que nadie lo ha montado todavía acá."

---

## 6. Tu prueba, y sus límites

El dato duro que tenés es real y es tuyo — campaña de Diamond, cuenta
`4392703294311533`, corte 23-jul-2026:

**$51.163 COP invertidos · 71.241 impresiones · 48.691 cuentas alcanzadas ·
2.938 visitas a la landing · $17 COP por resultado.**

Mostralo con la captura del administrador de anuncios, no como número suelto.

**Honestidad obligatoria:** ese número es **costo por visita a la landing**, no
costo por lead calificado ni por venta. Si lo presentás como "17 pesos por
cliente" y el prospecto lo verifica, perdiste la venta y la reputación.
Presentalo como lo que es — y es igual de impresionante.

---

## 7. Secuencia operativa

**Semana 1 — 25 correos y 25 llamadas.** Los correos están en
`correos-en-frio.txt`, ya personalizados con el dato medido de cada cuenta.
Mandalos lunes y martes por la mañana; llamá al fijo miércoles y jueves. Todos
tienen línea de oficina.

**Semana 2 — demos.** Meta razonable: 6 a 8 demos de 25 contactos. La demo usa
sus propias propiedades — cargá su inventario antes.

**Semana 3 — cerrar 1 o 2 y montar el despliegue aislado.**

### Qué medir
Tasa de respuesta al correo · llamadas que pasan de 3 minutos · demos agendadas
· **y sobre todo: cuál de las seis objeciones aparece más.** Esa frecuencia te
dice qué arreglar en el producto y en el precio, y es el insumo del copy de
cualquier campaña futura.

### Lo que no hay que hacer todavía
**No lances campaña de Meta.** Tenés las 239 empresas con teléfono y correo:
pagar por alcanzarlas es pagar por algo que ya tenés. Y el equipo de Diamond
está dentro de esa audiencia — verían el anuncio. La campaña tiene sentido
después de 15 conversaciones, cuando sepas qué frase convierte de verdad.

---

## 8. Evidencia que todavía falta

Dos cosas quedaron sin cerrar y son las de mayor valor por hora invertida:

1. **Mystery shopping sobre 30 empresas** — escribirles como comprador y
   cronometrar la respuesta. Convierte el argumento en
   *"escribí a 30 inmobiliarias del Valle un sábado; X no contestaron en 24
   horas"*. Es dato propietario, no replicable por la competencia, y es la
   prueba directa del valor de Sofi. Requiere tu decisión: implica contactar
   competidores de Diamond.
2. **60 reseñas de Google codificadas** — para el argumento del lado del cliente
   final. Menos urgente para vender B2B que el punto 1.
