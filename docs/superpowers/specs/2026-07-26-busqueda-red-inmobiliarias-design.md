# Búsqueda en la red de inmobiliarias — diseño

**Fecha:** 2026-07-26 · **Estado:** aprobado para implementar · **Alcance:** Fase 1 (Wasi)

## Problema

Cuando un cliente busca una propiedad que Diamond no tiene en su inventario ni
en la red de aliados (`ally_properties`), hoy el negocio se pierde. El asesor
puede buscar a mano en las webs de otras inmobiliarias, pero no lo hace: son
decenas de sitios y toma demasiado tiempo durante una conversación.

## Solución

Una herramienta interna que consulta en paralelo el catálogo público de las
inmobiliarias del Valle de Aburrá y le dice al asesor **quién tiene la
propiedad, con link a la ficha y el contacto de esa inmobiliaria**, para que él
gestione la comisión compartida.

### Por qué es viable sin scraping frágil

Las 58 inmobiliarias del Valle que corren Wasi exponen **el mismo endpoint de
búsqueda**: `GET /s` con parámetros `id_property_type`, `business_type[]`,
`bedrooms`, `bathrooms`, `min_price`, `max_price`, `match`. Es una consulta
estructurada, no una interpretación de HTML arbitrario.

**Validado el 26-jul-2026** con una prueba de concepto real sobre los 58 sitios:

```
Criterio: apartamento en arriendo, 2 habitaciones, hasta $3.000.000
11,5 segundos · 23 inmobiliarias con resultados · 162 propiedades · 6 errores
```

La URL de cada ficha codifica tipo, operación, barrio y municipio:
`giraldoposada.com/apartamento-arriendo-las-cometas-envigado/10139912`

## Decisiones tomadas

| Decisión | Valor | Por qué |
|---|---|---|
| Quién ve el resultado | **Solo el asesor** | Si el cliente ve quién tiene la propiedad, se va con esa inmobiliaria y Diamond pierde el negocio. Mismo criterio que ya rige la red de aliados. |
| Disparador | **Sofi-Comando, a pedido** | El canal ya existe. No toca el bot de cara al cliente: cero riesgo de que Sofi le diga a un lead algo desactualizado. |
| Persistencia | **Ninguna** | Cada búsqueda es efímera. No se almacena contenido de terceros. |
| Tenant | **Solo Diamond** | Decisión de Juan. El esquema no lo impide a futuro. |
| Plataformas en Fase 1 | **Solo Wasi** | Es lo único validado. |

## No-objetivos de la Fase 1

- No cubre sitios con catálogo renderizado por JavaScript (Grupo Santamaría,
  Acrecer). Requieren navegador — Fase 3.
- No cubre sitios propios con sitemap (El Dandy, Arrendamientos Envigado,
  COLTEBIENES) — Fase 2.
- No cubre SIMI: **no se verificó** si expone búsqueda por URL.
- No guarda resultados, no genera alertas, no contacta a nadie automáticamente.
- No se expone al cliente final por ningún camino.

## Arquitectura

Un módulo nuevo y un registro de herramienta. Nada más.

```
src/agent/sofi-comando-tools.js   (existente, +1 tool)
        │
        ▼
src/data/network-search.js        (NUEVO — orquestador)
        │
        ├── src/data/adapters/wasi.js   (NUEVO — construye la query, parsea fichas)
        │
        └── src/data/network.json       (NUEVO — los 58 sitios con su contacto)
```

### `src/data/network-search.js`

Interfaz única:

```js
async function search(criterio, opciones) -> {
  resultados: [{
    inmobiliaria, contacto_telefono, contacto_email,
    url, ref, tipo, operacion, zona, municipio
  }],
  consultados: Number,
  con_error: [{ inmobiliaria, motivo }]
}
```

- Consulta los sitios **en paralelo** (`Promise.allSettled`, concurrencia 16,
  timeout 20 s por sitio).
- Un sitio que falla **no rompe la búsqueda**: se acumula en `con_error`.
- Cada adaptador expone la misma firma `buscar(sitio, criterio) -> [ficha]`.
  Agregar SIMI o sitemaps más adelante es agregar un archivo, no tocar el
  orquestador.

### `src/data/adapters/wasi.js`

Dos funciones puras y una con red:

- `construirUrl(base, criterio)` — mapea el criterio al querystring de Wasi.
  Tabla de tipos observada: casa 1, apartamento 2, local 3, finca 4, lote 5,
  oficina 6, bodega 8. Operación: `for_rent` / `for_sale`.
- `parsearSlug(url)` — extrae `{tipo, operacion, zona, municipio, ref}` del path.
  Wasi usa tanto `arriendo` como `alquiler` para renta: ambos mapean a Arriendo.
- `buscar(sitio, criterio)` — hace el GET y devuelve las fichas parseadas.

### `config/network.json`

Generado a partir de la investigación de mercado
(`diamond-os/nivel-1-investigacion/prospectos-inmobiliarias-valle-aburra.csv`,
filtrando `crm_detectado` = Wasi). Por sitio: `nombre`, `base_url`, `telefono`,
`email`, `adaptador`. Es un archivo de datos versionado, no una tabla: cambia
poco y así queda auditable en git.

## Validación de resultados — obligatoria

**Hallazgo de la prueba de concepto:** algunos sitios aplican el filtro de forma
parcial. Lemont devolvió un `apartamento-venta-sabaneta` dentro de una búsqueda
de arriendo.

Por eso **cada ficha se revalida contra el criterio antes de devolverla**,
usando lo que trae el propio slug de la URL (tipo y operación). La validación es
local, gratis y determinista. Una ficha que no pasa se descarta en silencio.

No se revalida precio ni habitaciones: no están en la URL y abrir cada ficha
multiplicaría el costo. **Se le dice explícitamente al asesor** que confirme
precio y disponibilidad con la otra inmobiliaria.

## La herramienta

Se registra en `COMMAND_TOOL_DEFINITIONS` (`src/agent/sofi-comando-tools.js`),
siguiendo el patrón de `buscar_red_aliados` (línea 111):

```
name: "buscar_en_la_red"
```

Descripción para el modelo: busca en el catálogo público de otras inmobiliarias
del Valle de Aburrá. **Usar solo cuando el inventario propio y la red de aliados
no dieron resultado** — el orden lo impone el prompt, no el código.

`input_schema`: `zona`, `tipo`, `operacion` (enum Venta/Arriendo),
`precio_max`, `habitaciones`, `limite`.

**`limite` es el total de fichas devueltas al asesor, no por sitio** (default 10,
máximo 25 — más alto que el `MAX_RESULTADOS` de 10 del resto de herramientas,
porque acá el valor está en ver qué inmobiliarias tienen opciones). Se toman
como máximo 3 fichas por inmobiliaria antes de completar con el resto, para que
un solo sitio con mucho inventario no monopolice la respuesta.

**`zona` se pasa a Wasi en el parámetro `match`** (búsqueda por texto libre) y
además se usa para ordenar: las fichas cuyo slug contiene la zona pedida van
primero. Wasi no tiene un filtro de barrio estructurado.

El dispatch va en `executeCommandTool`, en un `case` nuevo. Devuelve texto
formateado con una advertencia fija al inicio:

> Estas propiedades son de OTRAS inmobiliarias y salen de su catálogo público.
> Confirmá disponibilidad, precio y condiciones con ellos antes de ofrecerlas.
> No compartas estos datos con el cliente hasta pactar la comisión.

Como el resto de las herramientas de Sofi-Comando, **el `scope` llega por fuera
del input del modelo**, nunca desde el input.

## Errores

| Caso | Comportamiento |
|---|---|
| Un sitio no responde o da timeout | Se omite; se cuenta en `con_error`; la búsqueda sigue |
| Ningún sitio devuelve resultados | Mensaje claro: "no encontré nada en la red con esos criterios" |
| Todos los sitios fallan | Se le dice al asesor que la red no está accesible, no "no hay resultados" |
| Un slug no parsea | Se descarta esa ficha, se registra en log, no rompe |

Sin reintentos en Fase 1: si un sitio está caído, está caído.

## Pruebas

`node --test`, como el resto del repo.

- **Puras, sin red (la mayoría):** `construirUrl` para cada combinación de
  criterio · `parsearSlug` contra un set de URLs reales capturadas · la
  revalidación de criterio, incluido el caso Lemont (venta dentro de búsqueda de
  arriendo → se descarta).
- **Orquestador con red simulada:** un sitio que falla no tumba la búsqueda ·
  todos fallan → mensaje distinto a "sin resultados" · se respeta el límite.
- **Fixtures:** HTML real guardado de 2–3 sitios Wasi. Sin red en los tests.

## Consideraciones legales y de trato

- Se consulta **catálogo público**, el mismo que ve cualquier persona que entre
  al sitio. No hay login, no hay elusión de protección.
- **No se almacena** contenido de terceros.
- Se identifica con un User-Agent honesto y se limita la concurrencia para no
  golpear los sitios.
- El resultado es para que el asesor **contacte a la otra inmobiliaria y pacte
  comisión compartida**, que es práctica normal del sector. No para saltársela.
- Nota comercial: existe la **Red Inmobiliaria MLS** de La Lonja (4.500+
  inmuebles, 50+ inmobiliarias) que resuelve esto con comisión ya pactada.
  Requiere afiliación a La Lonja; Diamond no es afiliado. Vale la pena evaluarlo
  en paralelo — no es excluyente.

## Fases siguientes (fuera de este diseño)

- **Fase 2 — adaptador de sitemap.** Suma las inmobiliarias con más inventario
  del Valle (El Dandy 5.001 fichas, Arrendamientos Envigado 1.543, COLTEBIENES
  586). Validado que funciona en 2 de 3; El Dandy no lleva la operación en el
  slug y requeriría abrir la ficha.
- **Fase 3 — adaptador de navegador.** Playwright para catálogos renderizados
  por JS. Es el único caso donde un agente con navegador se justifica.
- **Fase 4 — enriquecer una ficha puntual.** Que el asesor pida el detalle de un
  resultado y un agente abra esa ficha y extraiga precio, área y fotos.
- **Persistencia y alertas.** Descartadas explícitamente en Fase 1.
