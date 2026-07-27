# Informe maestro — Investigación de mercado inmobiliario, Medellín

**Qué es este documento:** el registro consolidado de toda la investigación de
mercado hecha entre el 25 y el 26 de julio de 2026 para decidir a quién le vende
Vértice Studio su ecosistema (bot Sofi + CRM + DMAP + landing REF).

**Por qué existe:** la investigación cambió de conclusión dos veces sobre la
marcha. Este archivo guarda el recorrido completo —incluidos los errores de
método y las hipótesis que se cayeron— para que ninguna decisión futura tenga
que rehacerse desde cero.

**Estado al cierre:** segmento objetivo redefinido. Falta diseñar el producto
que le encaje.

---

## 1. Qué se hizo, concretamente

Nada de esto es estimación. Todo se descargó y se contó.

| Paso | Método | Resultado |
|---|---|---|
| Universo | Extracción del directorio de afiliados de [La Lonja](https://lonja.org.co/afiliados-1/), incluidos categoría gremial y municipio vía su endpoint de filtrado | 530 afiliados |
| Stack tecnológico | Descarga del HTML de los 331 sitios listados + regex de firmas técnicas | 264 analizados, 48 muertos |
| Inventario | Lectura del `sitemap.xml` de cada dominio | 41 con inventario real |
| Datos financieros | Fichas del RUES vía informacolombia.com | 23 con NIT y facturación 2025 |
| Tamaño de mercado | Cámara de Comercio de Medellín vía Datos Abiertos, dataset `i8vm-9jeb` | Cifra oficial (2022) |
| Competencia | 40+ productos con precio público verificado | Ver §5 |
| Dolores | Calificaciones y reseñas de Google | **Parcial** — ver §7 |

---

## 2. El embudo medido (segmento original: inmobiliarias establecidas)

```
530  afiliados a La Lonja
455  en el Valle de Aburrá
239  personas jurídicas
177  con sitio web vivo
 41  con inventario real publicado (≥20 fichas)
 25  usan Wasi
 13  miden pauta (Meta Pixel)
  2  cumplen el perfil completo
```

Las dos con perfil completo: **Inmobiliaria Johnson S.A.S** y **Bodegas Y
Proyectos S.A.S**.

### Señales sobre las 177 con web viva

| Señal | Valor |
|---|---|
| Sin CRM inmobiliario detectable | 127 (71,8%) |
| Wasi | 22 (12,4%) · +3 con Wasi y SIMI a la vez |
| SIMI | 14 (7,9%) |
| Publican WhatsApp | 101 (57,1%) |
| **Tienen chat o bot automatizado** | **6 (3,4%)** |
| Meta Pixel instalado | 13 (7,3%) |
| **SEO estructurado inmobiliario** | **0 (0,0%)** |

### El hallazgo más vendible
**De las 22 inmobiliarias más grandes del Valle (≥180 fichas publicadas): las 22
publican un WhatsApp, ninguna lo tiene automatizado, y ninguna tiene versión en
inglés.**

---

## 3. Primer giro: los grandes no son el cliente

Las inmobiliarias con más inventario **no usan Wasi ni SIMI: construyeron su
propio sistema.** Verificado leyendo el generador de cada sitio.

| Empresa | Fichas | Plataforma real |
|---|---:|---|
| El Dandy Inmobiliaria | 5.001 | WordPress a medida |
| Grupo Santamaría | 1.680 | Astro (JS) |
| Arrendamientos Envigado | 1.543 | React/Next |
| Acrecer | 760 | React/Next |
| COLTEBIENES | 497 | React/Next |
| Londoño Gómez | 614 | SIMI |

Eso significa equipo interno, inversión hecha y resistencia alta. **Máximo
tamaño, máxima fricción, valor marginal.** Al re-rankear por valor entregado
sobre fricción de cierre, Londoño Gómez —la más grande, $218.322 millones de
patrimonio— cayó del puesto 7 al 95.

---

## 4. Segundo giro, y el error de método que lo causó

**El filtro original era circular.** Se seleccionaron empresas que ya tenían
inventario publicado, Wasi y píxel — es decir, **las que ya habían resuelto el
problema que el producto viene a resolver**. Para un producto que *crea* madurez
digital, ese filtro elige al cliente equivocado.

La prueba: **Diamond Inmobiliaria no habría pasado ese filtro** el día que se
firmó. No tenía nada de lo que hoy tiene. Es la única prueba de existencia real
que hay, y el análisis inicial la ignoró.

Además se excluyeron por defecto las 216 personas naturales del Valle bajo el
supuesto —no verificado— de que no pagan $1.600.000/mes. El supuesto era el
precio, no el cliente.

### El segmento que se había descartado

| | |
|---|---:|
| Personas naturales en el Valle (solo La Lonja) | **216** |
| Sin sitio web alguno | **131** |
| Con web viva | 64 |
| **Ya pagan Wasi** | **26** |
| — plan Pro (~USD 48/mes) | 20 |
| — plan Inicio (~USD 27/mes) | 7 |
| Publican WhatsApp | 41 de 64 |
| **Tienen automatización** | **1 de 64** |
| Con teléfono y correo | 216 de 216 |

**216 es un piso muy bajo:** la mayoría de los independientes no se afilia al
gremio. El dato oficial de la Cámara de Comercio (CIIU 6820, actividades
inmobiliarias por retribución o contrata, Medellín, 2022) da **789 micro + 226
pequeñas = 1.015 empresas** en el segmento.

### Muestra medida de inmobiliarias pequeñas en el plan de entrada de Wasi

Los dominios `*.inmo.co` son los sitios que Wasi regala en su plan Inicio.
Enumerarlos es enumerar directamente a quien ya paga software siendo pequeño.

| Sitio | Fichas activas | WhatsApp | Bot | Píxel | Celular |
|---|---:|---|---|---|---|
| arbolinmobiliaria.inmo.co | 12 | sí | **no** | no | 573128665330 |
| atlasarquitectura.inmo.co | 12 | sí | **no** | sí | 573246069233 |
| inmobiliariasreal.inmo.co | 11 | sí | **no** | no | 573007057780 |
| inmobiliariala51.inmo.co | 11 | sí | **no** | no | 573504132820 |
| farhanainmobiliaria.inmo.co | 11 | sí | **no** | no | 573015561008 |
| deltoro.inmo.co | 10 | sí | **no** | no | 573167401202 |
| jlinmobiliaria.inmo.co | 9 | sí | **no** | no | 573001921716 |
| ncpinmobiliaria.inmo.co | 4 | sí | **no** | no | 573245338891 |
| maesinmobiliaria.inmo.co | 0 | no | no | no | — |

**8 de 9 publican su WhatsApp. 0 de 9 tienen cualquier automatización.**
El hueco en este segmento es total, no parcial.

> **Nota de habeas data:** estos son celulares personales, no líneas
> corporativas. Ley 1581/2012 y Ley 2300/2023 aplican con más fuerza acá que en
> el segmento empresarial. No cargar a audiencias de Meta ni a campañas de envío
> masivo sin autorización.

---

## 5. Competencia (verificada el 25-jul-2026)

### La buena noticia
**Wasi no tiene ni anunció un agente de WhatsApp con IA.** Su única IA en
producción son descripciones de inmuebles con cuota semanal (5/10/30 según
plan), su API no tiene un solo endpoint de mensajería, y su feed de novedades
son integraciones de portales. Además tiene incentivo estructural a no
construirlo: su API abierta es lo que le retiene clientes vía terceros.

### La mala: la categoría ya está poblada

| Producto | Origen | Precio | ¿Califica con IA? | ¿Genera y publica pauta? |
|---|---|---|---|---|
| Newton.AI | 🇨🇴 | USD 99/mes | Sí — HOT/WARM/COLD + **rotación desde un solo número** | No |
| **VIDA AI** | 🇨🇴 **Medellín** | USD 129/mes | Sí — presupuesto, zona, urgencia | No |
| Inmobo / Chat Estelar | 🇨🇴 Bogotá | USD 175 + 5/agente | Sí. Clientes: RE/MAX, Century 21, KW, Engel & Völkers | No |
| YAVE | 🇨🇴 | $359.000 + $109.000 módulo IA | Sí, ejecuta acciones en el CRM | No (solo atribución) |
| **Yampi.ai** | 🇨🇴 | $399.000 – $1.999.000 COP | Sí + **recaudo de arriendos** + **integración Wasi** | No |
| Keybe / Biky | 🇨🇴 | USD 790 – 2.280 | Sí | **Gestiona, no genera** |
| Kommo | 🌎 | USD 15 por usuario/mes | Desde plan Advanced | No |
| Wasi (CRM base) | 🇨🇴 | USD 27 / 48 / ~85 | No | No |

**Terreno defendible:** ninguno de los 40+ productos auditados **genera el
creativo con IA y publica la campaña**. Eso es DMAP y es genuinamente único.

**Correcciones a datos que circulaban:** el plan de Kommo "con WhatsApp oficial a
USD 239/mes" **no existe** — sale del blog de un competidor; Kommo incluye API
oficial desde el plan Base a USD 15/usuario (mínimo 6 meses por adelantado).
Leadsales a USD 97 es real pero ese plan **no trae API oficial ni IA**; con
agente calificador cuesta USD 220. Zenvia Conversion (ex Sirena) **ya no existe**
como marca ni mantiene vertical inmobiliaria.

### SIMI — impacto directo sobre la apuesta de la V1
**SIMI hace recaudo y liquidación de arriendos completos, y hace décadas:**
recaudos automáticos, PSE, código de barras, causación, pre-extracto de giros,
pago a propietarios, giros por archivo plano a Bancolombia. Sigue evolucionando
en 2026. Varias inmobiliarias del Valle exponen su portal de propietarios e
inquilinos (`simidocs.siminmobiliarias.com/…?inmo={ID}&tipo=1|2`).

**Consecuencia:** `diamond-os-v1-alcance-comercial.md` eligió "recaudo +
liquidación" como la única capacidad nueva de la V1, sobre la hipótesis de que
ahí vive el dolor más crónico. **Ese espacio está ocupado por el incumbente
desde hace 30 años.** Hay que revisar esa decisión antes de escribir código.

---

## 6. Costos de WhatsApp (Meta) — con fecha crítica

Colombia, tarifa vigente: marketing **USD 0,0125** por mensaje · utility y
authentication **USD 0,0008**.

**Desde el 1 de octubre de 2026 Meta empieza a cobrar los mensajes de servicio**,
que hoy son gratis dentro de la ventana de 24 horas. La ventana gratuita de 72
horas del click-to-WhatsApp se mantiene — eso protege los leads que llegan por
anuncio; el costo sube para los orgánicos.

### El desbloqueo operativo: Embedded Signup
Meta permite que un **Tech Provider** integre un flujo donde el cliente conecta
su propio número sin intervención manual del proveedor, y **el cliente pone su
propio método de pago**. Límite inicial de 10 clientes nuevos cada 7 días, que
sube a **200 cada 7 días** tras verificación de empresa y App Review con acceso
avanzado a `whatsapp_business_management` y `whatsapp_business_messaging`.

**Esto es lo que hace viable vender a muchos clientes pequeños con un solo
desarrollador.** Sin esto, el modelo no escala.

---

## 7. Lo que quedó incompleto — sin maquillar

- **Evidencia de dolores: parcial.** Se planearon 30–60 testimonios; Google Maps
  pasó a "vista limitada" y el extractor con IA falló. Lo que hay: calificaciones
  agregadas de 8 empresas (los grandes administradores de arriendo están entre
  **3,2 y 3,7 estrellas con cientos de reseñas**) y 3 citas textuales
  verificadas. La columna `pts_dolor` de la base de prospectos está vacía y el
  score máximo alcanzable es 75, no 100.
- **Sin mystery shopping.** Es la señal más valiosa que falta: escribirle a 30
  inmobiliarias como comprador y cronometrar la respuesta. Requiere decisión
  previa porque implica contactar competidores de Diamond.
- **SIMI sin verificar** como fuente de búsqueda por URL.
- **Censo de independientes fuera de La Lonja:** en curso al cierre de este
  documento.
- **Segmento constructoras:** no investigado. Es donde sí hay presupuesto de
  pauta, y están en Camacol, no en La Lonja.

---

## 8. Bloqueantes técnicos del negocio

| # | Bloqueante | Evidencia | Estado |
|---|---|---|---|
| 1 | **No se puede facturar un segundo cliente** | CRM sin filtro por `org_id` (`kanban`, `leads`, `inbox`, `aliados`); RLS `using (true)`; rutas de Marketing confían el `orgId` del cliente; `crm/lib/marketing.ts:147` resuelve con `.limit(1)` | **Abierto — ahora es el cimiento** |
| 2 | Hardcodes de marca "Diamond" | Prompts de Sofi y de DMAP, guía legal, logo y color del CRM | Abierto |
| 3 | Verificación de empresa ante Meta | Pendiente para la propia Diamond | **Abierto — en ruta crítica** |
| 4 | Meta cobra mensajes de servicio | 1 de octubre de 2026 | Fecha conocida |

El bloqueante 1 cambió de gravedad con el giro de segmento: con 1 a 3 clientes
grandes se podía sortear aislando por despliegue separado; **con 40 clientes
pequeños es imposible.** Pasa de deuda postergable a prerrequisito.

---

## 9. Conclusión al cierre

**Muere:** el paquete completo a $1.600.000/mes vendido a inmobiliarias
establecidas del Valle de Aburrá. Dos clientes con perfil, siete competidores
más baratos —tres de ellos locales—, y un diferenciador que le habla al 7,3% del
mercado.

**Vive:** el segmento de **asesores independientes y pequeñas inmobiliarias**.
Tiene el hueco más grande medido (0 de 9 con automatización), disposición a pagar
ya probada (26 pagan Wasi hoy), decisión sin comité, y un universo oficial de
~1.015 micro y pequeñas empresas en Medellín además de los independientes no
afiliados.

**Lo que cambia con ese giro:**
- El precio baja de $1.600.000 a un rango de **$110.000–$250.000/mes** — que es
  lo que este segmento demuestra pagar hoy.
- La entrega tiene que ser **autoservicio**, no a medida. Diamond funcionó con
  meses de dedicación; eso no sobrevive a 20 clientes de $200.000.
- El aislamiento multi-tenant deja de ser postergable.
- **La pauta en Meta vuelve a tener sentido**: a un universo de cientos de
  independientes no enumerables, con producto de bajo ticket y autoservicio, sí
  se llega con publicidad. Al segmento anterior —239 empresas con teléfono y
  correo en mano— no.
- Es otra empresa: producto con embudo, churn y soporte, no consultoría. Con un
  desarrollador se puede hacer bien una de las dos.

---

## 10. Activos generados

Todo en `diamond-os/nivel-1-investigacion/`:

| Archivo | Qué es |
|---|---|
| `prospectos-inmobiliarias-valle-aburra.xlsx` | 239 empresas jurídicas, ordenadas por score, con hoja de metodología y limitaciones |
| `prospectos-inmobiliarias-valle-aburra.csv` | Lo mismo en CSV |
| `prospectos-por-valor.csv` | Re-rankeado por **valor entregado ÷ fricción de cierre** |
| `validacion-mercado-diamond-os.html` | Informe de validación con el veredicto original (segmento grande) |
| `manual-de-venta.md` | Precios por tier, guion de llamada, 6 objeciones con respuesta |
| `correos-en-frio.txt` | 25 correos personalizados con el dato medido de cada cuenta |
| `campana-meta-abm.md` | Especificación de campaña ABM, con la advertencia legal |
| `radiografias/` | 25 diagnósticos digitales individuales, listos para regalar |
| `INFORME-MAESTRO-…` | Este documento |

Diseño técnico derivado:
`docs/superpowers/specs/2026-07-26-busqueda-red-inmobiliarias-design.md` —
búsqueda en la red de 58 inmobiliarias Wasi. Validada con prueba de concepto:
**58 sitios en 11,5 segundos, 23 con resultados, 162 propiedades**.
Para un asesor independiente sin inventario propio, esta función deja de ser un
complemento y pasa a ser el producto: *"tu inventario es toda la ciudad"*.

---

## 11. Preguntas abiertas para el producto

1. ¿Qué incluye exactamente el plan de un independiente a $150.000–$250.000/mes,
   y qué se deja afuera para que el margen exista?
2. ¿El diferencial es la búsqueda en red (inventario prestado) o la atención 24/7?
   Los datos apuntan a la primera para quien no tiene inventario.
3. ¿Cómo se registra un cliente solo, de principio a fin, sin que Juan intervenga?
4. ¿Qué pasa con Diamond? Es el cliente ancla, paga 8 veces más que el nuevo
   segmento, y el producto autoservicio no es lo que compró.
5. ¿Se mantiene DMAP en la oferta? Es lo único sin competencia, pero le habla al
   segmento que menos pauta.
