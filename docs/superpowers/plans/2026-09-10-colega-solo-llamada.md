# Colega "solo llamada" y DM que dice a qué pedido responde — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que ningún DM le llegue a un colega marcado "solo llamada" (cada pedido suyo va al aviso de la asesora para que lo llame), y que todo DM a cualquier colega diga a qué pedido le estamos contestando.

**Architecture:** Una pieza compartida nueva (`src/groups/pedido.js`) describe el pedido para el DM y para el aviso. La marca vive en `colegas_grupos.solo_llamada` (migración ya corrida) y la consulta `colegas.esSoloLlamada` por tres llaves (lid, teléfono con cruce por `directorio_lids`, celular escrito en el pedido). Frenan: `politica.decidirDm` (camino automático), los dos caminos manuales de `vivo.js`, la cancelación de citas y un candado final dentro de `waha.enviarDm`, la única puerta de los DM.

**Tech Stack:** Node.js (CommonJS), `node:test`, Supabase (PostgREST), WAHA, Next.js/TSX en `crm/`.

**Spec:** [docs/superpowers/specs/2026-09-10-colega-solo-llamada-design.md](../specs/2026-09-10-colega-solo-llamada-design.md) — fuente de verdad. Rama: `colega-solo-llamada` (ya creada; spec y migración commiteadas en `691b932`).

## Global Constraints

- Migración `db/migrations/2026-09-10_colega_solo_llamada.sql`: **ya corrida en producción y verificada por REST** (2026-09-10). No se vuelve a correr; la fila de Ángela (lid `266150634110990`, tel `573146399667`) ya está en `solo_llamada = true`.
- **Falla cerrado:** si no se puede verificar la marca (`null`), no sale ningún DM.
- **Multi-tenant:** toda consulta filtra por `org_id`. Nada de datos de Diamond hardcodeados.
- **Mensaje blanqueado:** el DM al colega nunca lleva "Diamond" ni el nombre del grupo (el colega lo reenvía a su cliente).
- **Copy neutro en género:** "llamá", "Llamar a {nombre}", "Ya llamaste" — nunca "llamala"/"llamalo".
- Identificadores y comentarios en español, como el resto del repo. Comentarios con fecha y porqué, al estilo de los archivos que se tocan.
- Tests: `node --test test/<archivo>.test.js`; suite completa `npm test` (base 2026-09-08: 1730/1730). Bajo `node --test`, `src/data/supabase.js` exporta `null` y los módulos de datos caen a memoria (`src/data/memory.js`); WAHA exige `fetch` mockeado.
- Commits en español con prefijo convencional, terminando en `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Un commit por tarea.
- **Nunca `git push`** sin el visto bueno explícito de Juan: `git push origin main` despliega Railway y los dos Vercel.
- Cambio visual del CRM: **mockup HTML aprobado por Juan antes de tocar el componente** (Task 11).

## Mapa de archivos

| Archivo | Qué cambia |
|---|---|
| `src/groups/pedido.js` (nuevo) | `numeroPedido`, `resumenPedido`, `frasePedido`, `fragmentoPedido`, `fechaSiEsOtroDia` |
| `src/groups/redactar.js` | Saludo del DM: "te respondo tu PEDIDO N" / descripción |
| `src/groups/alerta-asesor.js` | Usa `pedido.js`; aviso "📞 LLAMAR"; línea "Pedido: N°"; `PORQUE` nuevos |
| `src/groups/digest-avisos.js` | `PORQUE_CORTO` nuevos |
| `src/data/colegas.js` | `esSoloLlamada`, `marcarSoloLlamada` |
| `src/groups/politica.js` | `decidirDm` recibe `soloLlamada` |
| `src/groups/vivo.js` | `pedidoDe` ampliado; freno en `asistir`, `aprobarManual`, `responderPorDmManual`; `prepararAviso`; `orgId` en `enviarDm` |
| `src/lib/waha.js` | Candado en `enviarDm` (exige `orgId`) |
| `src/api/crm.js`, `src/scheduler/ventana-asesora.js` | Pasan `orgId` a `enviarDm` |
| `src/groups/cancelar-cita.js` | No escribe a un colega marcado; alerta al equipo |
| `src/agent/tools.js`, `src/agent/prompts.js` | Herramienta `marcar_colega_solo_llamada`; regla en `promptColega`; caso nuevo en `aprobarPedidoRadar` |
| `src/agent/sofi-comando-tools.js` | Caso nuevo en `aprobarPedidoRadarComando` |
| `crm/components/aviso-celular.tsx`, `crm/components/senales-grupos.tsx` | Botón "📞 Llamar"; mapa de resultados; borrador con número de pedido |
| `docs/superpowers/mockups/2026-09-10-aviso-solo-llamada.html` (nuevo) | Mockup para aprobación |

---

### Task 1: `src/groups/pedido.js` — cómo se describe un pedido

**Files:**
- Create: `src/groups/pedido.js`
- Modify: `src/groups/alerta-asesor.js` (quitar `queBusca` local, líneas ~270-292; importar de `pedido.js`)
- Test: `test/pedido.test.js`

**Interfaces:**
- Produces:
  - `numeroPedido(texto: string) -> string | null` — el número tal como vino (`"02"`, no `"2"`).
  - `resumenPedido(senal) -> string | null` — la línea "Busca:" del aviso (ex `queBusca`, sin cambios de comportamiento).
  - `frasePedido(pedido) -> string | null` — `pedido` = `{ tipo, operacion, zonas, zona, precio_max, habitaciones }`.
  - `fragmentoPedido(texto, max = 60) -> string | null`.
  - `fechaSiEsOtroDia(fechaIso, ahora = new Date()) -> string | null` — `"8 de septiembre"` o `null` si es el mismo día en Bogotá.

- [ ] **Step 1: Write the failing test**

Crear `test/pedido.test.js`:

```js
// Como se describe un pedido de colega (Juan, 2026-09-10). Lo usan el DM al
// colega (redactar.js) y el aviso a la asesora (alerta-asesor.js): tienen que
// describir el MISMO pedido, o el colega y la asesora hablan de dos cosas.
const { test } = require("node:test");
const assert = require("node:assert");
const pedido = require("../src/groups/pedido");

test("numeroPedido: los formatos reales medidos en produccion", () => {
  assert.strictEqual(pedido.numeroPedido("🟢🟢🟢🟢 _*PEDIDO 👉 645*_\n🔎 _*BUSCO*_"), "645");
  assert.strictEqual(pedido.numeroPedido("Pedido #201 busco apto"), "201");
  assert.strictEqual(pedido.numeroPedido("*Pedido 12026* Busco *apto*"), "12026");
  assert.strictEqual(pedido.numeroPedido("Pedido 02👈 casa en Envigado"), "02");
  assert.strictEqual(pedido.numeroPedido("_*C_647*_ 🔆 Por favor quién con apartamentos"), "647");
});

test("numeroPedido: si trae los dos, gana la palabra 'pedido'", () => {
  assert.strictEqual(pedido.numeroPedido("_*C_647*_ ... _*PEDIDO 👉 647*_"), "647");
  assert.strictEqual(pedido.numeroPedido("C_111 ... PEDIDO 222"), "222");
});

test("numeroPedido: un # suelto, 'pedidos' o un digito solo NO son un numero de pedido", () => {
  assert.strictEqual(pedido.numeroPedido("Calle 10 #43, apto 3 alcobas"), null);
  assert.strictEqual(pedido.numeroPedido("para mis pedidos 23 aptos"), null);
  assert.strictEqual(pedido.numeroPedido("Pedido: 3 alcobas en Laureles"), null);
  assert.strictEqual(pedido.numeroPedido("Busco apto en Sabaneta"), null);
  assert.strictEqual(pedido.numeroPedido(null), null);
});

test("resumenPedido: la linea 'Busca:' de siempre", () => {
  assert.strictEqual(
    pedido.resumenPedido({ operacion: "venta", tipo: "apartamento", zonas: ["Sabaneta", "Envigado"], precio_max: 320000000, habitaciones: 2, banos: 2, garajes: 1 }),
    "venta · apartamento · Sabaneta, Envigado · hasta $320.000.000 · 2 alcobas · 2 baños · 1 garaje"
  );
  assert.strictEqual(pedido.resumenPedido({}), null);
});

test("frasePedido: tipo, zonas unidas con 'o', tope y alcobas", () => {
  assert.strictEqual(
    pedido.frasePedido({ tipo: "Apartamento", zonas: ["envigado", "itagüí", "la estrella", "sabaneta"], precio_max: 350000000, habitaciones: 2 }),
    "apartamento en Envigado, Itagüí, La Estrella o Sabaneta, hasta $350.000.000, 2 alcobas"
  );
  assert.strictEqual(pedido.frasePedido({ tipo: "apartamento", zona: "laureles" }), "apartamento en Laureles");
  assert.strictEqual(
    pedido.frasePedido({ tipo: "casa", operacion: "arriendo", zona: "el poblado", precio_max: 9000000 }),
    "casa en arriendo en El Poblado, hasta $9.000.000"
  );
  assert.strictEqual(pedido.frasePedido({ zonas: ["Envigado"], habitaciones: 2 }), "propiedad en Envigado, 2 alcobas");
});

test("frasePedido: sin tipo, zona ni precio no hay frase (el que llama cae al fragmento)", () => {
  assert.strictEqual(pedido.frasePedido({ habitaciones: 3 }), null);
  assert.strictEqual(pedido.frasePedido(null), null);
});

test("fragmentoPedido: sus primeras palabras, sin emojis ni asteriscos, cortadas en ~60", () => {
  const f = pedido.fragmentoPedido("🏭 *BUSCO BODEGA PARA RENTA* 📍 Ubicación: sabaneta,La Estrella o Caldas 📐 Área: 1.000 m²");
  assert.ok(f.startsWith("BUSCO BODEGA PARA RENTA Ubicación: sabaneta,La Estrella"), f);
  assert.ok(f.endsWith("…"), f);
  assert.ok(f.length <= 61, `largo ${f.length}`);
  assert.ok(!/[*🏭📍]/u.test(f), f);
  assert.strictEqual(pedido.fragmentoPedido("Viva solicita apto Sabaneta"), "Viva solicita apto Sabaneta");
  assert.strictEqual(pedido.fragmentoPedido("👀🔥"), null);
});

test("fechaSiEsOtroDia: nada si es el mismo dia en Bogota, la fecha si es otro", () => {
  const ahora = new Date("2026-09-10T15:00:00Z"); // 10-sep 10:00 a. m. Bogota
  assert.strictEqual(pedido.fechaSiEsOtroDia("2026-09-10T13:00:00Z", ahora), null);
  assert.strictEqual(pedido.fechaSiEsOtroDia("2026-09-08T20:00:00Z", ahora), "8 de septiembre");
  // 10-sep 02:00 UTC todavia es 9-sep en Bogota.
  assert.strictEqual(pedido.fechaSiEsOtroDia("2026-09-10T02:00:00Z", ahora), "9 de septiembre");
  assert.strictEqual(pedido.fechaSiEsOtroDia(null, ahora), null);
  assert.strictEqual(pedido.fechaSiEsOtroDia("basura", ahora), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pedido.test.js`
Expected: FAIL con `Cannot find module '../src/groups/pedido'`.

- [ ] **Step 3: Write minimal implementation**

Crear `src/groups/pedido.js`:

```js
// Como se describe un pedido de colega, en un solo lugar (Juan, 2026-09-10).
//
// Dos lectores con la misma necesidad: el DM al colega (redactar.js, "te
// respondo tu PEDIDO 645") y el aviso a la asesora (alerta-asesor.js, la linea
// "Busca:" y "Pedido: N° 645"). Si cada uno describiera el pedido a su manera,
// el colega y la asesora terminarian hablando de dos pedidos distintos por
// telefono.
//
// El caso que lo motivo: Angela Moscoso, 2026-09-09 — "de la empresa me estan
// enviando opciones pero no me describen para que pedido es". Medido el
// 2026-09-10 sobre 1.240 demandas: solo 47 (3,8 %) traen numero de pedido, asi
// que el numero solo no alcanza; al resto hay que describirle el pedido.

const formato = require("../lib/formato");

// Los formatos reales medidos en produccion (2026-09-10): "PEDIDO 👉 645",
// "_*PEDIDO 👉 645*_", "Pedido #201", "Pedido 12026", "Pedido 02👈" y el codigo
// "C_647". Entre la palabra y el numero se aceptan hasta 8 caracteres que no
// sean letras ni digitos (emojis, asteriscos, "#", ":"); una letra corta
// ("pedidos", "pedido de") y ahi no hay numero.
//
// Un "#123" SUELTO no se acepta: puede ser una direccion ("Calle 10 #43") o un
// apartamento, y un numero de pedido equivocado confunde mas que no ponerlo.
// Minimo 2 digitos por lo mismo: en "Pedido: 3 alcobas" el 3 no es el pedido.
const PATRONES_NUMERO = [
  /pedido[^\p{L}\p{N}]{0,8}(\d{2,6})(?!\d)/iu,
  /(?<![\p{L}\p{N}])C_(\d{2,6})(?!\d)/u,
];

function numeroPedido(texto) {
  const t = String(texto || "");
  for (const patron of PATRONES_NUMERO) {
    const m = t.match(patron);
    if (m) return m[1];
  }
  return null;
}

// Lo que busca el colega, en una linea (Juan, 2026-09-02): "que entienda que
// busca el colega". Movida tal cual desde alerta-asesor.js#queBusca
// (2026-09-10) para que el DM pueda describir el pedido con los mismos datos.
// Se muestran SOLO los campos que el pedido menciono: una linea con huecos
// ("hasta $0", "0 alcobas") seria peor que no ponerla.
function resumenPedido(senal) {
  const s = senal || {};
  const zonas = Array.isArray(s.zonas) && s.zonas.length ? s.zonas.join(", ") : s.zona;
  const partes = [
    s.operacion,
    s.tipo,
    zonas,
    formato.datoCargado(s.precio_max) ? `hasta ${formato.formatearPrecio(s.precio_max)}` : null,
    formato.datoCargado(s.habitaciones)
      ? `${formato.pluralizar(s.habitaciones, "alcoba")}${s.flexible_habitaciones ? " (o una menos con estudio)" : ""}`
      : null,
    formato.datoCargado(s.area_min) ? `desde ${s.area_min} m²` : null,
    formato.pluralizar(s.banos, "baño", "baños"),
    formato.pluralizar(s.garajes, "garaje"),
    formato.datoCargado(s.estrato) ? `estrato ${s.estrato}` : null,
  ].filter(Boolean);
  return partes.length ? partes.join(" · ") : null;
}

const MENORES = new Set(["de", "del", "la", "las", "el", "los", "y", "en"]);

// El clasificador guarda las zonas en minuscula ("la estrella"); en un mensaje
// para una persona van como nombre propio.
function capitalizarZona(zona) {
  return String(zona || "")
    .trim()
    .split(/\s+/)
    .map((palabra, i) => {
      const p = palabra.toLocaleLowerCase("es-CO");
      if (i > 0 && MENORES.has(p)) return p;
      return p.charAt(0).toLocaleUpperCase("es-CO") + p.slice(1);
    })
    .join(" ");
}

function unirConO(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} o ${items[items.length - 1]}`;
}

// El pedido como frase, para el saludo del DM: "apartamento en Envigado,
// Itagüí o Sabaneta, hasta $350.000.000, 2 alcobas". Solo tipo, zonas, tope y
// alcobas: es para que el colega RECONOZCA su pedido, no para repetirselo
// entero. Sin tipo, zona ni precio no hay nada reconocible y devuelve null
// (el saludo cae al fragmento de su propio texto).
function frasePedido(pedido) {
  if (!pedido) return null;
  const tipo = String(pedido.tipo || "").trim().toLocaleLowerCase("es-CO");
  const zonas = (Array.isArray(pedido.zonas) && pedido.zonas.length ? pedido.zonas : [pedido.zona])
    .map((z) => String(z || "").trim())
    .filter(Boolean)
    .map(capitalizarZona);
  const precio = formato.datoCargado(pedido.precio_max) ? formato.formatearPrecio(pedido.precio_max) : null;
  if (!tipo && !zonas.length && !precio) return null;

  let cabeza = tipo || "propiedad";
  if (/arriendo|renta|alquiler/i.test(String(pedido.operacion || ""))) cabeza += " en arriendo";
  if (zonas.length) cabeza += ` en ${unirConO(zonas)}`;
  return [cabeza, precio ? `hasta ${precio}` : null, formato.pluralizar(pedido.habitaciones, "alcoba")]
    .filter(Boolean)
    .join(", ");
}

// Las primeras palabras del pedido tal como lo escribio el colega, sin emojis,
// asteriscos ni guiones bajos de WhatsApp. Es el respaldo cuando el
// clasificador no saco nada reconocible: el colega reconoce sus propias
// palabras mejor que cualquier resumen.
function fragmentoPedido(texto, max = 60) {
  const limpio = String(texto || "")
    .replace(/[^\p{L}\p{N}\s.,$:/()-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (limpio.length < 8) return null;
  if (limpio.length <= max) return limpio;
  const corte = limpio.slice(0, max);
  const espacio = corte.lastIndexOf(" ");
  return `${(espacio > 30 ? corte.slice(0, espacio) : corte).trim()}…`;
}

const TZ = "America/Bogota";
const diaEnBogota = (fecha) => fecha.toLocaleDateString("en-CA", { timeZone: TZ });

// "8 de septiembre" si el pedido es de OTRO dia que hoy (en Bogota), o null.
// Los caminos manuales pueden mandar el DM dias despues del pedido; ahi el
// colega necesita saber de cual de sus pedidos le hablamos.
function fechaSiEsOtroDia(fechaIso, ahora = new Date()) {
  if (!fechaIso) return null;
  const fecha = new Date(fechaIso);
  if (Number.isNaN(fecha.getTime())) return null;
  if (diaEnBogota(fecha) === diaEnBogota(ahora)) return null;
  return fecha.toLocaleDateString("es-CO", { timeZone: TZ, day: "numeric", month: "long" });
}

module.exports = { numeroPedido, resumenPedido, frasePedido, fragmentoPedido, fechaSiEsOtroDia };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/pedido.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: `alerta-asesor.js` usa `resumenPedido` en vez de su `queBusca` local**

En `src/groups/alerta-asesor.js`:

1. Debajo de `const redactar = require("./redactar");` agregar:

```js
// El pedido se describe en un solo lugar (2026-09-10): el DM al colega y este
// aviso tienen que hablar del MISMO pedido. queBusca vivia aca; ahora es
// pedido.js#resumenPedido, sin cambios de comportamiento.
const { resumenPedido: queBusca, numeroPedido } = require("./pedido");
```

2. Borrar la función `queBusca` completa (el bloque que empieza con el comentario `// Lo que busca el colega, en una linea (Juan, 2026-09-02)` y termina en `return partes.length ? partes.join(" · ") : null;\n}`). Las llamadas `queBusca(senal)` y `queBusca(s)` quedan igual.

- [ ] **Step 6: Run the aviso tests (sin cambios de comportamiento)**

Run: `node --test test/alerta-asesor.test.js test/group-asistido.test.js test/pedido.test.js`
Expected: PASS (todos los que pasaban antes).

- [ ] **Step 7: Commit**

```bash
git add src/groups/pedido.js src/groups/alerta-asesor.js test/pedido.test.js
git commit -m "$(cat <<'EOF'
feat(radar): pedido.js -- numero, resumen y frase del pedido en un solo lugar

El DM al colega y el aviso a la asesora tienen que describir el mismo
pedido. numeroPedido reconoce los formatos reales (PEDIDO 👉 645, Pedido
#201, C_647) y rechaza el # suelto; queBusca se mueve sin cambios.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: El DM dice a qué pedido responde

**Files:**
- Modify: `src/groups/redactar.js` (saludo en `mensajeGrupo`, línea ~317; import arriba, línea ~72)
- Modify: `src/groups/vivo.js` (`pedidoDe`, línea ~363; llamada en `asistir`, línea ~598)
- Modify: `src/groups/alerta-asesor.js` (`mensajeListoParaReenviar`, el objeto `pedido`)
- Test: `test/group-redactar.test.js`, `test/group-asistido.test.js:559`, `test/alerta-asesor.test.js:155`

**Interfaces:**
- Consumes: `frasePedido`, `fragmentoPedido`, `fechaSiEsOtroDia`, `numeroPedido` (Task 1).
- Produces: `mensajeGrupo(senal, publicables, { ..., pedido, ahora })` donde `pedido` ahora puede traer `{ numero, tipo, operacion, zonas, zona, precio_max, habitaciones, areaMin, texto, fecha }`. `vivo.pedidoDe(fuente, { texto, fechaIso } = {})`.

- [ ] **Step 1: Write the failing tests**

Agregar al final de `test/group-redactar.test.js`:

```js
// A QUE PEDIDO LE CONTESTAMOS (Juan, 2026-09-10). Caso Angela Moscoso: "me
// estan enviando opciones pero no me describen para que pedido es". Solo el
// 3,8 % de los pedidos trae numero: la descripcion es lo principal.
const AHORA = new Date("2026-09-10T15:00:00Z");

test("con numero de pedido, el saludo lo nombra y describe el pedido", () => {
  const texto = redactar.mensajeGrupo({ autor_nombre: "Angela Moscoso" }, [match()], {
    ahora: AHORA,
    pedido: {
      numero: "645", tipo: "apartamento", zonas: ["envigado", "itagüí", "la estrella", "sabaneta"],
      precio_max: 350000000, habitaciones: 2, fecha: "2026-09-10T14:00:00Z",
    },
  });
  assert.match(
    texto,
    /^Hola Angela, te respondo tu PEDIDO 645 \(apartamento en Envigado, Itagüí, La Estrella o Sabaneta, hasta \$350\.000\.000, 2 alcobas\)\. Tengo esta opcion que puede servirte:/
  );
});

test("sin numero, el saludo describe el pedido", () => {
  const texto = redactar.mensajeGrupo({ autor_nombre: "Eugenia Alonso" }, [match(), match({ ref: "B" })], {
    ahora: AHORA,
    pedido: { tipo: "apartamento", zonas: ["laureles", "poblado", "fátima"], precio_max: 400000000, habitaciones: 2 },
  });
  assert.match(
    texto,
    /^Hola Eugenia, te respondo tu pedido de apartamento en Laureles, Poblado o Fátima, hasta \$400\.000\.000, 2 alcobas\. Tengo 2 opciones que pueden servirte:/
  );
});

test("sin nada reconocible del clasificador, cita las primeras palabras del colega", () => {
  const texto = redactar.mensajeGrupo({ autor_nombre: "Ana" }, [match()], {
    ahora: AHORA,
    pedido: { texto: "🏭 *Busco bodega* para renta" },
  });
  assert.match(texto, /^Hola Ana, te respondo tu pedido «Busco bodega para renta»\./);
});

test("sin pedido, queda el saludo de siempre", () => {
  const texto = redactar.mensajeGrupo({ autor_nombre: "Ana" }, [match()], { ahora: AHORA });
  assert.match(texto, /^Hola Ana, vi tu solicitud\./);
});

test("si el DM sale otro dia que el pedido, dice de que dia es", () => {
  const conNumero = redactar.mensajeGrupo({ autor_nombre: "Ana" }, [match()], {
    ahora: AHORA,
    pedido: { numero: "201", tipo: "casa", zona: "envigado", fecha: "2026-09-08T20:00:00Z" },
  });
  assert.match(conNumero, /^Hola Ana, te respondo tu PEDIDO 201 del 8 de septiembre \(casa en Envigado\)\./);

  const sinNumero = redactar.mensajeGrupo({ autor_nombre: "Ana" }, [match()], {
    ahora: AHORA,
    pedido: { tipo: "casa", zona: "envigado", fecha: "2026-09-08T20:00:00Z" },
  });
  assert.match(sinNumero, /^Hola Ana, te respondo tu pedido del 8 de septiembre: casa en Envigado\./);
});

test("el saludo nuevo no mete Diamond ni el nombre del grupo (mensaje blanqueado)", () => {
  const texto = redactar.mensajeGrupo({ autor_nombre: "Ana" }, [match()], {
    ahora: AHORA,
    pedido: { numero: "645", tipo: "apartamento", zona: "laureles" },
  });
  assert.ok(!texto.toLowerCase().includes("diamond"));
  assert.ok(!texto.includes("grupo"));
});
```

En `test/group-asistido.test.js`, línea 559, reemplazar:

```js
  assert.match(t, /Hola Patricia, vi tu solicitud/);
```

por:

```js
  // El saludo dice a que pedido responde (Juan, 2026-09-10): el clasificador
  // de este archivo devuelve apartamento / laureles / 900M / 3 alcobas.
  assert.match(t, /Hola Patricia, te respondo tu pedido de apartamento en Laureles, hasta \$900\.000\.000, 3 alcobas\./);
```

En `test/alerta-asesor.test.js`, línea 155, reemplazar:

```js
  assert.match(texto, /Hola Patricia, vi tu solicitud/);
```

por:

```js
  // senal() no trae campos clasificados: el saludo cita sus primeras palabras
  // (Juan, 2026-09-10 — el colega tiene que saber a que pedido le contestamos).
  assert.match(texto, /Hola Patricia, te respondo tu pedido «Busco apartamento en Laureles, 3 alcobas»/);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/group-redactar.test.js test/group-asistido.test.js test/alerta-asesor.test.js`
Expected: FAIL en los tests nuevos y en las dos aserciones editadas (el saludo sigue diciendo "vi tu solicitud").

- [ ] **Step 3: Implement the saludo in `redactar.js`**

En `src/groups/redactar.js`, debajo de `const { linkContactoOficial } = require("../lib/contacto");` agregar:

```js
const { frasePedido, fragmentoPedido, fechaSiEsOtroDia } = require("./pedido");
```

Encima de `function mensajeGrupo(` agregar:

```js
// A QUE PEDIDO LE CONTESTAMOS (Juan, 2026-09-10). Caso Angela Moscoso: "me
// estan enviando opciones pero no me describen para que pedido es" — publica
// varios pedidos por dia y un DM que dice solo "vi tu solicitud" no le sirve.
// Medido ese dia: solo el 3,8 % de los pedidos trae numero, asi que el numero
// va cuando exista y la descripcion es lo principal. En orden:
//   1. con numero: "te respondo tu PEDIDO 645 (apartamento en ...)."
//   2. con algo clasificado: "te respondo tu pedido de apartamento en ..."
//   3. con su texto: "te respondo tu pedido «Busco bodega para renta…»"
//   4. sin nada: el saludo de siempre, "vi tu solicitud".
// Si el DM sale OTRO dia que el pedido (los caminos manuales), se dice cual.
// Nunca lleva el nombre del grupo ni "Diamond": el colega reenvia esto a su
// cliente (mensaje blanqueado).
function saludoDelPedido(nombre, pedido, ahora) {
  const hola = nombre ? `Hola ${nombre}` : "Hola";
  const p = pedido || {};
  const dia = fechaSiEsOtroDia(p.fecha, ahora);
  const delDia = dia ? ` del ${dia}` : "";
  const frase = frasePedido(p);
  if (p.numero) return `${hola}, te respondo tu PEDIDO ${p.numero}${delDia}${frase ? ` (${frase})` : ""}.`;
  if (frase) return dia ? `${hola}, te respondo tu pedido${delDia}: ${frase}.` : `${hola}, te respondo tu pedido de ${frase}.`;
  const fragmento = fragmentoPedido(p.texto);
  if (fragmento) return `${hola}, te respondo tu pedido${delDia} «${fragmento}».`;
  return `${hola}, vi tu solicitud.`;
}
```

En `mensajeGrupo`, cambiar la firma y el saludo:

```js
function mensajeGrupo(
  senal,
  publicables,
  { maxPropiedades = MAX_PROPIEDADES, org = null, sinConfirmar = [], leFalta = [], pedido = null, ahora = new Date() } = {}
) {
  const props = (publicables || []).slice(0, maxPropiedades);
  if (props.length === 0) return null;

  const nombre = primerNombre(senal && senal.autor_nombre);
  const saludo = saludoDelPedido(nombre, pedido, ahora);
```

(El resto de `mensajeGrupo` no cambia: `encabezado` sigue usando `saludo`.)

- [ ] **Step 4: `pedidoDe` pasa número, descripción, texto y fecha**

En `src/groups/vivo.js`, debajo de `const formato = require("../lib/formato");` agregar:

```js
const { numeroPedido } = require("./pedido");
```

Reemplazar la función `pedidoDe` completa por:

```js
// Lo que el colega pidio, en la forma que esperan redactar.desvios y el saludo
// del DM: sirve tanto para la clasificacion recien hecha (`c`) como para una
// señal releida de la base, que guarda los mismos campos. Se comparte para que
// el DM automatico y los dos caminos manuales no diverjan en lo que le aclaran
// al colega.
//
// numero/tipo/operacion/precio_max/texto/fecha (Juan, 2026-09-10): el saludo
// del DM dice a que pedido le contestamos. La clasificacion en vivo no trae el
// texto ni la fecha del mensaje, por eso van en `extra`; una señal de la base
// los tiene en texto_original y fecha_mensaje.
function pedidoDe(fuente, { texto = null, fechaIso = null } = {}) {
  if (!fuente) return null;
  const textoPedido = texto || fuente.texto_original || null;
  return {
    zonas: Array.isArray(fuente.zonas) && fuente.zonas.length ? fuente.zonas : null,
    zona: fuente.zona || null,
    habitaciones: fuente.habitaciones || null,
    areaMin: fuente.area_min || null,
    operacion: fuente.operacion || null,
    tipo: fuente.tipo || null,
    precio_max: fuente.precio_max || null,
    texto: textoPedido,
    numero: numeroPedido(textoPedido),
    fecha: fechaIso || fuente.fecha_mensaje || fuente.created_at || null,
  };
}
```

En `asistir`, en la llamada a `textoParaColega(...)`, reemplazar el último argumento `pedidoDe(c)` por:

```js
      pedidoDe(c, { texto: mensaje.texto, fechaIso: mensaje.instanteIso })
```

(`aprobarManual`, `responderPorDmManual` y `prepararAviso` siguen llamando `pedidoDe(signal)`: la señal trae `texto_original` y `fecha_mensaje`.)

- [ ] **Step 5: El borrador del aviso a la asesora también dice a qué pedido responde**

En `src/groups/alerta-asesor.js`, dentro de `mensajeListoParaReenviar`, reemplazar el objeto `pedido: { ... }` por:

```js
    pedido: {
      zonas: Array.isArray(senal.zonas) && senal.zonas.length ? senal.zonas : null,
      zona: senal.zona || null,
      habitaciones: senal.habitaciones || null,
      areaMin: senal.area_min || null,
      // Mismo saludo que el DM automatico (2026-09-10): el borrador que la
      // asesora reenvia tambien dice a que pedido le contesta.
      operacion: senal.operacion || null,
      tipo: senal.tipo || null,
      precio_max: senal.precio_max || null,
      texto: senal.texto_original || null,
      numero: numeroPedido(senal.texto_original),
    },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test test/group-redactar.test.js test/redactar-desvios.test.js test/group-asistido.test.js test/alerta-asesor.test.js test/group-vivo.test.js test/pedido.test.js`
Expected: PASS. `redactar-desvios` pasa `pedido` sin tipo: su saludo cambia a "te respondo tu pedido de propiedad en …", pero sus aserciones son sobre las aclaraciones; si alguna fijara el saludo, actualizarla a la frase nueva.

- [ ] **Step 7: Commit**

```bash
git add src/groups/redactar.js src/groups/vivo.js src/groups/alerta-asesor.js test/group-redactar.test.js test/group-asistido.test.js test/alerta-asesor.test.js
git commit -m "$(cat <<'EOF'
feat(radar): el DM al colega dice a que pedido le contestamos

"te respondo tu PEDIDO 645 (apartamento en ...)" cuando hay numero, la
descripcion del pedido cuando no (el 96 %), sus primeras palabras si el
clasificador no saco nada, y la fecha si el DM sale otro dia. Cubre los
cinco lugares que usan redactar.mensajeGrupo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `colegas.esSoloLlamada` y `colegas.marcarSoloLlamada`

**Files:**
- Modify: `src/data/colegas.js`
- Test: `test/colegas-solo-llamada.test.js` (nuevo, rama en memoria), `test/colegas-data-supabase.test.js` (rama Supabase)

**Interfaces:**
- Produces:
  - `esSoloLlamada(orgId, { lid, telefono, textoPedido } = {}) -> Promise<true | false | null>` — `null` = no se pudo verificar. **Nunca lanza.**
  - `marcarSoloLlamada(orgId, { telefono } = {}) -> Promise<{ ok: true, colega: { nombre, telefono, lid } } | { ok: false, motivo: "sin_telefono" | "no_encontrado" | "error" }>`

- [ ] **Step 1: Write the failing test (memoria)**

Crear `test/colegas-solo-llamada.test.js`:

```js
// La marca "solo llamada" (Juan, 2026-09-10). Caso Angela Moscoso: pidio que
// la contacten solo por llamada y el radar le mando un DM dos horas despues.
// Lo que se fija aca: que la marca se reconozca por CUALQUIERA de las tres
// llaves (lid, telefono con el cruce de directorio_lids, celular escrito en el
// pedido) — Juan: "que no se nos filtren los mensajes porque queda marcado el
// colega pero de pronto el lid sigue disponible".
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const memory = require("../src/data/memory");
delete require.cache[require.resolve("../src/data/supabase")];
delete require.cache[require.resolve("../src/data/colegas")];
const supabasePath = require.resolve("../src/data/supabase");
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: null };
const colegas = require("../src/data/colegas");

const ORG = "org-1";
const ANGELA = { id: "c-angela", org_id: ORG, lid: "266150634110990", telefono: "573146399667", nombre: "tengotuinmueblecomercial1", grupos: [], solo_llamada: true };

beforeEach(() => {
  memory.colegasGrupos.length = 0;
  memory.directorioLids = [];
});

test("marcada por lid: el radar la reconoce por el identificador oculto", async () => {
  memory.colegasGrupos.push({ ...ANGELA });
  assert.strictEqual(await colegas.esSoloLlamada(ORG, { lid: "266150634110990" }), true);
  assert.strictEqual(await colegas.esSoloLlamada(ORG, { lid: "266150634110990@lid" }), true, "con sufijo tambien");
});

test("marcada por telefono: con o sin indicativo", async () => {
  memory.colegasGrupos.push({ ...ANGELA });
  assert.strictEqual(await colegas.esSoloLlamada(ORG, { telefono: "573146399667" }), true);
  assert.strictEqual(await colegas.esSoloLlamada(ORG, { telefono: "3146399667" }), true);
});

test("el cruce de directorio_lids: la fila marcada solo tiene lid y el DM iria por telefono", async () => {
  memory.colegasGrupos.push({ ...ANGELA, telefono: null });
  memory.directorioLids.push({ org_id: ORG, lid: "266150634110990", telefono: "573146399667" });
  assert.strictEqual(await colegas.esSoloLlamada(ORG, { telefono: "573146399667" }), true);
});

test("el cruce al reves: la fila marcada solo tiene telefono y el DM iria por lid", async () => {
  memory.colegasGrupos.push({ ...ANGELA, lid: "otro-lid-99999999" });
  memory.directorioLids.push({ org_id: ORG, lid: "266150634110990", telefono: "573146399667" });
  assert.strictEqual(await colegas.esSoloLlamada(ORG, { lid: "266150634110990" }), true);
});

test("el celular escrito en el pedido: si publica desde otra cuenta, igual se reconoce", async () => {
  memory.colegasGrupos.push({ ...ANGELA });
  const texto = "🟢 PEDIDO 👉 650 BUSCO APARTAMENTO 🙋 Angela Moscoso 📲 314 639 9667";
  assert.strictEqual(await colegas.esSoloLlamada(ORG, { lid: "999999999999999", textoPedido: texto }), true);
});

test("sin marca, o de otra organizacion, o sin ninguna llave: false", async () => {
  memory.colegasGrupos.push({ ...ANGELA, solo_llamada: false });
  memory.colegasGrupos.push({ ...ANGELA, id: "otra-org", org_id: "org-2", lid: "111111111111111", telefono: "573001112233" });
  assert.strictEqual(await colegas.esSoloLlamada(ORG, { lid: "266150634110990" }), false);
  assert.strictEqual(await colegas.esSoloLlamada(ORG, { telefono: "573001112233" }), false, "la marca de otra org no cruza");
  assert.strictEqual(await colegas.esSoloLlamada(ORG, {}), false);
});

test("sin org no se puede verificar: null (falla cerrado)", async () => {
  assert.strictEqual(await colegas.esSoloLlamada(null, { lid: "266150634110990" }), null);
});

test("marcarSoloLlamada: la encuentra por telefono y la marca", async () => {
  memory.colegasGrupos.push({ ...ANGELA, solo_llamada: false });
  const r = await colegas.marcarSoloLlamada(ORG, { telefono: "573146399667" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.colega.lid, "266150634110990");
  assert.strictEqual(memory.colegasGrupos[0].solo_llamada, true);
  assert.ok(memory.colegasGrupos[0].solo_llamada_at);
});

test("marcarSoloLlamada: si la fila no tiene telefono, la encuentra por directorio_lids", async () => {
  memory.colegasGrupos.push({ ...ANGELA, telefono: null, solo_llamada: false });
  memory.directorioLids.push({ org_id: ORG, lid: "266150634110990", telefono: "573146399667" });
  const r = await colegas.marcarSoloLlamada(ORG, { telefono: "3146399667" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(memory.colegasGrupos[0].solo_llamada, true);
});

test("marcarSoloLlamada: sin fila no inventa nada", async () => {
  const r = await colegas.marcarSoloLlamada(ORG, { telefono: "573146399667" });
  assert.deepStrictEqual(r, { ok: false, motivo: "no_encontrado" });
  assert.deepStrictEqual(await colegas.marcarSoloLlamada(ORG, { telefono: "123" }), { ok: false, motivo: "sin_telefono" });
});
```

Agregar al final de `test/colegas-data-supabase.test.js`:

```js
// ── esSoloLlamada contra la base (Juan, 2026-09-10) ──────────────────────

function cadenaQueResuelve(resultado, filtros) {
  const c = {
    select: () => c,
    eq: (col, val) => { filtros.push(["eq", col, val]); return c; },
    or: (f) => { filtros.push(["or", f]); return c; },
    in: (col, vals) => { filtros.push(["in", col, vals]); return c; },
    limit: () => Promise.resolve(resultado),
  };
  return c;
}

test("esSoloLlamada cruza directorio_lids y consulta colegas_grupos por lid O telefono", async (t) => {
  const filtrosDir = [];
  const filtrosCol = [];
  t.mock.method(supabase, "from", (tabla) => {
    if (tabla === "directorio_lids") {
      return cadenaQueResuelve({ data: [{ lid: "266150634110990", telefono: "573146399667" }], error: null }, filtrosDir);
    }
    assert.strictEqual(tabla, "colegas_grupos");
    return cadenaQueResuelve({ data: [{ id: "c-angela" }], error: null }, filtrosCol);
  });

  const r = await colegas.esSoloLlamada(ORG, { lid: "266150634110990" });
  assert.strictEqual(r, true);
  assert.ok(filtrosCol.some((f) => f[0] === "eq" && f[1] === "org_id" && f[2] === ORG), "filtra por org");
  assert.ok(filtrosCol.some((f) => f[0] === "eq" && f[1] === "solo_llamada" && f[2] === true));
  const or = filtrosCol.find((f) => f[0] === "or")[1];
  assert.match(or, /lid\.in\.\([^)]*266150634110990/);
  assert.match(or, /telefono\.in\.\([^)]*3146399667/, "el telefono que dio el directorio entra al filtro");
});

test("esSoloLlamada devuelve null (no false) si la base falla: falla cerrado", async (t) => {
  const original = console.error;
  console.error = () => {};
  t.mock.method(supabase, "from", () => cadenaQueResuelve({ data: null, error: { message: "boom" } }, []));
  try {
    assert.strictEqual(await colegas.esSoloLlamada(ORG, { lid: "266150634110990" }), null);
  } finally {
    console.error = original;
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/colegas-solo-llamada.test.js test/colegas-data-supabase.test.js`
Expected: FAIL con `colegas.esSoloLlamada is not a function`.

- [ ] **Step 3: Write minimal implementation**

En `src/data/colegas.js`, debajo de `const { mismoTelefono } = require("./advisors");` agregar:

```js
const { telefonoEnTexto } = require("../lib/contacto");
```

Antes de `module.exports` agregar:

```js
// ── "Solo llamada" (Juan, 2026-09-10) ────────────────────────────────────
//
// El caso: Angela Moscoso le pidio a Sofi que la contacten SOLO por llamada.
// Sofi dijo "ya esta anotado" sin guardar nada, y dos horas despues el radar le
// mando un DM. Decision de Juan: permanente, ningun DM, cada pedido suyo va al
// aviso de la asesora para que la llame. Ver
// docs/superpowers/specs/2026-09-10-colega-solo-llamada-design.md.
//
// TRES LLAVES, NO UNA (Juan: "que no se nos filtren los mensajes porque queda
// marcado el colega pero de pronto el lid sigue disponible"). El DM puede salir
// por lid o por telefono; si la marca se buscara por una sola llave, el DM
// saldria por la otra. Se reconoce por el lid, por el telefono (con el cruce de
// directorio_lids en los dos sentidos) y por el celular que el colega firma en
// su pedido — eso ultimo cubre que publique desde otra cuenta. Un falso
// positivo solo desvia el pedido a la asesora, que es el lado seguro.

function filtroLidsOTelefonos(lids, tels) {
  const partes = [];
  if (lids.size) partes.push(`lid.in.(${[...lids].join(",")})`);
  if (tels.size) partes.push(`telefono.in.(${[...tels].join(",")})`);
  return partes.join(",");
}

/**
 * ¿Este colega pidio que lo contacten solo por llamada?
 * @returns true | false | null — null = no se pudo verificar. Quien llama lo
 *          trata como marcado (no sale DM): FALLA CERRADO. Nunca lanza.
 */
async function esSoloLlamada(orgId, { lid = null, telefono = null, textoPedido = null } = {}) {
  if (!orgId) return null;
  const lids = new Set();
  const tels = new Set();
  const l = soloDigitos(lid);
  if (l) lids.add(l);
  for (const t of [soloDigitos(telefono), telefonoEnTexto(textoPedido)]) {
    if (t && t.length >= 10) for (const v of variantesTelefono(t)) tels.add(v);
  }
  if (!lids.size && !tels.size) return false;

  if (!supabase) {
    for (const d of memory.directorioLids || []) {
      if (d.org_id !== orgId) continue;
      if (lids.has(d.lid)) for (const v of variantesTelefono(d.telefono)) tels.add(v);
      if (tels.has(d.telefono)) lids.add(d.lid);
    }
    return memory.colegasGrupos.some(
      (c) => c.org_id === orgId && c.solo_llamada === true && (lids.has(c.lid) || (c.telefono && tels.has(c.telefono)))
    );
  }

  try {
    const { data: dir, error: e1 } = await supabase
      .from("directorio_lids")
      .select("lid, telefono")
      .eq("org_id", orgId)
      .or(filtroLidsOTelefonos(lids, tels))
      .limit(20);
    if (e1) throw e1;
    for (const d of dir || []) {
      lids.add(d.lid);
      for (const v of variantesTelefono(d.telefono)) tels.add(v);
    }

    const { data, error } = await supabase
      .from("colegas_grupos")
      .select("id")
      .eq("org_id", orgId)
      .eq("solo_llamada", true)
      .or(filtroLidsOTelefonos(lids, tels))
      .limit(1);
    if (error) throw error;
    return (data || []).length > 0;
  } catch (e) {
    console.error(`[colegas] No se pudo verificar si el colega pidio solo llamada (org ${orgId}):`, e.message);
    return null;
  }
}

/**
 * Marca al colega que escribe desde `telefono` como "solo llamada". Lo busca
 * por telefono y, si su fila no lo tiene, por el lid que directorio_lids le
 * asocia. Nunca inventa una fila: sin encontrarlo devuelve no_encontrado.
 */
async function marcarSoloLlamada(orgId, { telefono = null } = {}) {
  const tel = soloDigitos(telefono);
  if (!orgId || !tel || tel.length < 10) return { ok: false, motivo: "sin_telefono" };
  const tels = variantesTelefono(tel);
  const ahora = new Date().toISOString();

  if (!supabase) {
    let fila = memory.colegasGrupos.find((c) => c.org_id === orgId && c.telefono && tels.includes(c.telefono));
    if (!fila) {
      const dir = (memory.directorioLids || []).find((d) => d.org_id === orgId && tels.includes(d.telefono));
      if (dir) fila = memory.colegasGrupos.find((c) => c.org_id === orgId && c.lid === dir.lid);
    }
    if (!fila) return { ok: false, motivo: "no_encontrado" };
    fila.solo_llamada = true;
    fila.solo_llamada_at = ahora;
    return { ok: true, colega: { nombre: fila.nombre || null, telefono: fila.telefono || tel, lid: fila.lid } };
  }

  try {
    let { data: filas, error } = await supabase
      .from("colegas_grupos")
      .select("id, lid, telefono, nombre")
      .eq("org_id", orgId)
      .in("telefono", tels)
      .limit(5);
    if (error) throw error;
    if (!filas || !filas.length) {
      const { data: dir, error: e2 } = await supabase
        .from("directorio_lids")
        .select("lid")
        .eq("org_id", orgId)
        .in("telefono", tels)
        .limit(5);
      if (e2) throw e2;
      const lidsDir = (dir || []).map((d) => d.lid);
      if (lidsDir.length) {
        const r3 = await supabase
          .from("colegas_grupos")
          .select("id, lid, telefono, nombre")
          .eq("org_id", orgId)
          .in("lid", lidsDir)
          .limit(5);
        if (r3.error) throw r3.error;
        filas = r3.data || [];
      }
    }
    if (!filas || !filas.length) return { ok: false, motivo: "no_encontrado" };

    const { error: e4 } = await supabase
      .from("colegas_grupos")
      .update({ solo_llamada: true, solo_llamada_at: ahora })
      .in("id", filas.map((f) => f.id));
    if (e4) throw e4;
    const f = filas[0];
    return { ok: true, colega: { nombre: f.nombre || null, telefono: f.telefono || tel, lid: f.lid } };
  } catch (e) {
    console.error(`[colegas] No se pudo marcar solo llamada (org ${orgId}):`, e.message);
    return { ok: false, motivo: "error" };
  }
}
```

Y cambiar el export:

```js
module.exports = { upsert, porTelefono, listarConTelefono, listarSinTelefono, esSoloLlamada, marcarSoloLlamada };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/colegas-solo-llamada.test.js test/colegas-data-supabase.test.js test/colegas-data.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/colegas.js test/colegas-solo-llamada.test.js test/colegas-data-supabase.test.js
git commit -m "$(cat <<'EOF'
feat(colegas): esSoloLlamada y marcarSoloLlamada, por tres llaves

La marca se reconoce por lid, por telefono (con el cruce de
directorio_lids en los dos sentidos) y por el celular escrito en el
pedido, para que el DM no se escape por la otra llave. Si la base falla
devuelve null: quien llama falla cerrado.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `decidirDm` respeta la marca

**Files:**
- Modify: `src/groups/politica.js` (`decidirDm`, línea ~223)
- Test: `test/group-politica.test.js`

**Interfaces:**
- Produces: `decidirDm({ ..., soloLlamada })` — `true` → motivo `"colega_solo_llamada"`; `null` → `"solo_llamada_no_verificable"`; `false`/ausente → sin cambios. Corta **antes** de elegir la vía (`via: null`).

- [ ] **Step 1: Write the failing test**

Agregar al final de `test/group-politica.test.js`:

```js
// ── SOLO LLAMADA (Juan, 2026-09-10) ──────────────────────────────────────
// Caso Angela Moscoso: pidio que la contacten solo por llamada y el radar le
// mando un DM dos horas despues. La marca va PRIMERO, antes de elegir la via:
// si se evaluara despues del lid/telefono, un cambio de orden la esquivaria.
test("un colega marcado 'solo llamada' nunca recibe DM, y se corta antes de elegir la via", () => {
  const d = politica.decidirDm(escenarioDm({ soloLlamada: true, lid: "141746805670125" }));
  assert.strictEqual(d.enviarDm, false);
  assert.strictEqual(d.motivo, "colega_solo_llamada");
  assert.strictEqual(d.via, null);
  assert.ok(!d.traza.some((t) => t.startsWith("destino:")), d.traza.join(","));
});

test("si no se pudo verificar la marca (null), falla cerrado con su propio motivo", () => {
  const d = politica.decidirDm(escenarioDm({ soloLlamada: null }));
  assert.strictEqual(d.enviarDm, false);
  assert.strictEqual(d.motivo, "solo_llamada_no_verificable");
});

test("sin marca (false o sin el campo), el DM sale igual que siempre", () => {
  assert.strictEqual(politica.decidirDm(escenarioDm({ soloLlamada: false })).enviarDm, true);
  assert.strictEqual(politica.decidirDm(escenarioDm()).enviarDm, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/group-politica.test.js`
Expected: FAIL — `d.enviarDm` es `true` para `soloLlamada: true`.

- [ ] **Step 3: Write minimal implementation**

En `src/groups/politica.js`, en el JSDoc de `decidirDm`, debajo del `@param cuotaLinea`, agregar:

```js
 * @param soloLlamada       el colega pidio que lo contacten SOLO por llamada
 *                         (src/data/colegas.js#esSoloLlamada): true | false,
 *                         o null si no se pudo verificar — null FRENA.
```

Agregar `soloLlamada = false,` a la desestructuración (antes de `limites = LIMITES_DM_DEFAULT,`), y justo después de `const no = (motivo) => ...;` agregar:

```js
  // SOLO LLAMADA (Juan, 2026-09-10): permanente, ningun DM. Va PRIMERO, antes
  // de elegir la via, para que ni el lid ni el telefono puedan esquivarla.
  // null = no se pudo verificar la marca, y ante la duda no se escribe (el
  // principio 2 de este archivo). Los dos desvian a la asesora, como todo "no"
  // de esta funcion.
  if (soloLlamada === true) return no("colega_solo_llamada");
  if (soloLlamada === null) return no("solo_llamada_no_verificable");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/group-politica.test.js test/lid-camino-principal.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/groups/politica.js test/group-politica.test.js
git commit -m "$(cat <<'EOF'
feat(radar): decidirDm frena a un colega marcado solo llamada

Motivos colega_solo_llamada y solo_llamada_no_verificable, evaluados
antes de elegir la via. Los dos desvian a la asesora.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: El aviso a la asesora: "📞 LLAMAR — Pedido N°" y la línea del pedido en todos

**Files:**
- Modify: `src/groups/alerta-asesor.js` (`PORQUE`, `porqueNoSalioSolo`, `construir`, import de `contacto`)
- Modify: `src/groups/digest-avisos.js` (`PORQUE_CORTO`)
- Test: `test/alerta-asesor.test.js`

**Interfaces:**
- Consumes: `numeroPedido` (Task 1), motivos de Task 4.
- Produces: `construir(senal, veredicto, matches, telefonoColega, org, motivoDm, opts)` con `motivoDm` `"colega_solo_llamada"` / `"solo_llamada_no_verificable"` → aviso de llamada. `porqueNoSalioSolo(motivo, hayUtiles)` (ya exportada) entiende los dos motivos nuevos.

- [ ] **Step 1: Write the failing tests**

Agregar al final de `test/alerta-asesor.test.js`:

```js
// ── SOLO LLAMADA (Juan, 2026-09-10) ──────────────────────────────────────
// Caso Angela Moscoso: su forma de pedir es el numero de pedido, y pidio que
// la contacten solo por llamada. El aviso tiene que decir LLAMAR, con el
// numero de pedido y el telefono para marcar — y nada que invite a escribirle.
const { porqueNoSalioSolo } = require("../src/groups/alerta-asesor");

const SENAL_ANGELA = () =>
  senal({
    autor_nombre: "tengotuinmueblecomercial1",
    autor_telefono: "266150634110990",
    texto_original: "🟢🟢🟢🟢 _*PEDIDO 👉 645*_ 🔎 _*BUSCO*_ APARTAMENTO 🙋 _*Angela Moscoso*_ 📲 _*314 639 9667*_",
  });

test("solo llamada: LLAMAR con el numero de pedido y el telefono para marcar, sin nada para escribirle", () => {
  process.env.CONTACT_WHATSAPP_NUMBER = "573044653609";
  const texto = construir(
    SENAL_ANGELA(),
    VEREDICTO,
    [matchUtil({ linkWasi: "https://info.wasi.co/apartamento-venta-ap004/9744456" })],
    null,
    null,
    "colega_solo_llamada"
  );
  assert.match(texto, /^📞 LLAMAR — Pedido N° 645/);
  assert.match(texto, /Contacto: 📞 \+57 314 639 9667 — llamá, no le escribas/);
  assert.match(texto, /Por qué no salió solo: 📞 Este colega pidió contacto SOLO por llamada/);
  assert.match(texto, /llamá con urgencia/);
  assert.doesNotMatch(texto, /wa\.me/, "ni link de WhatsApp al colega ni invitacion a Sofi");
  assert.doesNotMatch(texto, /mandale ESTO YA/i);
  assert.doesNotMatch(texto, /escribirle a Sofi/);
  assert.match(texto, /Ref AP004/, "las propiedades siguen, para que sepa de que hablarle");
});

test("solo llamada sin numero de pedido en el texto: la cabecera no inventa uno", () => {
  const texto = construir(senal(), VEREDICTO, [matchUtil()], "573001234567", null, "colega_solo_llamada");
  assert.match(texto, /^📞 LLAMAR — pedido de un colega/);
  assert.match(texto, /Contacto: 📞 \+57 300 123 4567/);
});

test("solo llamada sin ningun telefono: dice que lo busque en el grupo y llame", () => {
  const texto = construir(senal({ texto_original: "Busco apto en Laureles" }), VEREDICTO, [matchUtil()], null, null, "colega_solo_llamada");
  assert.match(texto, /Contacto: no tenemos su número — buscalo en el grupo "Inmobiliarias Medellin" y llamá/);
});

test("no se pudo verificar la marca: mismo formato de llamada, con su propia razon", () => {
  const texto = construir(SENAL_ANGELA(), VEREDICTO, [matchUtil()], null, null, "solo_llamada_no_verificable");
  assert.match(texto, /^📞 LLAMAR — Pedido N° 645/);
  assert.match(texto, /No pudimos confirmar si este colega acepta mensajes/);
});

test("un aviso normal con numero de pedido suma la linea 'Pedido: N°'", () => {
  const texto = construir(SENAL_ANGELA(), VEREDICTO, [matchUtil()], null, null, "sin_telefono");
  assert.match(texto, /OPORTUNIDAD APROBADA/);
  assert.match(texto, /\nPedido: N° 645\n/);
});

test("un aviso normal sin numero de pedido no agrega la linea", () => {
  const texto = construir(senal(), VEREDICTO, [matchUtil()], "573001234567");
  assert.doesNotMatch(texto, /Pedido: N°/);
});

test("porqueNoSalioSolo: solo llamada sin nada aprobado pide decidir si vale la pena llamar", () => {
  assert.match(porqueNoSalioSolo("colega_solo_llamada", false), /^📞 .*decidí vos si vale la pena llamar/);
  assert.doesNotMatch(porqueNoSalioSolo("colega_solo_llamada", true), /escribile/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/alerta-asesor.test.js`
Expected: FAIL (la cabecera sigue siendo "OPORTUNIDAD APROBADA" y no hay línea "Pedido: N°").

- [ ] **Step 3: Implement**

En `src/groups/alerta-asesor.js`:

1. Cambiar el import de contacto por:

```js
const { linkWhatsappEstricto, linkContactoOficial, tocarNombreEnGrupo, telefonoEnTexto, telefonoNormalizado } = require("../lib/contacto");
```

2. En `PORQUE`, antes del cierre `};`, agregar:

```js
  // SOLO LLAMADA (Juan, 2026-09-10): permanente, el colega no quiere mensajes.
  // Copy neutro en genero: el nombre de WhatsApp no dice como se identifica.
  colega_solo_llamada: "Este colega pidió contacto SOLO por llamada — nada de mensajes. El bot no le escribió.",
  solo_llamada_no_verificable: "No pudimos confirmar si este colega acepta mensajes, así que el bot no le escribió.",
```

3. Debajo de `const URGENCIA = ...;` agregar:

```js
// Los motivos que convierten el aviso en un "LLAMAR" (Juan, 2026-09-10): ni
// link de WhatsApp al colega, ni borrador para reenviar, ni invitacion a Sofi.
const MOTIVOS_LLAMADA = new Set(["colega_solo_llamada", "solo_llamada_no_verificable"]);

// El numero para MARCAR, legible: "+57 314 639 9667". Mismas tres fuentes que
// contactoPara, en el mismo orden (directorio, autor, lo que firmo en el texto).
function telefonoParaLlamar(telefonoColega, autorTelefono, textoOriginal) {
  const d = telefonoNormalizado(telefonoColega) || telefonoNormalizado(autorTelefono) || telefonoEnTexto(textoOriginal);
  if (!d) return null;
  const n = d.length === 10 ? `57${d}` : d;
  return `+57 ${n.slice(2, 5)} ${n.slice(5, 8)} ${n.slice(8)}`;
}
```

4. Al principio de `porqueNoSalioSolo`, antes de `if (!hayUtiles) {`, agregar:

```js
  if (MOTIVOS_LLAMADA.has(motivo)) {
    return hayUtiles
      ? `📞 ${PORQUE[motivo]} Es una oportunidad YA APROBADA por Sofi: llamá con urgencia.`
      : `📞 ${PORQUE[motivo]} Sofi no aprobó ninguna del todo: decidí vos si vale la pena llamar.`;
  }
```

5. En `construir`, reemplazar desde `const quien = senal.autor_nombre || "un colega";` hasta el cierre del arreglo `const cabecera = [ ... ];` por:

```js
  const quien = senal.autor_nombre || "un colega";
  const contactoTexto = contactoPara(telefonoColega, senal.autor_telefono, quien, senal.texto_original);

  // SOLO LLAMADA (Juan, 2026-09-10) y el numero de pedido (su forma de pedir
  // informacion es ese numero): la asesora lo tiene que ver en la primera
  // linea, y con el telefono para marcar en vez de un link para escribirle.
  const soloLlamada = MOTIVOS_LLAMADA.has(motivoDm);
  const numero = numeroPedido(senal.texto_original);
  const telLlamada = soloLlamada ? telefonoParaLlamar(telefonoColega, senal.autor_telefono, senal.texto_original) : null;
  const contactoLinea = soloLlamada
    ? telLlamada
      ? `📞 ${telLlamada} — llamá, no le escribas`
      : `no tenemos su número — buscalo en el grupo "${senal.grupo_nombre || "del pedido"}" y llamá`
    : contactoTexto;

  const busca = queBusca(senal);
  // `utilesSofi.length > 0`, NO `utiles.length > 0` (fix critico): "hay algo
  // aprobado por Sofi" no es lo mismo que "hay algo ofrecible". Si se usara
  // `utiles` aca, el caso de arriba (todo aprobado, todo descartado por
  // calidad) caeria en la rama de "Sofi no aprobó ninguna del todo" -- falso,
  // Sofi SI aprobo, la compuerta fue la que freno.
  const porque = porqueNoSalioSolo(motivoDm, utilesSofi.length > 0);

  // Aprobada y sin salir es otra categoria de mensaje, y se tiene que ver
  // desde la primera linea sin leer el resto. AQUI SE MIDE LO OFRECIBLE, NO
  // LA APROBACION DE SOFI (Minor, 2026-09-07): el encabezado le ORDENA
  // escribirle al colega YA, y esa orden no puede encabezar un cuerpo que no
  // tiene nada confirmable que mandarle. Si Sofi aprobo pero todo quedo
  // apartado por dato corrupto, el aviso sale como oportunidad normal y el
  // bloque ⛔ explica que paso — el "Por qué no salió solo" sigue midiendose
  // contra `utilesSofi` unas lineas mas arriba, porque ahi la pregunta es
  // otra: si Sofi aprobo o no.
  const aprobadaSinSalir = utiles.length > 0 && Boolean(porque);
  const titulo = soloLlamada
    ? `📞 LLAMAR — ${numero ? `Pedido N° ${numero}` : "pedido de un colega"}`
    : aprobadaSinSalir
      ? `🚨🚨 OPORTUNIDAD APROBADA — el bot NO pudo escribirle al colega`
      : `🎯 Oportunidad en un grupo`;
  const cabecera = [
    titulo,
    ``,
    `Grupo: ${senal.grupo_nombre || "sin nombre"}`,
    `Colega: ${quien}`,
    // En el aviso de llamada el numero ya va en la primera linea.
    ...(numero && !soloLlamada ? [`Pedido: N° ${numero}`] : []),
    `Contacto: ${contactoLinea}`,
    // El link (Juan, 2026-09-02, opcion D): arriba, antes del pedido, para
    // que sea lo primero que toca. Lo esencial sigue inline: si un dia no le
    // abre, no pierde el negocio por una metrica.
    ...(link ? [``, `👉 Ver la oportunidad: ${link}`] : []),
    ...(porque ? [``, `Por qué no salió solo: ${porque}`] : []),
    ...(busca ? [``, `Busca: ${busca}`] : []),
    ``,
    busca ? `Lo escribió así:` : `Pidió:`,
    `"${(senal.texto_original || "").trim()}"`,
  ];
```

6. En la condición de `mensajeListo`, agregar `!soloLlamada &&` al principio:

```js
  const mensajeListo = !soloLlamada && utiles.length > 0 && !telefonoResuelto(telefonoColega, senal.autor_telefono)
    ? mensajeListoParaReenviar(senal, veredicto, utiles, org, aclaracionesColega)
    : null;
```

7. Reemplazar `const linkSofi = mensajeListo ? null : linkContactoOficial(org);` por:

```js
  // Al colega "solo llamada" no se lo invita a escribirle a nadie.
  const linkSofi = mensajeListo || soloLlamada ? null : linkContactoOficial(org);
```

En `src/groups/digest-avisos.js`, en `PORQUE_CORTO`, antes del cierre `};`, agregar:

```js
  colega_solo_llamada: "pidió contacto solo por llamada",
  solo_llamada_no_verificable: "no se pudo confirmar si acepta mensajes",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/alerta-asesor.test.js test/group-asistido.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/groups/alerta-asesor.js src/groups/digest-avisos.js test/alerta-asesor.test.js
git commit -m "$(cat <<'EOF'
feat(radar): aviso "📞 LLAMAR -- Pedido N°" para el colega solo llamada

Con el telefono para marcar en vez de link de WhatsApp, sin borrador para
reenviar ni invitacion a Sofi. Todos los avisos suman la linea "Pedido: N°"
cuando el pedido trae numero.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `asistir` consulta la marca antes de decidir el DM

**Files:**
- Modify: `src/groups/vivo.js` (imports; `asistir`, antes de `politica.decidirDm`, línea ~517)
- Test: `test/group-asistido.test.js`

**Interfaces:**
- Consumes: `colegas.esSoloLlamada` (Task 3), `decidirDm({ soloLlamada })` (Task 4), aviso de Task 5.

- [ ] **Step 1: Write the failing test**

En `test/group-asistido.test.js`, debajo de `const path = require("node:path");` agregar:

```js
const memory = require("../src/data/memory");
const colegasData = require("../src/data/colegas");
```

Agregar al final del archivo:

```js
// ── SOLO LLAMADA (Juan, 2026-09-10) ──────────────────────────────────────
// Caso Angela Moscoso: pidio que la contacten solo por llamada y el radar le
// mando un DM dos horas despues. Un colega marcado no recibe NINGUN DM: el
// pedido cae al aviso de la asesora, con el formato de llamada.
test("un colega marcado 'solo llamada' no recibe DM: el pedido va al aviso 📞 LLAMAR", async () => {
  telefonoColegaResuelto = "573001234567";
  memory.colegasGrupos.push({
    id: "c1", org_id: "org-1", lid: "141746805670125", telefono: null,
    nombre: "Patricia Gomez", grupos: [], solo_llamada: true,
  });
  try {
    const r = await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE, sesion: "RADA-NATALIA" });
    assert.strictEqual(enviosDm.length, 0, "no sale ningun DM");
    assert.strictEqual(marcadasRespondidas.length, 0);
    assert.ok(politicasGuardadas.some((p) => p.motivo === "colega_solo_llamada"), JSON.stringify(politicasGuardadas));
    assert.strictEqual(r.resultado, "avisada");
    assert.match(enviadosPorSofi[0].texto, /^📞 LLAMAR/);
    assert.match(enviadosPorSofi[0].texto, /\+57 300 123 4567/);
  } finally {
    memory.colegasGrupos.length = 0;
  }
});

test("si no se puede verificar la marca, tampoco sale el DM (falla cerrado)", async (t) => {
  telefonoColegaResuelto = "573001234567";
  t.mock.method(colegasData, "esSoloLlamada", async () => null);
  const r = await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE, sesion: "RADA-NATALIA" });
  assert.strictEqual(enviosDm.length, 0);
  assert.ok(politicasGuardadas.some((p) => p.motivo === "solo_llamada_no_verificable"));
  assert.strictEqual(r.resultado, "avisada");
});

test("un colega sin marca sigue recibiendo su DM como siempre", async () => {
  telefonoColegaResuelto = "573001234567";
  const r = await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE, sesion: "RADA-NATALIA" });
  assert.strictEqual(r.resultado, "dm_enviado");
  assert.strictEqual(enviosDm.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/group-asistido.test.js`
Expected: FAIL — el primer test ve `enviosDm.length === 1`.

- [ ] **Step 3: Implement**

En `src/groups/vivo.js`, debajo de `const directorio = require("./directorio");` agregar:

```js
// Se importa el MODULO (no la funcion suelta) para que los tests puedan
// mockear esSoloLlamada, igual que canalWhatsapp mas abajo.
const colegas = require("../data/colegas");
```

En `asistir`, justo antes de `const decisionDm = politica.decidirDm({`, agregar:

```js
  // SOLO LLAMADA (Juan, 2026-09-10): un colega que pidio que lo contacten solo
  // por llamada no recibe ningun DM — el pedido cae al aviso de la asesora
  // para que lo llame. Se consulta con las TRES llaves que hay a mano (el lid
  // del autor, el telefono resuelto y el texto del pedido, que suele traer su
  // celular) para que la marca no se esquive por la via que no se miro.
  // esSoloLlamada no lanza; el catch es por si un doble de test lo hace.
  const soloLlamada = await colegas
    .esSoloLlamada(org.id, { lid: lidColega, telefono: telefonoColega, textoPedido: mensaje.texto })
    .catch(() => null);
```

Y en la llamada `politica.decidirDm({ ... })`, agregar `soloLlamada,` después de `cuotaLinea,`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/group-asistido.test.js test/lid-camino-principal.test.js test/carril-arriendo.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/groups/vivo.js test/group-asistido.test.js
git commit -m "$(cat <<'EOF'
feat(radar): el DM automatico consulta la marca solo llamada

asistir pregunta con lid, telefono y texto del pedido antes de decidir;
un colega marcado (o una consulta fallida) cae al aviso de la asesora.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Los caminos manuales también quedan cerrados

**Files:**
- Modify: `src/groups/vivo.js` (`aprobarManual` ~línea 1014, `responderPorDmManual` ~línea 1212; import de `contacto`)
- Modify: `src/agent/tools.js` (`aprobarPedidoRadar`, switch ~línea 1342)
- Modify: `src/agent/sofi-comando-tools.js` (`aprobarPedidoRadarComando`, switch ~línea 933)
- Modify: `crm/components/senales-grupos.tsx` (`MENSAJE_RESULTADO_DM`, línea ~133)
- Test: `test/group-vivo.test.js`, `test/aprobar-pedido-radar.test.js`

**Interfaces:**
- Produces: `aprobarManual` y `responderPorDmManual` devuelven `{ resultado: "colega_solo_llamada", telefono: string | null }` sin enviar ni marcar respondida.

- [ ] **Step 1: Write the failing tests**

En `test/group-vivo.test.js`, debajo de `const mandatosData = require("../src/data/mandatos");` agregar:

```js
const memory = require("../src/data/memory");
```

Agregar al final del archivo:

```js
// ── SOLO LLAMADA en los caminos manuales (Juan, 2026-09-10) ─────────────
// "Ningun DM, por ningun camino": aprobar desde el chat de Sofi y el DM
// manual del CRM tampoco le escriben a un colega marcado.
function conColegaMarcado(fn) {
  return async () => {
    memory.colegasGrupos.push({
      id: "c1", org_id: "org-1", lid: "141746805670125", telefono: null,
      nombre: "Camilo", grupos: [], solo_llamada: true,
    });
    try {
      await fn();
    } finally {
      memory.colegasGrupos.length = 0;
    }
  };
}

test("aprobarManual: a un colega marcado no le escribe ni lo marca respondido", conColegaMarcado(async () => {
  señalParaAprobar = señalCallada({ autor_telefono: "141746805670125", texto_original: "busco apto 📲 314 639 9667" });
  grupoParaAprobar = grupoHabilitado();
  telefonoColegaManual = "573001234567";

  const r = await vivo.aprobarManual({ id: "org-1" }, "sig-callada");

  assert.strictEqual(r.resultado, "colega_solo_llamada");
  assert.strictEqual(r.telefono, "573146399667");
  assert.strictEqual(enviosDmManual.length, 0);
  assert.strictEqual(marcadas.length, 0);
}));

test("responderPorDmManual: a un colega marcado no le escribe ni lo marca respondido", conColegaMarcado(async () => {
  señalParaAprobar = señalCallada({ autor_telefono: "141746805670125" });
  grupoParaAprobar = grupoHabilitado();
  telefonoColegaManual = "573001234567";

  const r = await vivo.responderPorDmManual({ id: "org-1" }, "sig-callada", { sesion: "RADA-NATALIA" });

  assert.strictEqual(r.resultado, "colega_solo_llamada");
  assert.strictEqual(enviosDmManual.length, 0);
  assert.strictEqual(marcadas.length, 0);
}));
```

Agregar al final de `test/aprobar-pedido-radar.test.js`:

```js
test("colega solo llamada: le dice a la asesora que llame, no que escriba", async (t) => {
  t.mock.method(vivo, "aprobarManual", async () => ({ resultado: "colega_solo_llamada", telefono: "573146399667" }));
  const out = await executeTool("aprobar_pedido_radar", {}, ctxAsesor({ radarSignalId: "sig-1" }));
  assert.match(out, /SOLO por llamada/);
  assert.match(out, /\+573146399667/);
  assert.doesNotMatch(out, /publicado/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/group-vivo.test.js test/aprobar-pedido-radar.test.js`
Expected: FAIL — `aprobarManual` devuelve `"publicado"` y el switch cae al `default`.

- [ ] **Step 3: Implement**

En `src/groups/vivo.js`, debajo de `const { numeroPedido } = require("./pedido");` agregar:

```js
const { telefonoEnTexto } = require("../lib/contacto");
```

En `aprobarManual`, justo después de `if (signal.clase !== "demanda") return { resultado: "no_es_demanda" };`, agregar:

```js
  // SOLO LLAMADA (Juan, 2026-09-10): "ningun DM, por ningun camino". Una
  // aprobacion humana reemplaza al puntaje, no a lo que el colega pidio. Se va
  // antes de cualquier consulta de envio; el telefono viaja para que quien lo
  // muestre pueda decir a donde llamar. null (no se pudo verificar) tambien
  // frena: falla cerrado.
  const soloLlamadaManual = await colegas
    .esSoloLlamada(org.id, { lid: signal.autor_telefono, textoPedido: signal.texto_original })
    .catch(() => null);
  if (soloLlamadaManual !== false) {
    return { resultado: "colega_solo_llamada", telefono: telefonoEnTexto(signal.texto_original) };
  }
```

En `responderPorDmManual`, justo después de su `if (signal.clase !== "demanda") return { resultado: "no_es_demanda" };`, agregar el mismo bloque:

```js
  // SOLO LLAMADA (Juan, 2026-09-10): mismo freno que aprobarManual.
  const soloLlamadaManual = await colegas
    .esSoloLlamada(org.id, { lid: signal.autor_telefono, textoPedido: signal.texto_original })
    .catch(() => null);
  if (soloLlamadaManual !== false) {
    return { resultado: "colega_solo_llamada", telefono: telefonoEnTexto(signal.texto_original) };
  }
```

En `src/agent/tools.js`, en el `switch (r.resultado)` de `aprobarPedidoRadar`, antes de `default:`, agregar:

```js
    // SOLO LLAMADA (Juan, 2026-09-10): el colega pidio que lo contacten solo
    // por llamada. No se mando nada y no se tiene que mandar.
    case "colega_solo_llamada":
      return `No se mandó nada: este colega pidió contacto SOLO por llamada.${r.telefono ? ` Llamá al +${r.telefono}.` : " Llamá vos."} No le escribas por WhatsApp.`;
```

En `src/agent/sofi-comando-tools.js`, en el `switch (r.resultado)` de `aprobarPedidoRadarComando`, antes de `case "ya_respondida":`, agregar:

```js
    case "colega_solo_llamada":
      return `No se aprobó: este colega pidió contacto SOLO por llamada, así que el sistema no le escribe por ningún camino.${r.telefono ? ` Su número: +${r.telefono}.` : ""} Hay que llamar por teléfono.`;
```

En `crm/components/senales-grupos.tsx`, en `MENSAJE_RESULTADO_DM`, antes de `error_envio:`, agregar:

```ts
  // Solo llamada (Juan, 2026-09-10): permanente, ningún mensaje por ningún camino.
  colega_solo_llamada: "Este colega pidió contacto solo por llamada: no se le mandó nada. Llamá vos.",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/group-vivo.test.js test/aprobar-pedido-radar.test.js test/carril-arriendo.test.js test/senal-responder-dm-endpoint.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/groups/vivo.js src/agent/tools.js src/agent/sofi-comando-tools.js crm/components/senales-grupos.tsx test/group-vivo.test.js test/aprobar-pedido-radar.test.js
git commit -m "$(cat <<'EOF'
feat(radar): aprobar a mano y el DM manual respetan solo llamada

aprobarManual y responderPorDmManual devuelven colega_solo_llamada sin
enviar ni marcar respondida; Sofi, Sofi-Comando y el CRM lo dicen en
palabras.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: El candado final en `waha.enviarDm`

**Files:**
- Modify: `src/lib/waha.js` (`enviarDm`, línea ~471)
- Modify: todos los llamadores — `src/groups/vivo.js` (líneas ~607, ~618, ~634, ~1132, ~1326), `src/api/crm.js` (~409, ~505), `src/groups/cancelar-cita.js` (~86), `src/scheduler/ventana-asesora.js` (~110)
- Test: `test/waha-dm-lid.test.js`, `test/group-canal.test.js`, `test/group-vivo.test.js`

**Interfaces:**
- Produces: `enviarDm(sesion, telefono, texto, { lid = null, orgId = null } = {})`. Sin `orgId`, o con el destino marcado, o con la consulta fallida → `{ ok: false, error, previoAlEnvio: false, destino }` sin tocar la red. `previoAlEnvio: false` evita el reintento por la otra vía en `asistir`.

- [ ] **Step 1: Write the failing tests**

En `test/waha-dm-lid.test.js`, agregar `orgId: "org-1"` a las dos llamadas que sí deben llegar a la red:

```js
    const r = await waha.enviarDm("RADA-NATALIA", null, "hola", { lid: "269230108872829@lid", orgId: "org-1" });
```

y en el test "si WAHA rechaza el lid" (línea ~72):

```js
    const r = await waha.enviarDm("RADA-NATALIA", null, "hola", { lid: "269230108872829", orgId: "org-1" });
```

Y agregar al final del archivo:

```js
// ── EL CANDADO (Juan, 2026-09-10) ────────────────────────────────────────
// enviarDm es la unica puerta de los DM: aca se revisa, por ultima vez, que el
// destino no sea un colega marcado "solo llamada" — sea por lid o por
// telefono. Asi ni un camino nuevo ni el endpoint de prueba la esquivan.
const memory = require("../src/data/memory");
const colegasData = require("../src/data/colegas");

test("a un colega marcado no le sale nada, ni por lid ni por telefono", async () => {
  memory.colegasGrupos.push({ id: "c1", org_id: "org-1", lid: "269230108872829", telefono: "573146399667", nombre: "X", grupos: [], solo_llamada: true });
  const llamadas = conWaha({ cuerpo: {} });
  try {
    const porLid = await waha.enviarDm("RADA-NATALIA", null, "hola", { lid: "269230108872829", orgId: "org-1" });
    const porTel = await waha.enviarDm("RADA-NATALIA", "573146399667", "hola", { orgId: "org-1" });
    assert.strictEqual(porLid.ok, false);
    assert.strictEqual(porLid.error, "colega_solo_llamada");
    assert.strictEqual(porLid.previoAlEnvio, false, "nadie debe reintentar por la otra via");
    assert.strictEqual(porTel.error, "colega_solo_llamada");
    assert.strictEqual(llamadas.length, 0, "no se toco la red");
  } finally {
    restaurar();
    memory.colegasGrupos.length = 0;
  }
});

test("si no se puede verificar la marca, no sale (falla cerrado)", async (t) => {
  t.mock.method(colegasData, "esSoloLlamada", async () => null);
  const llamadas = conWaha({ cuerpo: {} });
  try {
    const r = await waha.enviarDm("RADA-NATALIA", "573001234567", "hola", { orgId: "org-1" });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, "colega_solo_llamada");
    assert.strictEqual(llamadas.length, 0);
  } finally {
    restaurar();
  }
});

test("sin orgId no se puede verificar al destinatario: no sale", async () => {
  const llamadas = conWaha({ cuerpo: {} });
  try {
    const r = await waha.enviarDm("RADA-NATALIA", "573001234567", "hola");
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /orgId/);
    assert.strictEqual(llamadas.length, 0);
  } finally {
    restaurar();
  }
});
```

En `test/group-canal.test.js`, agregar `{ orgId: "org-1" }` como cuarto argumento en las llamadas de las líneas ~163, ~182, ~190 y ~207 (las que mandan a un número válido). Ejemplo, línea 163:

```js
  const r = await waha.enviarDm("RADA-NATALIA", "573001234567", "hola colega, vi tu solicitud", { orgId: "org-1" });
```

Las de las líneas 137-148 (destinos inválidos) no cambian: la guarda de destino corre antes que el candado.

En `test/group-vivo.test.js`, actualizar las cuatro aserciones de `opciones`:

```js
  assert.deepStrictEqual(enviosDmManual[0].opciones, { orgId: "org-1" });
```

(líneas ~643 y ~920) y

```js
  assert.deepStrictEqual(enviosDmManual[0].opciones, { lid: "141746805670125", orgId: "org-1" });
```

(líneas ~661 y ~939).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/waha-dm-lid.test.js test/group-canal.test.js test/group-vivo.test.js`
Expected: FAIL — el candado no existe (el DM a un marcado sale; sin `orgId` sale) y las opciones no traen `orgId`.

- [ ] **Step 3: Implement the candado**

En `src/lib/waha.js`, cambiar la firma de `enviarDm`:

```js
async function enviarDm(sesion, telefono, texto, { lid = null, orgId = null } = {}) {
```

Y entre el cierre del `if (lid) { ... } else { ... }` que arma `chatId` y el `try {`, agregar:

```js
  // EL CANDADO (Juan, 2026-09-10): esta es la unica puerta de los DM, y aca
  // se revisa por ultima vez que el destino no sea un colega que pidio que lo
  // contacten SOLO por llamada — por lid o por telefono, que es por donde
  // podria escaparse (Juan: "que no se nos filtren los mensajes"). Los caminos
  // de arriba (politica.js#decidirDm, vivo.js, cancelar-cita.js) ya frenan
  // antes; esto existe para que un camino nuevo, o el endpoint de prueba, no
  // la esquive. Sin orgId no hay contra que org verificar: no se envia.
  // previoAlEnvio false: nadie debe reintentar por la otra via.
  //
  // Require tardio a proposito: evita el ciclo con los modulos de datos y deja
  // que los tests mockeen esSoloLlamada sobre el modulo.
  if (!orgId) return { ok: false, error: "Falta orgId para verificar al destinatario", previoAlEnvio: false, destino: chatId };
  const colegas = require("../data/colegas");
  const marcado = await colegas.esSoloLlamada(orgId, lid ? { lid } : { telefono });
  if (marcado !== false) return { ok: false, error: "colega_solo_llamada", previoAlEnvio: false, destino: chatId };
```

- [ ] **Step 4: Pasar `orgId` en todos los llamadores**

`src/groups/vivo.js`, en `asistir`:

```js
      const opcionesDm = decisionDm.via === "lid" ? { lid: lidColega, orgId: org.id } : { orgId: org.id };
```

y en el respaldo por teléfono:

```js
        envioDm = await waha.enviarDm(sesion, telefonoColega, textoDm, { orgId: org.id }).catch((e) => ({ ok: false, error: e.message }));
```

En `aprobarManual` y en `responderPorDmManual`:

```js
  const opcionesDm = lidColega ? { lid: lidColega, orgId: org.id } : { orgId: org.id };
```

`src/api/crm.js`, prueba de lid (línea ~409):

```js
    const r = await waha.enviarDm(activa.nombre, null, texto, { lid, orgId: org.id });
```

y prueba de DM (línea ~505):

```js
    const envio = await waha.enviarDm(sesiones[0].nombre, destino, texto, { orgId: org.id });
```

`src/groups/cancelar-cita.js`, en `avisarAlColega`:

```js
    const opcionesDm = esTelefono ? { orgId: org && org.id } : { lid: lead.phone, orgId: org && org.id };
```

`src/scheduler/ventana-asesora.js`, en `runParaOrg` (línea ~110):

```js
  const r = await waha.enviarDm(sesion, NUMERO_SOFI(), TEXTO_VENTANA, { orgId: org.id });
```

Verificar que no quede ningún llamador sin `orgId`:

Run: `grep -rn "enviarDm(" src/ | grep -v "function enviarDm"`
Expected: las 9 llamadas; cada una con `orgId` en el cuarto argumento (en `vivo.js` las tres de `asistir` y `opcionesDm` ya lo llevan).

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/waha-dm-lid.test.js test/group-canal.test.js test/group-vivo.test.js test/group-asistido.test.js test/cancelar-cita.test.js test/ventana-asesora.test.js test/lid-camino-principal.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/waha.js src/groups/vivo.js src/api/crm.js src/groups/cancelar-cita.js src/scheduler/ventana-asesora.js test/waha-dm-lid.test.js test/group-canal.test.js test/group-vivo.test.js
git commit -m "$(cat <<'EOF'
feat(waha): candado solo llamada en enviarDm, la unica puerta de los DM

enviarDm exige orgId y revisa el destino (lid o telefono) contra la marca
antes de tocar la red; marcado o sin verificar no sale, sin reintento.
Los 9 llamadores pasan orgId.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Cancelar o reprogramar una cita no le escribe a un colega marcado

**Files:**
- Modify: `src/groups/cancelar-cita.js` (`avisarAlColega`)
- Test: `test/cancelar-cita.test.js`

**Interfaces:**
- Produces: `avisarAlColega(...)` puede devolver `"solo_llamada"` (además de `"oficial" | "linea_natalia" | "no_se_pudo"`). `cancelar`/`reprogramar` lo pasan tal cual en `aviso`.

- [ ] **Step 1: Write the failing test**

En `test/cancelar-cita.test.js`, debajo de `const RUTA = ...;` agregar:

```js
const memory = require("../src/data/memory");
```

Agregar al final del archivo:

```js
// SOLO LLAMADA (Juan, 2026-09-10): la cancelacion sale primero por la Cloud API
// oficial, que no pasa por waha.enviarDm (el candado). Por eso este camino
// tiene su propio chequeo: a un colega marcado no le sale nada por ninguna de
// las dos lineas, y se le avisa al equipo para que lo llame.
test("colega solo llamada: la cita se cancela, no se le escribe y el equipo recibe la orden de llamar", async () => {
  memory.colegasGrupos.push({
    id: "c1", org_id: "org-1", lid: "63402340827320", telefono: "573147815403",
    nombre: "Miguel", grupos: [], solo_llamada: true,
  });
  try {
    const mod = instalar(CITA);
    const r = await mod.cancelar(ORG, "lead-1", { motivo: "ya se vendio", sesion: "RADA-NATALIA" });
    assert.strictEqual(r.resultado, "cancelada");
    assert.strictEqual(r.aviso, "solo_llamada");
    assert.strictEqual(leadGuardado.cita.estado, "cancelada", "el registro cambia igual");
    assert.strictEqual(enviosOficial.length, 0, "ni la linea oficial");
    assert.strictEqual(enviosWaha.length, 0, "ni la linea de Natalia");
    assert.strictEqual(alertas.length, 1);
    assert.match(alertas[0].texto, /llamá a Miguel/);
    assert.match(alertas[0].texto, /solo por llamada/);
  } finally {
    memory.colegasGrupos.length = 0;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/cancelar-cita.test.js`
Expected: FAIL — `r.aviso` es `"oficial"`.

- [ ] **Step 3: Implement**

En `src/groups/cancelar-cita.js`, debajo de `const contacto = require("../lib/contacto");` agregar:

```js
const colegas = require("../data/colegas");
```

En `avisarAlColega`, justo después de `const esTelefono = contacto.esCelularColombiano(lead.phone);`, agregar:

```js
  // SOLO LLAMADA (Juan, 2026-09-10): un colega que pidio que lo contacten solo
  // por llamada no recibe este aviso por ninguna de las dos lineas. La linea
  // oficial NO pasa por el candado de waha.enviarDm, asi que el chequeo tiene
  // que estar aca. El registro de la cita ya cambio antes (regla 1): lo unico
  // que cambia es que en vez de escribirle, se le pide al equipo que llame.
  // null (no se pudo verificar) tambien frena.
  const marca = org && org.id
    ? await colegas.esSoloLlamada(org.id, esTelefono ? { telefono: lead.phone } : { lid: lead.phone }).catch(() => null)
    : false;
  if (marca !== false) {
    const numero = esTelefono ? `+${String(lead.phone).replace(/\D/g, "")}` : "sin teléfono visible";
    const quien = lead.nombre || "el colega";
    const alerta = `📞 ${queCambio} — llamá a ${quien} (${numero}) para avisarle: pidió contacto solo por llamada. No se le mandó ningún mensaje.`;
    for (const to of ALERTA_TO()) {
      await mensajeAsesor.enviarYRegistrar(org, to, alerta).catch((e) =>
        console.warn("[citas] no se pudo pedir la llamada al equipo:", e.message)
      );
    }
    return "solo_llamada";
  }
```

Actualizar el comentario de la cabecera de `avisarAlColega`: `// Devuelve "oficial" | "linea_natalia" | "no_se_pudo" | "solo_llamada". Nunca lanza: ...`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/cancelar-cita.test.js test/cancelar-cita-endpoint.test.js test/citas-colega.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/groups/cancelar-cita.js test/cancelar-cita.test.js
git commit -m "$(cat <<'EOF'
feat(citas): cancelar o reprogramar no le escribe a un colega solo llamada

La linea oficial no pasa por el candado de enviarDm: el chequeo va en
avisarAlColega. La cita cambia igual y el equipo recibe la orden de llamar.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Sofi puede marcar al colega de verdad

**Files:**
- Modify: `src/agent/tools.js` (`TOOL_DEFINITIONS`, dispatch en `executeTool`, función nueva, `module.exports`)
- Modify: `src/agent/prompts.js` (`promptColega`, texto estable)
- Test: `test/colega-solo-llamada-tool.test.js` (nuevo), `test/colega-escribe-a-sofi.test.js`

**Interfaces:**
- Consumes: `colegas.marcarSoloLlamada` (Task 3), `advisors.findAsesorPrincipalRadar(org)`, `mensajeAsesor.enviarYRegistrar(org, telefono, texto)`.
- Produces: tool `marcar_colega_solo_llamada` (input opcional `{ detalle: string }`); `marcarColegaSoloLlamada(input, ctx) -> Promise<string>` exportada.

- [ ] **Step 1: Write the failing tests**

Crear `test/colega-solo-llamada-tool.test.js`:

```js
// Sofi marca de verdad al colega que pide solo llamada (Juan, 2026-09-10).
// Caso Angela Moscoso: Sofi le dijo "ya esta anotado" sin llamar ninguna
// herramienta, y dos horas despues el radar le mando un DM. Lo que se fija:
// que la marca quede guardada, que la asesora se entere, y que Sofi NUNCA
// reciba un texto que la invite a decir "anotado" si no se pudo guardar.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const memory = require("../src/data/memory");
const { executeTool, TOOL_DEFINITIONS } = require("../src/agent/tools");
const advisors = require("../src/data/advisors");
const mensajeAsesor = require("../src/lib/mensaje-asesor");

const ctxColega = () => ({
  org: { id: "org-1", name: "Diamond" },
  lead: { id: "lead-1", phone: "573146399667" },
  colega: { lid: "266150634110990", telefono: "573146399667", nombre: "tengotuinmueblecomercial1" },
});

let avisos;
beforeEach(() => {
  memory.colegasGrupos.length = 0;
  avisos = [];
});

function mockAviso(t) {
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => ({ id: "adv-natalia", name: "Natalia Velez", phone: "573001878024" }));
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async (org, telefono, texto) => {
    avisos.push({ telefono, texto });
    return { ok: true };
  });
}

test("la tool esta declarada", () => {
  const def = TOOL_DEFINITIONS.find((d) => d.name === "marcar_colega_solo_llamada");
  assert.ok(def);
  assert.match(def.description, /solo por llamada|únicamente por llamada/);
});

test("con un colega que esta en los grupos: lo marca, avisa a la asesora y Sofi puede confirmarlo", async (t) => {
  mockAviso(t);
  memory.colegasGrupos.push({ id: "c1", org_id: "org-1", lid: "266150634110990", telefono: "573146399667", nombre: "tengotuinmueblecomercial1", grupos: [], solo_llamada: false });

  const out = await executeTool("marcar_colega_solo_llamada", { detalle: "que la llamen, no mensajes" }, ctxColega());

  assert.strictEqual(memory.colegasGrupos[0].solo_llamada, true);
  assert.match(out, /quedó guardado/);
  assert.strictEqual(avisos.length, 1);
  assert.strictEqual(avisos[0].telefono, "573001878024");
  assert.match(avisos[0].texto, /SOLO por llamada/);
  assert.match(avisos[0].texto, /\+573146399667/);
  assert.match(avisos[0].texto, /que la llamen, no mensajes/);
});

test("si no lo encuentra, NO le da a Sofi un texto para decir 'anotado', y avisa igual a la asesora", async (t) => {
  mockAviso(t);
  const out = await executeTool("marcar_colega_solo_llamada", {}, ctxColega());
  assert.match(out, /NO se pudo guardar/);
  assert.match(out, /NO le digas que quedó anotado/);
  assert.doesNotMatch(out, /quedó guardado/);
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0].texto, /NO pude guardar la marca/);
});

test("con alguien que no es colega, no aplica", async (t) => {
  mockAviso(t);
  const out = await executeTool("marcar_colega_solo_llamada", {}, { ...ctxColega(), colega: null });
  assert.match(out, /No aplica/);
  assert.strictEqual(avisos.length, 0);
});
```

En `test/colega-escribe-a-sofi.test.js`, agregar al final:

```js
test("si el colega pide solo llamada, el prompt le da la herramienta y le prohibe decir 'anotado' sin ella", () => {
  const p = texto(buildSystemPrompt({ org, lead, qualified: false, now: null, colega }));
  assert.match(p, /marcar_colega_solo_llamada/);
  assert.match(p, /nunca digas "quedó anotado"/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/colega-solo-llamada-tool.test.js test/colega-escribe-a-sofi.test.js`
Expected: FAIL — la tool no existe.

- [ ] **Step 3: Implement the tool**

En `src/agent/tools.js`:

1. Debajo de `const mandatos = require("../data/mandatos");` agregar:

```js
const colegas = require("../data/colegas");
```

2. En `TOOL_DEFINITIONS`, justo antes del objeto con `name: "registrar_mandato_compra",`, agregar:

```js
  {
    name: "marcar_colega_solo_llamada",
    description:
      "Úsala SOLO con un colega de otra inmobiliaria que pide contacto únicamente por llamada, o que no le manden más mensajes. Deja la marca guardada: desde ese momento el radar nunca le escribe por WhatsApp y cada pedido suyo le llega a la asesora para que llame. No la uses con un cliente ni con un asesor de la casa.",
    input_schema: {
      type: "object",
      properties: {
        detalle: { type: "string", description: "Lo que pidió el colega, en sus palabras (ej. 'que la llamen al 314..., no mensajes')" },
      },
    },
  },
```

3. En `executeTool`, justo después del bloque `if (name === "rechazar_pedido_radar") { ... }`, agregar:

```js
  if (name === "marcar_colega_solo_llamada") {
    return marcarColegaSoloLlamada(input, ctx);
  }
```

4. Encima de `module.exports = {`, agregar:

```js
// El colega que pide que lo contacten SOLO por llamada (Juan, 2026-09-10).
// Caso Angela Moscoso: Sofi le contesto "ya esta anotado" sin llamar ninguna
// herramienta — no habia donde anotarlo — y dos horas despues el radar le
// mando un DM. Esta herramienta guarda la marca de verdad (colegas_grupos.
// solo_llamada, que frena todos los DM) y le avisa a la asesora principal del
// radar, que desde ahi es quien llama.
//
// Si no se pudo guardar, el texto que vuelve le PROHIBE a Sofi decir
// "anotado": es exactamente la mentira que origino esto. La asesora se entera
// igual, con la aclaracion, para que no dependa de que el sistema lo haya
// guardado.
async function marcarColegaSoloLlamada(input, ctx) {
  if (!ctx.colega) {
    return "No aplica: esta herramienta es solo para un colega de otra inmobiliaria que pide contacto por llamada.";
  }
  const r = await colegas.marcarSoloLlamada(ctx.org.id, { telefono: ctx.lead.phone });
  const nombre = (r.colega && r.colega.nombre) || ctx.colega.nombre || "Un colega";
  const tel = `+${String(ctx.lead.phone || "").replace(/\D/g, "")}`;
  const detalle = input && input.detalle ? `Lo dijo así: "${String(input.detalle).trim()}"` : null;

  const texto = r.ok
    ? [
        `📞 ${nombre} pidió contacto SOLO por llamada.`,
        ``,
        `Desde ahora el radar no le escribe: cada pedido suyo te llega a vos para que llames al ${tel}.`,
        detalle,
      ]
    : [
        `📞 ${nombre} (${tel}) pidió contacto SOLO por llamada, pero NO pude guardar la marca en el sistema${r.motivo === "no_encontrado" ? " (no lo encuentro entre los colegas de los grupos)" : ""}.`,
        ``,
        `Si el radar le escribe, es por esto. Llamá vos y avisale al administrador.`,
        detalle,
      ];

  const asesora = await advisors.findAsesorPrincipalRadar(ctx.org).catch(() => null);
  if (asesora && asesora.phone) {
    // Require tardio (mismo motivo que avisarCitaAutoAgendada, arriba).
    const mensajeAsesor = require("../lib/mensaje-asesor");
    await mensajeAsesor
      .enviarYRegistrar(ctx.org, String(asesora.phone).replace(/\D/g, ""), texto.filter((l) => l !== null).join("\n"))
      .catch((e) => console.warn("[tools] No se pudo avisar el pedido de solo llamada:", e.message));
  }

  if (r.ok) {
    return "Listo, quedó guardado: el radar ya no le escribe por WhatsApp y la asesora va a llamar. Confirmáselo con tus palabras, corto.";
  }
  return "NO se pudo guardar en el sistema. NO le digas que quedó anotado ni registrado: decile solamente que le pasaste el pedido a la asesora para que llame.";
}
```

5. Agregar `marcarColegaSoloLlamada` al `module.exports`.

- [ ] **Step 4: Implement the prompt rule**

En `src/agent/prompts.js`, dentro de `promptColega`, en el texto `stable`, justo después del párrafo que empieza con `PARA TODO LO DEMAS QUE NO ES UNA VISITA AGENDADA` (y antes de `LO QUE NO SABES:`), agregar:

```
SI TE PIDE QUE NO LE ESCRIBAN, O CONTACTO SOLO POR LLAMADA: usa marcar_colega_solo_llamada. Solo con el resultado de esa herramienta podes decirle que quedo guardado; si la herramienta dice que no se pudo, deciselo como ella indica. Nunca digas "quedó anotado" o "ya quedó registrado" sobre algo que no hiciste con una herramienta.
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/colega-solo-llamada-tool.test.js test/colega-escribe-a-sofi.test.js test/registrar-demanda-colega.test.js test/colega-deteccion.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agent/tools.js src/agent/prompts.js test/colega-solo-llamada-tool.test.js test/colega-escribe-a-sofi.test.js
git commit -m "$(cat <<'EOF'
feat(sofi): marcar_colega_solo_llamada -- la marca queda guardada de verdad

Sofi guarda la marca y le avisa a la asesora principal del radar. Si no
se pudo, el resultado le prohibe decir "anotado". promptColega suma la
regla.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: La página del aviso — mockup, aprobación y componente

**Files:**
- Create: `docs/superpowers/mockups/2026-09-10-aviso-solo-llamada.html`
- Modify: `src/groups/vivo.js` (`prepararAviso`, línea ~1487)
- Modify: `crm/components/aviso-celular.tsx`
- Modify: `crm/components/senales-grupos.tsx` (`borrador`, línea ~228)
- Test: `test/group-vivo.test.js`

**Interfaces:**
- Consumes: `colegas.esSoloLlamada` (Task 3), `porqueNoSalioSolo` (Task 5).
- Produces: `prepararAviso(...)` suma `soloLlamada: boolean` y `telefonoLlamada: string | null` (dígitos con 57); `mensaje` es `null` si `soloLlamada`. `DatosAviso` (TS) suma los mismos campos opcionales.

- [ ] **Step 1: Write the mockup**

Crear `docs/superpowers/mockups/2026-09-10-aviso-solo-llamada.html`:

```html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mockup — aviso para colega solo llamada</title>
<script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-100">
<p class="mx-auto max-w-md px-5 pt-4 text-xs text-slate-500">Mockup 2026-09-10 — página /aviso/[token] cuando el colega pidió contacto solo por llamada. Cambia: etiqueta arriba, franja ámbar, no hay mensaje redactado, "Contacto" dice a qué número llamar, botón verde → "📞 Llamar".</p>
<main class="relative mx-auto mt-3 min-h-[720px] max-w-md bg-white pb-40 text-slate-900 shadow">
  <header class="bg-gradient-to-br from-[#0b1526] to-[#15213a] px-5 pb-4 pt-5 text-slate-100">
    <div class="text-[11px] font-bold uppercase tracking-wider text-[#f2d58a]">📞 Pidió solo llamada · Pedido N° 645</div>
    <h1 class="mt-1 text-lg font-extrabold leading-tight">tengotuinmueblecomercial1 busca apartamento en Envigado</h1>
    <div class="mt-1 text-xs text-slate-300">Grupo <b class="font-semibold text-white">PEDIDOS -Buscando PEDIDOS</b> · hace 12 min</div>
    <div class="mt-2 inline-block rounded-full border border-[#d4a53a]/40 bg-[#d4a53a]/15 px-2 py-0.5 text-[11px] text-[#f2d58a]">👁 Visto</div>
  </header>
  <section class="border-b border-amber-200 bg-amber-50 px-5 py-3">
    <p class="text-sm font-semibold text-amber-900">📞 Este colega pidió contacto solo por llamada. No le escribas por WhatsApp.</p>
  </section>
  <section class="border-b border-slate-200 px-5 py-3">
    <p class="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Por qué no salió solo</p>
    <p class="rounded-r-lg border-l-4 border-amber-400 bg-slate-50 px-3 py-2 text-sm">📞 Este colega pidió contacto SOLO por llamada — nada de mensajes. El bot no le escribió. Es una oportunidad YA APROBADA por Sofi: llamá con urgencia.</p>
  </section>
  <section class="border-b border-slate-200 px-5 py-3">
    <p class="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Lo que pide</p>
    <p class="rounded-r-lg border-l-4 border-indigo-500 bg-slate-50 px-3 py-2 text-sm">🟢🟢🟢🟢 PEDIDO 👉 645 · BUSCO APARTAMENTO · Envigado, Itagüí, La Estrella o Sabaneta · Máximo $350.000.000 · 2 habitaciones · 2 baños · Angela Moscoso 📲 314 639 9667</p>
  </section>
  <section class="border-b border-slate-200 px-5 py-3">
    <p class="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Le sirve · 1</p>
    <div class="flex items-start justify-between gap-2">
      <div><div class="text-sm font-semibold">Vendo Apartamento en Sabaneta Villa Romera</div><div class="font-mono text-[11px] text-slate-400">ref 10013129 · <span class="text-indigo-600">Wasi ↗</span></div></div>
      <div class="whitespace-nowrap text-base font-bold tabular-nums">$235.000.000</div>
    </div>
    <div class="mt-1 text-xs text-slate-600">Sabaneta · 50 m² · 3 alcobas · 2 baños · garajes: sin dato · estrato 3</div>
  </section>
  <section class="px-5 py-3">
    <p class="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Contacto</p>
    <p class="text-sm text-slate-600">Llamá a <b class="text-slate-900">tengotuinmueblecomercial1</b> al <b class="text-slate-900">314 639 9667</b>. Tené a mano el número de pedido: así es como pide la información.</p>
  </section>
  <div class="absolute inset-x-0 bottom-0 grid gap-2 border-t border-slate-200 bg-white px-4 pb-5 pt-3">
    <a class="rounded-2xl bg-[#25d366] px-4 py-3 text-center text-[15px] font-bold text-[#0b3d22]">📞 Llamar a tengotuinmueblecomercial1</a>
    <button class="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">No sirve para este colega</button>
    <p class="text-center text-[11px] text-slate-400">Al tocar Llamar queda registrado como gestionado.</p>
  </div>
</main>
</body>
</html>
```

- [ ] **Step 2: ⛔ Gate — Juan aprueba el mockup**

Mandarle el archivo a Juan (`SendUserFile`, `display: "render"`) y **esperar su aprobación explícita** antes del Step 5. Si pide cambios, ajustar el mockup y volver a mandar. Los Steps 3-4 (backend) se pueden hacer mientras tanto.

- [ ] **Step 3: Write the failing test (`prepararAviso`)**

Agregar al final de `test/group-vivo.test.js`:

```js
test("prepararAviso: para un colega marcado no arma mensaje y dice a que numero llamar", conColegaMarcado(async () => {
  señalParaAprobar = señalCallada({
    autor_telefono: "141746805670125",
    texto_original: "PEDIDO 👉 645 busco apto 📲 314 639 9667",
    revalidacion: { refs_utiles: ["AP004"], sin_confirmar: [] },
  });
  grupoParaAprobar = grupoHabilitado();
  telefonoColegaManual = null;

  const r = await vivo.prepararAviso({ id: "org-1" }, "sig-callada", { sesion: "RADA-NATALIA" });

  assert.strictEqual(r.resultado, "ok");
  assert.strictEqual(r.soloLlamada, true);
  assert.strictEqual(r.mensaje, null, "no hay mensaje para mandarle");
  assert.strictEqual(r.telefonoLlamada, "573146399667");
  assert.strictEqual(r.motivo, "colega_solo_llamada");
  assert.match(r.porque, /^📞/);
}));

test("prepararAviso: un colega sin marca sigue recibiendo el mensaje armado", async () => {
  señalParaAprobar = señalCallada({ revalidacion: { refs_utiles: ["AP004"], sin_confirmar: [] } });
  grupoParaAprobar = grupoHabilitado();
  const r = await vivo.prepararAviso({ id: "org-1" }, "sig-callada", { sesion: "RADA-NATALIA" });
  assert.strictEqual(r.soloLlamada, false);
  assert.ok(r.mensaje);
  assert.strictEqual(r.telefonoLlamada, null);
});
```

Run: `node --test test/group-vivo.test.js`
Expected: FAIL — `r.soloLlamada` es `undefined`.

- [ ] **Step 4: Implement `prepararAviso`**

En `src/groups/vivo.js`, en `prepararAviso`, reemplazar desde `const aprobada = utiles.length > 0;` hasta el final del `return { ... };` por:

```js
  // SOLO LLAMADA (Juan, 2026-09-10): para un colega marcado la pagina no arma
  // mensaje — no hay nada que mandarle — y dice a que numero llamar. null (no
  // se pudo verificar) cuenta como marcado, igual que en el resto del radar.
  const marca = await colegas
    .esSoloLlamada(org.id, { lid: signal.autor_telefono, telefono: telefonoColega, textoPedido: signal.texto_original })
    .catch(() => null);
  const soloLlamada = marca !== false;
  const motivo = marca === true ? "colega_solo_llamada" : marca === null ? "solo_llamada_no_verificable" : signal.politica_motivo || null;

  const aprobada = utiles.length > 0;
  const mensaje = aprobada && !soloLlamada
    ? redactar.mensajeGrupo({ autor_nombre: signal.autor_nombre }, utiles, {
        org,
        sinConfirmar: rev.sin_confirmar || [],
        leFalta: rev.le_falta || [],
        pedido: pedidoDe(signal),
      })
    : null;

  return {
    resultado: "ok",
    senal: {
      id: signal.id,
      autor_nombre: signal.autor_nombre,
      grupo_nombre: (grupo && (grupo.nombre || grupo.jid)) || null,
      texto_original: signal.texto_original,
      created_at: signal.created_at,
      operacion: signal.operacion,
      tipo: signal.tipo,
      zona: signal.zona,
      zonas: signal.zonas,
      precio_max: signal.precio_max,
      habitaciones: signal.habitaciones,
      garajes: signal.garajes,
      area_min: signal.area_min,
      sin_confirmar: rev.sin_confirmar || [],
      visto_at: signal.visto_at || null,
      gestionado_at: signal.gestionado_at || null,
      gestion: signal.gestion || null,
      respondida_at: signal.respondida_at || null,
    },
    utiles,
    dudosas: porRef(rev.refs_dudosas),
    descartados,
    mensaje,
    telefonoColega,
    soloLlamada,
    telefonoLlamada: soloLlamada ? telefonoColega || telefonoEnTexto(signal.texto_original) || null : null,
    motivo,
    porque: alertaAsesor.porqueNoSalioSolo(motivo, aprobada),
    aprobada,
  };
```

Run: `node --test test/group-vivo.test.js test/aviso-endpoint.test.js`
Expected: PASS.

- [ ] **Step 5: Implement the component (solo después del ⛔ Gate del Step 2)**

En `crm/components/aviso-celular.tsx`:

1. En `DatosAviso`, después de `telefonoColega: string | null;`, agregar:

```ts
  // Solo llamada (Juan, 2026-09-10): el colega pidió que lo contacten solo por
  // llamada. Sin mensaje que mandar; el botón llama.
  soloLlamada?: boolean;
  telefonoLlamada?: string | null;
```

2. Reemplazar la línea de desestructuración por:

```ts
  const { senal, utiles, dudosas, mensaje, telefonoColega, porque, aprobada, soloLlamada = false, telefonoLlamada = null } = datos;
```

3. Debajo de la función `enviar()`, agregar:

```ts
  async function llamar() {
    await registrar("envio");
    if (telefonoLlamada) window.location.href = `tel:+${telefonoLlamada}`;
  }

  const telLegible = telefonoLlamada ? telefonoLlamada.replace(/^57/, "").replace(/(\d{3})(\d{3})(\d{4})/, "$1 $2 $3") : null;
```

4. Reemplazar el `<div>` de la etiqueta del header:

```tsx
        <div className="text-[11px] font-bold uppercase tracking-wider text-[#f2d58a]">
          {soloLlamada ? "📞 Pidió solo llamada" : aprobada ? "🚨 Aprobada por Sofi · sin salir" : "🎯 Oportunidad · para revisar"}
        </div>
```

5. Reemplazar el texto del badge de gestión:

```tsx
            ✅ {gestion === "envio" ? (soloLlamada ? "Ya llamaste" : "Ya le escribiste") : "Marcado: no sirve"}
```

6. Justo después de `</header>`, agregar:

```tsx
      {soloLlamada && (
        <section className="border-b border-amber-200 bg-amber-50 px-5 py-3">
          <p className="text-sm font-semibold text-amber-900">📞 Este colega pidió contacto solo por llamada. No le escribas por WhatsApp.</p>
        </section>
      )}
```

7. Cambiar `{mensaje && (` de la sección del textarea por `{mensaje && !soloLlamada && (`.

8. Reemplazar la sección "Cómo se la mandás" completa (`<section className="px-5 py-3">` … `</section>`) por:

```tsx
      <section className="px-5 py-3">
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">{soloLlamada ? "Contacto" : "Cómo se la mandás"}</p>
        {soloLlamada ? (
          telLegible ? (
            <p className="text-sm text-slate-600">
              Llamá a <b className="text-slate-900">{senal.autor_nombre || "el colega"}</b> al <b className="text-slate-900">{telLegible}</b>. Tené a mano el número de pedido: así es como pide la información.
            </p>
          ) : (
            <p className="text-sm text-slate-600">
              No tenemos su número: buscalo en <b className="text-slate-900">{senal.grupo_nombre || "el grupo"}</b> y llamá.
            </p>
          )
        ) : telefonoColega ? (
          <p className="text-sm text-slate-600">
            <b className="text-slate-900">{senal.autor_nombre}</b> · {telefonoColega.replace(/^57/, "")}. Se abre el chat con el mensaje ya escrito; solo tocás enviar.
          </p>
        ) : (
          <ol className="grid gap-1 text-sm text-slate-600">
            <li>1. El botón copia el mensaje y abre WhatsApp</li>
            <li>
              2. Entrá a <b className="text-slate-900">{senal.grupo_nombre || "el grupo"}</b> y tocá “{senal.autor_nombre || "el colega"}”
            </li>
            <li>3. Pegá en su chat privado y enviá</li>
          </ol>
        )}
        {aviso && <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{aviso}</p>}
      </section>
```

9. En el pie fijo, reemplazar el bloque `{mensaje && ( <button onClick={enviar} ...> ... </button> )}` por:

```tsx
        {soloLlamada ? (
          <button
            onClick={llamar}
            disabled={ocupado || !telefonoLlamada}
            className="rounded-2xl bg-[#25d366] px-4 py-3 text-[15px] font-bold text-[#0b3d22] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a53a] disabled:opacity-60"
          >
            📞 Llamar a {nombre}
          </button>
        ) : (
          mensaje && (
            <button
              onClick={enviar}
              disabled={ocupado}
              className="rounded-2xl bg-[#25d366] px-4 py-3 text-[15px] font-bold text-[#0b3d22] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a53a] disabled:opacity-60"
            >
              {telefonoColega ? "💬 Enviar por WhatsApp" : "📋 Copiar y abrir WhatsApp"}
            </button>
          )
        )}
```

10. Reemplazar la línea de pie:

```tsx
        <p className="text-center text-[11px] text-slate-400">{soloLlamada ? "Al tocar Llamar queda registrado como gestionado." : "Al tocar el botón verde queda registrado como gestionado."}</p>
```

- [ ] **Step 6: El borrador del CRM también dice a qué pedido responde**

En `crm/components/senales-grupos.tsx`, dentro de `borrador`, reemplazar el `return (` … `);` final por:

```ts
  // A qué pedido le contestamos (Juan, 2026-09-10). Misma regla que
  // src/groups/pedido.js#numeroPedido (fuente de verdad del bot): "pedido" +
  // número, o el código C_647; nunca un # suelto. Sin \p{} para no depender del
  // target de TypeScript del CRM.
  const texto = s.texto_original || "";
  const numero =
    texto.match(/pedido[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]{0,8}(\d{2,6})(?!\d)/i)?.[1] ||
    texto.match(/(?:^|[^A-Za-z0-9])C_(\d{2,6})(?!\d)/)?.[1] ||
    null;
  const referencia = numero ? `te respondo tu PEDIDO ${numero}` : "vi tu solicitud en el grupo";

  return (
    `${quien}${referencia}. Tengo esto disponible que te puede servir:\n\n` +
    `${lineas.join("\n\n")}\n\n` +
    `Comisión compartida.`
  );
```

- [ ] **Step 7: Typecheck y lint del CRM**

Run: `cd crm && npx tsc --noEmit && npm run lint`
Expected: sin errores nuevos (si `npm run lint` ya tenía avisos previos, que no aparezca ninguno en `aviso-celular.tsx` ni en `senales-grupos.tsx`).

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/mockups/2026-09-10-aviso-solo-llamada.html src/groups/vivo.js crm/components/aviso-celular.tsx crm/components/senales-grupos.tsx test/group-vivo.test.js
git commit -m "$(cat <<'EOF'
feat(crm): la pagina del aviso llama en vez de escribir al colega solo llamada

prepararAviso devuelve soloLlamada y telefonoLlamada y no arma mensaje;
la pagina muestra la franja, el numero y "📞 Llamar". El borrador de
/grupos dice "te respondo tu PEDIDO N". Mockup aprobado por Juan.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Suite completa, documentación, revisión y despliegue

**Files:**
- Modify: `CLAUDE.md` (sección "2. Estado actual")

- [ ] **Step 1: Suite completa**

Run: `npm test`
Expected: todo en verde (base 1730 + los nuevos). Si algo falla, arreglarlo antes de seguir; no marcar esta tarea sin la salida en verde.

- [ ] **Step 2: Build del CRM**

Run: `cd crm && npm run build`
Expected: build OK.

- [ ] **Step 3: Actualizar `CLAUDE.md`**

En "## 2. Estado actual", agregar al principio de la lista:

```markdown
- **Colega "solo llamada" y DM con el número de pedido (rama
  `colega-solo-llamada`, 2026-09-10).** Caso Ángela Moscoso: pidió contacto
  solo por llamada, Sofi dijo "anotado" sin herramienta y el radar le mandó un
  DM dos horas después. Ahora `colegas_grupos.solo_llamada` (migración
  `2026-09-10_colega_solo_llamada.sql`, **corrida y verificada por REST el
  2026-09-10**; Ángela ya marcada) frena todos los DM: `decidirDm`, los dos
  caminos manuales, citas y un candado en `waha.enviarDm` (que ahora exige
  `orgId`). La marca se reconoce por lid, teléfono (con `directorio_lids`) y
  el celular escrito en el pedido. Sofi tiene `marcar_colega_solo_llamada`.
  Además todo DM dice "te respondo tu PEDIDO N" o describe el pedido (solo el
  3,8 % trae número). Spec y plan en `docs/superpowers/`.
```

(Si al momento de ejecutar ya se desplegó, decirlo con la fecha y el commit, igual que las otras entradas.)

- [ ] **Step 4: Commit de la documentación**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: estado -- colega solo llamada y DM con numero de pedido

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Code review**

Usar `superpowers:requesting-code-review` sobre `git diff main...colega-solo-llamada`. Arreglar lo crítico e importante con su test antes de seguir.

- [ ] **Step 6: ⛔ Gate — Juan aprueba el merge y el push**

`git push origin main` despliega Railway y los dos Vercel. Pedirle el visto bueno a Juan con: resumen del cambio, suite en verde (número exacto de la salida), lo que queda pendiente. Sin su sí, no se mergea ni se pushea.

- [ ] **Step 7: Merge y push (solo con el sí de Juan)**

```bash
git checkout main
git merge --no-ff colega-solo-llamada -m "merge: colega solo llamada y DM con numero de pedido"
git push origin main
```

- [ ] **Step 8: Verificación en producción (spec §8)**

Después del deploy (confirmar en los logs de Railway que arrancó el commit nuevo):

1. Cero DMs a Ángela desde el deploy — por REST, `group_signals` con `respuesta_destino_lid = '266150634110990@lid'` o `respuesta_destino_telefono = '573146399667'` y `respondida_at` posterior a la hora del deploy → 0 filas.
2. El próximo pedido de Ángela con propiedades: `politica_motivo = 'colega_solo_llamada'`, `respondida_at` null, `aviso_advisor_id` de Natalia, y el aviso en el chat de Natalia empieza con "📞 LLAMAR — Pedido N°".
3. Los DM a otros colegas posteriores al deploy: `respuesta_texto` empieza con "Hola …, te respondo tu PEDIDO …" o "… te respondo tu pedido …".

Dejar el resultado de cada punto (con números) en la entrada de `CLAUDE.md` y en la memoria del proyecto.
