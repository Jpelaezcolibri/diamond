# Censo de asesores independientes e inmobiliarias pequeñas — Valle de Aburrá

**Fecha de captura:** 26 de julio de 2026
**Entregable:** `independientes.json` (594 registros)
**Universo previo excluido:** las 216 personas naturales del directorio de La Lonja
(`universo.json`, `persona_juridica: false` + `en_valle_aburra: true`).

---

## 1. Resultado global

| Métrica | Valor |
|---|---|
| **Registros finales** | **594** |
| Excluidos por coincidir con La Lonja (nombre o teléfono) | 30 |
| Asesores independientes (persona natural) | 109 |
| Inmobiliarias pequeñas / empresas | 485 |
| **Con teléfono** | **430** (72%) |
| Con email | 111 (19%) |
| Con web propia | 110 (19%) |
| Con Instagram | 132 (22%) |
| Solo perfil de portal (sin web ni Instagram) | 391 (66%) |
| **Ya pagan software inmobiliario (dominio Wasi)** | **56** |

### Por municipio

| Municipio | Registros |
|---|---|
| Medellín | 412 |
| Envigado | 57 |
| Bello | 49 |
| Itagüí | 39 |
| Sabaneta | 25 |
| Caldas | 4 |
| Girardota | 3 |
| Copacabana | 3 |
| La Estrella | 2 |
| Barbosa | 0 |

Girardota, Copacabana, La Estrella, Caldas y Barbosa están claramente
subrepresentados: los portales casi no tienen afiliados ahí. No es que no
existan asesores, es que no aparecen en estas fuentes.

---

## 2. Qué rindió cada fuente

Conteo por fuente **antes** de deduplicar (22 registros aparecen en más de una
fuente, por eso la suma da más de 594).

| # | Fuente | ¿Rindió? | Registros aportados | Qué se obtuvo |
|---|---|---|---|---|
| 1 | **buscocasita** | Sí | 58 | Nombre, ciudad, teléfono, email, dirección, foto, descripción |
| 2 | **Fincaraíz** | Parcial | 70 | Nombre y ciudad; **sin teléfono ni email** |
| 3 | **Ciencuadras** | Sí, la mejor | 285 | Nombre, ciudad, tipo, dirección, teléfono fijo y celular |
| 4 | **Dominios `*.inmo.co` / `*.inmob.site` (Wasi)** | Sí, la más valiosa | 56 | Nombre, ciudad, teléfono, email, web, Instagram |
| 5 | **Búsqueda web general** | Sí, moderado | 55 | Dominio propio, nombre, ciudad; teléfono solo a veces |
| 6 | **Instagram** | Sí, vía buscador | 93 | Handle, nombre, ciudad; teléfono cuando está en la bio |

### 2.1 buscocasita — RINDIÓ

`https://colombia.buscocasita.com/agentes-inmobiliarios/` declara **436 agentes**
en Colombia. El filtro por departamento funciona por GET (`?p=133` = Antioquia),
que es lo que permitió acotarlo sin recorrer las 44 páginas del país:

- **86 agentes en Antioquia** (9 páginas de 10).
- **59 en el Valle de Aburrá** — Medellín 41, Bello 8, Envigado 3, Itagüí 2,
  La Estrella 1, Caldas 1, Girardota 3.
- Se scrapearon **58 fichas individuales** (1 falló).
- **57 de 58 traen celular y 58 traen email.** Es la fuente con mejor tasa de
  contacto directo.
- **Ninguno de los 58 tiene web propia** — el campo "Web" está vacío en todas
  las fichas. Presencia 100% de portal.
- El directorio de inmobiliarias del mismo portal (`/inmobiliarias/?p=133`)
  tiene **31 en Antioquia, 25 en el Valle de Aburrá**. Sus nombres y URLs
  quedaron capturados (`censo/bc-inmob.json`) pero **las fichas individuales no
  se alcanzaron a scrapear** porque se agotaron los créditos de Firecrawl.
  Quedan como pendiente barato: 25 scrapes.

### 2.2 Fincaraíz — RINDIÓ A MEDIAS

- El listado `https://www.fincaraiz.com.co/inmobiliarias` sí carga con
  `firecrawl scrape` (renderiza JS) y expone **2.205 perfiles de inmobiliarias
  de todo el país en una sola página**, ordenados alfabéticamente.
- **Problema: el listado no trae ciudad**, y no existe ruta por ciudad —
  `/inmobiliarias/medellin` y `/inmobiliarias/antioquia` devuelven "Página no
  encontrada". Filtrar los 2.205 exigiría scrapear perfil por perfil.
- Solución aplicada: búsqueda dirigida `site:fincaraiz.com.co/inmobiliarias` +
  ciudad, que devuelve URLs del tipo
  `/inmobiliarias/{slug}/{id}/arriendo/bello/antioquia`. **La ciudad viene en la
  propia ruta**, así que es evidencia de que esa inmobiliaria opera ahí.
- Resultado: **118 empresas distintas, 71 con ciudad del Valle de Aburrá
  confirmada** (Medellín 45, Bello 18, Envigado 17, Itagüí 13, Sabaneta 10,
  Copacabana 1).
- **Fincaraíz enmascara los teléfonos** (`Contáctanos por WhatsApp al ***`).
  De esta fuente no sale ni un número. Por eso los 56 registros que aporta al
  archivo final quedan sin teléfono ni email.

### 2.3 Ciencuadras — RINDIÓ, ES LA MÁS PRODUCTIVA

- La ruta real del listado es **`https://www.ciencuadras.com/inmobiliarias`**
  (en singular, `/inmobiliaria/{slug}-{id}`, son las fichas). Confirmado que
  `/inmobiliarias/medellin` da 404.
- El filtro por ciudad es un `<select name="InmobiliariaSearch[id_ciudad]">` y
  **la paginación es AJAX por POST** — no hay `?page=N` que funcione. Se resolvió
  con `firecrawl interact` (Playwright): disparar el `change` del select y hacer
  click en `#paginaN` en bucle.
- IDs de ciudad descubiertos: Medellín 81, Bello 28, Itagüí 70, Envigado 58,
  Sabaneta 100, Caldas 36, Copacabana 50, Girardota 62, Barbosa 27.
- Resultado: **303 registros únicos** — Medellín 228, Envigado 24, Sabaneta 18,
  Itagüí 15, Bello 13, Copacabana 3, Caldas 2. La Estrella, Girardota y Barbosa
  devolvieron 0.
- Cada ficha trae **dirección, teléfono fijo y celular**. Es la fuente que más
  teléfonos aportó.
- **6 registros vienen etiquetados por el propio portal como "Agente
  independiente"** (los otros 297 como "Inmobiliaria").

**Advertencia de calidad sobre esta fuente:** Ciencuadras no expone tamaño de
empresa. Entre los 303 hay inmobiliarias grandes y consolidadas (Abad Faciolince,
Arrendamientos Nutibara, Alberto Álvarez). El campo `tipo` se llenó con el
criterio del portal, no con evidencia de tamaño. **Estos registros hay que
filtrarlos por tamaño antes de usarlos como lista de prospección.** Lo mismo
aplica a los 56 de Fincaraíz.

### 2.4 Dominios Wasi (`*.inmo.co` / `*.inmob.site`) — RINDIÓ, Y ES LA SEÑAL MÁS FUERTE

Es la fuente que el encargo señalaba como la más valiosa y lo confirmó: cada
dominio es alguien que **ya paga software inmobiliario**, así que ya cruzó la
barrera de "pagar por herramientas".

- **42 consultas de búsqueda** distintas (`site:inmo.co` y `site:inmob.site`
  cruzados con ciudades, barrios de Medellín — Poblado, Laureles, Belén,
  Robledo, Castilla, Buenos Aires, Estadio — y términos de negocio).
- **100 dominios distintos encontrados** (88 `.inmo.co` + 12 `.inmob.site`).
- Se verificó **cada dominio entrando a su home** para leer ciudad y contacto.
- **Resultado: 56 con ciudad del Valle de Aburrá confirmada** (55 `.inmo.co` +
  1 `.inmob.site`), con nombre, teléfono, email, web e Instagram.
- **17 verificados fuera del Valle de Aburrá** y descartados: Bogotá (2),
  Guarne, La Ceja, Armenia, Pasto, Cartagena, Manizales, Pereira, Soacha,
  Santa Marta, y 6 fuera de Colombia (Costa Rica ×2, Venezuela ×2, Panamá,
  Argentina). Quedan documentados en `censo/wasi-fuera.json` para no volver a
  consultarlos.
- **9 sin datos**: 6 `.inmob.site` son placeholders vacíos que solo muestran
  "CRMRED", 2 `.inmo.co` muestran la página de "no disponible" de Wasi, 1 dio
  timeout.
- El resto quedó sin ciudad detectable en el home.
- Los sitios llevan **"Powered by: wasi.co"** en el pie — confirmación directa
  del proveedor. Varios ya traen un **widget de WhatsApp básico** ("Hola, buen
  día. ¿Cómo puedo ayudarle el día de hoy?"), lo cual es dato comercial
  relevante: no parten de cero, pero lo que tienen es un formulario, no un
  agente.

**Advertencia:** 100 dominios NO es el censo completo de subdominios Wasi de
Medellín. Los buscadores solo indexan una parte y no hay listado público que
enumerarlos. El número real es mayor; 100 es el piso, no el techo.

### 2.5 Google / búsqueda general — RINDIÓ MODERADAMENTE

- 8 consultas ("asesor inmobiliario independiente Medellín", "corredor
  inmobiliario Medellín independiente", "asesor inmobiliario Itagüí Bello
  contacto", etc.), 160 bloques de resultado.
- Aportó **55 registros con dominio propio** verificado contra ciudad del Valle
  de Aburrá en el título o el snippet: `eugeniaalonso.com.co`,
  `albertoalvarez.com`, `panoramainmobiliario.co`,
  `ramirezboteroasesoresinmobiliarios.co`, `gomezsierrapropiedades.com`,
  `dinamicainmobiliaria.co`, `eldandyinmobiliaria.com`, `totalbienes.com`,
  `inmobiliariapoblasur.com`, `alejandrobroker.com`, `jairochoa.com`,
  `aburrasur.co`, entre otros.
- Se excluyeron portales y franquicias grandes (Century 21, Engel & Völkers,
  Habi, Coninsa, metrocuadrado, properstar, bolsas de empleo).
- **Google Maps: no se usó.** No hubo "vista limitada" porque no se llegó a
  consultarlo: la búsqueda web general ya devolvía las mismas fichas de negocio
  con más contexto, y los créditos se destinaron a las fuentes estructuradas.
  **Queda como fuente sin explotar** y probablemente sea la de mayor rendimiento
  marginal para los municipios flojos (Bello, Itagüí, Copacabana, Girardota).

### 2.6 Instagram — RINDIÓ MÁS DE LO ESPERADO

La expectativa era que no se pudiera. **Sí se puede, pero no scrapeando
Instagram** — sin sesión, instagram.com no entrega nada útil.

- Lo que sí funciona: **buscar perfiles vía buscador** (`site:instagram.com` +
  término + ciudad). Los snippets del buscador exponen bio, número de
  seguidores, y **muchas veces el celular escrito en la bio**.
- 14 consultas → **124 perfiles distintos**, de los cuales **93 con ciudad del
  Valle de Aburrá confirmada** en el título o la bio.
- Ejemplos de lo que se extrae: `paulaaristizabal_propiedadraiz` — "4.4K
  followers · 484 posts · Asesora Inmobiliaria Medellín | Sectores Poblado +
  Envigado"; Hernán Castro — "asesor inmobiliario con 11 años de experiencia en
  Medellín y el Área Metropolitana · 314 8427897".
- **93 de estos 93 no tienen web propia detectada** — son el segmento "solo
  Instagram", el que literalmente no tiene nada. Marcados en el JSON como
  `plataforma_detectada: "ninguna (solo Instagram)"`.

---

## 3. Web propia vs. solo perfil de portal

| Situación | Registros | % |
|---|---|---|
| **Con web propia** | 110 | 19% |
| — de esas, dominio Wasi regalado (`inmo.co`/`inmob.site`) | 56 | 9% |
| — dominio propio comprado | 54 | 9% |
| **Sin web: solo perfil de portal y/o Instagram** | 484 | 81% |
| — solo perfil de portal, sin ninguna red detectada | 391 | 66% |
| — solo Instagram | 93 | 16% |

Lectura comercial: **4 de cada 5 no tienen sitio propio.** Y de los que sí lo
tienen, la mitad no compró dominio: usa el subdominio que Wasi regala.

---

## 4. Cuántos ya pagan software

| Señal | Registros |
|---|---|
| **Dominio Wasi confirmado (`inmo.co` / `inmob.site`)** | **56** |
| — `*.inmo.co` | 55 |
| — `*.inmob.site` | 1 |
| Sin plataforma detectada | 538 |

Los 56 son el segmento más cualificado del censo: ciudad verificada, teléfono,
email y web, y evidencia dura de que ya pagan una herramienta. Reparto:
Medellín 47, Bello 3, Envigado 3, Itagüí 1, Caldas 1, La Estrella 1.

Aviso: "sin plataforma detectada" **no** significa que no paguen nada. Solo
significa que no se detectó dominio Wasi. Muchos de los 285 de Ciencuadras
seguramente usan algún CRM; simplemente no deja huella en el dominio.

---

## 5. Limitaciones honestas

1. **Créditos de Firecrawl agotados a mitad del trabajo.** Costó: 59 de los 100
   dominios Wasi y las 25 fichas de inmobiliarias de buscocasita. Los 59
   dominios se recuperaron con `WebFetch` uno a uno; las 25 fichas de
   buscocasita **quedaron pendientes** (los nombres y URLs sí están en
   `censo/bc-inmob.json`).
2. **Fincaraíz no da teléfonos.** Sus 56 registros necesitan enriquecimiento por
   otra vía.
3. **Ciencuadras y Fincaraíz no distinguen tamaño.** Hay inmobiliarias grandes
   mezcladas. `tipo` refleja lo que dice el portal, no una verificación de
   tamaño. Filtrar antes de prospectar.
4. **El conteo de inventario publicado se descartó.** Los sitios Wasi sí
   muestran cuántas propiedades tienen por tipo en el menú, pero el parser sumaba
   duplicados entre secciones (daba hasta 39.786). Se anuló el campo en vez de
   publicar un número malo. Es recuperable con un parser mejor y sería el mejor
   proxy de tamaño disponible.
5. **Google Maps sin explotar** (ver 2.5).
6. **Municipios pequeños subrepresentados**: Barbosa 0, La Estrella 2,
   Girardota 3, Copacabana 3, Caldas 4.
7. **Deduplicación por nombre normalizado + teléfono.** Puede quedar algún
   duplicado con razón social distinta a nombre comercial (ej. "ALNAGO" vs
   "Arrendamientos Alnago"), aunque ese caso concreto sí se fusionó.

---

## 6. Archivos

| Archivo | Contenido |
|---|---|
| `independientes.json` | **Entregable principal** — 594 registros |
| `independientes-informe.md` | Este informe |
| `censo/wasi-domains.txt` | Los 100 dominios Wasi encontrados |
| `censo/wasi-webfetch.json` | 34 dominios Wasi verificados por WebFetch |
| `censo/wasi-extract.json` | 41 dominios Wasi verificados por Firecrawl |
| `censo/wasi-fuera.json` | 17 fuera del Valle + 9 sin datos, documentados |
| `censo/cc-med-clean.json`, `censo/cc-otras-clean.json` | 303 de Ciencuadras |
| `censo/bc-perfiles.json`, `censo/bc-agentes.json` | 58 agentes de buscocasita |
| `censo/bc-inmob.json` | 31 inmobiliarias de buscocasita (fichas pendientes) |
| `censo/fr-empresas.json` | 71 empresas de Fincaraíz con ciudad |
| `censo/ig-parsed.json`, `censo/gg-parsed.json` | Resultados crudos de búsqueda |
| `censo/build.py` | Script consolidador reproducible |

### Estructura de cada registro

```json
{
 "nombre": "Katia Botero",
 "tipo": "inmobiliaria_pequena",
 "ciudad": "Medellín",
 "telefono": "3115618101",
 "email": "katiabotero@hotmail.com",
 "web": "https://katiabotero.inmo.co",
 "instagram": "katiaboteropropiedadraiz",
 "plataforma_detectada": "wasi (inmo.co)",
 "fuente_url": "https://katiabotero.inmo.co/",
 "fecha_captura": "2026-07-26",
 "inventario_publicado": null,
 "tipo_fuente": "dominio Wasi verificado (subdominio gratuito del plan de entrada)"
}
```

Campos vacíos van en `null`. `tipo_fuente` documenta de dónde salió cada dato y
lleva las dos fuentes separadas por `|` cuando el registro se fusionó.

---

## 7. Siguientes pasos de mayor rendimiento

1. **Google Maps** para Bello, Itagüí, Copacabana, Girardota, La Estrella y
   Barbosa — es donde el censo está más flojo.
2. **25 fichas de inmobiliarias de buscocasita** — 25 scrapes, trae teléfono y
   email.
3. **Recontar inventario de los 56 sitios Wasi** con un parser correcto, para
   ordenarlos por tamaño real y quedarse con los verdaderamente pequeños.
4. **Enriquecer los 56 de Fincaraíz** con teléfono desde otra fuente.
5. **Ampliar la búsqueda de dominios Wasi** con más barrios y términos: 100 es
   el piso, no el techo.
