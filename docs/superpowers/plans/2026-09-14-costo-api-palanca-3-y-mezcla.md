# Costo de la API: buscar_propiedades liviano y mezcla del clasificador

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bajar los tokens que `buscar_propiedades` le manda a Sofi en cada vuelta del tool loop, y medir en qué termina cada mensaje que paga el clasificador, para decidir con datos la próxima palanca.

**Architecture:** Dos cambios independientes, cada uno en su commit. (1) `src/agent/tools.js` deja de serializar columnas internas y deja de indentar el JSON. (2) El canal de grupos (`src/channels/whatsapp-group.js`) cuenta, después de `vivo.procesarMensaje`, si el mensaje terminó en ruido, oferta o demanda, y lo expone en `/webhook/grupos/estado`. Ninguno cambia lo que Sofi responde ni lo que el radar decide.

**Tech Stack:** Node.js (CommonJS), `node:test`, Railway (`railway run` para la clave de producción).

## Global Constraints

- Contexto: auditoría del 2026-09-14 (`docs/costo-api-claude.md`, artifact "Costo del radar Diamond"). La palanca 1 (cache del clasificador) ya está en producción, commit `b9fc9b1`.
- La palanca 2 original (compuerta léxica de intención antes del clasificador) **se descarta**: medido sobre producción, deja pasar el 98,6–99,1 % de 1.509 demandas reales pero también el 93,3–93,6 % de 329 ofertas reales. No recortaría las ofertas; su ahorro dependería solo del ruido, que no está medido. La tarea 2 mide eso.
- Regla del repo: los tests prueban comportamiento, no `includes()` sobre el fuente (memoria `linea-dm-puerta-lid-cerrada`).
- Nada de contenido de terceros en logs ni contadores: solo cuentas.
- Commits en español, prefijos convencionales, con `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Deploy = `git push origin main` (Railway + Vercel). Solo después de suite completa en verde.

---

### Task 1: `buscar_propiedades` sin columnas internas y en JSON compacto

**Files:**
- Modify: `src/agent/tools.js` (bloque final de `executeTool` para `buscar_propiedades`, hoy `results.map(({ images, ...resto }) => resto)` + `JSON.stringify(paraElModelo, null, 2)`)
- Test: `test/tool-payload.test.js`

**Interfaces:**
- Consumes: `executeTool(name, input, ctx)` existente; `properties.search` mockeable.
- Produces: la salida de `buscar_propiedades` es un JSON compacto (sin saltos de línea) de filas sin `images`, `id`, `org_id`, `created_at`, `captador_id`, `prioridad_venta`. `disponible` se queda.

- [ ] **Step 1: Write the failing tests** — agregar al final de `test/tool-payload.test.js`:

```js
test("el resultado no lleva columnas internas que Sofi nunca lee", async (t) => {
  t.mock.method(properties, "search", async () => [
    propiedad({ captador_id: "adv-9", prioridad_venta: 2, created_at: "2026-07-01T00:00:00Z" }),
  ]);
  const salida = await executeTool("buscar_propiedades", { zona: "Envigado" }, ctxDe());
  const [p] = JSON.parse(salida);
  for (const campo of ["id", "org_id", "created_at", "captador_id", "prioridad_venta"]) {
    assert.ok(!(campo in p), `${campo} no le sirve al modelo y se paga en cada vuelta del tool loop`);
  }
  assert.strictEqual(p.disponible, true, "disponible se queda: la regla 18 del prompt lo usa");
});

test("el resultado viaja en JSON compacto, sin sangria", async (t) => {
  t.mock.method(properties, "search", async () => [propiedad({ descripcion: "Linea uno.\nLinea dos." })]);
  const salida = await executeTool("buscar_propiedades", { zona: "Envigado" }, ctxDe());
  assert.ok(!salida.includes("\n"), "la sangria son tokens que el modelo no necesita");
  assert.strictEqual(JSON.parse(salida)[0].descripcion, "Linea uno.\nLinea dos.", "el contenido no cambia");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/tool-payload.test.js`
Expected: FAIL — `id no le sirve al modelo…` y `la sangria son tokens…`.

- [ ] **Step 3: Minimal implementation** — en `src/agent/tools.js`, reemplazar las dos líneas finales del bloque de `buscar_propiedades`:

```js
    const paraElModelo = results.map((p) =>
      Object.fromEntries(Object.entries(p).filter(([campo]) => !NO_AL_MODELO.has(campo)))
    );
    return JSON.stringify(paraElModelo);
```

y declarar a nivel de módulo, antes de `executeTool`:

```js
// Columnas de `properties` que NO viajan al modelo en buscar_propiedades. El
// resultado entra como tool_result y se reenvia entero en cada vuelta del tool
// loop (engine.js), asi que cada campo de mas se paga por iteracion.
// - images (2026-09-05): el 61% de la fila; la ficha usa `link`, no las URLs.
// - id, org_id, created_at, captador_id, prioridad_venta (2026-09-14): internas;
//   ningun prompt ni tool las nombra (las tools identifican por `ref`).
// `disponible` se queda: la regla 18 del prompt la usa.
const NO_AL_MODELO = new Set(["images", "id", "org_id", "created_at", "captador_id", "prioridad_venta"]);
```

Y el JSON va sin sangría (`JSON.stringify(x)`): medido con count_tokens, 5 propiedades bajan de 3.002 a 2.572 tokens solo por eso.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/tool-payload.test.js test/ally-tool.test.js test/captador-alert.test.js test/colega-no-embudo.test.js`
Expected: PASS, 0 fail.

- [ ] **Step 5: Measure** — con la clave de producción (count_tokens es gratis), comparar el tool_result de 5 propiedades reales antes y después:

Run: `railway run --service diamond node <scratchpad>/contar-tokens.js` (sección `buscar_propiedades`)
Expected: tokens del resultado nuevo < 2.572 (compacto) — anotar el número en el commit.

- [ ] **Step 6: Commit**

```bash
git add src/agent/tools.js test/tool-payload.test.js
git commit -m "fix(bot): buscar_propiedades deja de mandarle a Sofi columnas internas y sangria"
```

---

### Task 2: Mezcla del clasificador en `/webhook/grupos/estado`

**Files:**
- Modify: `src/channels/whatsapp-group.js` (objeto `metricas`, función `procesar`, exports del final)
- Test: `test/radar-mezcla-clasificador.test.js` (nuevo)

**Interfaces:**
- Consumes: `vivo.procesarMensaje(...)` → `{ resultado }`. Valores: `"ruido"`; `"oferta_sin_match"` / `"oferta_cruzada"` (camino de ofertas); `"sin_clasificar"` (falló la llamada); `"radar_apagado"` / `"descartado_prefiltro"` (no llegó a clasificar); cualquier otro = el mensaje fue demanda.
- Produces:
  - `claseDelResultado(resultado) → "ruido" | "oferta" | "demanda" | "sin_clasificar" | null`, exportado como `module.exports._claseDelResultado`.
  - `procesar` exportado como `module.exports._procesar` (mismo patrón que `_metricas`, `_yaVisto`).
  - Nuevas claves en `metricas`: `clasificados_demanda`, `clasificados_oferta`, `clasificados_ruido`, `sin_clasificar`.

- [ ] **Step 1: Write the failing tests** — crear `test/radar-mezcla-clasificador.test.js`:

```js
// Que termina siendo cada mensaje que paga el clasificador (auditoria de
// costo, 2026-09-14). Sin esta mezcla no se sabe si achicar la salida del
// ruido vale la pena: es el dato que decide la proxima palanca.
const test = require("node:test");
const assert = require("node:assert");

const canal = require("../src/channels/whatsapp-group");
const vivo = require("../src/groups/vivo");
const advisors = require("../src/data/advisors");
const organizations = require("../src/data/organizations");

test("cada resultado del radar cae en la clase que lo produjo", () => {
  const c = canal._claseDelResultado;
  assert.strictEqual(c("ruido"), "ruido");
  assert.strictEqual(c("oferta_sin_match"), "oferta");
  assert.strictEqual(c("oferta_cruzada"), "oferta");
  for (const r of ["sin_candidatas", "descartada_por_sofi", "dm_enviado", "callado", "duplicado", "sin_señal", "en_cola"]) {
    assert.strictEqual(c(r), "demanda", `${r} sale del camino de demandas`);
  }
  assert.strictEqual(c("sin_clasificar"), "sin_clasificar");
  assert.strictEqual(c("radar_apagado"), null);
  assert.strictEqual(c("descartado_prefiltro"), null);
});

test("el canal cuenta en que termino cada mensaje clasificado", async (t) => {
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => null);
  t.mock.method(organizations, "modoDeRespuesta", () => "asistido");
  const salidas = ["ruido", "oferta_sin_match", "sin_candidatas", "sin_clasificar"];
  t.mock.method(vivo, "procesarMensaje", async () => ({ resultado: salidas.shift() }));

  const m = canal._metricas;
  const antes = { ...m };
  const grupo = { id: "g-mezcla", jid: "120363@g.us", nombre: "Pedidos" };
  const textos = ["busco apto en laureles mezcla-1", "vendo casa en belen mezcla-2", "busco local en envigado mezcla-3", "arriendo apto en sabaneta mezcla-4"];
  for (const [i, texto] of textos.entries()) {
    await canal._procesar(
      { id: "org-1" },
      { waMessageId: `mezcla-${i}`, texto, autorNombre: "Colega", autorId: "573001112233@c.us", tsMs: Date.now(), tieneMedia: false, sesion: "S", chatId: grupo.jid },
      grupo,
      null
    );
  }
  const delta = (k) => (m[k] || 0) - (antes[k] || 0);
  assert.strictEqual(delta("clasificados_ruido"), 1);
  assert.strictEqual(delta("clasificados_oferta"), 1);
  assert.strictEqual(delta("clasificados_demanda"), 1);
  assert.strictEqual(delta("sin_clasificar"), 1);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/radar-mezcla-clasificador.test.js`
Expected: FAIL — `canal._claseDelResultado is not a function`.

- [ ] **Step 3: Minimal implementation** — en `src/channels/whatsapp-group.js`:

(a) En `metricas`, agregar las claves (contar() ignora claves que no existen):

```js
  // Que termino siendo cada mensaje clasificado (auditoria de costo,
  // 2026-09-14): es lo que dice cuanto del gasto del clasificador es ruido.
  clasificados_demanda: 0, clasificados_oferta: 0, clasificados_ruido: 0, sin_clasificar: 0,
```

(b) Antes de `procesar`, la función pura:

```js
// En que termino un mensaje que llego al clasificador, a partir del resultado
// de vivo.procesarMensaje. null = no llego a clasificarse (radar apagado o
// descartado por el prefiltro). Todo lo que no es ruido, oferta ni fallo salio
// del camino de demandas.
function claseDelResultado(resultado) {
  if (resultado === "ruido") return "ruido";
  if (resultado === "sin_clasificar") return "sin_clasificar";
  if (resultado === "radar_apagado" || resultado === "descartado_prefiltro") return null;
  if (typeof resultado === "string" && resultado.startsWith("oferta_")) return "oferta";
  return "demanda";
}
```

(c) En `procesar`, justo después del bloque `if (r.resultado === "publicado") contar(...) ... else if (...aviso_pendiente...)`:

```js
  const clase = claseDelResultado(r.resultado);
  if (clase === "sin_clasificar") contar("sin_clasificar");
  else if (clase) contar(`clasificados_${clase}`);
```

(d) Al final del archivo, con los otros exports de test:

```js
module.exports._procesar = procesar;
module.exports._claseDelResultado = claseDelResultado;
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/radar-mezcla-clasificador.test.js test/group-canal.test.js test/directorio-enganche.test.js`
Expected: PASS, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/channels/whatsapp-group.js test/radar-mezcla-clasificador.test.js
git commit -m "feat(radar): /estado cuenta en que termina cada mensaje que paga el clasificador"
```

---

### Task 3: Suite, documentación, deploy y verificación

**Files:**
- Modify: `docs/costo-api-claude.md` (sección "Actualizacion 2026-09-14": palanca 2 descartada con los números; palanca 3 aplicada; cómo leer la mezcla)
- Modify: `CLAUDE.md` (bullet "Costo de la API" del estado actual)

- [ ] **Step 1:** `npm test` → Expected: `ℹ fail 0`.
- [ ] **Step 2:** Actualizar los dos documentos con los números medidos en Task 1 Step 5 y la decisión sobre la palanca 2.
- [ ] **Step 3:** Commit `docs: palanca 3 aplicada, compuerta descartada y como leer la mezcla del clasificador` y `git push origin main`.
- [ ] **Step 4:** Verificar el deploy: `railway run --service diamond node <scratchpad>/estado.js` hasta que `metricas.desde` sea posterior al push, y confirmar que `metricas` trae `clasificados_*`. En los logs de Railway, `[uso] classify … cache_read=` sigue alto.
- [ ] **Step 5:** A las 24–48 h, leer la mezcla (`clasificados_ruido / (ruido+oferta+demanda)`) y decidir: si el ruido es ≥ 40 %, planear la salida corta para ruido; si no, el clasificador queda como está.
