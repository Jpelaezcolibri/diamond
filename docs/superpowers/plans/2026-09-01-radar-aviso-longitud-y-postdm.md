# Radar: aviso sin pasarse del límite de WhatsApp + aviso post-DM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el aviso a la asesora nunca vuelva a ser rechazado por Meta por pasarse de 4096 caracteres, y que cuando el DM directo al colega sale bien pero quedan propiedades dudosas del mismo pedido, la asesora se entere de esas en vez de perderlas en silencio.

**Architecture:** `src/groups/alerta-asesor.js#construir` se reorganiza en bloques nombrados (en vez de un array plano) para poder reconstruir el mensaje una segunda vez, más compacto, si el primero pasa el margen de seguridad. Se agrega `construirAvisoPostDm`, una función nueva y separada para el caso "el DM ya salió, esto otro quedó pendiente". `src/groups/vivo.js#asistir` llama a esa función justo después de un DM exitoso.

**Tech Stack:** Node.js (CommonJS), `node:test`.

## Global Constraints

- El límite real de Meta es 4096 caracteres; el margen de seguridad de este plan es 4000.
- La deduplicación y el tope de longitud son solo del aviso INTERNO a la asesora — el mensaje que se arma para reenviar al colega (`mensajeListoParaReenviar`) no cambia en absoluto.
- Cuando el DM sale bien y NO hay `refs_dudosas`, el comportamiento no cambia: nadie recibe nada extra (ver el test existente `test/group-asistido.test.js` — "la asesora no recibe nada: no tiene nada que hacer" — que debe seguir pasando sin modificarlo).
- Un fallo mandando el aviso post-DM nunca puede cambiar el `resultado` que ya devuelve `asistir` (`"dm_enviado"` sigue siendo verdad aunque el aviso post-DM falle) — mismo criterio best-effort que ya usa el resto de este archivo.

---

### Task 1: `construir` no repite la invitación a Sofi y tiene un tope de longitud

**Files:**
- Modify: `src/groups/alerta-asesor.js`
- Test: `test/alerta-asesor.test.js`

**Interfaces:**
- Produces: `construir(senal, veredicto, matches, telefonoColega, org)` mantiene exactamente la misma firma y el mismo contrato de retorno (string o `null`). Comportamiento nuevo: nunca duplica la invitación a Sofi, y nunca devuelve un texto de más de 4096 caracteres cuando `mensajeListoParaReenviar` está presente.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `test/alerta-asesor.test.js`:

```js
// LIMITE DE META (Juan, 2026-09-01) -- un aviso real con 6 propiedades fue
// rechazado por WhatsApp ("Param text.body must be at most 4096 characters
// long."). Causa: dos invitaciones casi identicas a escribirle a Sofi (una
// dentro del mensaje para reenviar, otra aparte), mas la lista de
// propiedades repetida completa dos veces.

test("con mensaje para reenviar presente, NO se duplica la invitacion a escribirle a Sofi", () => {
  process.env.CONTACT_WHATSAPP_NUMBER = "573000000001";
  const texto = construir(
    senal(),
    VEREDICTO,
    [matchUtil({ linkWasi: "https://info.wasi.co/apartamento-venta-ap004/9744456" })],
    null // sin telefono resuelto -- dispara el mensaje para reenviar
  );
  const ocurrencias = (texto.match(/escribirle a Sofi/gi) || []).length;
  assert.strictEqual(ocurrencias, 1, `deberia aparecer una sola vez, aparecio ${ocurrencias} veces`);
  delete process.env.CONTACT_WHATSAPP_NUMBER;
});

test("sin mensaje para reenviar (telefono resuelto), la invitacion a Sofi si aparece como antes", () => {
  process.env.CONTACT_WHATSAPP_NUMBER = "573000000001";
  const texto = construir(senal(), VEREDICTO, [matchUtil()], "573001234567");
  assert.match(texto, /escribirle a Sofi/i);
  delete process.env.CONTACT_WHATSAPP_NUMBER;
});

test("un pedido con muchas propiedades y mensaje para reenviar no pasa de 4096 caracteres, y no pierde ninguna ref", () => {
  // 8 propiedades, cada una con datos completos -- suficiente para reproducir
  // el caso real (6 propiedades ya alcanzaba a pasarse del limite).
  const muchasRefs = Array.from({ length: 8 }, (_, i) => `AP0${i}`);
  const muchasProps = muchasRefs.map((ref) =>
    matchUtil({
      ref,
      titulo: `Apartamento en Venta Laureles ${ref}`,
      zona: "Laureles",
      linkWasi: `https://info.wasi.co/apartamento-venta-laureles-${ref}`,
      link: `https://diamondinmobiliaria.com/propiedades/${ref}`,
    })
  );
  const veredictoConTodas = { ...VEREDICTO, refs_utiles: muchasRefs, por_que: "Todas calzan en zona, precio y alcobas." };
  const texto = construir(senal(), veredictoConTodas, muchasProps, null);

  assert.ok(texto.length <= 4096, `el texto tiene ${texto.length} caracteres, se paso del limite de Meta`);
  // Ninguna ref se pierde -- sigue estando, aunque sea solo dentro del
  // mensaje para reenviar (que siempre lista todas completas).
  for (const ref of muchasRefs) assert.match(texto, new RegExp(ref), `falta ${ref} en el aviso`);
});

test("con pocas propiedades (mensaje corto), el listado 'Le puede(n) servir' sigue completo, no se comprime", () => {
  const texto = construir(
    senal(),
    VEREDICTO,
    [matchUtil({ linkWasi: "https://info.wasi.co/apartamento-venta-ap004/9744456" })],
    null
  );
  assert.match(texto, /Le puede servir:\n▸ Ref AP004/, "con un mensaje corto, no hace falta comprimir nada");
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `node --test test/alerta-asesor.test.js`
Expected: FAIL en el primero (hoy la invitación SÍ se duplica) y probablemente en el de 8 propiedades (hoy no hay tope de longitud). Los otros dos pueden pasar ya — no importa, se confirman igual en el Step 4.

- [ ] **Step 3: Implementación**

Reemplazar la función `construir` completa (desde `function construir(senal, veredicto, matches, telefonoColega = null, org = null) {` hasta el `}` que la cierra, justo antes de `module.exports`) por:

```js
function construir(senal, veredicto, matches, telefonoColega = null, org = null) {
  const refsUtiles = veredicto && Array.isArray(veredicto.refs_utiles) ? veredicto.refs_utiles : [];
  const refsDudosas = veredicto && Array.isArray(veredicto.refs_dudosas) ? veredicto.refs_dudosas : [];
  if (!veredicto || (refsUtiles.length === 0 && refsDudosas.length === 0)) return null;

  const utiles = refsUtiles
    .map((ref) => (matches || []).find((m) => String(m.ref) === String(ref)))
    .filter(Boolean);
  // Para revisar (Juan, 2026-09-01): refs_dudosas de revalidar.js -- Sofi no
  // las aprueba para el envio normal, pero tampoco las descarta del todo.
  // Van SOLO al asesor, nunca al colega.
  const dudosas = refsDudosas
    .map((ref) => (matches || []).find((m) => String(m.ref) === String(ref)))
    .filter(Boolean);
  if (utiles.length === 0 && dudosas.length === 0) return null;

  const quien = senal.autor_nombre || "un colega";
  const contactoTexto = contactoPara(telefonoColega, senal.autor_telefono, quien);

  const cabecera = [
    `🎯 Oportunidad en un grupo`,
    ``,
    `Grupo: ${senal.grupo_nombre || "sin nombre"}`,
    `Colega: ${quien}`,
    `Contacto: ${contactoTexto}`,
    ``,
    `Pidió:`,
    `"${(senal.texto_original || "").trim()}"`,
  ];

  // Tope de longitud (Juan, 2026-09-01): con `compacto=true` se reemplaza el
  // listado completo por una linea de conteo -- las mismas propiedades ya
  // van completas mas abajo, en el mensaje para reenviar. Nunca se pierde
  // informacion, solo se deja de repetirla dos veces.
  function bloqueUtiles(compacto) {
    if (!utiles.length) return [];
    if (compacto) {
      const plural = utiles.length === 1 ? "" : "es";
      const verbo = utiles.length === 1 ? "puede" : "pueden";
      return [``, `Le ${verbo} servir ${utiles.length} propiedad${plural} — el detalle completo va más abajo, en el mensaje listo para reenviar.`];
    }
    return [``, utiles.length === 1 ? `Le puede servir:` : `Le pueden servir:`, utiles.map(linea).join("\n")];
  }

  const bloqueDudosas = dudosas.length
    ? [
        ``,
        utiles.length
          ? `🔎 Para revisar (no confirmadas — decidí vos si vale la pena llamar al colega):`
          : `🔎 Para revisar (nada confirmado del todo — decidí vos si vale la pena llamar al colega):`,
        dudosas.map(linea).join("\n"),
      ]
    : [];

  const sofiDice = [``, `Sofi dice: ${veredicto.por_que}`];

  // Mensaje listo para reenviar (Juan, 2026-09-01): sin telefono resuelto,
  // nadie mas que un humano puede escribirle al colega -- se le entrega el
  // texto YA armado. Con telefono resuelto no hace falta: la asesora ya
  // tiene el link directo al privado arriba, en `Contacto:`.
  const mensajeListo = utiles.length && !telefonoResuelto(telefonoColega, senal.autor_telefono)
    ? mensajeListoParaReenviar(senal, veredicto, utiles, org)
    : null;
  const bloqueReenviar = mensajeListo
    ? [
        ``,
        `⚡ No se pudo resolver su número — mandale ESTO YA por su privado (tocá su nombre arriba para abrirle el chat):`,
        ``,
        mensajeListo,
      ]
    : [];

  // Sin invitacion duplicada (Juan, 2026-09-01): el mensaje para reenviar YA
  // trae su propia invitacion a escribirle a Sofi (viene de
  // redactar.js#mensajeGrupo). Agregarla aparte fue justo lo que hizo que un
  // aviso de 6 propiedades pasara el limite de 4096 caracteres de Meta.
  const linkSofi = mensajeListo ? null : linkContactoOficial(org);
  const bloqueSofi = linkSofi
    ? [
        ``,
        `Para que la conversación quede en nuestro sistema, cerrale invitándolo a escribirle a Sofi (nuestra línea oficial):`,
        linkSofi,
      ]
    : [];

  const cierre = [``, `Contame en qué quedó (la llamaste, no servía, ya se vendió). Con eso el radar aprende.`];

  const armar = (compacto) =>
    [...cabecera, ...bloqueUtiles(compacto), ...bloqueDudosas, ...sofiDice, ...bloqueReenviar, ...bloqueSofi, ...cierre].join("\n");

  const completo = armar(false);
  // Margen de seguridad bajo el limite real de Meta (4096). Solo tiene
  // sentido comprimir si el mensaje para reenviar esta presente -- es la
  // unica fuente de la duplicacion de datos que este tope existe para evitar.
  if (completo.length > 4000 && mensajeListo) return armar(true);
  return completo;
}
```

**OJO:** este reemplazo cambia la ESTRUCTURA interna de la función (de un array plano `lineas` a bloques nombrados + una función `armar`), pero el contenido y el orden de cada línea para el caso "sin compresión" (`armar(false)`) es idéntico al que ya existía — verificalo comparando línea por línea contra el archivo actual antes de aplicar el reemplazo, no lo hagas a ciegas.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test test/alerta-asesor.test.js`
Expected: PASS — todos los tests del archivo (los de antes + los 4 nuevos), 0 fallos

- [ ] **Step 5: Correr toda la suite**

Run: `node --test test/*.test.js`
Expected: PASS — sin regresiones (este archivo lo usa `src/groups/vivo.js`, revisar que `test/group-asistido.test.js` y `test/group-vivo*.test.js` sigan en verde)

- [ ] **Step 6: Commit**

```bash
git add src/groups/alerta-asesor.js test/alerta-asesor.test.js
git commit -m "fix(radar): el aviso al asesor no repite la invitacion a Sofi y nunca pasa el limite de Meta"
```

---

### Task 2: `construirAvisoPostDm` — aviso cuando el DM salió bien pero quedan dudosas

**Files:**
- Modify: `src/groups/alerta-asesor.js`
- Test: `test/alerta-asesor.test.js`

**Interfaces:**
- Produces: `construirAvisoPostDm(senal, veredicto, matches, refsEnviadas)` — nueva función exportada. `senal` solo necesita `autor_nombre` (no necesita `grupo_nombre`, `autor_telefono` ni `texto_original` — este aviso no incluye esos datos). `refsEnviadas` es un array de refs (strings), típicamente `utiles.map(m => m.ref)` del llamador. Devuelve `null` si `veredicto.refs_dudosas` está vacío o ausente; si no, un string.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `test/alerta-asesor.test.js`:

```js
// construirAvisoPostDm (Juan, 2026-09-01): cuando el DM directo al colega
// SI sale, pero el pedido tenia propiedades dudosas, la asesora se entera
// igual -- antes esto se perdia en silencio.

test("construirAvisoPostDm: sin refs_dudosas, devuelve null -- no hay nada pendiente que avisar", () => {
  const { construirAvisoPostDm } = require("../src/groups/alerta-asesor");
  const texto = construirAvisoPostDm({ autor_nombre: "Patricia Gomez" }, VEREDICTO, [matchUtil()], ["AP004"]);
  assert.strictEqual(texto, null);
});

test("construirAvisoPostDm: con refs_dudosas, dice que ya se mando y que queda pendiente", () => {
  const { construirAvisoPostDm } = require("../src/groups/alerta-asesor");
  const veredictoConDudosas = { ...VEREDICTO, refs_dudosas: ["AP009"] };
  const dudosa = matchUtil({ ref: "AP009", titulo: "Apartamento en Sabaneta", zona: "Sabaneta" });
  const texto = construirAvisoPostDm({ autor_nombre: "Patricia Gomez" }, veredictoConDudosas, [matchUtil(), dudosa], ["AP004"]);

  assert.notStrictEqual(texto, null);
  assert.match(texto, /Ya le mandé por privado a Patricia Gomez/i);
  assert.match(texto, /AP004/, "menciona lo que ya se envio");
  assert.match(texto, /Ref AP009/, "lista la dudosa con el mismo formato que 'Para revisar'");
  assert.match(texto, /Sabaneta/);
});

test("construirAvisoPostDm: sin refsEnviadas (undefined), no revienta -- solo no menciona nada enviado", () => {
  const { construirAvisoPostDm } = require("../src/groups/alerta-asesor");
  const veredictoConDudosas = { ...VEREDICTO, refs_dudosas: ["AP009"] };
  const dudosa = matchUtil({ ref: "AP009" });
  const texto = construirAvisoPostDm({ autor_nombre: "Patricia Gomez" }, veredictoConDudosas, [dudosa], undefined);
  assert.notStrictEqual(texto, null);
  assert.match(texto, /Ya le mandé por privado a Patricia Gomez/i);
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `node --test test/alerta-asesor.test.js`
Expected: FAIL — `construirAvisoPostDm is not a function` (todavía no existe)

- [ ] **Step 3: Implementación**

En `src/groups/alerta-asesor.js`, agregar la función nueva justo antes de `module.exports` (después de `construir`):

```js
// Aviso liviano post-DM (Juan, 2026-09-01): el DM directo al colega SI salio,
// pero el mismo pedido tenia propiedades dudosas que no se mandaron -- antes
// esto se perdia en silencio ("no tiene nada que hacer" solo es cierto si no
// queda nada pendiente). Deliberadamente separada de construir(): la forma es
// distinta, no hace falta Contacto (la asesora no tiene que contactar a
// nadie, el DM ya salio) ni el texto completo del pedido.
//
// @param senal          solo necesita autor_nombre
// @param veredicto      lo que devolvio revalidar.js
// @param matches        las candidatas (para resolver las refs a fichas completas)
// @param refsEnviadas   array de refs que SI se mandaron por DM (utiles.map(m => m.ref))
// @returns el texto del aviso, o null si no hay refs_dudosas
function construirAvisoPostDm(senal, veredicto, matches, refsEnviadas) {
  const dudosas = (veredicto && Array.isArray(veredicto.refs_dudosas) ? veredicto.refs_dudosas : [])
    .map((ref) => (matches || []).find((m) => String(m.ref) === String(ref)))
    .filter(Boolean);
  if (dudosas.length === 0) return null;

  const quien = senal.autor_nombre || "un colega";
  const enviadas = (refsEnviadas || []).filter(Boolean);
  const detalleEnviadas = enviadas.length ? `: ${enviadas.map((r) => `Ref ${r}`).join(", ")}` : ".";

  const lineas = [
    `✅ Ya le mandé por privado a ${quien}${detalleEnviadas}`,
    ``,
    `🔎 Esto otro quedó sin mandar (no confirmado) — decidí vos si vale la pena:`,
    dudosas.map(linea).join("\n"),
  ];
  return lineas.join("\n");
}
```

Y actualizar el `module.exports` al final del archivo:

```js
module.exports = { construir, construirAvisoPostDm, linea };
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test test/alerta-asesor.test.js`
Expected: PASS — todos los tests, 0 fallos

- [ ] **Step 5: Correr toda la suite**

Run: `node --test test/*.test.js`
Expected: PASS — sin regresiones

- [ ] **Step 6: Commit**

```bash
git add src/groups/alerta-asesor.js test/alerta-asesor.test.js
git commit -m "feat(radar): construirAvisoPostDm -- avisa a la asesora lo que quedo pendiente cuando el DM al colega ya salio"
```

---

### Task 3: `vivo.js#asistir` manda el aviso post-DM cuando corresponde

**Files:**
- Modify: `src/groups/vivo.js`
- Test: `test/group-asistido.test.js`

**Interfaces:**
- Consumes: `alertaAsesor.construirAvisoPostDm` (Task 2) — `alertaAsesor` ya está importado en `vivo.js` (se usa más abajo en la misma función para `alertaAsesor.construir`). `mensajeAsesor.enviarYRegistrar` — ya importado y usado en el resto del archivo.
- Produces: ningún cambio en la firma de `asistir` ni en la forma del objeto que devuelve (`{ resultado: "dm_enviado", ... }` sigue igual).

- [ ] **Step 1: Escribir el test que falla**

Leer primero el bloque de tests alrededor de la línea 466 de `test/group-asistido.test.js` (el test `"con telefono, pedido reciente, cupo libre y sesion, se manda el DM y NO se avisa a la asesora"`) para confirmar los nombres reales de las variables de mock (`telefonoColegaResuelto`, `enviosDm`, `enviadosPorSofi`, `veredictoDeSofi`, `APRUEBA`, `ORG`, `GRUPO`, `CATHERINE`, `mensaje()`, `vivo.procesarMensaje`) — deben coincidir exactamente con lo que ya usa ese archivo.

Agregar, justo después de ese test existente (que NO se debe modificar):

```js
test("con telefono resuelto Y refs_dudosas, el DM sale Y la asesora recibe el aviso de lo pendiente", async () => {
  telefonoColegaResuelto = "573001234567";
  matchesDevueltos = [match(), match({ ref: "9800000", titulo: "Apartamento en Sabaneta", zona: "Sabaneta" })];
  veredictoDeSofi = { ...APRUEBA, refs_dudosas: ["9800000"] };

  const r = await vivo.procesarMensaje(ORG, mensaje(), {
    grupo: GRUPO, modo: "asistido", asesor: CATHERINE, sesion: "RADA-NATALIA",
  });

  assert.strictEqual(r.resultado, "dm_enviado", "el DM sigue saliendo igual");
  assert.strictEqual(enviosDm.length, 1, "el colega sigue recibiendo su DM normal");
  assert.strictEqual(enviadosPorSofi.length, 1, "la asesora SI recibe algo ahora -- quedo una dudosa pendiente");
  assert.match(enviadosPorSofi[0].texto, /Ya le mandé por privado/i);
  assert.match(enviadosPorSofi[0].texto, /9780079/, "menciona la ref que ya se envio por DM");
  assert.match(enviadosPorSofi[0].texto, /9800000/, "lista la dudosa pendiente");
  assert.match(enviadosPorSofi[0].texto, /Sabaneta/);
});
```

If `match()` (the test's helper for building a candidate fixture) doesn't accept an override object the way this snippet assumes, or if `APRUEBA`'s shape or `matchesDevueltos`'s usage differs from what's shown here, adapt the test to the file's real conventions — read the existing test right above the insertion point and the `match()`/`mensaje()` helper functions near the top of the file first.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/group-asistido.test.js`
Expected: FAIL — `enviadosPorSofi.length` es `0`, no `1` (todavía no se manda nada post-DM)

- [ ] **Step 3: Implementación**

En `src/groups/vivo.js`, dentro de `asistir()`, localizar el bloque (ya existente) que maneja un DM exitoso:

```js
      const envioDm = await waha.enviarDm(sesion, telefonoColega, textoDm).catch((e) => ({ ok: false, error: e.message }));
      if (envioDm && envioDm.ok) {
        // Se registra DESPUES de que salio, con el id real del mensaje publicado: si
        // manana un colega reclama por lo que se dijo, la unica respuesta honesta es
        // mostrar el texto tal como salio.
        const refsDm = utiles.map((m) => m.ref).filter(Boolean);
        await groupSignals.marcarRespondida(org.id, signal.id, { texto: textoDm, wamid: envioDm.wamid, modo: "auto", refs: refsDm });
        // No se avisa a la asesora: no tiene nada que hacer con un pedido que
        // el bot ya resolvio, y avisarle igual seria ruido. El feed del admin
        // SI se entera — es la trazabilidad que ya usa el resto de este
        // archivo, solo que con quien realmente se avisó.
        await feedComando
          .registrar(org, señalParaFeed, veredicto, matches, {
            avisada: true,
            destinatarioNombre: `DM directo a ${mensaje.autor || "el colega"}`,
          })
          .catch((e) => console.warn("[radar] No se pudo escribir en el feed del admin:", e.message));
        return { resultado: "dm_enviado", veredicto, texto: textoDm, telefono: telefonoColega, signalId: signal.id };
      }
```

Reemplazar por (agrega el aviso post-DM justo después de `marcarRespondida`, antes del comentario "No se avisa a la asesora" — ese comentario ya no es del todo cierto y se actualiza):

```js
      const envioDm = await waha.enviarDm(sesion, telefonoColega, textoDm).catch((e) => ({ ok: false, error: e.message }));
      if (envioDm && envioDm.ok) {
        // Se registra DESPUES de que salio, con el id real del mensaje publicado: si
        // manana un colega reclama por lo que se dijo, la unica respuesta honesta es
        // mostrar el texto tal como salio.
        const refsDm = utiles.map((m) => m.ref).filter(Boolean);
        await groupSignals.marcarRespondida(org.id, signal.id, { texto: textoDm, wamid: envioDm.wamid, modo: "auto", refs: refsDm });

        // Aviso post-DM (Juan, 2026-09-01): "no tiene nada que hacer" solo es
        // cierto si no queda nada pendiente -- si el pedido tenia dudosas,
        // esas se le avisan igual, aparte del DM que ya salio. Best-effort:
        // un fallo aca no puede tumbar el resultado "dm_enviado", que ya es
        // verdad sin importar si este aviso extra sale o no.
        if (asesor && asesor.phone) {
          const avisoPostDm = alertaAsesor.construirAvisoPostDm(
            { autor_nombre: mensaje.autor },
            veredicto,
            matches,
            refsDm
          );
          if (avisoPostDm) {
            await mensajeAsesor.enviarYRegistrar(org, asesor.phone, avisoPostDm).catch((e) =>
              console.warn("[radar] No se pudo mandar el aviso post-DM:", e.message)
            );
          }
        }

        // El feed del admin SI se entera siempre — es la trazabilidad que ya
        // usa el resto de este archivo, con quien realmente se avisó.
        await feedComando
          .registrar(org, señalParaFeed, veredicto, matches, {
            avisada: true,
            destinatarioNombre: `DM directo a ${mensaje.autor || "el colega"}`,
          })
          .catch((e) => console.warn("[radar] No se pudo escribir en el feed del admin:", e.message));
        return { resultado: "dm_enviado", veredicto, texto: textoDm, telefono: telefonoColega, signalId: signal.id };
      }
```

**OJO:** confirmar que `alertaAsesor` y `mensajeAsesor` ya están importados (`require(...)`) al inicio de `src/groups/vivo.js` antes de aplicar este cambio — se usan más abajo en la misma función para el camino normal (sin DM), así que deberían existir ya. Si por algún motivo no están, agregar el `require` correspondiente siguiendo el mismo patrón que los demás imports del archivo.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --test test/group-asistido.test.js`
Expected: PASS — todos los tests del archivo (los de antes + el nuevo), 0 fallos. Confirmar en particular que el test existente "la asesora no recibe nada: no tiene nada que hacer" (sin dudosas) SIGUE pasando sin modificarlo.

- [ ] **Step 5: Correr toda la suite**

Run: `node --test test/*.test.js`
Expected: PASS — sin regresiones

- [ ] **Step 6: Commit**

```bash
git add src/groups/vivo.js test/group-asistido.test.js
git commit -m "feat(radar): asistir manda el aviso post-DM cuando quedan dudosas en el mismo pedido"
```

---

### Task 4: Deploy y verificación en producción

**Files:** ninguno (push + verificación operativa)

- [ ] **Step 1: Push a main**

```bash
git push origin main
```

- [ ] **Step 2: Verificar el deploy**

`railway deployment list` (proyecto `ca2b2fb9-f4eb-45fe-9e60-b6cd17ef3337`, environment `10f374aa-f477-45d3-b85f-eaf4e0014246`, servicio `diamond` = `2360e9b8-5ec2-43f0-bb41-7e0fe7665f1f`), esperar `status: SUCCESS` con el `commitHash` del último commit de este plan. Revisar logs (`railway logs --lines 60`) para confirmar arranque limpio.

- [ ] **Step 3: Smoke test contra el caso real que disparó este plan**

Repetir localmente (con las credenciales reales de producción, mismo patrón ya usado en esta sesión) `evaluarOferta`/`buildMandatoMatchAlert` no aplica acá — este plan es del carril de venta. En su lugar, llamar directo a `alerta-asesor.js#construir` con las 6 propiedades reales del pedido de Mateo Narváez (ya están en la base, en el mensaje fallido a Natalia) y confirmar que el texto resultante mide menos de 4096 caracteres y no repite la invitación a Sofi. No hace falta reenviar nada real — es una verificación de la función pura contra datos reales.

- [ ] **Step 4: Buscar en la base si quedan mensajes `delivery: 'failed'` con el mismo error de longitud**

Consultar la tabla `messages` (Supabase) por `delivery = 'failed'` y `delivery_error ilike '%4096%'` de los últimos días — si hay más casos represados, decidir con Juan si vale la pena reintentarlos manualmente ahora que el fix está desplegado (no es parte obligatoria de este plan, es una oportunidad que el deploy destapa).

---

## Self-Review

**Cobertura del spec:** §2 Parte A (Task 1) · §3 Parte B (Task 2 + Task 3) · §4 "qué no cambia" (verificado en Global Constraints y en el test que confirma que sin dudosas nada cambia) · §5 testing (cada sección tiene su tarea correspondiente).

**Placeholders:** ninguno — cada step trae código completo o el comando exacto.

**Consistencia de tipos:** `construirAvisoPostDm(senal, veredicto, matches, refsEnviadas)` se define en Task 2 con esa firma exacta y se llama en Task 3 con `({ autor_nombre: mensaje.autor }, veredicto, matches, refsDm)` — mismo orden y tipos. `construir`'s contrato (string o `null`) no cambia entre tareas. `module.exports` se actualiza en Task 2 para incluir `construirAvisoPostDm` junto a `construir` y `linea` (ya existentes) — ninguna tarea posterior necesita otro export de este archivo.
