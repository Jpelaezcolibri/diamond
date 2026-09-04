# Radar: DM flexible al colega — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el radar deje de descartar propiedades por un dato accesorio y se
las mande al colega con el hueco declarado, sin quitarle los frenos que
protegen la línea.

**Architecture:** Cuatro cambios quirúrgicos sobre módulos existentes. Las
compuertas duras de `match.js` dejan de descartar candidatas accesorias (el
castigo de puntaje ya existía y era inalcanzable). El criterio de aprobación
sigue siendo Sofi (`revalidar.js`), a la que se le enseña a derivar a Natalia
lo que no podemos evaluar. `politica.js` pierde el tope por colega y gana un
cortacircuitos atado a la cuota real de WhatsApp. Nada nuevo se construye:
todo es abrir, frenar o registrar sobre piezas ya aprobadas.

**Tech Stack:** Node.js 22, CommonJS, `node:test` + `node:assert`. Sin
frameworks de test. Supabase por REST. WAHA por HTTP.

**Spec:** [2026-09-04-radar-dm-flexible-design.md](../specs/2026-09-04-radar-dm-flexible-design.md)

## Global Constraints

- Idioma del código: inglés. Comentarios y mensajes al usuario: español.
- Commits en español con prefijo convencional (`feat:`, `fix:`, `docs:`).
- Correr toda la suite con `npm test` antes de cada commit. **Ninguna tarea se
  da por cerrada con un test rojo preexistente sin decirlo explícitamente.**
- `src/groups/politica.js` es código PURO: no consulta la base, no llama IA, no
  envía. Recibe hechos y devuelve `{enviarDm, motivo, traza}`. **No romper esto.**
- Ningún "no" de `decidirDm` puede descartar un pedido: todos derivan a la
  asesora. Invariante de Juan del 2026-08-24.
- `src/lib/waha.js` debe seguir teniendo **exactamente dos** llamadas a
  `/api/sendText` (`enviarTexto` y `enviarDm`). `test/group-canal.test.js` lo
  verifica leyendo el fuente. No agregar una tercera.
- Toda columna nueva de `group_signals` se escribe con degradación limpia: si
  la migración no corrió, se avisa una vez y se guarda sin ella (patrón ya
  implementado en `src/data/group-signals.js#insertar`).

---

### Task 1: Alcobas de más dejan de descartar

**Files:**
- Modify: `src/groups/match.js:406-412`
- Test: `test/group-match.test.js`

**Interfaces:**
- Consumes: nada de tareas previas.
- Produces: `evaluarCandidata(propiedad, pedido, fuente)` acepta propiedades con
  más alcobas de las pedidas. Firma y forma del retorno sin cambios.

- [ ] **Step 1: Escribir el test que falla**

En `test/group-match.test.js`, después del test
`"banos, garajes y estrato viajan en el match, no solo en el puntaje"`:

```js
// FLEXIBILIDAD HACIA ARRIBA (Juan, 2026-09-04): "si necesita 2 habitaciones y
// tiene 3 o 4 o 5 por el mismo precio o sobre el rango que definimos, envialo".
// Hasta hoy `ok` cortaba en q+1, asi que un pedido de 2 alcobas descartaba en
// silencio una propiedad de 4 que calzaba en zona y precio. Medido: el tope
// aplicaba a 499 de 664 demandas reales (75%).
test("un pedido de 2 alcobas acepta una propiedad de 4", () => {
  const m = evaluarCandidata(apto({ habitaciones: 4 }), pide({ habitaciones: 2 }), "diamond");
  assert.ok(m, "una propiedad con alcobas de sobra no se puede descartar");
  assert.match(m.razones.join(" | "), /4 alcobas/);
});

// La decision del 2026-08-20 sigue viva: abrir la compuerta no puede cambiar
// el orden. "la que calza exacto deberia tener el puntaje mayor" (Juan).
test("la que calza exacto puntua mas alto que la que tiene alcobas de sobra", () => {
  const exacta = evaluarCandidata(apto({ habitaciones: 2 }), pide({ habitaciones: 2 }), "diamond");
  const sobra = evaluarCandidata(apto({ habitaciones: 4 }), pide({ habitaciones: 2 }), "diamond");
  assert.ok(exacta.puntaje > sobra.puntaje, `exacta ${exacta.puntaje} debe superar a sobra ${sobra.puntaje}`);
});

// Hacia ABAJO no se abre nada: las alcobas definen el producto. Quien acepte
// una menos lo sigue diciendo con flexible_habitaciones.
test("un pedido de 3 alcobas sigue descartando una propiedad de 2", () => {
  assert.strictEqual(evaluarCandidata(apto({ habitaciones: 2 }), pide({ habitaciones: 3 }), "diamond"), null);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/group-match.test.js`
Expected: FAIL — `"una propiedad con alcobas de sobra no se puede descartar"`
(recibe `null`). Los otros dos pasan ya.

- [ ] **Step 3: Quitar el tope superior**

En `src/groups/match.js`, dentro del array `exigencias`, reemplazar el bloque
de `habitaciones`:

```js
    {
      pide: c.habitaciones, tiene: p.habitaciones,
      // SIN TOPE SUPERIOR (Juan, 2026-09-04). Antes era `t <= q + 1`, y eso
      // descartaba en silencio una propiedad de 4 alcobas ante un pedido de 2
      // aunque calzara en zona y precio. Medido sobre 664 demandas reales: el
      // tope aplicaba a 499 (75%).
      //
      // El orden NO cambia: `puntos` sigue dando 10 al exacto y 6 al que no lo
      // es, que es la decision del 2026-08-20 ("la que calza exacto deberia
      // tener el puntaje mayor"). Abrir la compuerta solo deja de tirarla a la
      // basura; no la asciende.
      //
      // Hacia ABAJO no se abre: las alcobas definen el producto, un 2 alcobas
      // no resuelve un pedido de 3. La gabela de una menos sigue siendo
      // exclusiva de flexible_habitaciones, declarado por el colega.
      ok: (t, q) => t >= q - (flexible ? 1 : 0),
      texto: (t) => `${t} alcobas`, puntos: (t, q) => (t === q ? 10 : 6),
      castigo: CASTIGO_CORTO.habitaciones,
    },
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test test/group-match.test.js`
Expected: PASS, incluidos los tres nuevos.

Run: `npm test`
Expected: PASS. Si `test/group-vivo.test.js` o `test/group-asistido.test.js`
fallan, es señal de que algún escenario dependía del descarte — leer el fallo
antes de tocar nada.

- [ ] **Step 5: Commit**

```bash
git add src/groups/match.js test/group-match.test.js
git commit -m "feat(radar): alcobas de mas dejan de descartar la propiedad"
```

---

### Task 2: Baños y garajes dejan de descartar, y cobran el castigo que ya existía

**Files:**
- Modify: `src/groups/match.js:424-437`
- Test: `test/group-match.test.js`

**Interfaces:**
- Consumes: `evaluarCandidata` de Task 1.
- Produces: `evaluarCandidata` acepta propiedades con menos baños/garajes de los
  pedidos, con `razones` que dicen `"1 garaje (pediste 2)"` y puntaje castigado.

- [ ] **Step 1: Escribir el test que falla**

```js
// EL RESCATE DEL 24-AGO, DESBLOQUEADO (Juan, 2026-09-04). revalidar.js tiene
// `le_falta` desde el caso Edwin Ramirez -- "al menos el apartamento de el
// portal si se podia enviar con la aclaracion de que solo le falta un
// parqueadero de todo el pedido". Pero match.js descartaba la propiedad ANTES
// de que Sofi la viera: `ok: t >= q` solo aflojaba con flexible_habitaciones,
// true en 49 de 664 demandas (7,4%). Como `corto` exige que ok() haya pasado,
// CASTIGO_CORTO.garajes era codigo inalcanzable.
test("un pedido de 2 garajes acepta una propiedad de 1, y lo dice", () => {
  const m = evaluarCandidata(apto({ garaje: 1 }), pide({ garajes: 2 }), "diamond");
  assert.ok(m, "quedarse corto en un garaje no puede descartar la propiedad");
  assert.match(m.razones.join(" | "), /1 garaje \(pediste 2\)/);
});

test("un pedido de 3 banos acepta una propiedad de 2, y lo dice", () => {
  const m = evaluarCandidata(apto({ banos: 2 }), pide({ banos: 3 }), "diamond");
  assert.ok(m, "quedarse corto en un bano no puede descartar la propiedad");
  assert.match(m.razones.join(" | "), /2 baños \(pediste 3\)/);
});

// El castigo deja de ser codigo muerto: quedarse corto entra, pero nunca
// puede empatar con la que cumple.
test("la que cumple los garajes puntua mas que la que se queda corta", () => {
  const cumple = evaluarCandidata(apto({ garaje: 2 }), pide({ garajes: 2 }), "diamond");
  const corta = evaluarCandidata(apto({ garaje: 1 }), pide({ garajes: 2 }), "diamond");
  assert.ok(cumple.puntaje > corta.puntaje, `cumple ${cumple.puntaje} debe superar a corta ${corta.puntaje}`);
});

// Sin dato sigue siendo neutro, no un descarte: el hueco lo declara Sofi en
// sin_confirmar. Una propiedad sin garaje registrado no puede desaparecer.
test("una propiedad sin garaje registrado sigue entrando", () => {
  assert.ok(evaluarCandidata(apto({ garaje: null }), pide({ garajes: 2 }), "diamond"));
  assert.ok(evaluarCandidata(apto({ garaje: 0 }), pide({ garajes: 2 }), "diamond"));
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/group-match.test.js`
Expected: FAIL — los dos primeros reciben `null`.

- [ ] **Step 3: Abrir las dos compuertas**

En `src/groups/match.js`, reemplazar los bloques de `banos` y `garajes`:

```js
    // BAÑOS Y GARAJES YA NO DESCARTAN (Juan, 2026-09-04): "si no tiene si no
    // un parqueadero (...) envialo con la observacion".
    //
    // `ok` solo se evalua cuando `e.tiene > 0` (ver el `continue` del bucle de
    // abajo), asi que devolver true no significa "cualquier cosa entra":
    // significa que una propiedad que SI tiene el dato y se queda corta entra
    // con su castigo y su razon, en vez de desaparecer. Sin dato sigue siendo
    // neutro y el hueco lo declara Sofi en `sin_confirmar`.
    //
    // Esto es lo que desbloquea `le_falta` de revalidar.js: hasta hoy la
    // propiedad se descartaba aca y Sofi nunca llegaba a verla.
    {
      pide: c.banos, tiene: p.banos,
      ok: () => true,
      texto: (t) => `${t} baños`, puntos: (t, q) => (t >= q ? 6 : 4),
      castigo: CASTIGO_CORTO.banos,
    },
    {
      pide: c.garajes, tiene: p.garaje,
      ok: () => true,
      texto: (t) => `${t} garaje${t > 1 ? "s" : ""}`, puntos: (t, q) => (t >= q ? 6 : 4),
      castigo: CASTIGO_CORTO.garajes,
    },
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test test/group-match.test.js`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/groups/match.js test/group-match.test.js
git commit -m "feat(radar): banos y garajes cortos entran con su aclaracion"
```

---

### Task 3: Quitar el tope de DMs por colega

**Files:**
- Modify: `src/groups/politica.js:145-218`
- Test: `test/group-politica.test.js:190-210`

**Interfaces:**
- Consumes: nada de tareas previas.
- Produces: `decidirDm({telefono, fechaMensajeIso, ahora, dmsHoyColega,
  dmsHoyLinea, limites})` → `{enviarDm, motivo, traza}`. `dmsHoyColega` sigue
  aceptándose y sigue apareciendo en `traza`, pero **ya no bloquea**. Los
  motivos `limite_colega_alcanzado` y `limite_colega_no_verificable` dejan de
  existir.

- [ ] **Step 1: Actualizar los tests existentes y agregar el nuevo**

En `test/group-politica.test.js`, **reemplazar** los tres tests que fijan el
tope por colega (los que esperan `limite_colega_alcanzado`,
`limite_colega_no_verificable` y el de `dmsHoyColega: 1`) por:

```js
// TOPE POR COLEGA QUITADO (Juan, 2026-09-04): "quita la restriccion de la
// cantidad de mensajes a un mismo colega ya que vamos a tener respuestas
// directas a mensajes enviados por ellos, entonces no veo el problema de que
// respondamos a mas de 2 mensajes en un dia".
//
// Lo que sigue protegiendo contra el spam NO es este tope: es el dedup por
// contenido (el mismo pedido difundido a cinco grupos manda UN solo DM) y la
// antiguedad maxima. Los dos siguen en pie.
test("un colega con tres pedidos distintos en el dia recibe los tres", () => {
  assert.strictEqual(politica.decidirDm(escenarioDm({ dmsHoyColega: 2 })).enviarDm, true);
  assert.strictEqual(politica.decidirDm(escenarioDm({ dmsHoyColega: 9 })).enviarDm, true);
});

// No poder contar los DMs del colega ya no puede frenar nada: sin tope, el
// numero es informacion para medir, no una compuerta.
test("no poder contar los DMs del colega ya no frena el envio", () => {
  const d = politica.decidirDm(escenarioDm({ dmsHoyColega: null }));
  assert.strictEqual(d.enviarDm, true);
});

// Se sigue registrando para poder medir el volumen por colega.
test("el conteo por colega sigue quedando en la traza", () => {
  const d = politica.decidirDm(escenarioDm({ dmsHoyColega: 4 }));
  assert.ok(d.traza.some((t) => t.includes("dms_colega_hoy:4")), d.traza.join(","));
});

// El tope de LA LINEA no se toca: es cortacircuitos, no cuota.
test("el tope diario de la linea sigue frenando", () => {
  assert.strictEqual(politica.decidirDm(escenarioDm({ dmsHoyLinea: 150 })).motivo, "limite_linea_alcanzado");
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/group-politica.test.js`
Expected: FAIL — `dmsHoyColega: 2` devuelve `enviarDm: false` con motivo
`limite_colega_alcanzado`.

- [ ] **Step 3: Quitar el límite**

En `src/groups/politica.js`, en `LIMITES_DM_DEFAULT` **borrar** la propiedad
`dmsPorColegaDia` y su comentario, y dejar en su lugar:

```js
  // TOPE POR COLEGA: QUITADO (Juan, 2026-09-04). Estuvo en 1 (24-ago) y en 2
  // (02-sep). El argumento de Juan para sacarlo: estos DMs son RESPUESTAS a
  // pedidos que el colega acaba de publicar, no mensajes en frio -- responder
  // tres pedidos distintos en un dia no es insistencia, es servicio.
  //
  // Lo que protege contra el spam sigue en pie y no es este tope:
  //   · el dedup por contenido (GROUPS_DEDUP_HORAS): el MISMO pedido
  //     difundido a cinco grupos manda UN solo DM.
  //   · antiguedadMaximaMin: nunca se responde un pedido viejo.
  //   · topeDiarioLinea y la cuota de WhatsApp: el volumen de la linea.
```

En `decidirDm`, **reemplazar** las tres líneas del chequeo por colega:

```js
  // El conteo por colega ya no decide nada (ver la nota del limite quitado),
  // pero se conserva en la traza: es como se mide el volumen por persona para
  // decidir si el tope tiene que volver.
  if (dmsHoyColega !== null && dmsHoyColega !== undefined) traza.push(`dms_colega_hoy:${dmsHoyColega}`);
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test test/group-politica.test.js`
Expected: PASS.

Run: `npm test`
Expected: PASS. `test/group-asistido.test.js` tiene `dmsHoyColegaMock`; si algún
escenario esperaba el freno, actualizarlo con la misma justificación.

- [ ] **Step 5: Commit**

```bash
git add src/groups/politica.js test/group-politica.test.js
git commit -m "feat(radar): sin tope de DMs por colega, son respuestas a lo que el pidio"
```

---

### Task 4: Leer la cuota real de WhatsApp desde WAHA

**Files:**
- Modify: `src/lib/waha.js` (agregar función y exportarla)
- Test: `test/waha-cuota.test.js` (crear)

**Interfaces:**
- Consumes: `estadoSesion(nombre)` (ya existe en `waha.js`).
- Produces: `waha.cuotaDeLinea(nombre)` → `Promise<{usados, total, fraccion} | null>`.
  Devuelve `null` cuando WAHA no reporta `messageCapping` o no se pudo leer.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/waha-cuota.test.js`:

```js
// LA CUOTA QUE NO PONEMOS NOSOTROS (2026-09-04). WhatsApp le impone a la linea
// un tope propio, visible en la sesion de WAHA:
//   "messageCapping": {"totalQuota":300,"usedQuota":12,
//                      "cycleStart":2026-09-01,"cycleEnd":2026-10-01}
// 300 por mes calendario. Con ~17 pedidos/dia, abrir la manguera sin freno
// agota la cuota cerca del dia 18 y deja el radar mudo el resto del mes.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const waha = require("../src/lib/waha");

let respuesta;
beforeEach(() => {
  process.env.WAHA_URL = "http://waha.test";
  process.env.WAHA_API_KEY = "k";
  globalThis.fetch = async () => ({
    ok: true, status: 200, text: async () => JSON.stringify(respuesta),
  });
});

test("lee usados, total y fraccion de messageCapping", async () => {
  respuesta = { name: "RADA-NATALIA", status: "WORKING", me: { messageCapping: { totalQuota: 300, usedQuota: 240 } } };
  const c = await waha.cuotaDeLinea("RADA-NATALIA");
  assert.deepStrictEqual(c, { usados: 240, total: 300, fraccion: 0.8 });
});

// Sin el campo NO se inventa un numero: devolver 0 usados seria decirle al
// cortacircuitos que hay cuota de sobra cuando en realidad no sabemos.
test("sin messageCapping devuelve null, no un cero optimista", async () => {
  respuesta = { name: "RADA-NATALIA", status: "WORKING", me: {} };
  assert.strictEqual(await waha.cuotaDeLinea("RADA-NATALIA"), null);
});

test("con totalQuota en cero devuelve null y no divide por cero", async () => {
  respuesta = { me: { messageCapping: { totalQuota: 0, usedQuota: 0 } } };
  assert.strictEqual(await waha.cuotaDeLinea("RADA-NATALIA"), null);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/waha-cuota.test.js`
Expected: FAIL — `waha.cuotaDeLinea is not a function`.

- [ ] **Step 3: Implementar `cuotaDeLinea`**

En `src/lib/waha.js`, inmediatamente después de `estadoSesion`:

```js
// LA CUOTA DE WHATSAPP, QUE NO PONEMOS NOSOTROS (2026-09-04).
//
// La sesion reporta `me.messageCapping`: un tope de mensajes por ciclo de mes
// calendario que impone WhatsApp sobre la linea. Medido el 2026-09-04 en la
// linea del radar: 300 por ciclo, 12 usados, ciclo 01-sep a 01-oct.
//
// Se lee de aca y no de un contador propio a proposito: el numero de WhatsApp
// es el que manda, y ademas resuelve por observacion la duda que quedo abierta
// en el spec (si esos 300 cuentan mensajes o personas nuevas contactadas).
//
// Devuelve null cuando no se puede saber -- NUNCA un cero optimista. Un cero
// le diria al cortacircuitos que hay cuota de sobra justo cuando no sabemos si
// la hay, que es el modo de falla exacto que este archivo evita en todos lados.
async function cuotaDeLinea(nombre) {
  const s = await estadoSesion(nombre);
  const cap = s && s.me && s.me.messageCapping;
  const total = Number(cap && cap.totalQuota);
  if (!(total > 0)) return null;
  const usados = Number(cap.usedQuota) || 0;
  return { usados, total, fraccion: usados / total };
}
```

Agregar `cuotaDeLinea` a `module.exports`.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test test/waha-cuota.test.js`
Expected: PASS.

Run: `node --test test/group-canal.test.js`
Expected: PASS — `cuotaDeLinea` usa `estadoSesion` (GET), no agrega una tercera
llamada a `/api/sendText`.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/waha.js test/waha-cuota.test.js
git commit -m "feat(waha): leer la cuota de mensajes que WhatsApp le impone a la linea"
```

---

### Task 5: Cortacircuitos por cuota de WhatsApp

**Files:**
- Modify: `src/groups/politica.js` (`LIMITES_DM_DEFAULT` y `decidirDm`)
- Modify: `src/groups/vivo.js:425-435` (leer la cuota y pasarla)
- Test: `test/group-politica.test.js`

**Interfaces:**
- Consumes: `waha.cuotaDeLinea` de Task 4; `decidirDm` de Task 3.
- Produces: `decidirDm` acepta `cuotaLinea` (`{usados,total,fraccion} | null`) y
  devuelve motivo `cuota_whatsapp_alta` cuando `fraccion >= fraccionCuotaMaxima`.

- [ ] **Step 1: Escribir el test que falla**

En `test/group-politica.test.js`:

```js
// CORTACIRCUITOS POR LA CUOTA DE WHATSAPP (2026-09-04). Es la unica adicion al
// pedido literal de Juan, y la aprobo: sin esto, abrir la manguera agota los
// 300 mensajes del ciclo cerca del dia 18 y el radar queda mudo el resto del
// mes. FRENA, NO DESCARTA: el pedido sigue llegando a Natalia.
const CUOTA_OK = { usados: 100, total: 300, fraccion: 100 / 300 };
const CUOTA_ALTA = { usados: 240, total: 300, fraccion: 0.8 };

test("con la cuota de WhatsApp al 80% no sale ningun DM", () => {
  const d = politica.decidirDm(escenarioDm({ cuotaLinea: CUOTA_ALTA }));
  assert.strictEqual(d.enviarDm, false);
  assert.strictEqual(d.motivo, "cuota_whatsapp_alta");
});

test("con cuota holgada el DM sale y queda registrada en la traza", () => {
  const d = politica.decidirDm(escenarioDm({ cuotaLinea: CUOTA_OK }));
  assert.strictEqual(d.enviarDm, true);
  assert.ok(d.traza.some((t) => t.includes("cuota_wa:100/300")), d.traza.join(","));
});

// DECISION DELIBERADA, distinta al resto del archivo: no poder leer la cuota
// NO frena. El principio "ante la duda, no" se aplica a los datos que son la
// unica proteccion; aca queda `topeDiarioLinea` cubriendo el mismo eje. Callar
// el radar entero por un hipo de WAHA es peor que el riesgo que evita.
test("no poder leer la cuota no frena el DM: queda el tope diario de la linea", () => {
  assert.strictEqual(politica.decidirDm(escenarioDm({ cuotaLinea: null })).enviarDm, true);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/group-politica.test.js`
Expected: FAIL — con `CUOTA_ALTA` devuelve `enviarDm: true` (el parámetro se
ignora).

- [ ] **Step 3: Implementar el cortacircuitos**

En `LIMITES_DM_DEFAULT` agregar:

```js
  // Fraccion de la cuota de WhatsApp a partir de la cual se dejan de mandar
  // DMs. 0.8 de 300 = 240: quedan 60 de colchon para lo que de verdad no
  // puede esperar. Se sube o baja con RADAR_DM_CUOTA_MAX sin redesplegar.
  fraccionCuotaMaxima: Number(process.env.RADAR_DM_CUOTA_MAX || 0.8),
```

En `decidirDm`, agregar `cuotaLinea = null` a los parámetros y, **después** del
chequeo de `dmsHoyLinea`:

```js
  // La cuota de WhatsApp va DESPUES del tope propio a proposito: si los dos
  // frenan, el motivo que queda escrito es el nuestro, que es el que podemos
  // cambiar. `null` = no se pudo leer, y eso NO frena (ver el test).
  if (cuotaLinea && cuotaLinea.fraccion >= limites.fraccionCuotaMaxima) {
    return no("cuota_whatsapp_alta");
  }
  if (cuotaLinea) traza.push(`cuota_wa:${cuotaLinea.usados}/${cuotaLinea.total}`);
```

En `src/groups/vivo.js`, dentro de `asistir`, **antes** de la llamada a
`politica.decidirDm`:

```js
  // Best-effort: si WAHA no contesta, `null` y el tope diario propio sigue
  // cubriendo el eje de volumen (ver la nota en politica.js#decidirDm).
  const cuotaLinea = sesion
    ? await waha.cuotaDeLinea(sesion).catch((e) => {
        console.warn("[radar] No se pudo leer la cuota de WhatsApp de la linea:", e.message);
        return null;
      })
    : null;
```

y pasarla en la llamada: `politica.decidirDm({ ..., cuotaLinea })`.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test test/group-politica.test.js test/group-asistido.test.js`
Expected: PASS. `group-asistido.test.js` mockea `src/lib/waha.js`; si el mock no
expone `cuotaDeLinea`, agregarlo devolviendo `null`.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/groups/politica.js src/groups/vivo.js test/group-politica.test.js test/group-asistido.test.js
git commit -m "feat(radar): cortacircuitos por la cuota de mensajes de WhatsApp"
```

---

### Task 6: Lo que no podemos evaluar se deriva a Natalia

**Files:**
- Modify: `src/groups/revalidar.js` (prompt `SISTEMA`)
- Test: `test/group-revalidar.test.js`

**Interfaces:**
- Consumes: `revalidar.apruebaAviso(veredicto)` (sin cambios de forma).
- Produces: ningún cambio de API. El comportamiento nuevo vive en el prompt: las
  refs de un pedido con atributos no evaluables van a `refs_dudosas` y nunca a
  `refs_utiles`.

**Por qué así y no con un campo nuevo:** `vivo.js` ya condiciona el DM a
`utiles.length > 0`, y `apruebaAviso` ya devuelve `true` con solo
`refs_dudosas`. Poniendo esas refs en `refs_dudosas` el pedido **no sale por DM
y sí llega a Natalia**, que es exactamente lo pedido, sin tocar una línea de
código de ruteo ni agregar un campo al esquema.

**Por qué esta es la ÚNICA regla nueva del prompt.** El spec (4.2) pedía además
que Sofi fuera más permisiva: aprobar con los básicos cumplidos, usar
`le_falta` en vez de descartar, usar `sin_confirmar` para los huecos. Eso **ya
está en el prompt** desde el 2026-08-24 — el esquema de `refs_utiles` dice
literalmente que incluye *"las INCOMPLETAS (...) y las CASI (cumplen todo salvo
una sola cosa accesoria)"* y que *"ninguno de esos dos huecos descarta la
propiedad: se declaran"*. Lo que faltaba no era la instrucción: era que la
propiedad llegara hasta Sofi, y eso lo arreglan las Tasks 1 y 2. No hay que
tocar nada más del prompt.

- [ ] **Step 1: Escribir el test que falla**

En `test/group-revalidar.test.js`:

```js
// LO QUE NO PODEMOS EVALUAR VA A NATALIA (Juan, 2026-09-04): "no quiero que
// dejemos propiedades por fuera sin saber si hay match, entonces (...) las que
// tengan esas salvedades enviala a natalia cosas como el numero del piso
// especifico o unidad cerrada o jardin privado".
//
// Ni `properties` ni classify.js tienen piso, orientacion ni unidad cerrada.
// Sin dato de los dos lados no se puede declarar un hueco honesto, asi que
// esos pedidos no se responden solos: los mira una persona.
test("el prompt le ordena a Sofi mandar a dudosas lo que no se puede evaluar", () => {
  const s = require("../src/groups/revalidar").SISTEMA;
  assert.match(s, /piso/i);
  assert.match(s, /unidad cerrada/i);
  assert.match(s, /jard[ií]n privado/i);
  assert.match(s, /refs_dudosas/);
});

// El ruteo ya existe y no se toca: solo dudosas => no hay DM, hay aviso.
test("un veredicto con solo dudosas se aprueba (va a la asesora) pero no trae utiles", () => {
  const { apruebaAviso } = require("../src/groups/revalidar");
  const v = { es_pedido_real: true, refs_utiles: [], refs_dudosas: ["9944723"] };
  assert.strictEqual(apruebaAviso(v), true);
  assert.strictEqual(v.refs_utiles.length, 0, "sin utiles no hay DM automatico");
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/group-revalidar.test.js`
Expected: FAIL — el prompt no menciona "unidad cerrada".

- [ ] **Step 3: Agregar la regla al prompt**

En `src/groups/revalidar.js`, dentro de la constante `SISTEMA`, agregar como
regla propia:

```
ATRIBUTOS QUE NO PODEMOS EVALUAR. Si el pedido menciona el NÚMERO DE PISO
específico ("piso 15", "de piso 10 para arriba"), UNIDAD CERRADA, JARDÍN
PRIVADO u ORIENTACIÓN (poniente, occidente, oriente), esas refs van en
`refs_dudosas`, NUNCA en `refs_utiles`.

El motivo: el inventario no registra ninguno de esos datos y el pedido tampoco
se extrae con ellos, así que no podemos ni cumplirlos ni declararlos como hueco
honesto. Un pedido así no se responde solo: lo mira la asesora, que sí puede
abrir la ficha y confirmarlo.

Esto NO es un descarte. La propiedad sigue viajando; cambia quién decide.
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test test/group-revalidar.test.js`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/groups/revalidar.js test/group-revalidar.test.js
git commit -m "feat(radar): los pedidos con atributos no evaluables van a la asesora"
```

---

### Task 7: Registrar a quién se le mandó y medir el volumen del día

**Files:**
- Create: `db/migrations/2026-09-04_dm_destinatario.sql`
- Modify: `src/data/group-signals.js` (`marcarRespondida`)
- Modify: `src/channels/whatsapp-group.js` (endpoint de salud)
- Test: `test/group-signals-dm.test.js`

**Interfaces:**
- Consumes: `marcarRespondida(orgId, signalId, {texto, wamid, modo, refs})`.
- Produces: `marcarRespondida(orgId, signalId, {texto, wamid, modo, refs,
  destinoTelefono, destinoLid})` — los dos nuevos son opcionales; sin ellos el
  comportamiento no cambia.

- [ ] **Step 1: Escribir la migración**

Crear `db/migrations/2026-09-04_dm_destinatario.sql`:

```sql
-- A QUIEN se le mando el DM, no solo QUE se le mando (Juan, 2026-09-04):
-- "me dejes un registro en el crm de el mensaje enviado a quien y la
-- informacion necesaria para contactarlo en un futuro".
--
-- Hoy `marcarRespondida` guarda el texto, el wamid y las refs, pero no el
-- destinatario: para responder "¿por que le escribimos a este?" habia que
-- cruzar a mano contra el directorio, que ademas cambia con el tiempo.
--
-- ALCANCE, y no es incidental: esto es AUDITORIA de una interaccion que el
-- colega inicio, NO una agenda de prospeccion. El limite de la Ley 1581 de
-- 2012 trazado en 2026-08-22_colegas_grupos.sql sigue intacto: a quien se le
-- escribe lo decide src/groups/politica.js#decidirDm, y solo se le escribe a
-- quien acaba de publicar un pedido. Nadie recibe un mensaje por estar aca.
--
-- Correr a mano en Supabase. Idempotente.

alter table group_signals
  add column if not exists respuesta_destino_telefono text,
  add column if not exists respuesta_destino_lid text;

comment on column group_signals.respuesta_destino_telefono is
  'Telefono al que salio el DM. Auditoria de una respuesta, no lista de contactos.';
comment on column group_signals.respuesta_destino_lid is
  'El @lid con el que se enruto. Verificado el 2026-09-04: WhatsApp entrega a un @lid con grupo compartido.';
```

- [ ] **Step 2: Escribir el test que falla**

En `test/group-signals-dm.test.js`:

Primero, **agregar `"update"` a la lista de métodos** de `construirQuery` (hoy
es `["select", "eq", "gte", "order", "limit"]`), para que el doble registre el
payload del update:

```js
  for (const metodo of ["select", "eq", "gte", "order", "limit", "update"]) {
```

Y agregar los tests:

```js
// AUDITORIA DEL DESTINATARIO (Juan, 2026-09-04). Sin esto, "a quien le
// escribimos" solo se podia reconstruir cruzando contra el directorio, que
// cambia con el tiempo -- o sea que no se podia reconstruir.
test("marcarRespondida guarda el telefono y el lid del destinatario", async () => {
  const { mod, llamadasPorTabla } = instalarConSupabase({ data: null, error: null });

  await mod.marcarRespondida("org-9", "sig-1", {
    texto: "hola", wamid: "wm-1", modo: "auto", refs: ["9944723"],
    destinoTelefono: "573001234567", destinoLid: "184564139970806",
  });

  const [, patch] = llamadasPorTabla[0].llamadas.find(([m]) => m === "update");
  assert.strictEqual(patch.respuesta_destino_telefono, "573001234567");
  assert.strictEqual(patch.respuesta_destino_lid, "184564139970806");
});

// Degradacion limpia: si la migracion no corrio, la respuesta se marca igual.
// Perder la marca de "ya respondido" duplicaria el DM al colega, que es MUCHO
// peor que perder el dato de auditoria.
test("sin la migracion corrida, se marca igual y sin los campos nuevos", async () => {
  // PGRST204 = PostgREST no encuentra la columna. Falla la primera vez y
  // acierta la segunda, que es como se comporta una migracion sin correr.
  let intentos = 0;
  const supabasePath = require.resolve("../src/data/supabase");
  const groupSignalsPath = require.resolve("../src/data/group-signals");
  const updates = [];
  delete require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true,
    exports: {
      from: () => {
        const q = {};
        for (const m of ["select", "eq", "gte", "order", "limit", "update"]) {
          q[m] = (...args) => { if (m === "update") updates.push(args[0]); return q; };
        }
        q.then = (resolve) =>
          resolve(intentos++ === 0 ? { error: { code: "PGRST204", message: "respuesta_destino_lid" } } : { error: null });
        return q;
      },
    },
  };
  delete require.cache[groupSignalsPath];
  const mod = require("../src/data/group-signals");

  const ok = await mod.marcarRespondida("org-9", "sig-1", {
    texto: "hola", wamid: "wm-1", modo: "auto", destinoTelefono: "573001234567",
  });

  assert.strictEqual(ok, true, "la señal tiene que quedar marcada igual");
  assert.ok(updates[1].respondida_at, "el segundo intento sigue marcando la respuesta");
  assert.strictEqual(updates[1].respuesta_destino_telefono, undefined, "sin las columnas nuevas");
});
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `node --test test/group-signals-dm.test.js`
Expected: FAIL — las columnas nunca se escriben.

- [ ] **Step 4: Implementar el guardado con degradación**

Reemplazar `src/data/group-signals.js:587-608` por:

```js
async function marcarRespondida(
  orgId,
  signalId,
  { texto, wamid = null, modo = "auto", refs = null, destinoTelefono = null, destinoLid = null } = {}
) {
  if (!MODOS_RESPUESTA.includes(modo)) throw new Error(`Modo de respuesta invalido: ${modo}`);
  if (!supabase) return true;
  const patch = {
    respondida_at: new Date().toISOString(),
    respuesta_texto: texto || null,
    respuesta_wamid: wamid,
    respuesta_modo: modo,
    respuesta_refs: refs && refs.length ? refs : null,
    updated_at: new Date().toISOString(),
  };
  // A QUIEN salio (Juan, 2026-09-04). Van en el MISMO patch y no en un update
  // aparte a proposito: un segundo update podria fallar solo y dejar la señal
  // marcada como respondida pero sin destinatario, que es el estado que hace
  // imposible auditar. O entran los dos con la respuesta, o no entra ninguno.
  if (destinoTelefono) patch.respuesta_destino_telefono = destinoTelefono;
  if (destinoLid) patch.respuesta_destino_lid = destinoLid;

  let { error } = await supabase.from("group_signals").update(patch).eq("org_id", orgId).eq("id", signalId);

  // Degradacion, en el orden en que importa: primero se sueltan los campos de
  // AUDITORIA (2026-09-04_dm_destinatario.sql), que se pueden perder; despues
  // respuesta_refs. Marcar la respuesta es lo ultimo que se sacrifica: sin esa
  // marca el colega recibe el MISMO DM dos veces, que es peor que cualquier
  // dato de auditoria perdido.
  if (error && esColumnaFaltante(error)) {
    console.warn(
      "[grupos] Falta la migracion 2026-09-04_dm_destinatario.sql: la respuesta se marca, pero sin decir a quien salio."
    );
    delete patch.respuesta_destino_telefono;
    delete patch.respuesta_destino_lid;
    ({ error } = await supabase.from("group_signals").update(patch).eq("org_id", orgId).eq("id", signalId));
  }
  if (error && esColumnaFaltante(error)) {
    delete patch.respuesta_refs;
    ({ error } = await supabase.from("group_signals").update(patch).eq("org_id", orgId).eq("id", signalId));
  }
  if (error) {
    console.error("[grupos] No se pudo registrar la respuesta publicada:", error.message);
    return false;
  }
  return true;
}
```

Y en `src/groups/vivo.js`, en las **dos** llamadas a `marcarRespondida` del
camino del DM automático (la de `modo: "auto"` tras `envioDm`, y la del DM
manual), pasar el destinatario:

```js
      await groupSignals.marcarRespondida(org.id, signal.id, {
        texto: textoDm, wamid: envioDm.wamid, modo: "auto", refs: refsDm,
        destinoTelefono: telefonoColega || null,
        destinoLid: mensaje.autorTelefono || null,
      });
```

Nota sobre el nombre: `mensaje.autorTelefono` **es el @lid**, no un teléfono —
sale de `soloDigitos(ev.autorId)` en `whatsapp-group.js`. El nombre engaña y no
se renombra en este plan (lo usan `dmsHoyPorColega` y el directorio); por eso el
campo destino se llama `destinoLid` y no se confunde con `destinoTelefono`.

- [ ] **Step 5: Exponer el contador del día**

En el endpoint `GET /webhook/grupos/estado` de `src/channels/whatsapp-group.js`,
agregar al JSON:

```js
    // Volumen de DMs de la linea HOY, contrastable contra la cuota que reporta
    // WhatsApp (Juan, 2026-09-04: "tratemos de medir los mensajes que enviamos
    // a colegas desde la linea de natalia por dia"). Los dos numeros juntos, a
    // proposito: el nuestro se puede desincronizar, el de WhatsApp manda.
    dmsHoy: await groupSignals.dmsHoyLinea(org.id, desdeMedianoche).catch(() => null),
    cuotaWhatsapp: sesionActiva ? await waha.cuotaDeLinea(sesionActiva).catch(() => null) : null,
```

- [ ] **Step 6: Correr los tests y verificar que pasan**

Run: `node --test test/group-signals-dm.test.js test/salud.test.js`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add db/migrations/2026-09-04_dm_destinatario.sql src/data/group-signals.js src/channels/whatsapp-group.js test/group-signals-dm.test.js
git commit -m "feat(radar): registrar a quien salio el DM y medir el volumen del dia"
```

- [ ] **Step 8: Correr la migración en Supabase**

**Esto lo hace Juan, no el agente.** Pegar
`db/migrations/2026-09-04_dm_destinatario.sql` en el SQL editor de Supabase.
Hasta que corra, el bot guarda las respuestas sin destinatario y avisa una vez
en el log. Verificar después con un `select` por REST, según la regla del
CLAUDE.md.

---

## Verificación final

Contra los 8 criterios de aceptación del spec:

| # | Criterio | Tarea |
|---|---|---|
| 1 | Pedido de 2 alcobas acepta propiedad de 4 | Task 1 |
| 2 | Pedido de 2 garajes acepta propiedad de 1, con aclaración | Task 2 |
| 3 | Pedido con "piso 15" / "unidad cerrada" / "jardín privado" → Natalia | Task 6 |
| 4 | Colega con tres pedidos recibe tres respuestas | Task 3 |
| 5 | Mismo pedido en tres grupos → un solo DM | dedup existente, sin cambios |
| 6 | `usedQuota >= 240` → ningún DM y aviso | Task 5 |
| 7 | Ningún mensaje al colega nombra a Diamond | `publicable.js` existente, sin cambios |
| 8 | Pedido fuera de zona o presupuesto no sale por DM | compuertas duras, sin cambios |

Los criterios 5, 7 y 8 **no tienen tarea a propósito**: ya están implementados y
este plan no los toca. Confirmarlos corriendo `npm test` completo — sus tests
existen y tienen que seguir verdes.

## Después de implementar

1. `npm test` completo en verde.
2. Push a `origin main` **por SSH** (HTTPS da 403 desde el 2026-09-03).
3. Juan corre la migración.
4. **Observar el fin de semana**, que es el plan que él mismo puso: mirar
   `dmsHoy` contra `cuotaWhatsapp` en `/webhook/grupos/estado`, y `usedQuota`
   para resolver la duda abierta de si los 300 cuentan mensajes o personas.
5. Con esos datos se decide si el tope por colega vuelve, y en cuánto.
