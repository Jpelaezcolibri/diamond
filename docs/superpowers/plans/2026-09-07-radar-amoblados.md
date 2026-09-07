# Carril de amoblados del radar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el radar entienda "amoblado", no ofrezca un vacío a quien lo pidió amoblado (ni al revés), y saque las demandas de arriendo por dos carriles: DM al colega si calza fino, aviso diferenciado a Natalia si no.

**Architecture:** Un módulo hoja puro (`amoblado.js`) deriva si una propiedad es amoblada desde el título — Wasi no expone el campo. `classify.js` extrae dos campos nuevos del pedido. `evaluarCandidata` es el único punto que ve el pedido **y** la propiedad, así que ahí van las compuertas y ahí se estampan las marcas que después lee `publicable.js`. Un módulo de carril (`carril-arriendo.js`) concentra el interruptor y el umbral, y sus guardas se llaman desde las cuatro puertas de salida.

**Tech Stack:** Node 22, CommonJS, `node:test` + `node:assert`. Sin dependencias nuevas.

## Global Constraints

- **Idioma:** código y nombres en inglés; comentarios, prompts y textos de usuario en español (Colombia). Los comentarios explican **por qué**, con el caso real que los motivó — es el estilo de todo `src/groups/`.
- **Sin acentos ni ñ en los comentarios de código** (convención vigente del repo); sí en los textos que lee una persona.
- **Tests:** `node --test test/<archivo>.test.js` para uno solo; `npm test` corre todos.
- **`null` no es `false`.** En `amoblado`, `null` significa "no sabemos" y decide el carril de salida. Nunca colapsarlos con `||`.
- **Compuertas duras que NO se tocan:** estrato, banda de precio, zona, alcobas hacia abajo.
- **Ningún cambio de prompt se fija con `includes("frase")`.** Ver Task 8.
- **Commits en español** con prefijo convencional (`feat:`, `fix:`, `docs:`), terminando con:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```
- **Nada de esto se despliega solo:** `git push origin main` publica a Railway y a los dos Vercel. El push va al final, con Juan enterado.

---

### Task 1: El módulo hoja `amoblado.js`

Deriva si una propiedad está amoblada. Es puro y sin I/O a propósito: lo consume `match.js`, que corre por cada candidata de cada pedido.

**Files:**
- Create: `src/groups/amoblado.js`
- Test: `test/amoblado.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `esAmoblada(propiedad) -> true | false | null`, donde `propiedad` es una fila de `properties` (usa `titulo` y `caracteristicas`).

- [ ] **Step 1: Write the failing test**

Crear `test/amoblado.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { esAmoblada } = require("../src/groups/amoblado");

// Las dos fichas REALES del inventario de produccion (verificadas por REST el
// 2026-09-07). Importan porque prueban el hallazgo que motivo este modulo:
// Wasi pone "Amoblado" en el TITULO y no en las caracteristicas. La ficha de
// la 10319436 trae 43 caracteristicas ("Sauna", "Turco", "Piscina"...) y
// ninguna dice amoblado.
test("la marca vive en el titulo, no en las caracteristicas", () => {
  const don_quijote = {
    titulo: "Apartamento Amoblado en Arriendo en Don Quijote, Medellín",
    caracteristicas: "Admite mascotas, Agua, Armarios empotrados, Ascensor, Cocina integral",
  };
  assert.strictEqual(esAmoblada(don_quijote), true);
});

test("una propiedad de venta cualquiera es null, NO false", () => {
  // La diferencia decide el carril: `false` descarta la candidata ante un
  // pedido de amoblado; `null` la deja pasar marcada sin_confirmar y el
  // pedido llega igual a la asesora. Colapsarlos pierde pedidos en silencio.
  const venta = {
    titulo: "Apartamento en Venta en Los Colores, Medellín - 2 Alcobas",
    caracteristicas: "Balcón, Ascensor",
  };
  assert.strictEqual(esAmoblada(venta), null);
});

test("'sin amoblar' es false, y gana sobre el patron positivo", () => {
  // El orden importa: "no amoblado" contiene "amoblad". Si el patron positivo
  // se evalua primero, una propiedad explicitamente vacia se ofrece como
  // amoblada — el error exacto que este modulo existe para no cometer.
  assert.strictEqual(esAmoblada({ titulo: "Apartamento sin amoblar en Envigado" }), false);
  assert.strictEqual(esAmoblada({ titulo: "Apto NO amoblado, Sabaneta" }), false);
});

test("tambien lee las caracteristicas, por si Wasi empieza a marcarlo", () => {
  assert.strictEqual(esAmoblada({ titulo: "Apto en Laureles", caracteristicas: "Amoblado, Balcón" }), true);
});

test("sin datos es null, nunca revienta", () => {
  assert.strictEqual(esAmoblada(null), null);
  assert.strictEqual(esAmoblada({}), null);
  assert.strictEqual(esAmoblada({ titulo: "", caracteristicas: null }), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/amoblado.test.js`
Expected: FAIL — `Cannot find module '../src/groups/amoblado'`

- [ ] **Step 3: Write minimal implementation**

Crear `src/groups/amoblado.js`:

```js
// Si una propiedad esta amoblada, derivado del texto que SI tenemos.
//
// POR QUE DERIVADO Y NO UNA COLUMNA (2026-09-07): Wasi no expone el dato.
// Verificado contra las dos propiedades de arriendo de produccion: sus
// `caracteristicas` traen 24 y 43 items ("Admite mascotas", "Ascensor",
// "Sauna"...) y NINGUNA dice amoblado. La palabra vive solo en el titulo:
// "Apartamento Amoblado en Arriendo en Don Quijote, Medellin".
//
// Una columna seria igual de inferida, pero ademas obligaria a tocar DMAP,
// correr una migracion y hacer backfill: tres pasos para el mismo grado de
// certeza. El dia que Wasi lo exponga de verdad, esta funcion lee el campo y
// nadie mas se entera.
//
// Modulo hoja a proposito: lo llama match.js por cada candidata de cada
// pedido, asi que no puede tener I/O ni dependencias.

// "amoblad" cubre amoblado/amoblada/amoblados; "amueblad", la variante que
// usan algunos colegas. No se incluye "amoblar" (infinitivo): aparece casi
// siempre dentro de "sin amoblar", que es lo contrario.
const PATRON_SI = /amoblad|amueblad/i;
const PATRON_NO = /sin\s+amoblar|sin\s+amueblar|sin\s+muebles|no\s+amoblad/i;

/**
 * @returns true  si el texto dice que esta amoblada
 *          false si dice explicitamente que NO
 *          null  si no se puede saber
 *
 * `null` NO es `false`: ante un pedido de amoblado, `false` descarta la
 * candidata y `null` la deja pasar marcada `amoblado_sin_confirmar`, que es
 * lo que hace que el pedido llegue igual a la asesora. Colapsarlos pierde
 * pedidos sin que nada falle ruidosamente.
 */
function esAmoblada(propiedad) {
  if (!propiedad) return null;
  const texto = [propiedad.titulo, propiedad.caracteristicas].filter(Boolean).join(" ");
  if (!texto.trim()) return null;
  // El negativo se evalua PRIMERO: "no amoblado" contiene "amoblad" y el
  // patron positivo lo daria por bueno.
  if (PATRON_NO.test(texto)) return false;
  if (PATRON_SI.test(texto)) return true;
  return null;
}

module.exports = { esAmoblada, PATRON_SI, PATRON_NO };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/amoblado.test.js`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/groups/amoblado.js test/amoblado.test.js
git commit -m "feat(radar): esAmoblada lee el titulo, que es donde Wasi lo dice

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: El pedido — `amoblado` y `periodo` en la clasificación

**Files:**
- Modify: `src/groups/classify.js` (bloque `ESQUEMA`, lista `required`, prompt `SISTEMA`)
- Modify: `src/groups/lexico.js` (arrays `ATRIBUTOS` y `OPERACIONES`)
- Test: `test/classify-amoblado.test.js` (crear)

**Interfaces:**
- Consumes: nada.
- Produces: cada objeto clasificado gana `amoblado: "si"|"no"|""` y `periodo: "mes"|"corta"|""`. Los consume `match.js` (Task 4) como `c.amoblado` y `c.periodo`.

- [ ] **Step 1: Write the failing test**

Crear `test/classify-amoblado.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { ESQUEMA } = require("../src/groups/classify");

const props = ESQUEMA.properties.mensajes.items.properties;
const required = ESQUEMA.properties.mensajes.items.required;

test("el esquema extrae amoblado como TRI-ESTADO, no booleano", () => {
  // Un booleano no distingue "no lo pidio" de "lo rechazo", y son conductas
  // opuestas. Caso real en la base: "*3 alcobas mas servicio* $9.000.000
  // *SIN muebles*" — ante "" la amoblada es elegible, ante "no" se descarta.
  assert.deepStrictEqual(props.amoblado.enum, ["si", "no", ""]);
  assert.ok(required.includes("amoblado"), "amoblado tiene que ser required");
});

test("el esquema extrae el periodo del arriendo", () => {
  // "$4.500.000 por 15 dias" calza perfecto contra nuestro amoblado mensual
  // y le ofreceriamos un mes por el precio de quince dias.
  assert.deepStrictEqual(props.periodo.enum, ["mes", "corta", ""]);
  assert.ok(required.includes("periodo"), "periodo tiene que ser required");
});

test("los campos opcionales siguen sin ser nullables", () => {
  // Misma regla que el resto del esquema: el string vacio significa "no
  // especificado", asi que match.js no necesita comprobaciones de null.
  assert.strictEqual(props.amoblado.type, "string");
  assert.strictEqual(props.periodo.type, "string");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/classify-amoblado.test.js`
Expected: FAIL — `Cannot read properties of undefined (reading 'enum')`, y además `ESQUEMA` no está exportado.

- [ ] **Step 3: Write minimal implementation**

En `src/groups/classify.js`, dentro de `ESQUEMA.properties.mensajes.items.properties`, agregar justo después de `edificio`:

```js
          // AMOBLADO, TRI-ESTADO (2026-09-07). Un booleano no puede expresar
          // la diferencia entre "no lo menciono" y "lo rechazo", y son
          // conductas opuestas: ante "" una propiedad amoblada es elegible,
          // ante "no" queda descartada. El caso que lo motivo esta en la base:
          // "*Busco CASA para arriendo en el Poblado* 3 alcobas mas servicio
          // $9.000.000 *SIN muebles*" — hoy eso cruza contra nuestro amoblado
          // de Los Gonzales sin que nada lo frene.
          amoblado: {
            type: "string",
            enum: ["si", "no", ""],
            description:
              "'si' si el pedido pide amoblado/amueblado. 'no' si lo rechaza explicitamente ('SIN muebles', 'sin amoblar', 'vacio', 'no amoblado'). '' si no lo menciona.",
          },
          // PERIODO (2026-09-07). El peligro NO es el que parece: un pedido de
          // "$300.000 por noche" ya lo bloquea la banda de precio sola. El que
          // si pasa hoy es el inverso: "$4.500.000 por 15 dias" extrae
          // precio_max 4.500.000, calza perfecto contra nuestro amoblado
          // mensual, y le ofrecemos un mes por el precio de quince dias.
          periodo: {
            type: "string",
            enum: ["mes", "corta", ""],
            description:
              "'corta' si el arriendo es por noches, dias, semanas o una estadia de pocos dias. 'mes' si es mensual o de largo plazo. '' si no se puede saber.",
          },
```

En la lista `required` del mismo bloque, agregar `"amoblado", "periodo"` al final:

```js
        required: [
          "id", "clase", "confianza", "operacion", "tipo", "zonas", "zona", "zonas_excluidas", "ciudad",
          "precio_min", "precio_max", "habitaciones", "area_min", "banos",
          "garajes", "estrato", "contacto", "notas", "flexible_habitaciones", "edificio",
          "amoblado", "periodo",
        ],
```

En el prompt `SISTEMA`, agregar estas dos viñetas justo antes de la última (`- Un mensaje de una sola propiedad con foto y ficha es oferta aunque no diga "vendo".`):

```
- \`amoblado\`: 'si' cuando el pedido pide amoblado o amueblado ("busco amoblado en Sabaneta", "apartamento amoblado en el poblado"). 'no' cuando lo RECHAZA explícitamente — "SIN muebles", "sin amoblar", "vacío", "no amoblado". '' si no lo menciona. Los tres valores son distintos y no se pueden mezclar: '' significa que al colega le da igual, 'no' significa que no lo quiere.
- \`periodo\`: 'corta' si el arriendo es por noches, días, semanas o una estadía de pocos días ("por 15 días", "3 noches", "renta corta", "airbnb"). 'mes' si es mensual o de largo plazo. '' si no se puede saber. Ojo: un precio alto no implica mensual — "$4.500.000 por 15 días" es 'corta' con precio_max 4500000.
```

Exportar `ESQUEMA` — en `module.exports` de `classify.js`, agregarlo a la lista:

```js
module.exports = {
  classify, armarLotes, formatearLote, costoDe, esReintentable, ESQUEMA,
  MODELO, TAMANO_LOTE, CONCURRENCIA, REINTENTOS,
};
```

En `src/groups/lexico.js`, agregar a `ATRIBUTOS` (después de `"sin amoblar"`):

```js
  "amoblados", "amueblado", "sin muebles", "renta corta", "coliving", "airbnb", "temporal",
```

y a `OPERACIONES` (después de `"arrendamiento"`):

```js
  "renta", "rentar", "alquiler", "alquilar",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/classify-amoblado.test.js`
Expected: PASS — 3 tests

Y verificar que el prefiltro puro no se rompió con las palabras nuevas:

Run: `node --test test/prefilter-puro.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/groups/classify.js src/groups/lexico.js test/classify-amoblado.test.js
git commit -m "feat(radar): el clasificador extrae amoblado (tri-estado) y periodo

amoblado es tri-estado y no booleano porque hay un pedido real en la base que
dice 'SIN muebles': un booleano no distingue 'no lo pidio' de 'lo rechazo'.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Guardar los dos campos en `group_signals`

Sin esto el dato se extrae, se usa y no se guarda — el mismo hueco que se cerró el 2026-08-24 con `area_min`/`banos`/`garajes` y el 2026-09-02 con `zonas`.

**Files:**
- Create: `db/migrations/2026-09-07_amoblado.sql`
- Modify: `src/data/group-signals.js` (`COLUMNAS_NUEVAS`, objeto `fila`)
- Test: `test/group-signals-amoblado.test.js` (crear)

**Interfaces:**
- Consumes: los campos `amoblado` / `periodo` que produce Task 2.
- Produces: las columnas `group_signals.amoblado` y `group_signals.periodo`.

- [ ] **Step 1: Write the failing test**

Crear `test/group-signals-amoblado.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { COLUMNAS_NUEVAS } = require("../src/data/group-signals");

test("las columnas nuevas entran en la lista de reintento", () => {
  // Si el insert falla porque la migracion no corrio, group-signals reintenta
  // SIN estas columnas. Fuera de la lista, una senal se perderia entera en vez
  // de guardarse sin el dato nuevo — y una senal guardada a medias vale mucho
  // mas que una senal perdida.
  assert.ok(COLUMNAS_NUEVAS.includes("amoblado"));
  assert.ok(COLUMNAS_NUEVAS.includes("periodo"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/group-signals-amoblado.test.js`
Expected: FAIL — `COLUMNAS_NUEVAS` no está exportado (`Cannot read properties of undefined`).

- [ ] **Step 3: Write minimal implementation**

Crear `db/migrations/2026-09-07_amoblado.sql`:

```sql
-- Lo que el pedido dice sobre muebles y sobre el plazo del arriendo.
--
-- POR QUE (2026-09-07): el radar llevaba 155 demandas de arriendo capturadas y
-- CERO respondidas. "Amoblado" no existia para el motor -- Wasi solo lo pone en
-- el titulo de la propiedad, no en las caracteristicas -- asi que el cruce no
-- podia fallar de una sola manera sino de dos opuestas: ofrecer un vacio a
-- quien pidio amoblado, u ofrecer un amoblado a quien lo rechazo. El segundo
-- caso ya estaba en la base: "*Busco CASA para arriendo en el Poblado* 3
-- alcobas mas servicio $9.000.000 *SIN muebles*".
--
-- `amoblado` es TEXTO y no boolean a proposito: los tres valores ('si','no','')
-- son distintos. Un booleano no distingue "no lo pidio" de "lo rechazo".
--
-- `periodo` cubre el caso que hoy pasa sin que nada lo frene: "$4.500.000 por
-- 15 dias" calza perfecto contra un amoblado mensual del mismo precio.
--
-- Sin correr esta migracion el bot sigue funcionando: el insert de
-- src/data/group-signals.js reintenta sacando la columna que falte y avisa una
-- vez en el log. El CRM lee con select("*"), asi que tampoco se rompe.

alter table group_signals add column if not exists amoblado text;
alter table group_signals add column if not exists periodo text;

comment on column group_signals.amoblado is
  'Que dice el pedido sobre muebles: si | no | "" (no lo menciona). Texto y no boolean: "no lo pidio" y "lo rechazo" son distintos.';
comment on column group_signals.periodo is
  'Plazo del arriendo pedido: mes | corta | "" . "corta" = por noches, dias o semanas.';
```

En `src/data/group-signals.js`, agregar a `COLUMNAS_NUEVAS`:

```js
const COLUMNAS_NUEVAS = [
  "origen", "fecha_mensaje", "advisor_id",
  "area_min", "banos", "garajes", "estrato", "flexible_habitaciones",
  // 2026-09-07_amoblado.sql
  "amoblado", "periodo",
];
```

En el objeto `fila`, después de `flexible_habitaciones`:

```js
    // Texto, no booleano: "" (no lo menciona) y "no" (lo rechaza) son
    // distintos, y `|| null` los colapsaria a los dos en null.
    amoblado: fields.amoblado ?? null,
    periodo: fields.periodo ?? null,
```

Exportar `COLUMNAS_NUEVAS` desde `src/data/group-signals.js` agregándolo al `module.exports` existente.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/group-signals-amoblado.test.js`
Expected: PASS — 1 test

- [ ] **Step 5: Correr la migración en producción**

```bash
psql "$SUPABASE_DB_URL" -f db/migrations/2026-09-07_amoblado.sql
```

Si no hay `psql`, pegar el SQL en el editor de Supabase. **Verificar por REST antes de darla por corrida** — la lista del CLAUDE.md estuvo desactualizada dos semanas por no hacer esto:

```bash
curl -s "$SUPABASE_URL/rest/v1/group_signals?select=amoblado,periodo&limit=1" \
  -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"
```
Expected: `[{"amoblado":null,"periodo":null}]` — no un error `42703`.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/2026-09-07_amoblado.sql src/data/group-signals.js test/group-signals-amoblado.test.js
git commit -m "feat(db): group_signals guarda amoblado y periodo del pedido

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: La compuerta en `evaluarCandidata`

Va acá porque es la **única** función que ve el pedido y la propiedad a la vez. `publicable.esPublicable(match)` recibe sólo el match, así que las marcas se estampan acá para que él las pueda leer.

**Files:**
- Modify: `src/groups/match.js` (`evaluarCandidata`, y el objeto que devuelve)
- Test: `test/group-match-amoblado.test.js` (crear)

**Interfaces:**
- Consumes: `esAmoblada` de Task 1; `c.amoblado` y `c.periodo` de Task 2.
- Produces: cada match gana tres campos — `amoblado: true|false|null`, `amoblado_sin_confirmar: boolean`, `periodo_no_soportado: boolean`. Los lee `publicable.js` (Task 5) y `carril-arriendo.js` (Task 6).

- [ ] **Step 1: Write the failing test**

Crear `test/group-match-amoblado.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { evaluarCandidata } = require("../src/groups/match");

// Base que pasa todas las compuertas que YA existen, para que cada test de
// abajo aisle una sola variable: la de amoblado.
const pedido = {
  operacion: "arriendo", tipo: "apartamento", zona: "El Poblado", zonas: ["El Poblado"],
  zonas_excluidas: [], ciudad: "", precio_max: 8000000, precio_min: 0,
  habitaciones: 2, area_min: 0, banos: 0, garajes: 0, estrato: 0,
  amoblado: "", periodo: "",
};

const amoblada = {
  ref: "10319436", titulo: "Apartamento Amoblado en Arriendo en El Poblado - Los Gonzáles",
  tipo: "Apartamento", operacion: "Arriendo", precio: "$7.900.000", area: "90m2",
  habitaciones: 3, zona: "Los Gonzáles", ciudad: "Medellín", caracteristicas: "Balcón, Ascensor",
};

const vacia = {
  ref: "99999", titulo: "Apartamento sin amoblar en El Poblado",
  tipo: "Apartamento", operacion: "Arriendo", precio: "$7.900.000", area: "90m2",
  habitaciones: 3, zona: "Los Gonzáles", ciudad: "Medellín", caracteristicas: "",
};

const desconocida = {
  ref: "88888", titulo: "Apartamento en El Poblado - Los Gonzáles",
  tipo: "Apartamento", operacion: "Arriendo", precio: "$7.900.000", area: "90m2",
  habitaciones: 3, zona: "Los Gonzáles", ciudad: "Medellín", caracteristicas: "Balcón",
};

test("pide amoblado + ES amoblada -> pasa, suma y lo dice", () => {
  const m = evaluarCandidata(amoblada, { ...pedido, amoblado: "si" }, "diamond");
  assert.ok(m, "tiene que pasar la compuerta");
  assert.strictEqual(m.amoblado, true);
  assert.strictEqual(m.amoblado_sin_confirmar, false);
  assert.ok(m.razones.includes("amoblada"), `razones: ${m.razones.join("; ")}`);
});

test("pide amoblado + NO amoblada -> descarta", () => {
  assert.strictEqual(evaluarCandidata(vacia, { ...pedido, amoblado: "si" }, "diamond"), null);
});

test("pide amoblado + no sabemos -> pasa marcada sin confirmar", () => {
  // No se descarta: el pedido tiene que llegar igual a la asesora. Lo que
  // impide que salga sola es la marca, no la compuerta.
  const m = evaluarCandidata(desconocida, { ...pedido, amoblado: "si" }, "diamond");
  assert.ok(m, "no se descarta, se marca");
  assert.strictEqual(m.amoblado, null);
  assert.strictEqual(m.amoblado_sin_confirmar, true);
});

test("BUG: pide SIN muebles + ES amoblada -> descarta", () => {
  // Caso real en produccion (2026-09-07): "*Busco CASA para arriendo en el
  // Poblado* 3 alcobas mas servicio $9.000.000 *SIN muebles*". Antes de esto,
  // ese pedido cruzaba contra nuestro amoblado de Los Gonzales sin freno.
  assert.strictEqual(evaluarCandidata(amoblada, { ...pedido, amoblado: "no" }, "diamond"), null);
});

test("no lo menciona -> neutro, ni suma ni descarta", () => {
  const m = evaluarCandidata(amoblada, pedido, "diamond");
  assert.ok(m);
  assert.strictEqual(m.amoblado_sin_confirmar, false);
  assert.ok(!m.razones.includes("amoblada"), "no se declara lo que no se pidio");
});

test("BUG: '$4.500.000 por 15 dias' se marca como periodo no soportado", () => {
  // El precio calza perfecto contra un amoblado mensual del mismo valor y le
  // ofreceriamos un mes por el precio de quince dias.
  const m = evaluarCandidata(amoblada, { ...pedido, periodo: "corta" }, "diamond");
  assert.ok(m, "sigue siendo un match, la compuerta esta en publicable");
  assert.strictEqual(m.periodo_no_soportado, true);
});

test("periodo mensual o sin dato no marca nada", () => {
  assert.strictEqual(evaluarCandidata(amoblada, { ...pedido, periodo: "mes" }, "diamond").periodo_no_soportado, false);
  assert.strictEqual(evaluarCandidata(amoblada, pedido, "diamond").periodo_no_soportado, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/group-match-amoblado.test.js`
Expected: FAIL — `Expected values to be strictly equal: undefined !== true` (los campos no existen todavía).

- [ ] **Step 3: Write minimal implementation**

En `src/groups/match.js`, junto a los otros `require` de la parte de arriba:

```js
const { esAmoblada } = require("./amoblado");
```

Dentro de `evaluarCandidata`, justo después de la compuerta de tipo
(`if (c.tipo && !String(p.tipo || "")...) return null;`) y **antes** de
`ubicacionCoincide`:

```js
  // ── Amoblado: compuerta en las DOS direcciones ──────────────────────────
  //
  // Wasi no expone el dato (ver src/groups/amoblado.js), asi que la certeza es
  // asimetrica y por eso son tres estados y no dos:
  //   · true  -> lo sabemos, se declara en positivo y suma.
  //   · false -> lo sabemos y NO cumple: descarta, en cualquiera de los dos
  //              sentidos. El pedido "SIN muebles" es real y esta en la base.
  //   · null  -> no lo sabemos: NO descarta. El pedido tiene que llegar igual
  //              a la asesora; lo que impide que salga solo es la marca
  //              `amoblado_sin_confirmar`, que lee publicable.js.
  const amoblada = esAmoblada(p);
  const pideAmoblado = String(c.amoblado || "").trim().toLowerCase();
  if (pideAmoblado === "si" && amoblada === false) return null;
  if (pideAmoblado === "no" && amoblada === true) return null;
```

Después de la línea `let castigos = 0;`, agregar la bonificación:

```js
  // 8 puntos, en linea con el area (8) y por debajo de las alcobas (10): es un
  // requisito verificado del pedido, no el que define el producto.
  if (pideAmoblado === "si" && amoblada === true) {
    puntaje += 8;
    razones.push("amoblada");
  }
```

En el objeto que devuelve `evaluarCandidata`, después de `caracteristicas`:

```js
    // Las tres marcas que lee publicable.js (2026-09-07). Se estampan ACA
    // porque esta es la unica funcion que ve el pedido Y la propiedad:
    // `esPublicable(match)` recibe solo el match y no tiene forma de saber
    // que pidio el colega.
    amoblado: amoblada,
    amoblado_sin_confirmar: pideAmoblado === "si" && amoblada === null,
    // El plazo es del PEDIDO, no de la propiedad — viaja en el match por la
    // misma razon que el de arriba: es el unico camino hasta publicable.js.
    periodo_no_soportado: String(c.periodo || "").trim().toLowerCase() === "corta",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/group-match-amoblado.test.js`
Expected: PASS — 7 tests

Y que no se rompió nada del motor que ya andaba:

Run: `node --test test/group-match.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/groups/match.js test/group-match-amoblado.test.js
git commit -m "feat(radar): el cruce entiende amoblado en las dos direcciones

Un pedido que dice 'SIN muebles' ya no cruza contra nuestro amoblado. Lo que
no podemos confirmar no se descarta: se marca, y la marca decide el carril.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Los dos motivos nuevos en `publicable.js`

`publicable.filtrar` es el único punto por el que pasan los cuatro caminos de salida (`asistir`, `aprobarManual`, `responderPorDmManual` y el DM manual). Una compuerta que cubre una puerta de cuatro no es una compuerta.

**Files:**
- Modify: `src/groups/publicable.js` (`esPublicable`, `MOTIVOS_LEGIBLES`)
- Test: `test/publicable-amoblado.test.js` (crear)

**Interfaces:**
- Consumes: `amoblado_sin_confirmar` y `periodo_no_soportado` de Task 4.
- Produces: los motivos `"amoblado_sin_confirmar"` y `"periodo_no_soportado"` en el array `motivos` de `esPublicable`, y sus traducciones en `explicarMotivos`.

- [ ] **Step 1: Write the failing test**

Crear `test/publicable-amoblado.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { esPublicable, explicarMotivos, MOTIVOS_LEGIBLES } = require("../src/groups/publicable");

// Match que pasa TODO lo que ya existia, para aislar la variable nueva.
const base = {
  fuente: "diamond", ref: "10319436", titulo: "Apartamento Amoblado en Arriendo en El Poblado",
  precio: "$7.900.000", operacion: "Arriendo", zona: "Los Gonzáles", area: "90m2",
  link: "https://diamondinmobiliaria.com/propiedades/apto-10319436",
  linkWasi: "https://info.wasi.co/apartamento-alquiler-los-gonzales-medellin/10319436",
  puntaje: 90, ubicacion: "exacta",
  amoblado: true, amoblado_sin_confirmar: false, periodo_no_soportado: false,
};

test("el match base sigue siendo publicable", () => {
  assert.deepStrictEqual(esPublicable(base), { ok: true, motivos: [] });
});

test("amoblado sin confirmar no es publicable", () => {
  const r = esPublicable({ ...base, amoblado: null, amoblado_sin_confirmar: true });
  assert.strictEqual(r.ok, false);
  assert.ok(r.motivos.includes("amoblado_sin_confirmar"), `motivos: ${r.motivos}`);
});

test("un pedido por dias o semanas no es publicable", () => {
  const r = esPublicable({ ...base, periodo_no_soportado: true });
  assert.strictEqual(r.ok, false);
  assert.ok(r.motivos.includes("periodo_no_soportado"), `motivos: ${r.motivos}`);
});

test("los dos motivos se traducen al castellano", () => {
  // Lección del 2026-09-06: un motivo que no se traduce es un motivo que quien
  // lo lea va a reemplazar por una explicacion inventada. Sofi le dijo a Juan
  // que el colega "no tiene telefono registrado" cuando la razon real era
  // ref_bloqueada.
  for (const m of ["amoblado_sin_confirmar", "periodo_no_soportado"]) {
    assert.ok(MOTIVOS_LEGIBLES[m], `falta la traduccion de ${m}`);
    assert.ok(!explicarMotivos([m]).includes(m), `${m} salio crudo hacia una persona`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/publicable-amoblado.test.js`
Expected: FAIL — el test "amoblado sin confirmar no es publicable" falla con `r.ok === true`.

- [ ] **Step 3: Write minimal implementation**

En `src/groups/publicable.js`, dentro de `esPublicable`, después del bloque de `zona_no_publicable` y antes de `puntaje_bajo`:

```js
  // AMOBLADO SIN CONFIRMAR (2026-09-07). Wasi solo dice "Amoblado" en el
  // titulo, asi que hay propiedades de las que no lo sabemos. Cuando el colega
  // lo pidio explicitamente, eso NO puede salir solo: ofrecerle un vacio a
  // quien pidio amoblado es el mismo tipo de dato no verificable que frena
  // `edificio_especifico` en politica.js.
  //
  // No se pierde el pedido: la senal llega igual al aviso de la asesora, con
  // este motivo traducido. Es la talla explicita a la regla D7 (lo no
  // registrado se ofrece con sin_confirmar) y vive ACA, en codigo, y no como
  // una frase opuesta dentro del prompt de revalidar.js -- que es como se
  // construyo la contradiccion que encontro la auditoria del 2026-09-05.
  if (match.amoblado_sin_confirmar) motivos.push("amoblado_sin_confirmar");

  // PLAZO NO SOPORTADO (2026-09-07). Nuestro inventario esta cotizado por mes.
  // "$4.500.000 por 15 dias" calza perfecto contra un amoblado mensual del
  // mismo precio, y le ofreceriamos un mes por el precio de quince dias.
  if (match.periodo_no_soportado) motivos.push("periodo_no_soportado");
```

En `MOTIVOS_LEGIBLES`, agregar las dos entradas:

```js
  amoblado_sin_confirmar: "el colega pidió amoblado y no tenemos confirmado que ésta lo esté: Wasi sólo lo dice en el título y esta ficha no lo trae",
  periodo_no_soportado: "el pedido es por días o semanas y nuestro inventario está cotizado por mes",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/publicable-amoblado.test.js`
Expected: PASS — 4 tests

Run: `node --test test/publicable.test.js`
Expected: PASS (si ese archivo existe; si no, saltear)

- [ ] **Step 5: Commit**

```bash
git add src/groups/publicable.js test/publicable-amoblado.test.js
git commit -m "feat(radar): amoblado sin confirmar y plazo corto frenan la salida sola

Los dos motivos van con su traduccion al castellano: un motivo que no se
traduce, quien lo lea lo reemplaza por una explicacion inventada (2026-09-06).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: El módulo del carril y su interruptor

Aplica la regla que Juan fijó el 2026-09-05 tras los 1.906 avisos: la guardia va **dentro del módulo del carril**, cubre **todas** las puertas, y **no admite excepciones razonadas adentro**.

**Files:**
- Create: `src/groups/carril-arriendo.js`
- Modify: `src/groups/vivo.js` (4 puertas: `procesarMensaje`, `asistir`, `aprobarManual`, `responderPorDmManual`)
- Test: `test/carril-arriendo.test.js` (crear)

**Interfaces:**
- Consumes: `puntaje` y `amoblado_sin_confirmar` de los matches (Task 4).
- Produces:
  - `esDelCarril(clasificado) -> boolean`
  - `carrilActivo() -> boolean`
  - `umbralDm() -> number`
  - `puedeSalirSolo(matches) -> boolean`

- [ ] **Step 1: Write the failing test**

Crear `test/carril-arriendo.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const carril = require("../src/groups/carril-arriendo");

test("el carril es toda demanda de arriendo, no solo la que dice amoblado", () => {
  // Nuestro inventario de arriendo es 100% amoblado (las dos propiedades que
  // hay), asi que un pedido de arriendo que no menciona muebles igual va a
  // cruzar contra un amoblado y merece el mismo tratamiento.
  assert.strictEqual(carril.esDelCarril({ operacion: "arriendo" }), true);
  assert.strictEqual(carril.esDelCarril({ operacion: "Arriendo" }), true);
  assert.strictEqual(carril.esDelCarril({ operacion: "venta" }), false, "venta no se toca");
  assert.strictEqual(carril.esDelCarril({}), false);
  assert.strictEqual(carril.esDelCarril(null), false);
});

test("solo sale solo el que calza fino", () => {
  const alto = { puntaje: 90, amoblado_sin_confirmar: false };
  const bajo = { puntaje: 79, amoblado_sin_confirmar: false };
  assert.strictEqual(carril.puedeSalirSolo([alto]), true);
  assert.strictEqual(carril.puedeSalirSolo([bajo]), false, "79 esta debajo de 85");
  assert.strictEqual(carril.puedeSalirSolo([bajo, alto]), true, "basta una que calce");
  assert.strictEqual(carril.puedeSalirSolo([]), false);
});

test("un puntaje alto NO alcanza si no confirmamos que es amoblada", () => {
  const sinConfirmar = { puntaje: 95, amoblado_sin_confirmar: true };
  assert.strictEqual(carril.puedeSalirSolo([sinConfirmar]), false);
});

test("el umbral y el interruptor se leen en cada llamada, no al cargar", () => {
  // Si se leyeran al cargar el modulo, moverlos exigiria redesplegar — y el
  // interruptor tiene que poder apagarse ya.
  const antesUmbral = process.env.RADAR_AMOBLADO_UMBRAL_DM;
  const antesActivo = process.env.RADAR_AMOBLADO_ACTIVO;
  try {
    assert.strictEqual(carril.umbralDm(), 85, "el default es 85");
    assert.strictEqual(carril.carrilActivo(), true, "prendido por defecto");

    process.env.RADAR_AMOBLADO_UMBRAL_DM = "70";
    assert.strictEqual(carril.umbralDm(), 70);

    process.env.RADAR_AMOBLADO_ACTIVO = "false";
    assert.strictEqual(carril.carrilActivo(), false);
  } finally {
    if (antesUmbral === undefined) delete process.env.RADAR_AMOBLADO_UMBRAL_DM;
    else process.env.RADAR_AMOBLADO_UMBRAL_DM = antesUmbral;
    if (antesActivo === undefined) delete process.env.RADAR_AMOBLADO_ACTIVO;
    else process.env.RADAR_AMOBLADO_ACTIVO = antesActivo;
  }
});

test("apagado, ninguna demanda de arriendo puede salir sola", () => {
  // La guardia vive en el modulo del carril y no en quien lo llama: si cada
  // puerta la implementara por su cuenta, apagar el carril dejaria alguna
  // hablando — que es exactamente lo que paso con `mandatos_activos`.
  const antes = process.env.RADAR_AMOBLADO_ACTIVO;
  try {
    process.env.RADAR_AMOBLADO_ACTIVO = "false";
    assert.strictEqual(carril.puedeSalirSolo([{ puntaje: 100, amoblado_sin_confirmar: false }]), false);
  } finally {
    if (antes === undefined) delete process.env.RADAR_AMOBLADO_ACTIVO;
    else process.env.RADAR_AMOBLADO_ACTIVO = antes;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/carril-arriendo.test.js`
Expected: FAIL — `Cannot find module '../src/groups/carril-arriendo'`

- [ ] **Step 3: Write minimal implementation**

Crear `src/groups/carril-arriendo.js`:

```js
// El carril de arriendo/amoblados: su interruptor y su umbral.
//
// POR QUE UN MODULO Y NO UN IF EN CADA PUERTA (Juan, 2026-09-05, despues de
// los 1.906 avisos a una sola asesora): la guardia va DENTRO del modulo del
// carril, no en quien lo llama, porque casi siempre hay mas de una puerta.
// Aca son cuatro: la escucha en vivo (asistir), la aprobacion manual, el DM
// manual y el camino que publica en el grupo. Si cada una implementara la
// regla por su cuenta, apagar el carril dejaria alguna hablando — que es
// exactamente lo que paso con `mandatos_activos`.
//
// Y no admite excepciones razonadas adentro. Una excepcion bien argumentada
// dentro de un kill switch es un kill switch roto, por bien escrita que este
// en el comentario.

// El default de 85 es lo que Juan llamo "muy cerca de lo que pide" (2026-09-07)
// -- por encima del umbral general de 70 de publicable.js, porque el
// inventario de arriendo es de dos propiedades y una respuesta floja se paga
// con la reputacion de la linea, no con una comision.
const UMBRAL_DEFAULT = 85;

// Se leen en cada llamada y no al cargar el modulo: el interruptor tiene que
// poder apagarse desde Railway sin redesplegar, y un `const` arriba obligaria
// a reiniciar el proceso para que tome efecto.
function carrilActivo() {
  return process.env.RADAR_AMOBLADO_ACTIVO !== "false";
}

function umbralDm() {
  return Number(process.env.RADAR_AMOBLADO_UMBRAL_DM || UMBRAL_DEFAULT);
}

// TODA demanda de arriendo, no solo la que dice la palabra amoblado: nuestro
// inventario de arriendo es 100% amoblado, asi que un pedido que no menciona
// muebles igual cruza contra un amoblado. Las demandas de venta no se tocan.
function esDelCarril(clasificado) {
  return String(clasificado?.operacion || "").trim().toLowerCase() === "arriendo";
}

/**
 * Si alguna de las candidatas calza lo bastante fino como para que el DM salga
 * sin que lo mire una persona.
 *
 * `matches` son las que YA pasaron publicable.filtrar. Se exige puntaje y
 * ademas que no quede la duda del amoblado: un 95 sobre una propiedad de la
 * que no sabemos si tiene muebles no es un 95 para este carril.
 */
function puedeSalirSolo(matches) {
  if (!carrilActivo()) return false;
  const umbral = umbralDm();
  return (matches || []).some((m) => Number(m.puntaje) >= umbral && !m.amoblado_sin_confirmar);
}

module.exports = { esDelCarril, carrilActivo, umbralDm, puedeSalirSolo, UMBRAL_DEFAULT };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/carril-arriendo.test.js`
Expected: PASS — 5 tests

- [ ] **Step 5: Cablear las cuatro puertas**

En `src/groups/vivo.js`, agregar el `require` arriba con los demás:

```js
const carrilArriendo = require("./carril-arriendo");
```

**Puerta 1 — el camino que publica en el grupo.** En `procesarMensaje`, justo después del bloque `if (modo === "asistido") { return asistir(...); }`:

```js
  // NADA AL GRUPO, POR CODIGO (Juan, 2026-09-07: "nada a grupos, solo
  // respuestas al dm"). Hoy este camino esta inactivo —la org esta en
  // 'asistido' y ningun grupo tiene responde=true— y la guarda existe
  // justamente para que siga siendo cierto el dia que alguna de esas dos
  // cosas cambie por error.
  if (carrilArriendo.esDelCarril(c)) {
    return { resultado: "carril_sin_publicacion_en_grupo", signalId: signal.id };
  }
```

**Puerta 2 — el DM automático.** En `asistir`, reemplazar la condición del envío:

```js
  if (decisionDm.enviarDm && sesion && utiles.length > 0) {
```

por:

```js
  // El carril de arriendo exige ademas que alguna candidata calce fino
  // (RADAR_AMOBLADO_UMBRAL_DM). Si no, el pedido NO se pierde: cae al aviso
  // diferenciado a la asesora, mas abajo en esta misma funcion.
  const salidaSolaOk = !carrilArriendo.esDelCarril(c) || carrilArriendo.puedeSalirSolo(utiles);
  if (decisionDm.enviarDm && sesion && utiles.length > 0 && salidaSolaOk) {
```

**Puertas 3 y 4 — los caminos manuales.** En `aprobarManual`, después de la comprobación `if (grupo.modo === "ignorar")`:

```js
  // El interruptor del carril SI aplica a la aprobacion manual: apagar un
  // carril es dejar de recibir, no distinguir poblaciones. El umbral NO
  // aplica — la persona que aprueba reemplaza al puntaje, igual que el
  // `umbral: 0` de mas abajo.
  if (carrilArriendo.esDelCarril(signal) && !carrilArriendo.carrilActivo()) {
    return { resultado: "carril_apagado" };
  }
```

En `responderPorDmManual`, la misma guarda, después de que obtiene la señal:

```js
  if (carrilArriendo.esDelCarril(signal) && !carrilArriendo.carrilActivo()) {
    return { resultado: "carril_apagado" };
  }
```

- [ ] **Step 6: Probar las puertas manuales con datos que SÍ calzan**

La regla del 2026-09-05 es explícita: *"el test tiene que ejercitar el camino
con datos que SÍ calzan; el test existente stubeaba los leads a lista vacía,
así que la función salía por un `return` temprano y el carril apagado nunca se
probó de verdad"*. Por eso cada test va con su **control positivo**: se corre
el mismo caso con el carril prendido y se verifica que NO devuelve
`carril_apagado`, lo cual prueba que los datos llegan hasta la guarda.

Agregar a `test/carril-arriendo.test.js`:

```js
const groupSignals = require("../src/data/group-signals");
const whatsappGroups = require("../src/data/whatsapp-groups");
const vivo = require("../src/groups/vivo");

// Una demanda de arriendo real, no respondida, con un match que pasaria todo:
// si la funcion saliera antes por falta de datos, el test seria una mentira.
function señalDeArriendo() {
  return {
    id: "sig-1", clase: "demanda", operacion: "arriendo", respondida_at: null,
    group_id: "g-1", autor_nombre: "Gustavo Arango",
    matches: [{
      fuente: "diamond", ref: "10319436", puntaje: 95,
      titulo: "Apartamento Amoblado en Arriendo en El Poblado - Los Gonzáles",
      zona: "Los Gonzáles", precio: "$7.900.000", area: "90m2", operacion: "Arriendo",
      ubicacion: "exacta", amoblado: true, amoblado_sin_confirmar: false,
      periodo_no_soportado: false,
      link: "https://diamondinmobiliaria.com/propiedades/apto-10319436",
      linkWasi: "https://info.wasi.co/apartamento-alquiler-los-gonzales-medellin/10319436",
    }],
  };
}

function conCarril(valor, fn) {
  const antes = process.env.RADAR_AMOBLADO_ACTIVO;
  process.env.RADAR_AMOBLADO_ACTIVO = valor;
  return Promise.resolve(fn()).finally(() => {
    if (antes === undefined) delete process.env.RADAR_AMOBLADO_ACTIVO;
    else process.env.RADAR_AMOBLADO_ACTIVO = antes;
  });
}

test("puerta 3: aprobar a mano no manda nada con el carril apagado", async (t) => {
  t.mock.method(groupSignals, "obtenerPorId", async () => señalDeArriendo());
  t.mock.method(whatsappGroups, "obtenerGrupo", async () => ({ id: "g-1", modo: "sombra", jid: "1@g.us" }));

  const apagado = await conCarril("false", () => vivo.aprobarManual({ id: "org-1" }, "sig-1"));
  assert.strictEqual(apagado.resultado, "carril_apagado");

  // CONTROL POSITIVO: con el carril prendido, los MISMOS datos pasan la
  // guarda y la funcion sigue adelante (fallara mas alla, por sesion o por
  // inventario, y eso esta bien: lo que se prueba es que no freno ACA).
  const prendido = await conCarril("true", () => vivo.aprobarManual({ id: "org-1" }, "sig-1"));
  assert.notStrictEqual(prendido.resultado, "carril_apagado", "los datos no llegaban a la guarda");
});

test("puerta 4: el DM manual tampoco sale con el carril apagado", async (t) => {
  t.mock.method(groupSignals, "obtenerPorId", async () => señalDeArriendo());
  t.mock.method(whatsappGroups, "obtenerGrupo", async () => ({ id: "g-1", modo: "sombra", jid: "1@g.us" }));

  const apagado = await conCarril("false", () => vivo.responderPorDmManual({ id: "org-1" }, "sig-1"));
  assert.strictEqual(apagado.resultado, "carril_apagado");

  const prendido = await conCarril("true", () => vivo.responderPorDmManual({ id: "org-1" }, "sig-1"));
  assert.notStrictEqual(prendido.resultado, "carril_apagado", "los datos no llegaban a la guarda");
});

test("una demanda de VENTA nunca ve el carril, ni apagado", async (t) => {
  t.mock.method(groupSignals, "obtenerPorId", async () => ({ ...señalDeArriendo(), operacion: "venta" }));
  t.mock.method(whatsappGroups, "obtenerGrupo", async () => ({ id: "g-1", modo: "sombra", jid: "1@g.us" }));

  const r = await conCarril("false", () => vivo.aprobarManual({ id: "org-1" }, "sig-1"));
  assert.notStrictEqual(r.resultado, "carril_apagado", "venta no se toca");
});
```

Run: `node --test test/carril-arriendo.test.js`
Expected: PASS — 8 tests

**Sobre las puertas 1 y 2.** No llevan test propio acá y es una decisión, no
un olvido: ejercitarlas de punta a punta exige simular WAHA, Claude y Supabase
a la vez. Lo que las protege es estructural — la regla **no está duplicada en
cuatro lugares**, es una sola función (`puedeSalirSolo`, que empieza con
`if (!carrilActivo()) return false`) llamada desde las cuatro, y el test del
Step 1 prueba que esa función falla cerrado. El riesgo que la regla de Juan
ataca —que una puerta implemente la lógica por su cuenta y quede hablando— está
eliminado por construcción, no por confianza. La verificación de punta a punta
la da el Step 5 de Task 9, en producción.

- [ ] **Step 7: Verificar que no se rompió el radar que ya andaba**

Run: `npm test`
Expected: PASS — toda la suite. Prestar atención a `test/aprobar-pedido-radar.test.js` y a los `test/radar-*.test.js`.

- [ ] **Step 8: Commit**

```bash
git add src/groups/carril-arriendo.js src/groups/vivo.js test/carril-arriendo.test.js
git commit -m "feat(radar): carril de arriendo con interruptor y umbral propio

La guardia vive dentro del modulo del carril y cubre las cuatro puertas
(grupo, DM automatico, aprobacion manual, DM manual). Regla de Juan del
2026-09-05: un interruptor no admite excepciones razonadas adentro.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: El aviso diferenciado a Natalia

**Files:**
- Modify: `src/groups/alerta-asesor.js` (`construir`)
- Modify: `src/groups/vivo.js` (la llamada a `alertaAsesor.construir` dentro de `asistir`)
- Test: `test/alerta-amoblados.test.js` (crear)

**Interfaces:**
- Consumes: `esDelCarril` de Task 6.
- Produces: `construir(senal, veredicto, matches, telefonoColega, org, motivoDm, { link, carrilAmoblados })` — la opción nueva es `carrilAmoblados: boolean`, default `false`.

- [ ] **Step 1: Write the failing test**

Crear `test/alerta-amoblados.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construir } = require("../src/groups/alerta-asesor");

const senal = {
  autor_nombre: "Gustavo Arango", grupo: "PEDIDOS INMOBILIARIOS",
  texto_original: "Buscamos apartamento Amoblado en el poblado, 2 habitaciones, hasta $8.000.000",
  operacion: "arriendo", tipo: "apartamento", zona: "El Poblado", precio_max: 8000000,
  habitaciones: 2, amoblado: "si",
};
const matches = [{
  fuente: "diamond", ref: "10319436", titulo: "Apartamento Amoblado en Arriendo en El Poblado - Los Gonzáles",
  zona: "Los Gonzáles", precio: "$7.900.000", operacion: "Arriendo", area: "90m2",
  habitaciones: 3, puntaje: 79, ubicacion: "exacta", amoblado: true,
  razones: ["misma zona", "$7,9M dentro de $8M", "3 alcobas", "amoblada"],
}];
const veredicto = { refs_utiles: ["10319436"], refs_dudosas: [], sin_confirmar: [], le_falta: [] };

test("el aviso de amoblados se distingue de un vistazo", () => {
  // Juan, 2026-09-07: "se envia a natalia con un mensaje diferenciado que sepa
  // que es de amoblados". Natalia recibe avisos de venta todo el dia; si este
  // se lee igual, no lo va a tratar distinto.
  const texto = construir(senal, veredicto, matches, null, null, null, { carrilAmoblados: true });
  assert.ok(texto, "tiene que producir un aviso");
  assert.ok(texto.includes("AMOBLADOS"), `no se distingue:\n${texto}`);
});

test("un aviso de venta no lleva el encabezado de amoblados", () => {
  const venta = { ...senal, operacion: "venta", amoblado: "" };
  const texto = construir(venta, veredicto, matches, null, null, null, {});
  assert.ok(texto);
  assert.ok(!texto.includes("AMOBLADOS"), `un aviso de venta no se marca:\n${texto}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/alerta-amoblados.test.js`
Expected: FAIL — el primer test falla porque el texto no contiene `"AMOBLADOS"`.

- [ ] **Step 3: Write minimal implementation**

En `src/groups/alerta-asesor.js`, cambiar la firma de `construir` (línea 241):

```js
function construir(senal, veredicto, matches, telefonoColega = null, org = null, motivoDm = null, { link = null, carrilAmoblados = false } = {}) {
```

El encabezado entra en `armar`, que es la función que une todos los bloques.
Va ahí y no en el `return` para que lo cuente el clamp de 4096 caracteres de
Meta y para que valga igual en la versión compacta. Reemplazar:

```js
  const armar = (compacto) =>
    [...cabecera, ...bloqueUtiles(compacto), ...bloqueDudosas, ...bloqueApartadas, ...sofiDice, ...bloqueReenviar, ...bloqueSofi, ...cierre].join("\n");
```

por:

```js
  // ENCABEZADO DEL CARRIL (Juan, 2026-09-07): "un mensaje diferenciado que
  // sepa que es de amoblados". Natalia recibe avisos de venta todo el dia; sin
  // esto, uno de arriendo se lee igual que los demas y se trata igual.
  //
  // Va DENTRO de armar y no pegado al return para que lo cuente el clamp de
  // 4096 caracteres de Meta, y para que salga igual en la version compacta.
  const encabezado = carrilAmoblados ? ["🛋️ *AMOBLADOS* — pedido que no salió solo", ``] : [];

  const armar = (compacto) =>
    [...encabezado, ...cabecera, ...bloqueUtiles(compacto), ...bloqueDudosas, ...bloqueApartadas, ...sofiDice, ...bloqueReenviar, ...bloqueSofi, ...cierre].join("\n");
```

En `src/groups/vivo.js`, dentro de `asistir`, en la llamada a `alertaAsesor.construir`, pasar la opción:

```js
  const texto = alertaAsesor.construir(
    senalParaAviso(c, mensaje, grupo),
    veredicto,
    matches,
    telefonoColega,
    org,
    decisionDm.motivo,
    { link: linkAviso, carrilAmoblados: carrilArriendo.esDelCarril(c) }
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/alerta-amoblados.test.js`
Expected: PASS — 2 tests

Run: `node --test test/alerta-asesor.test.js`
Expected: PASS — el aviso de venta no cambió.

- [ ] **Step 5: Commit**

```bash
git add src/groups/alerta-asesor.js src/groups/vivo.js test/alerta-amoblados.test.js
git commit -m "feat(radar): el aviso de amoblados se distingue de un vistazo

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Declarar "amoblada" en las dos fichas

La ficha que ve Sofi (`revalidar.js`) y la que recibe el colega (`redactar.js`). **Este es el único task que toca un prompt**, y por eso lleva el golden set.

**Files:**
- Modify: `src/groups/revalidar.js` (`formatearCandidatas`, bloque del pedido)
- Modify: `src/groups/redactar.js` (`ficha`)
- Test: `test/ficha-amoblado.test.js` (crear)

**Interfaces:**
- Consumes: `match.amoblado` de Task 4; `clasificado.amoblado` de Task 2.
- Produces: nada que consuma otro task.

- [ ] **Step 1: Write the failing test**

Crear `test/ficha-amoblado.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { ficha } = require("../src/groups/redactar");

const amoblada = {
  ref: "10319436", titulo: "Apartamento Amoblado en Arriendo en El Poblado - Los Gonzáles",
  operacion: "Arriendo", zona: "Los Gonzáles", precio: "$7.900.000", area: "90m2",
  habitaciones: 3, banos: null, garajes: null, estrato: null,
  linkWasi: "https://info.wasi.co/apartamento-alquiler-los-gonzales-medellin/10319436",
  amoblado: true,
};

test("la ficha del colega dice que esta amoblada", () => {
  const t = ficha(amoblada, 1);
  assert.ok(t.includes("amoblada"), `la ficha no lo declara:\n${t}`);
});

test("una propiedad de la que no sabemos NO se declara amoblada", () => {
  // La ausencia de dato nunca se convierte en una afirmacion. Es la misma
  // regla que ya rige banos/garajes/estrato: un hueco de sync no se disfraza.
  const t = ficha({ ...amoblada, amoblado: null }, 1);
  assert.ok(!t.includes("amoblada"), `afirmo lo que no sabe:\n${t}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ficha-amoblado.test.js`
Expected: FAIL — el primer test falla, la ficha no menciona "amoblada".

- [ ] **Step 3: Write minimal implementation**

En `src/groups/redactar.js`, dentro de `ficha`, agregar "amoblada" al array `detalles` (el que hoy lleva baños/garajes/estrato):

```js
  const detalles = [
    // Solo en positivo y solo si lo sabemos: `null` es "no sabemos" y
    // convertirlo en "sin amoblar" seria afirmar lo que no verificamos.
    match.amoblado === true ? "amoblada" : null,
    formato.pluralizar(match.banos, "baño", "baños"),
    formato.pluralizar(match.garajes, "garaje"),
    formato.datoCargado(match.estrato) ? `estrato ${match.estrato}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
```

En `src/groups/revalidar.js`, dentro de `formatearCandidatas`, agregar la línea al array `datos` (después de `m.habitaciones ? ... : null`):

```js
        m.amoblado === true ? "amoblada" : null,
```

Y en el bloque que le describe el pedido a Sofi, después de la línea de `estrato`:

```js
    clasificado.amoblado === "si" ? `- amoblado: SI, el colega lo pidio explicitamente` : null,
    clasificado.amoblado === "no" ? `- amoblado: NO, el colega lo RECHAZO explicitamente` : null,
```

**Y una sola frase al prompt `SISTEMA` de `revalidar.js`, que reconoce la talla en vez de contradecirla.** Agregarla junto a las reglas de `sin_confirmar`:

```
El amoblado es la ÚNICA excepción a la regla de arriba: si el colega pidió amoblado y la ficha no lo confirma, la propiedad va igual a refs_utiles con el dato en 'sin_confirmar' — pero el motor no la va a dejar salir sola, y eso está bien y no es cosa tuya. No cambies tu criterio por esto.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ficha-amoblado.test.js`
Expected: PASS — 2 tests

- [ ] **Step 5: Correr el golden set — NO se salta**

La suite de `revalidar` fija el prompt con substrings, y por eso **no detecta contradicciones**: la auditoría del 2026-09-05 encontró dos órdenes opuestas conviviendo con la suite en verde. Lo único que prueba comportamiento son los 6 pedidos reales:

```bash
railway run --service diamond node scripts/golden-revalidar.js
```

Expected: los 6 pedidos dan el mismo veredicto que antes del cambio. Si alguno cambió, **parar** y revisar si la frase nueva contradice una vieja — no seguir adelante.

Run: `node --test test/group-revalidar.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/groups/redactar.js src/groups/revalidar.js test/ficha-amoblado.test.js
git commit -m "feat(radar): las dos fichas declaran amoblada, solo en positivo

La frase del prompt RECONOCE la talla del motor en vez de contradecirla: meter
una regla opuesta a la que ya esta es como se construyo la contradiccion que
encontro la auditoria del 2026-09-05. Validado con golden-revalidar, no con
tests de frases.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Cierre — suite completa, documentación y despliegue

- [ ] **Step 1: Correr la suite entera**

Run: `npm test`
Expected: PASS, sin tests saltados.

- [ ] **Step 2: Actualizar el estado del CLAUDE.md**

En `CLAUDE.md`, sección "2. Estado actual", agregar bajo las migraciones que `2026-09-07_amoblado.sql` está corrida y **verificada por REST** (regla vigente: no declarar una migración corrida sin un `select` que lo pruebe).

Y agregar a "Pendientes de negocio": *los amoblados actualizados en Wasi no están en la cuenta de Paraíso Inmobiliario que consulta el sync — verificado el 2026-09-07 contra la web pública de la cuenta (112 propiedades, 2 en alquiler).*

- [ ] **Step 3: Commit de la documentación**

```bash
git add CLAUDE.md
git commit -m "docs: estado del carril de amoblados y el pendiente de Wasi

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Desplegar — con Juan enterado**

`git push origin main` publica a Railway **y** a los dos Vercel. Antes de pushear, confirmar con Juan.

```bash
git log origin/main..HEAD --oneline
git push origin main
```

- [ ] **Step 5: Verificar en producción**

Esperar el deploy de Railway y confirmar en el log del servicio `diamond` que el arranque no rompió nada. Después, sobre la primera demanda de arriendo que entre:

```bash
curl -s "$SUPABASE_URL/rest/v1/group_signals?select=amoblado,periodo,politica_motivo,respondida_at&operacion=eq.arriendo&order=created_at.desc&limit=5" \
  -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"
```

Expected: `amoblado` y `periodo` con valores reales (no todos `null`). Si salen todos `null` después de varias señales, el clasificador no está extrayendo los campos — revisar Task 2 antes de dar esto por andando.

---

## Qué queda fuera, a propósito

- **Los amoblados que faltan en Wasi.** Pendiente de negocio: no están en la cuenta de Paraíso. Con este plan el motor queda listo; el inventario sigue siendo 2 propiedades.
- **Abrir grupos de amoblados o renta corta.** Decisión de Juan del 2026-09-07: gasto de API sin contrapartida mientras haya dos propiedades.
- **Una columna `amoblado` en `properties`.** Se reevalúa si Wasi expone el campo.
- **El bug latente de `normalizeOperacionYPrecio`** (prioriza `for_sale` sobre `for_rent`: una propiedad marcada venta *y* arriendo se guardaría sólo como Venta). Verificado el 2026-09-07 que hoy no está mordiendo.
