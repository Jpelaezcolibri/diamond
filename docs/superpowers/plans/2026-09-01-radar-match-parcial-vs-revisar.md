# Radar: distinguir match fuerte de "revisar" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que las propiedades/ofertas que solo pasan el filtro por el margen (zona vecina, sobreprecio, falta un dato pedido) salgan marcadas como "revisar", no con la misma confianza que un match limpio — en los dos carriles (compra y venta).

**Architecture:** En compra, `evaluarOferta` calcula un `nivel` ("fuerte"/"revisar") a partir de señales que ya construye, y `buildMandatoMatchAlert` elige el encabezado según ese nivel. En venta, se agrega un cuarto campo al veredicto de Sofi (`refs_dudosas`, junto a `refs_utiles`) para el caso hoy forzado a un descarte binario, y `alertaAsesor.construir` le agrega al aviso una sección aparte con esas referencias.

**Tech Stack:** Node.js (CommonJS), `node:test`, Anthropic SDK (solo en el carril de venta, sin cambios en el cliente).

## Global Constraints

- Ningún portón de entrada cambia: lo que hoy se descarta (`evaluarOferta` devuelve `null`, o Sofi marca INCOMPATIBLE) se sigue descartando exactamente igual.
- El volumen de mensajes no cambia: uno por propiedad/oferta, nunca agrupado (decisión explícita de Juan).
- El cuerpo del mensaje de compra (`Cumple:`/`Ojo:`) no cambia — solo el encabezado.
- En venta, `refs_dudosas` **nunca** se manda al colega (ni por DM ni auto-publicado en el grupo) — solo aparece en el aviso al asesor. Sigue siendo exclusivo de `refs_utiles` todo lo que va al colega.
- Backward-compatible: código que lee un veredicto o una evaluación SIN el campo nuevo (`nivel` o `refs_dudosas` ausente) debe seguir funcionando como hoy, sin romper.

---

### Task 1: `evaluarOferta` clasifica "fuerte" vs "revisar"

**Files:**
- Modify: `src/groups/cruce-mandatos.js`
- Test: `test/group-cruce-mandatos.test.js`

**Interfaces:**
- Produces: `evaluarOferta(oferta, mandato, opts)` ahora devuelve, cuando no es `null`, `{ sirve, puntaje, ubicacion, cumple, salvedades, nivel }` donde `nivel` es `"fuerte"` o `"revisar"`. Todo lo demás del shape queda igual.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `test/group-cruce-mandatos.test.js`:

```js
// Nivel de confianza (Juan, 2026-09-01): "sirve" ya no alcanza para decidir
// que tan fuerte encabezar el aviso -- el portón se queda igual (filo bajo,
// nada nuevo se descarta), pero "fuerte" vs "revisar" le dice al asesor si
// esto es un match limpio o uno que hay que confirmar con calma.

test("zona exacta + dentro del tope + habitaciones cumplidas -> nivel fuerte", () => {
  const r = evaluarOferta(OFERTA, MANDATO);
  assert.strictEqual(r.nivel, "fuerte");
});

test("zona vecina -> nivel revisar, aunque el resto cumpla", () => {
  const mandatoConCiudad = { ...MANDATO, zonas: ["Envigado"], ciudad: "Medellín" };
  const r = evaluarOferta({ ...OFERTA, zona: "El Poblado", ciudad: "Medellín", precio: "$1.900.000.000" }, mandatoConCiudad);
  assert.ok(r, "El Poblado es vecina de Envigado en el motor de zonas");
  assert.strictEqual(r.ubicacion, "vecina");
  assert.strictEqual(r.nivel, "revisar");
});

test("precio dentro del margen del 15% pero por encima del tope exacto -> nivel revisar", () => {
  const r = evaluarOferta({ ...OFERTA, precio: "$2.508.000.000" }, MANDATO); // 14% arriba
  assert.ok(r.sirve);
  assert.strictEqual(r.nivel, "revisar");
});

test("le falta una habitacion pedida -> nivel revisar", () => {
  const r = evaluarOferta({ ...OFERTA, habitaciones: 3 }, MANDATO); // pide 4
  assert.ok(r.sirve);
  assert.strictEqual(r.nivel, "revisar");
});

test("habitaciones de menos pero el mandato es flexible_habitaciones -> sigue siendo fuerte", () => {
  const mandatoFlexible = { ...MANDATO, flexible_habitaciones: true };
  const r = evaluarOferta({ ...OFERTA, habitaciones: 3 }, mandatoFlexible);
  assert.ok(r.sirve);
  assert.strictEqual(r.nivel, "fuerte", "el cliente ya dijo que una menos con estudio/servicio le sirve");
});

test("area/garajes/estrato/exigencias de menos NO bajan el nivel -- siguen siendo blandos incluso en fuerte", () => {
  const r = evaluarOferta({ ...OFERTA, area: 145 }, MANDATO); // area_min es 150
  assert.ok(r.sirve);
  assert.strictEqual(r.nivel, "fuerte", "area es blando en los dos niveles, solo zona/precio/habitaciones/baños definen el nivel");
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `node --test test/group-cruce-mandatos.test.js`
Expected: FAIL en los 6 tests nuevos — `r.nivel` es `undefined`, no `"fuerte"`/`"revisar"`.

- [ ] **Step 3: Implementación**

En `src/groups/cruce-mandatos.js`, la función `evaluarOferta` termina hoy con:

```js
  return { sirve: true, puntaje: m.puntaje, ubicacion: m.ubicacion, cumple, salvedades };
}
```

Justo ANTES de ese `return`, agregar el cálculo del nivel (usa variables que la función ya tiene calculadas: `m`, `precio`, `c`, y los mismos `oferta.habitaciones`/`oferta.banos` que ya se leyeron en el loop de `blandos`):

```js
  // Nivel de confianza (Juan, 2026-09-01): el portón de arriba no cambia --
  // esto es una clasificación ENCIMA de lo que ya pasó el filtro, para que el
  // encabezado del aviso sea honesto sobre que tan solido es el match.
  // "fuerte" exige lo mismo que hoy se muestra como "cumple" sin salvedad en
  // los tres ejes de fondo (zona, precio, habitaciones/baños); cualquier otra
  // cosa que paso el portón (zona vecina, margen de precio, falta una
  // habitacion o un baño pedido) es "revisar". flexible_habitaciones cuenta
  // como cumplido: el cliente ya dijo que una menos con estudio/servicio le
  // sirve, no es un motivo para bajarlo de nivel.
  const habitacionesFuerte = c.habitaciones <= 0
    || num(oferta.habitaciones) >= c.habitaciones
    || (c.flexible_habitaciones && num(oferta.habitaciones) === c.habitaciones - 1);
  const banosFuerte = c.banos <= 0 || num(oferta.banos) >= c.banos;
  const nivel = (m.ubicacion === "exacta" && precio > 0 && precio <= c.precio_max && habitacionesFuerte && banosFuerte)
    ? "fuerte"
    : "revisar";

  return { sirve: true, puntaje: m.puntaje, ubicacion: m.ubicacion, cumple, salvedades, nivel };
}
```

**OJO:** `precio > 0` es necesario en la condición de `nivel` porque si la oferta no trae precio (`precio <= 0`), el bloque de arriba solo agrega una salvedad y no toca `precio`/`c.precio_max` — sin este chequeo, `precio <= c.precio_max` con `precio = 0` daría `true` falsamente y calificaría como fuerte una oferta sin precio conocido.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test test/group-cruce-mandatos.test.js`
Expected: PASS — todos los tests del archivo (los de antes + los 6 nuevos), 0 fallos

- [ ] **Step 5: Correr toda la suite para confirmar que no se rompio nada**

Run: `node --test test/*.test.js`
Expected: PASS — agregar un campo nuevo al resultado no debe romper ningún consumidor existente (nada leía `r.nivel` antes)

- [ ] **Step 6: Commit**

```bash
git add src/groups/cruce-mandatos.js test/group-cruce-mandatos.test.js
git commit -m "feat(radar): evaluarOferta clasifica nivel fuerte/revisar en el carril de compra"
```

---

### Task 2: El encabezado del aviso de compra depende del nivel

**Files:**
- Modify: `src/notifications/mandato-aviso.js`
- Test: `test/mandato-aviso.test.js`

**Interfaces:**
- Consumes: `evaluacion.nivel` (Task 1) — si está ausente (fixtures viejos armados a mano, sin pasar por `evaluarOferta`), se trata como `"fuerte"` para no romper nada existente.
- Produces: sin cambio de firma en `buildMandatoMatchAlert`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `test/mandato-aviso.test.js`:

```js
test("nivel 'fuerte' (o ausente, por compatibilidad) usa el encabezado de siempre", () => {
  const t = buildMandatoMatchAlert(BASE); // BASE.evaluacion no trae 'nivel'
  assert.match(t, /^🎯 Oferta nueva que le sirve a Marcela Restrepo/);
});

test("nivel 'revisar' usa un encabezado distinto, sin prometer que sirve", () => {
  const t = buildMandatoMatchAlert({ ...BASE, evaluacion: { ...BASE.evaluacion, nivel: "revisar" } });
  assert.match(t, /^🔎 Revisar con el colega — match parcial para Marcela Restrepo/);
  assert.doesNotMatch(t, /Oferta nueva que le sirve/);
});

test("el cuerpo del mensaje (Cumple/Ojo/ficha) no cambia entre niveles", () => {
  const fuerte = buildMandatoMatchAlert({ ...BASE, evaluacion: { ...BASE.evaluacion, nivel: "fuerte" } });
  const revisar = buildMandatoMatchAlert({ ...BASE, evaluacion: { ...BASE.evaluacion, nivel: "revisar" } });
  const sinEncabezado = (t) => t.split("\n").slice(1).join("\n");
  assert.strictEqual(sinEncabezado(fuerte), sinEncabezado(revisar));
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `node --test test/mandato-aviso.test.js`
Expected: FAIL en los 2 primeros tests nuevos (el encabezado siempre sale igual hoy); el tercero puede pasar de casualidad, no importa — se confirma en el Step 4 junto con los otros.

- [ ] **Step 3: Implementación**

En `src/notifications/mandato-aviso.js`, dentro de `buildMandatoMatchAlert`, se arma hoy el encabezado como la primera línea de `lineas`:

```js
  const ficha = fichaDe(oferta);
  const lineas = [
    `🎯 Oferta nueva que le sirve a ${cliente}`,
    "",
    `${tipo}${operacion}${zona}`,
  ];
```

Reemplazar por:

```js
  // Encabezado segun nivel (Juan, 2026-09-01): "fuerte" es el mensaje de
  // siempre; "revisar" es el mismo cuerpo (Cumple/Ojo no cambian) pero sin
  // prometerle al asesor una confianza que el match no tiene. Sin 'nivel'
  // (fixtures viejos, o codigo que arma evaluacion a mano) se trata como
  // fuerte -- es el comportamiento que ya existia antes de este cambio.
  const encabezado = evaluacion.nivel === "revisar"
    ? `🔎 Revisar con el colega — match parcial para ${cliente}`
    : `🎯 Oferta nueva que le sirve a ${cliente}`;
  const ficha = fichaDe(oferta);
  const lineas = [
    encabezado,
    "",
    `${tipo}${operacion}${zona}`,
  ];
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test test/mandato-aviso.test.js`
Expected: PASS — todos los tests del archivo, 0 fallos

- [ ] **Step 5: Correr toda la suite**

Run: `node --test test/*.test.js`
Expected: PASS — sin regresiones

- [ ] **Step 6: Commit**

```bash
git add src/notifications/mandato-aviso.js test/mandato-aviso.test.js
git commit -m "feat(radar): encabezado del aviso de compra distingue fuerte de revisar"
```

---

### Task 3: `revalidar.js` agrega `refs_dudosas` al veredicto

**Files:**
- Modify: `src/groups/revalidar.js`
- Test: `test/group-revalidar.test.js`

**Interfaces:**
- Produces: `revalidar.ESQUEMA` incluye `refs_dudosas` (array de strings) en `required` y `properties`. El veredicto que devuelve `revalidar()` puede traer `refs_dudosas` (array, puede venir `undefined` en veredictos viejos ya guardados en base).

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `test/group-revalidar.test.js`:

```js
// DUDOSA (Juan, 2026-09-01) — hasta ahora Sofi decidia siempre en binario
// (entra a refs_utiles o no entra a nada); esto le da una tercera salida
// para el caso genuinamente incierto, en vez de forzarlo a INCOMPATIBLE.

test("el esquema exige 'refs_dudosas' -- no es un campo opcional que Sofi pueda omitir", () => {
  assert.ok(revalidar.ESQUEMA.required.includes("refs_dudosas"));
  assert.strictEqual(revalidar.ESQUEMA.properties.refs_dudosas.type, "array");
});

test("una candidata DUDOSA no entra a refs_utiles pero si a refs_dudosas", async (t) => {
  mockRespuesta(t, {
    es_pedido_real: true, sirve_alguna: true, refs_utiles: [],
    por_que: "Ninguna calza del todo, pero REF1 esta cerca: zona vecina y le falta un baño.",
    confianza: 0.6, desacuerdo_con_puntaje: "",
    sin_confirmar: [], le_falta: [],
    refs_dudosas: ["REF1"],
  });

  const { veredicto } = await revalidar.revalidar(clasificado(), [match()]);

  assert.deepStrictEqual(veredicto.refs_utiles, []);
  assert.deepStrictEqual(veredicto.refs_dudosas, ["REF1"]);
});

test("una ref nunca aparece en refs_utiles y refs_dudosas a la vez -- son mutuamente excluyentes por contrato del prompt", async (t) => {
  // Esto documenta el contrato (el prompt se lo pide a Sofi); no hay
  // validacion de codigo que lo fuerce, asi que el test deja constancia
  // explicita de la regla para quien lea el esquema despues.
  mockRespuesta(t, {
    es_pedido_real: true, sirve_alguna: true, refs_utiles: ["REF1"],
    por_que: "Calza en todo.", confianza: 0.9, desacuerdo_con_puntaje: "",
    sin_confirmar: [], le_falta: [], refs_dudosas: [],
  });

  const { veredicto } = await revalidar.revalidar(clasificado(), [match()]);
  const interseccion = veredicto.refs_utiles.filter((r) => veredicto.refs_dudosas.includes(r));
  assert.deepStrictEqual(interseccion, []);
});

test("un veredicto VIEJO sin 'refs_dudosas' no rompe apruebaAviso", async (t) => {
  mockRespuesta(t, {
    es_pedido_real: true, sirve_alguna: true, refs_utiles: ["REF1"],
    por_que: "Calza en zona, alcobas y precio.", confianza: 0.9, desacuerdo_con_puntaje: "",
    // sin 'refs_dudosas' a proposito: lo que ya esta guardado antes de este cambio
  });

  const { veredicto } = await revalidar.revalidar(clasificado(), [match()]);
  assert.strictEqual(veredicto.refs_dudosas, undefined);
  assert.strictEqual(revalidar.apruebaAviso(veredicto), true);
});

test("el prompt nombra la situacion DUDOSA y dice que se manda al asesor, no se pierde", () => {
  const s = revalidar.SISTEMA || "";
  assert.ok(s.includes("DUDOSA"), "el prompt nombra la cuarta situacion");
  assert.ok(/refs_dudosas/.test(s), "el prompt dice explicitamente el nombre del campo");
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `node --test test/group-revalidar.test.js`
Expected: FAIL en los primeros 4 tests nuevos (`refs_dudosas` no existe en el esquema ni se propaga); el del prompt también falla (no menciona "DUDOSA" todavía).

- [ ] **Step 3: Implementación**

En `src/groups/revalidar.js`, en el objeto `ESQUEMA`, agregar `"refs_dudosas"` al array `required` (junto a los que ya están: `es_pedido_real`, `sirve_alguna`, `refs_utiles`, `por_que`, `confianza`, `desacuerdo_con_puntaje`, `sin_confirmar`, `le_falta`), y agregar la propiedad, justo después de `refs_utiles`:

```js
    refs_utiles: {
      type: "array",
      items: { type: "string" },
      description:
        "Las refs que si sirven, de la mas util a la menos. Vacio si ninguna. Incluye las que calzan del todo, las " +
        "INCOMPLETAS (calzan en lo verificable pero falta un dato que el inventario no registra -> 'sin_confirmar') " +
        "y las CASI (cumplen todo salvo una sola cosa accesoria, que si conocemos -> 'le_falta'). Ninguno de esos " +
        "dos huecos descarta la propiedad: se declaran.",
    },
    // DUDOSA (Juan, 2026-09-01): antes de este campo, una candidata que no
    // era un descarte limpio (INCOMPATIBLE) pero tampoco calzaba lo
    // suficiente para refs_utiles se perdia sin que nadie la viera -- Sofi
    // tenia que forzar un SI o un NO. Este campo es la tercera salida.
    refs_dudosas: {
      type: "array",
      items: { type: "string" },
      description:
        "Refs que NO van en refs_utiles (no se le mandan al colega ni se auto-publican) pero tampoco son un " +
        "descarte limpio -- vale la pena que la asesora decida si llamar al colega igual. Vacio si no hay ninguna. " +
        "Una ref nunca va en refs_utiles y refs_dudosas a la vez.",
    },
```

En el mismo archivo, dentro de la constante `SISTEMA`, buscar el bloque de las "TRES situaciones distintas" (empieza con `Hay TRES situaciones distintas y confundirlas es el error mas caro que\n      podes cometer aca:` y termina justo antes de `- Como decidir si un incumplimiento es ACCESORIO o de FONDO:`). Cambiar `TRES` por `CUATRO` en esa frase, y agregar la cuarta situación al final de la lista, después del bloque de `CASI` y antes de la línea `- Como decidir si un incumplimiento es ACCESORIO o de FONDO:`:

```
    · DUDOSA (no entra a refs_utiles, entra a refs_dudosas): no es un
      INCOMPATIBLE limpio (no es otra zona no vecina, ni otro tipo, ni fuera
      de presupuesto, ni algo innegociable incumplido) pero tampoco calza lo
      suficiente para mandarla con la confianza de las anteriores -- por
      ejemplo, DOS O MAS incumplimientos accesorios a la vez (que por si
      solos serian CASI, pero juntos ya no), o una zona vecina lejana que te
      genera dudas reales. Antes esto se resolvia forzando un NO y la
      oportunidad se perdia sin que nadie la viera; ahora se lo llevás al
      asesor para que decida si vale la pena, en vez de perderla en
      silencio.
```

Y buscar la línea (dentro del mismo `SISTEMA`, más abajo):

```
- Ante la duda sobre si INCOMPATIBLE, decidi que NO sirve. Escribirle a una
  asesora (o a un colega) por algo que no era le cuesta tiempo y le quita
  credibilidad al sistema. Pero un dato que el pedido pide y el inventario
  simplemente no tiene no es motivo de duda sobre si sirve -- es motivo para
  usar 'sin_confirmar', no para descartar.
```

Reemplazarla por (agrega la salida DUDOSA a la duda entre INCOMPATIBLE y no, en vez de forzar un descarte):

```
- Ante la duda sobre si algo es INCOMPATIBLE o DUDOSA, preferí DUDOSA: nunca
  la mandes con la confianza de refs_utiles, pero tampoco la pierdas sin que
  nadie la vea -- eso es exactamente lo que refs_dudosas existe para evitar.
  Ante la duda entre DUDOSA e INCOMPLETO/CASI (¿esto de verdad sirve, o solo
  se acerca?), seguí el criterio de ACCESORIO/DE FONDO de más abajo. Un dato
  que el pedido pide y el inventario simplemente no tiene no es motivo de
  duda sobre si sirve -- es motivo para usar 'sin_confirmar', no para
  descartar ni para DUDOSA.
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test test/group-revalidar.test.js`
Expected: PASS — todos los tests del archivo, 0 fallos

- [ ] **Step 5: Correr toda la suite**

Run: `node --test test/*.test.js`
Expected: PASS — sin regresiones (nada leía `refs_dudosas` todavía, así que ningún consumidor existente se ve afectado)

- [ ] **Step 6: Commit**

```bash
git add src/groups/revalidar.js test/group-revalidar.test.js
git commit -m "feat(radar): revalidar.js agrega refs_dudosas -- cuarta salida para el caso incierto"
```

---

### Task 4: El aviso al asesor incluye una sección "Para revisar"

**Files:**
- Modify: `src/groups/alerta-asesor.js`
- Test: `test/alerta-asesor.test.js`

**Interfaces:**
- Consumes: `veredicto.refs_dudosas` (Task 3) — puede venir `undefined` (veredictos viejos), se trata como `[]`.
- Produces: sin cambio de firma en `construir(senal, veredicto, matches, telefonoColega, org)`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `test/alerta-asesor.test.js`:

```js
// "Para revisar" (Juan, 2026-09-01): refs_dudosas del veredicto (ver
// src/groups/revalidar.js) aparecen en el aviso al asesor, nunca en el DM
// al colega -- esa sigue siendo exclusiva de refs_utiles.

test("con refs_dudosas, el aviso agrega una seccion 'Para revisar' con esas propiedades", () => {
  const veredictoConDudosas = { ...VEREDICTO, refs_dudosas: ["AP009"] };
  const otraPropiedad = matchUtil({ ref: "AP009", titulo: "Apartamento en Sabaneta", zona: "Sabaneta" });
  const texto = construir(senal(), veredictoConDudosas, [matchUtil(), otraPropiedad], "573001234567");

  assert.match(texto, /Para revisar/i);
  assert.match(texto, /Ref AP009/);
  assert.match(texto, /Sabaneta/);
});

test("sin refs_dudosas (o vacio), no hay seccion 'Para revisar'", () => {
  const texto = construir(senal(), VEREDICTO, [matchUtil()], "573001234567");
  assert.doesNotMatch(texto, /Para revisar/i);
});

test("un veredicto VIEJO sin refs_dudosas no revienta -- se trata como vacio", () => {
  const veredictoViejo = { ...VEREDICTO };
  delete veredictoViejo.refs_dudosas;
  const texto = construir(senal(), veredictoViejo, [matchUtil()], "573001234567");
  assert.doesNotMatch(texto, /Para revisar/i);
  assert.match(texto, /Ref AP004/, "el resto del aviso sigue funcionando igual");
});

test("las propiedades de 'Para revisar' NO llegan al mensaje listo para reenviar al colega", () => {
  // Cubre el constraint global: refs_dudosas nunca sale hacia el colega,
  // solo el asesor las ve. mensajeListoParaReenviar se arma con `utiles`
  // (refs_utiles), nunca con las dudosas -- esto lo confirma end-to-end
  // sobre el texto final, sin telefono resuelto (el caso donde SI se arma
  // ese mensaje).
  const veredictoConDudosas = { ...VEREDICTO, refs_dudosas: ["AP009"], sin_confirmar: [] };
  const dudosa = matchUtil({ ref: "AP009", titulo: "Apartamento en Sabaneta", linkWasi: "https://info.wasi.co/ap009" });
  const util = matchUtil({ linkWasi: "https://info.wasi.co/apartamento-venta-ap004/9744456" });
  const texto = construir(senal(), veredictoConDudosas, [util, dudosa], null);

  // El bloque "mandale ESTO YA" es el mensaje blanqueado para el colega.
  const inicioMensajeListo = texto.indexOf("mandale ESTO YA");
  assert.notStrictEqual(inicioMensajeListo, -1);
  const mensajeListo = texto.slice(inicioMensajeListo);
  assert.doesNotMatch(mensajeListo, /AP009|Sabaneta/, "la dudosa no puede aparecer en el texto que se reenvia al colega");
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `node --test test/alerta-asesor.test.js`
Expected: FAIL en los primeros 2 tests nuevos (la sección "Para revisar" no existe todavía). El tercero y el cuarto pueden pasar de casualidad (nada rompe si refs_dudosas simplemente se ignora) — se confirman igual en el Step 4.

- [ ] **Step 3: Implementación**

En `src/groups/alerta-asesor.js`, dentro de `construir`, el bloque actual es:

```js
  const utiles = veredicto.refs_utiles
    .map((ref) => (matches || []).find((m) => String(m.ref) === String(ref)))
    .filter(Boolean);
  if (utiles.length === 0) return null;

  const quien = senal.autor_nombre || "un colega";
  const contactoTexto = contactoPara(telefonoColega, senal.autor_telefono, quien);

  const lineas = [
    `🎯 Oportunidad en un grupo`,
    ``,
    `Grupo: ${senal.grupo_nombre || "sin nombre"}`,
    `Colega: ${quien}`,
    `Contacto: ${contactoTexto}`,
    ``,
    `Pidió:`,
    `"${(senal.texto_original || "").trim()}"`,
    ``,
    utiles.length === 1 ? `Le puede servir:` : `Le pueden servir:`,
    utiles.map(linea).join("\n"),
    ``,
    `Sofi dice: ${veredicto.por_que}`,
  ];
```

Reemplazar por (agrega `dudosas` y la sección nueva, sin tocar nada de lo que ya arma `utiles`/el resto):

```js
  const utiles = veredicto.refs_utiles
    .map((ref) => (matches || []).find((m) => String(m.ref) === String(ref)))
    .filter(Boolean);
  if (utiles.length === 0) return null;

  // Para revisar (Juan, 2026-09-01): refs_dudosas de revalidar.js -- Sofi no
  // las aprueba para el envio normal, pero tampoco las descarta del todo.
  // Van SOLO al asesor, nunca al colega (a diferencia de `utiles`, que
  // alimenta tambien el DM/mensaje blanqueado mas abajo en este archivo).
  const dudosas = (veredicto.refs_dudosas || [])
    .map((ref) => (matches || []).find((m) => String(m.ref) === String(ref)))
    .filter(Boolean);

  const quien = senal.autor_nombre || "un colega";
  const contactoTexto = contactoPara(telefonoColega, senal.autor_telefono, quien);

  const lineas = [
    `🎯 Oportunidad en un grupo`,
    ``,
    `Grupo: ${senal.grupo_nombre || "sin nombre"}`,
    `Colega: ${quien}`,
    `Contacto: ${contactoTexto}`,
    ``,
    `Pidió:`,
    `"${(senal.texto_original || "").trim()}"`,
    ``,
    utiles.length === 1 ? `Le puede servir:` : `Le pueden servir:`,
    utiles.map(linea).join("\n"),
  ];

  if (dudosas.length) {
    lineas.push(
      ``,
      `🔎 Para revisar (no confirmadas — decidí vos si vale la pena llamar al colega):`,
      dudosas.map(linea).join("\n")
    );
  }

  lineas.push(``, `Sofi dice: ${veredicto.por_que}`);
```

**OJO:** el resto de la función (bloque de `mensajeListoParaReenviar`, `linkSofi`, cierre) sigue exactamente igual — no lo repitas, solo reemplazá el fragmento de arriba. `mensajeListoParaReenviar` recibe `utiles` (no `dudosas`), así que el constraint de "nunca al colega" ya queda garantizado por no tocar esa llamada.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test test/alerta-asesor.test.js`
Expected: PASS — todos los tests del archivo, 0 fallos

- [ ] **Step 5: Correr toda la suite**

Run: `node --test test/*.test.js`
Expected: PASS — sin regresiones

- [ ] **Step 6: Commit**

```bash
git add src/groups/alerta-asesor.js test/alerta-asesor.test.js
git commit -m "feat(radar): el aviso al asesor separa las propiedades para revisar de las utiles"
```

---

### Task 5: Deploy y verificación en producción

**Files:** ninguno (push + verificación operativa)

- [ ] **Step 1: Push a main**

```bash
git push origin main
```

Dispara auto-deploy en Railway (servicio `diamond`, proyecto `ca2b2fb9-f4eb-45fe-9e60-b6cd17ef3337`, environment `10f374aa-f477-45d3-b85f-eaf4e0014246`, servicio `2360e9b8-5ec2-43f0-bb41-7e0fe7665f1f`).

- [ ] **Step 2: Verificar el deploy**

`railway deployment list` con esos IDs, esperar `status: SUCCESS` con el `commitHash` del último commit de este plan. Revisar logs (`railway logs --lines 60`) para confirmar arranque limpio, sin errores nuevos.

- [ ] **Step 3: Confirmar en logs que la clasificación corre sobre tráfico real**

El carril de compra recibe ofertas constantemente (129 grupos activos). Esperar unos minutos y consultar `mandato_match_alerts` (Supabase) ordenado por `created_at desc, limit 5` — los avisos nuevos deberían traer, dentro de su `texto`, el encabezado `🎯 Oferta nueva que le sirve` o `🔎 Revisar con el colega` según corresponda (no el genérico de antes en el 100% de los casos, salvo que todo lo que llegó calzara perfecto).

Si no hay tráfico nuevo en la ventana de verificación, no bloquea el deploy — el código ya está probado por la suite; es solo una confirmación adicional en vivo, igual que se hizo con el fix anterior de esta misma sesión.

---

## Self-Review

**Cobertura del spec:** §3 carril de compra (Task 1 + Task 2) · §4 carril de venta (Task 3 + Task 4) · §5 "qué no cambia" (verificado explícitamente en Global Constraints y en los tests de "no regresión" de cada tarea — ningún portón, ningún volumen, ningún cambio en el DM al colega) · §6 testing (cada sección del spec tiene su tarea de test correspondiente).

**Placeholders:** ninguno — cada step trae código completo o el comando exacto.

**Consistencia de tipos:** `evaluarOferta` devuelve `nivel` en Task 1 y se consume sin transformación en Task 2 (`evaluacion.nivel`). `revalidar.js` produce `refs_dudosas` en Task 3 y se consume sin transformación en Task 4 (`veredicto.refs_dudosas`). Ninguna tarea depende de una anterior más allá de leer su output — las 4 se pueden implementar y revisar en cualquier orden si hiciera falta, aunque el orden natural (compra primero, venta después) sigue el spec.
