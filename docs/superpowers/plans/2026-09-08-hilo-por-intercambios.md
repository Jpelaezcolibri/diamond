# El hilo de la línea por intercambios — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el panel `/grupos` del CRM muestre, junto a lo que escribió el colega, el DM que le mandó Sofi — agrupado en bloques por intercambio (un DM y las respuestas a *ese* DM), no como una conversación corrida.

**Architecture:** Toda la lógica de agrupar sale del componente y vive en `crm/lib/linea-dm-hilo.ts` como una función pura, que se prueba de verdad desde la suite de la raíz aprovechando el type-stripping nativo de Node 24. `page.tsx` suma una consulta que trae **todos** los DM mandados a los colegas en pantalla (incluidos los que nadie contestó, que son el denominador del conteo). El componente sólo renderiza.

**Tech Stack:** Next.js 16 + React 19 + TypeScript + Tailwind 4 (CRM); `node --test` (suite de la raíz); Supabase/PostgREST.

**Spec:** `docs/superpowers/specs/2026-09-08-hilo-por-intercambios-design.md`
**Mockup aprobado:** https://claude.ai/code/artifact/fe8686dd-abaa-48be-924e-0628a86cdd9b

## Global Constraints

- **Esto es sólo CRM.** No se toca el bot (`src/`), ni la base, ni hay migración. `group_signals.respuesta_texto` ya está guardado en el 100% de las señales.
- **No se toca `mias()` ni el aislamiento por asesor.** La consulta nueva a `group_signals` va envuelta en `mias(...)` como todas las demás. `test/crm-grupos-aislamiento.test.js` lo vigila leyendo el texto del fuente y exige que lo que venga inmediatamente antes de `supabase.from("group_signals")` sea `mias(`.
- **Toda consulta a `group_signals` en `page.tsx` usa `select("*")`**, no una lista de columnas: con una lista angosta el helper genérico de `mias()` dispara TS2589. Ya hay un comentario en el archivo que lo explica.
- Idioma de la interfaz: español (Colombia). En el CRM los acentos van normales, en textos visibles y en comentarios.
- **Sólo tipos borrables en `crm/lib/linea-dm-hilo.ts`**: anotaciones, `type`, `interface`, `import type`. Nada que emita runtime (`enum`, `namespace`, decoradores, `private` en parámetros de constructor) — el `require()` desde el test de la raíz depende de eso.
- Commits en español con prefijo convencional. Terminar cada mensaje con `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Verificación: `npx tsc --noEmit` y `npm run build` desde `crm/`; `npm test` desde la raíz (base actual: **1730 pass, 0 fail**). `npm run lint` NO funciona en `crm/` — ESLint nunca estuvo instalado ahí; no intentar arreglarlo.
- Trabajar desde la raíz del repo: `C:/Users/JuanPelaez/bot-inmobiliario`. Windows sin admin, Git Bash, rutas con `/`.

---

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| `crm/lib/linea-dm-hilo.ts` (modificar) | Tipos y la función pura `armarHilos`. Ya tiene `claveHilo`, `anclaHilo`, `IdentidadHilo`. Recibe además `DmMensaje` (hoy vive en el componente) y los tipos nuevos. |
| `test/linea-dm-hilo.test.js` (crear) | Prueba `armarHilos` ejecutándola. Primer módulo de `crm/lib` probado así. |
| `crm/app/(dashboard)/grupos/page.tsx` (modificar) | Consulta nueva de los DM por identidad; arma el `Map` que consume `armarHilos`; arregla el error descartado de la consulta de señales. |
| `crm/components/linea-dm-inbox.tsx` (modificar) | Sólo renderiza. Pierde `agruparPorRemitente` y el tipo `DmMensaje` (los re-exporta desde el lib para no romper el import de `page.tsx`). |

---

### Task 1: `armarHilos` — la lógica pura y sus tests

**Files:**
- Modify: `crm/lib/linea-dm-hilo.ts`
- Test: `test/linea-dm-hilo.test.js` (crear)

**Interfaces:**
- Consumes: `claveHilo`, `anclaHilo`, `IdentidadHilo` (ya existen en el mismo archivo).
- Produces (los consumen las Tasks 2 y 3):
  - `type DmMensaje` — el mensaje ENTRANTE del colega. Se mueve tal cual desde `crm/components/linea-dm-inbox.tsx`, sin cambiarle ningún campo.
  - `type DmEnviado = { senalId: string; enviadoAt: string | null; texto: string | null; pedidoOriginal: string | null; propiedad: { ref: string; titulo: string | null; link: string | null } | null }`
  - `type MotivoSinDm = "nunca_le_escribimos" | "restringido" | "sin_atribuir"`
  - `type Intercambio = { clave: string; dm: DmEnviado | null; sinDm: MotivoSinDm | null; respuestas: DmMensaje[] }`
  - `type HiloLinea = { identidad: IdentidadHilo; nombre: string | null; idRespaldo: string; ultimaActividad: string; ultimoMensaje: DmMensaje; dmEnviados: number; dmRespondidos: number; visibles: Intercambio[]; plegados: Intercambio[]; avanceMasReciente: DmMensaje | null }`
  - `function armarHilos(mensajes: DmMensaje[], dmsPorClave: Map<string, DmEnviado[]>): HiloLinea[]`

- [ ] **Step 1: Escribir el test que falla**

Crear `test/linea-dm-hilo.test.js`:

```js
// La logica que arma el panel de la linea de DM del radar, probada
// EJECUTANDOLA y no leyendo su fuente.
//
// COMO SE IMPORTA UN .ts DESDE ACA (verificado 2026-09-08, Node v24.20.0):
// Node 24 hace type-stripping nativo, asi que `require` de un modulo con
// solo tipos borrables funciona sin transpilar ni agregar tsx/ts-node. Si
// alguien mete un `enum` o un `namespace` en ese archivo, este require se
// rompe -- y eso es deliberado: el test es tambien la guarda de esa regla.
//
// Es distinto de test/crm-grupos-aislamiento.test.js, que lee el TEXTO de
// page.tsx porque una pagina de servidor de Next no se puede instanciar.
// Aca la funcion es pura y se ejercita de verdad.

const { test } = require("node:test");
const assert = require("node:assert");
const { armarHilos } = require("../crm/lib/linea-dm-hilo.ts");

const LID = "276467766300904@lid";

// Un mensaje entrante del colega. Solo los campos que armarHilos mira.
function msg(id, creado, extra = {}) {
  return {
    id, created_at: creado,
    remitente_lid: LID, remitente_telefono: null, remitente_nombre: "Carva",
    texto: `texto ${id}`, senal_id: null,
    tiene_cita: null, avance_tipo: null, cita_fecha_hora_iso: null,
    ...extra,
  };
}

function dm(senalId, enviadoAt, ref = "9953055") {
  return {
    senalId, enviadoAt, texto: `DM de ${senalId}`,
    pedidoOriginal: `pedido de ${senalId}`,
    propiedad: { ref, titulo: `Casa ${ref}`, link: null },
  };
}

test("un DM con dos respuestas: un intercambio visible, contadores 1 y 1", () => {
  const mensajes = [
    msg("m1", "2026-09-08T16:38:00Z", { senal_id: "s1" }),
    msg("m2", "2026-09-08T16:42:00Z", { senal_id: "s1" }),
  ];
  const dms = new Map([[LID, [dm("s1", "2026-09-08T16:24:00Z")]]]);

  const [hilo] = armarHilos(mensajes, dms);

  assert.strictEqual(hilo.dmEnviados, 1);
  assert.strictEqual(hilo.dmRespondidos, 1);
  assert.strictEqual(hilo.visibles.length, 1);
  assert.strictEqual(hilo.plegados.length, 0);
  assert.strictEqual(hilo.visibles[0].dm.senalId, "s1");
  // Las respuestas de un intercambio van en orden cronologico ascendente.
  assert.deepStrictEqual(hilo.visibles[0].respuestas.map((r) => r.id), ["m1", "m2"]);
});

test("tres DM y solo el mas reciente contestado: los dos callados se pliegan", () => {
  const mensajes = [msg("m1", "2026-09-08T16:10:00Z", { senal_id: "s3" })];
  const dms = new Map([[LID, [
    dm("s1", "2026-09-06T18:40:00Z"),
    dm("s2", "2026-09-07T14:15:00Z"),
    dm("s3", "2026-09-08T15:52:00Z"),
  ]]]);

  const [hilo] = armarHilos(mensajes, dms);

  assert.strictEqual(hilo.dmEnviados, 3);
  assert.strictEqual(hilo.dmRespondidos, 1);
  assert.deepStrictEqual(hilo.visibles.map((i) => i.dm.senalId), ["s3"]);
  // Mas reciente primero tambien entre los plegados.
  assert.deepStrictEqual(hilo.plegados.map((i) => i.dm.senalId), ["s2", "s1"]);
});

// "Le acabamos de escribir y todavia no contesta" es informacion, no ruido:
// plegarlo esconderia justo lo que se esta esperando.
test("el DM MAS RECIENTE se ve aunque no tenga respuesta, y el viejo respondido tambien", () => {
  const mensajes = [msg("m1", "2026-09-06T19:00:00Z", { senal_id: "s1" })];
  const dms = new Map([[LID, [
    dm("s1", "2026-09-06T18:40:00Z"),
    dm("s2", "2026-09-07T14:15:00Z"),
    dm("s3", "2026-09-08T15:52:00Z"),
  ]]]);

  const [hilo] = armarHilos(mensajes, dms);

  // s3 por ser el mas reciente, s1 por tener respuesta. s2 se pliega.
  assert.deepStrictEqual(hilo.visibles.map((i) => i.dm.senalId), ["s3", "s1"]);
  assert.strictEqual(hilo.visibles[0].respuestas.length, 0);
  assert.deepStrictEqual(hilo.plegados.map((i) => i.dm.senalId), ["s2"]);
});

// Los tres motivos por los que un mensaje puede no tener DM son distintos y
// el panel no puede confundirlos: decir "escribio por su cuenta" de algo que
// quiza si era respuesta es inventar una explicacion.
test("sin senal_id y sin ningun DM: escribio por su cuenta", () => {
  const [hilo] = armarHilos([msg("m1", "2026-09-08T18:20:00Z")], new Map());
  assert.strictEqual(hilo.dmEnviados, 0);
  assert.strictEqual(hilo.visibles.length, 1);
  assert.strictEqual(hilo.visibles[0].dm, null);
  assert.strictEqual(hilo.visibles[0].sinDm, "nunca_le_escribimos");
});

test("sin senal_id pero el colega SI tiene DM: es un hueco de atribucion, no 'por su cuenta'", () => {
  const mensajes = [msg("m1", "2026-09-08T18:20:00Z")];
  const dms = new Map([[LID, [dm("s1", "2026-09-08T15:52:00Z")]]]);

  const [hilo] = armarHilos(mensajes, dms);

  const suelto = hilo.visibles.find((i) => i.dm === null);
  assert.strictEqual(suelto.sinDm, "sin_atribuir");
});

test("con senal_id que no vino entre los DM (mias() lo filtro): restringido", () => {
  const mensajes = [msg("m1", "2026-09-08T18:20:00Z", { senal_id: "s-ajena", pedido_restringido: true })];
  const [hilo] = armarHilos(mensajes, new Map());
  const bloque = hilo.visibles.find((i) => i.dm === null);
  assert.strictEqual(bloque.sinDm, "restringido");
});

test("un lid y un telefono con los mismos digitos son DOS hilos, no uno", () => {
  const mensajes = [
    msg("m1", "2026-09-08T10:00:00Z", { remitente_lid: "573001112222@lid", remitente_telefono: null }),
    msg("m2", "2026-09-08T10:05:00Z", { remitente_lid: null, remitente_telefono: "573001112222" }),
  ];
  const hilos = armarHilos(mensajes, new Map());
  assert.strictEqual(hilos.length, 2);
});

test("los hilos salen por actividad mas reciente primero", () => {
  const mensajes = [
    msg("viejo", "2026-09-07T10:00:00Z", { remitente_lid: "111@lid" }),
    msg("nuevo", "2026-09-08T10:00:00Z", { remitente_lid: "222@lid" }),
  ];
  const hilos = armarHilos(mensajes, new Map());
  assert.deepStrictEqual(hilos.map((h) => h.ultimoMensaje.id), ["nuevo", "viejo"]);
});

test("un mensaje sin identidad ninguna igual produce su hilo, con idRespaldo para el ancla", () => {
  const mensajes = [msg("m1", "2026-09-08T10:00:00Z", { remitente_lid: null, remitente_telefono: null })];
  const [hilo] = armarHilos(mensajes, new Map());
  assert.strictEqual(hilo.idRespaldo, "m1");
  assert.deepStrictEqual(hilo.identidad, { lid: null, telefono: null });
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `node --test test/linea-dm-hilo.test.js`
Expected: FAIL — `armarHilos is not a function` (todavía no existe).

- [ ] **Step 3: Implementar en `crm/lib/linea-dm-hilo.ts`**

Agregar al final del archivo (sin tocar `IdentidadHilo`, `claveHilo` ni `anclaHilo`, que quedan como están):

```ts
/** Un mensaje ENTRANTE del colega, tal como sale de `linea_dm` (más los
 *  campos que `page.tsx` resuelve después). Vivía en linea-dm-inbox.tsx;
 *  se movió acá para que la lógica de armado sea pura y testeable. */
export type DmMensaje = {
  id: string;
  remitente_telefono: string | null;
  /** Lid crudo (`<digitos>@lid`) cuando el chat llegó por direccionamiento
   *  oculto — que es por donde salen los DM del radar y por donde vuelven las
   *  respuestas (Juan, 2026-09-08). Excluyente con remitente_telefono. */
  remitente_lid: string | null;
  remitente_nombre: string | null;
  texto: string | null;
  created_at: string;
  tiene_cita: boolean | null;
  avance_tipo: "cita_confirmada" | "agendando" | "interes_avanzado" | "ninguno" | null;
  cita_fecha_hora_iso: string | null;
  senal_id: string | null;
  /** Hay `senal_id`, pero la señal no vino en el enriquecimiento porque
   *  `mias()` la filtró: el pedido existe y este usuario no puede verlo. Es un
   *  estado DISTINTO de "nunca hubo pedido ligado". Lo calcula page.tsx. */
  pedido_restringido?: boolean;
};

/** Un DM que Sofi le mandó a un colega — una fila de `group_signals` que ya
 *  salió al privado. Se arma en page.tsx y llega acá listo. */
export type DmEnviado = {
  senalId: string;
  /** group_signals.respondida_at — cuándo salió el DM. */
  enviadoAt: string | null;
  /** group_signals.respuesta_texto — el mensaje entero, largo. */
  texto: string | null;
  /** group_signals.texto_original — lo que el colega publicó en el grupo. */
  pedidoOriginal: string | null;
  propiedad: { ref: string; titulo: string | null; link: string | null } | null;
};

/** Por qué un bloque de mensajes no tiene un DM nuestro arriba. Los tres son
 *  distintos y el panel no puede confundirlos (Juan, 2026-09-08): decirle
 *  "escribió por su cuenta" a algo que quizá sí era una respuesta es
 *  inventar una explicación. */
export type MotivoSinDm = "nunca_le_escribimos" | "restringido" | "sin_atribuir";

/** UN intercambio: el DM que le mandamos y lo que contestó a ESE DM. Es la
 *  unidad del panel — cada DM es por una propiedad distinta, así que un hilo
 *  con el mismo colega son intercambios separados, no una conversación. */
export type Intercambio = {
  /** Clave estable para la key de React. */
  clave: string;
  dm: DmEnviado | null;
  sinDm: MotivoSinDm | null;
  /** En orden cronológico ascendente. */
  respuestas: DmMensaje[];
};

export type HiloLinea = {
  identidad: IdentidadHilo;
  nombre: string | null;
  /** id de la primera fila, para `anclaHilo` cuando no hay identidad. */
  idRespaldo: string;
  ultimaActividad: string;
  ultimoMensaje: DmMensaje;
  dmEnviados: number;
  dmRespondidos: number;
  /** Más reciente primero. */
  visibles: Intercambio[];
  /** DM viejos sin ninguna respuesta. Más reciente primero. */
  plegados: Intercambio[];
  avanceMasReciente: DmMensaje | null;
};

const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);

/** La fecha por la que se ordena un intercambio: la del DM si lo hay, si no
 *  la del último mensaje del colega. */
function fechaDe(i: Intercambio): number {
  if (i.dm) return ms(i.dm.enviadoAt);
  const ultima = i.respuestas[i.respuestas.length - 1];
  return ultima ? ms(ultima.created_at) : 0;
}

/**
 * Arma los hilos del panel de la línea.
 *
 * @param mensajes     lo que escribieron los colegas (filas de linea_dm).
 * @param dmsPorClave  los DM que les mandamos, indexados por la MISMA clave
 *                     que devuelve `claveHilo` (el lid, o el teléfono).
 *                     Incluye los que nadie contestó: sin ellos no hay
 *                     denominador y el conteo mentiría.
 */
export function armarHilos(mensajes: DmMensaje[], dmsPorClave: Map<string, DmEnviado[]>): HiloLinea[] {
  const porClave = new Map<string, DmMensaje[]>();
  for (const m of mensajes) {
    const key = claveHilo(m) || `sin-identidad:${m.id}`;
    if (!porClave.has(key)) porClave.set(key, []);
    porClave.get(key)!.push(m);
  }

  const hilos: HiloLinea[] = [];
  for (const [clave, lista] of porClave) {
    lista.sort((a, b) => ms(a.created_at) - ms(b.created_at));
    const dms = [...(dmsPorClave.get(clave) || [])].sort((a, b) => ms(b.enviadoAt) - ms(a.enviadoAt));

    // Las respuestas de cada DM, por senal_id. Lo que no cae en ningún DM
    // conocido se junta aparte, con su motivo.
    const porSenal = new Map<string, DmMensaje[]>();
    const sueltos: DmMensaje[] = [];
    const restringidos: DmMensaje[] = [];
    const conocidas = new Set(dms.map((d) => d.senalId));
    for (const m of lista) {
      if (m.senal_id && conocidas.has(m.senal_id)) {
        if (!porSenal.has(m.senal_id)) porSenal.set(m.senal_id, []);
        porSenal.get(m.senal_id)!.push(m);
      } else if (m.senal_id) {
        // Tiene señal, pero no vino entre los DM: mias() la filtró.
        restringidos.push(m);
      } else {
        sueltos.push(m);
      }
    }

    const deDm: Intercambio[] = dms.map((d) => ({
      clave: `dm:${d.senalId}`,
      dm: d,
      sinDm: null,
      respuestas: porSenal.get(d.senalId) || [],
    }));

    const extras: Intercambio[] = [];
    if (restringidos.length) {
      extras.push({ clave: `restringido:${clave}`, dm: null, sinDm: "restringido", respuestas: restringidos });
    }
    if (sueltos.length) {
      extras.push({
        clave: `sueltos:${clave}`,
        dm: null,
        // Si al colega SÍ le escribimos, un mensaje sin ligar es un hueco de
        // atribución, no alguien que escribió espontáneamente.
        sinDm: dms.length > 0 ? "sin_atribuir" : "nunca_le_escribimos",
        respuestas: sueltos,
      });
    }

    // Se ve: el DM más reciente (aunque no haya contestado) y todo lo que
    // tiene respuesta. Se pliega: DM viejos que nadie contestó.
    const visibles: Intercambio[] = [];
    const plegados: Intercambio[] = [];
    deDm.forEach((i, idx) => {
      if (idx === 0 || i.respuestas.length > 0) visibles.push(i);
      else plegados.push(i);
    });
    visibles.push(...extras);
    visibles.sort((a, b) => fechaDe(b) - fechaDe(a));

    const ultimoMensaje = lista[lista.length - 1];
    hilos.push({
      identidad: { lid: lista[0].remitente_lid, telefono: lista[0].remitente_telefono },
      nombre: ultimoMensaje.remitente_nombre,
      idRespaldo: lista[0].id,
      ultimaActividad: ultimoMensaje.created_at,
      ultimoMensaje,
      dmEnviados: dms.length,
      dmRespondidos: deDm.filter((i) => i.respuestas.length > 0).length,
      visibles,
      plegados,
      avanceMasReciente:
        [...lista].reverse().find((m) => m.tiene_cita && m.avance_tipo && m.avance_tipo !== "ninguno") || null,
    });
  }

  hilos.sort((a, b) => ms(b.ultimaActividad) - ms(a.ultimaActividad));
  return hilos;
}
```

- [ ] **Step 4: Correr los tests**

Run: `node --test test/linea-dm-hilo.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Confirmar que no rompiste la suite ni el typecheck**

Run (raíz): `npm test`
Expected: 1739 pass, 0 fail (1730 de base + 9 nuevos).

Run (desde `crm/`): `npx tsc --noEmit`
Expected: sin salida. `linea-dm-inbox.tsx` todavía define su propio `DmMensaje`; eso es esperado y lo resuelve la Task 3.

- [ ] **Step 6: Commit**

```bash
git add crm/lib/linea-dm-hilo.ts test/linea-dm-hilo.test.js
git commit -m "feat(crm): armarHilos -- la linea se agrupa por intercambio, con tests que la ejecutan

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: La consulta de los DM mandados a cada colega

**Files:**
- Modify: `crm/app/(dashboard)/grupos/page.tsx` (bloque de datos, ~líneas 355-430)

**Interfaces:**
- Consumes: `DmEnviado` y `DmMensaje` de `@/lib/linea-dm-hilo` (Task 1); `claveHilo` (ya existía).
- Produces (lo consume la Task 3): la página le pasa a `<LineaDmInbox>` dos props — `mensajes: DmMensaje[]` y `dmsPorClave: Map<string, DmEnviado[]>`.

- [ ] **Step 1: Agregar la consulta y armar el Map**

En `page.tsx`, **después** del bloque que arma `dmConPedido` (termina en `pedido_restringido: Boolean(m.senal_id) && !s,` y su `});`), insertar:

```tsx
  // TODOS los DM que les mandamos a los colegas que están en pantalla —
  // incluidos los que nadie contestó (Juan, 2026-09-08). Sin esos no hay
  // denominador: el encabezado dice "3 DM enviados · 1 respondido" y ese 3
  // sale de acá. Es una pregunta DISTINTA de la consulta de arriba: aquella
  // responde "¿de qué pedido salió este mensaje?", esta "¿qué le mandamos a
  // este colega?".
  //
  // Va por mias() igual que todas: las señales del radar se persisten con el
  // advisor_id de la dueña de la línea, así que en la práctica esto lo ven
  // Juan (admin) y Natalia. Para las demás, el hilo se ve sin nuestro lado y
  // el panel lo dice — no se toca el aislamiento.
  const lidsHilo = [...new Set(dmMensajes.map((m) => m.remitente_lid).filter(Boolean))] as string[];
  const telsHilo = [...new Set(dmMensajes.map((m) => m.remitente_telefono).filter(Boolean))] as string[];
  const filtrosDestino: string[] = [];
  if (lidsHilo.length > 0) filtrosDestino.push(`respuesta_destino_lid.in.(${lidsHilo.join(",")})`);
  if (telsHilo.length > 0) filtrosDestino.push(`respuesta_destino_telefono.in.(${telsHilo.join(",")})`);

  type SeñalEnviada = {
    id: string;
    respondida_at: string | null;
    respuesta_texto: string | null;
    texto_original: string | null;
    respuesta_refs: string[] | null;
    respuesta_destino_lid: string | null;
    respuesta_destino_telefono: string | null;
  };
  // select("*") y no una lista de columnas: con una lista angosta el helper
  // genérico de mias() dispara TS2589 — mismo motivo que la consulta de
  // arriba. Ver test/crm-grupos-aislamiento.test.js.
  const enviadosRes =
    filtrosDestino.length > 0
      ? await fetchSafe<SeñalEnviada>(
          mias(supabase.from("group_signals").select("*")).or(filtrosDestino.join(",")).limit(500),
          "grupos:dm_enviados"
        )
      : null;

  // Los títulos de las propiedades que salieron en esos DM.
  const señalesEnviadas = enviadosRes?.data ?? [];
  const refsEnviadas = [...new Set(señalesEnviadas.map((s) => s.respuesta_refs?.[0]).filter(Boolean))] as string[];
  const propiedadEnviadaPorRef = new Map<string, { ref: string; titulo: string | null; link: string | null }>();
  if (refsEnviadas.length > 0) {
    const { data: props } = await supabase.from("properties").select("ref, titulo, link").in("ref", refsEnviadas);
    for (const p of props || []) {
      propiedadEnviadaPorRef.set(p.ref as string, {
        ref: p.ref as string,
        titulo: p.titulo as string | null,
        link: p.link as string | null,
      });
    }
  }

  // Indexado por la MISMA clave que usa claveHilo: el lid si lo hay, si no el
  // teléfono. Es lo que empareja un DM con el hilo del colega que lo recibió.
  const dmsPorClave = new Map<string, DmEnviado[]>();
  for (const s of señalesEnviadas) {
    const clave = s.respuesta_destino_lid || s.respuesta_destino_telefono;
    if (!clave) continue;
    const ref = s.respuesta_refs?.[0] ?? null;
    const entrada: DmEnviado = {
      senalId: s.id,
      enviadoAt: s.respondida_at,
      texto: s.respuesta_texto,
      pedidoOriginal: s.texto_original,
      propiedad: ref ? propiedadEnviadaPorRef.get(ref) ?? { ref, titulo: null, link: null } : null,
    };
    if (!dmsPorClave.has(clave)) dmsPorClave.set(clave, []);
    dmsPorClave.get(clave)!.push(entrada);
  }
```

Y el import al inicio del archivo, junto a los demás de `@/lib`:

```tsx
import type { DmEnviado } from "@/lib/linea-dm-hilo";
```

- [ ] **Step 2: Arreglar el error descartado de la consulta de señales**

Sigue abierto de la revisión anterior y este cambio lo empeoraría: hoy el `const { data: señales } = await mias(...)` descarta el error, así que si la consulta falla, **todos** los hilos muestran "no es visible con tu usuario" — un diagnóstico falso dicho con seguridad.

Reemplazar ese bloque:

```tsx
  const señalPorId = new Map<string, SeñalHilo>();
  const señalesRes =
    idsSeñalDm.length > 0
      ? await fetchSafe<SeñalHilo>(mias(supabase.from("group_signals").select("*")).in("id", idsSeñalDm), "grupos:senales_hilo")
      : null;
  for (const s of (señalesRes?.data ?? []) as SeñalHilo[]) señalPorId.set(s.id, s);
```

Y el cálculo de `pedido_restringido` pasa a exigir que la consulta haya funcionado — si falló, no se puede afirmar que sea un problema de permiso:

```tsx
      pedido_restringido: Boolean(m.senal_id) && !s && !señalesRes?.hasError,
```

- [ ] **Step 3: Pasarle los datos al componente**

Cambiar la llamada del render (~línea 584):

```tsx
            <LineaDmInbox mensajes={dmConPedido} dmsPorClave={dmsPorClave} embebido />
```

Y sumar el banner de error de la consulta nueva, junto al que ya está:

```tsx
              {dmRes.hasError && <ErrorBanner message={dmRes.message} />}
              {señalesRes?.hasError && <ErrorBanner message={señalesRes.message} />}
              {enviadosRes?.hasError && <ErrorBanner message={enviadosRes.message} />}
```

- [ ] **Step 4: Verificar**

Run (desde `crm/`): `npx tsc --noEmit`
Expected: errores esperados en `LineaDmInbox` porque todavía no acepta la prop `dmsPorClave` — eso lo resuelve la Task 3. Si aparece **TS2589** en alguna consulta a `group_signals`, es la lista de columnas: confirmar que se usó `select("*")`.

Run (raíz): `npm test`
Expected: 1739 pass, 0 fail. En particular `test/crm-grupos-aislamiento.test.js` en verde: exige que las **tres** consultas a `group_signals` de `page.tsx` estén envueltas en `mias(`.

- [ ] **Step 5: Commit**

```bash
git add "crm/app/(dashboard)/grupos/page.tsx"
git commit -m "feat(crm): la pagina trae los DM que le mandamos a cada colega, tambien los que nadie contesto

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: El panel por intercambios

**Files:**
- Modify: `crm/components/linea-dm-inbox.tsx`

**Interfaces:**
- Consumes: `armarHilos`, `DmMensaje`, `DmEnviado`, `HiloLinea`, `Intercambio`, `anclaHilo` de `@/lib/linea-dm-hilo` (Task 1); las props que pasa `page.tsx` (Task 2).
- Produces: re-exporta `type DmMensaje` para que el `import LineaDmInbox, { type DmMensaje } from "@/components/linea-dm-inbox"` de `page.tsx` siga funcionando sin tocarlo.

- [ ] **Step 1: Reemplazar la cabecera del componente**

Borrar de `linea-dm-inbox.tsx` el tipo `DmMensaje` completo, el tipo `Hilo` y la función `agruparPorRemitente` (se fueron al lib en la Task 1). La cabecera queda:

```tsx
"use client";

import { fechaHoraLarga } from "@/lib/fecha";
import {
  anclaHilo,
  armarHilos,
  type DmEnviado,
  type DmMensaje,
  type HiloLinea,
  type Intercambio,
} from "@/lib/linea-dm-hilo";

/** Re-exportado para que page.tsx siga importando el tipo desde acá. El tipo
 *  vive en @/lib/linea-dm-hilo, con la lógica que lo consume. */
export type { DmMensaje };

const AVANCE_LABEL: Record<string, { texto: string; clase: string }> = {
  cita_confirmada: { texto: "📅 Cita confirmada", clase: "bg-emerald-50 text-emerald-700" },
  agendando: { texto: "🗓️ Coordinando visita", clase: "bg-amber-50 text-amber-700" },
  interes_avanzado: { texto: "🔥 Posible venta", clase: "bg-rose-50 text-rose-700" },
};

/** Una celda de "todavía no": la columna existe desde la fase 1 para que el
 *  panel no cambie de forma cuando la fase que la llena se prenda. */
function Pendiente({ etiqueta, fase }: { etiqueta: string; fase: string }) {
  return (
    <span className="text-xs text-slate-400" title={`Se llena en la ${fase}`}>
      {etiqueta}: —
    </span>
  );
}

const SIN_DM_TEXTO: Record<string, string> = {
  nunca_le_escribimos: "Escribió por su cuenta — nunca le mandamos un DM.",
  sin_atribuir: "No se pudo ligar con ninguno de los DM que le mandamos.",
  restringido: "El pedido y el DM de esta señal no son visibles con tu usuario.",
};
```

- [ ] **Step 2: El bloque de un intercambio**

Agregar, antes del componente `Hilo`:

```tsx
/** UN intercambio: lo que le ofrecimos arriba, lo que contestó a ESE abajo.
 *  Cada DM es por una propiedad distinta, así que los bloques van separados —
 *  fusionarlos en una sola línea de tiempo los hacía parecer una conversación
 *  continua que no existe (Juan, 2026-09-08). */
function BloqueIntercambio({ intercambio, apagado = false }: { intercambio: Intercambio; apagado?: boolean }) {
  const { dm, sinDm, respuestas } = intercambio;
  const borde = apagado || !dm ? "border-dashed border-slate-200 bg-slate-50" : "border-slate-200";

  return (
    <div className={`overflow-hidden rounded-lg border ${borde}`}>
      {dm ? (
        <div
          className={`flex items-baseline justify-between gap-3 border-b px-3 py-2 ${
            apagado ? "border-slate-200" : "border-teal-200 bg-teal-50"
          }`}
        >
          <p className="min-w-0 text-sm font-medium text-slate-900">
            {dm.propiedad ? (
              <>
                Ref {dm.propiedad.ref}{" "}
                <span className="font-normal text-slate-600">
                  {dm.propiedad.link ? (
                    <a href={dm.propiedad.link} target="_blank" rel="noreferrer" className="underline">
                      {dm.propiedad.titulo || "ver ficha"}
                    </a>
                  ) : (
                    dm.propiedad.titulo || ""
                  )}
                </span>
              </>
            ) : (
              <span className="font-normal text-slate-500">DM sin propiedad registrada</span>
            )}
          </p>
          <span className="shrink-0 text-xs text-slate-400">
            {dm.enviadoAt ? `DM enviado ${fechaHoraLarga(dm.enviadoAt)}` : "sin fecha de envío"}
          </span>
        </div>
      ) : null}

      <div className="space-y-2 px-3 py-2">
        {sinDm ? <p className="text-xs text-slate-500">{SIN_DM_TEXTO[sinDm]}</p> : null}

        {dm ? (
          dm.texto ? (
            <details>
              <summary className="cursor-pointer text-xs font-medium text-teal-700">Ver el mensaje que le mandamos</summary>
              <pre className="mt-2 whitespace-pre-wrap border-l-2 border-teal-200 pl-3 font-sans text-xs text-slate-600">
                {dm.texto}
              </pre>
            </details>
          ) : (
            <p className="text-xs text-slate-400">El texto de este DM no quedó registrado.</p>
          )
        ) : null}

        {dm && respuestas.length === 0 ? <p className="text-xs italic text-slate-400">No contestó.</p> : null}

        {respuestas.length > 0 ? (
          <div className={`space-y-1 ${dm ? "border-t border-dashed border-slate-200 pt-2" : ""}`}>
            {respuestas.map((r) => (
              <div key={r.id} className="flex gap-3 text-sm">
                <span className="w-24 shrink-0 text-xs tabular-nums text-slate-400">{fechaHoraLarga(r.created_at)}</span>
                <p className="min-w-0 flex-1 text-slate-700">{r.texto || "(imagen o adjunto)"}</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Reescribir el componente `Hilo`**

Reemplazar la función `Hilo` completa:

```tsx
function Hilo({ hilo }: { hilo: HiloLinea }) {
  const badge = hilo.avanceMasReciente?.avance_tipo ? AVANCE_LABEL[hilo.avanceMasReciente.avance_tipo] : null;
  const quien = hilo.nombre || (hilo.identidad.telefono ? `+${hilo.identidad.telefono}` : null) || "Colega sin nombre";
  // El pedido que publicó en el grupo: del intercambio más reciente que lo
  // tenga. Es contexto del hilo, distinto de lo que le mandamos.
  const pedido = hilo.visibles.find((i) => i.dm?.pedidoOriginal)?.dm?.pedidoOriginal ?? null;

  return (
    <details id={anclaHilo(hilo.identidad, hilo.idRespaldo)} className="group scroll-mt-24 px-4 py-3 open:bg-slate-50">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">{quien}</p>
          <p className="text-xs text-slate-500">
            {hilo.dmEnviados > 0 ? (
              <>
                <span className="tabular-nums">{hilo.dmEnviados}</span> DM enviado{hilo.dmEnviados === 1 ? "" : "s"} ·{" "}
                <span className="tabular-nums">{hilo.dmRespondidos}</span> respondido
                {hilo.dmRespondidos === 1 ? "" : "s"}
              </>
            ) : (
              "Nunca le mandamos un DM — escribió por su cuenta"
            )}
          </p>
          <p className="truncate text-sm text-slate-500">{hilo.ultimoMensaje.texto || "(imagen o adjunto)"}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {badge ? (
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge.clase}`}>{badge.texto}</span>
          ) : (
            <Pendiente etiqueta="Cita" fase="fase 2 (clasificador)" />
          )}
          <span className="text-xs text-slate-400">{fechaHoraLarga(hilo.ultimaActividad)}</span>
        </div>
      </summary>

      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
        {pedido ? (
          <p className="rounded bg-slate-100 px-3 py-2 text-sm text-slate-600">
            <span className="font-medium">Pidió en el grupo: </span>
            {pedido}
          </p>
        ) : null}

        {hilo.visibles.map((i) => (
          <BloqueIntercambio key={i.clave} intercambio={i} />
        ))}

        {hilo.plegados.length > 0 ? (
          <details className="pt-1">
            <summary className="cursor-pointer text-xs font-medium text-slate-500">
              Ver {hilo.plegados.length} intercambio{hilo.plegados.length === 1 ? "" : "s"} anterior
              {hilo.plegados.length === 1 ? "" : "es"}, sin respuesta
            </summary>
            <div className="mt-2 space-y-2">
              {hilo.plegados.map((i) => (
                <BloqueIntercambio key={i.clave} intercambio={i} apagado />
              ))}
            </div>
          </details>
        ) : null}

        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-slate-500">
          <Pendiente etiqueta="Tiempo hasta responder" fase="fase 3 (tiempos)" />
        </div>
      </div>
    </details>
  );
}
```

- [ ] **Step 4: La prop nueva en el componente exportado**

Reemplazar la firma y el cuerpo de `LineaDmInbox`:

```tsx
export default function LineaDmInbox({
  mensajes,
  dmsPorClave,
  embebido = false,
}: {
  mensajes: DmMensaje[];
  /** Los DM que les mandamos, por la clave de `claveHilo`. Los arma page.tsx. */
  dmsPorClave: Map<string, DmEnviado[]>;
  /** Sin borde propio: vive dentro de una tarjeta que ya lo tiene. */
  embebido?: boolean;
}) {
  const hilos = armarHilos(mensajes, dmsPorClave);

  if (hilos.length === 0) {
    return (
      <div className={`p-6 text-center text-sm text-slate-500 ${embebido ? "" : "rounded-lg border border-dashed border-slate-300"}`}>
        <p>Todavía no llegó ningún mensaje directo a la línea vinculada.</p>
        <p className="mt-1 text-xs text-slate-400">
          Los mensajes se guardan desde el despliegue del 2026-09-08; antes de esa fecha no quedó registro.
        </p>
      </div>
    );
  }

  return (
    <div className={`divide-y divide-slate-100 bg-white ${embebido ? "" : "rounded-lg border border-slate-200"}`}>
      {hilos.map((h) => (
        <Hilo key={anclaHilo(h.identidad, h.idRespaldo)} hilo={h} />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Verificar**

Run (desde `crm/`): `npx tsc --noEmit`
Expected: sin salida, sin errores.

Run (desde `crm/`): `npm run build`
Expected: build completo, `/grupos` en la lista de rutas.

Run (raíz): `npm test`
Expected: 1739 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add crm/components/linea-dm-inbox.tsx
git commit -m "feat(crm): el hilo de la linea se muestra por intercambios, con el DM que mandamos arriba de cada uno

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Documentación y cierre

**Files:**
- Modify: `CLAUDE.md` (sección 2, el ítem de la línea de Natalia)

- [ ] **Step 1: Correr la suite completa una vez más**

Run (raíz): `npm test` → Expected: 1739 pass, 0 fail.
Run (desde `crm/`): `npx tsc --noEmit` y `npm run build` → Expected: los dos limpios.

- [ ] **Step 2: Actualizar el CLAUDE.md**

En el ítem de la sección 2 que empieza con "**La línea de Natalia empezó a recibir respuestas**", agregar al final:

```
  **El panel muestra la conversación (2026-09-08).** Cada bloque es un
  intercambio: el DM que le mandó Sofi arriba (con la propiedad y el texto
  completo plegado) y lo que el colega contestó a *ese* DM abajo — no una
  línea de tiempo fusionada, porque cada DM es por una propiedad distinta.
  El encabezado del hilo trae `N DM enviados · M respondidos`, que es el
  numerador y el denominador de la fase 4. Lo ven Juan y Natalia: la
  consulta de los DM pasa por `mias()` como todas, y las señales del radar
  se persisten con el `advisor_id` de la dueña de la línea. Para las demás
  asesoras el hilo se ve sin nuestro lado, y el panel dice que es por
  permiso, no que no exista. La lógica de armado vive en
  `crm/lib/linea-dm-hilo.ts#armarHilos` y **se prueba ejecutándola** desde
  `test/linea-dm-hilo.test.js` — Node 24 hace type-stripping nativo, así que
  un `.ts` de `crm/lib` se puede `require()` desde la suite de la raíz
  mientras no tenga tipos que emitan runtime (`enum`, `namespace`,
  decoradores). Es el primer módulo del CRM probado así.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(crm): el panel de la linea muestra la conversacion por intercambios

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Lo que decide Juan (no hacer)**

No hacer `git push` ni merge. El despliegue lo decide Juan: `git push origin main` publica bot y los dos Vercel a la vez. Verificación en producción: entrar a `/grupos` con su usuario y confirmar que un hilo real muestra el bloque con la ref, el DM plegado y las respuestas debajo.

---

## Self-review

**Cobertura de la spec:**
- §3.1 bloque por intercambio → Task 1 (`armarHilos`) + Task 3 (`BloqueIntercambio`).
- §3.2 qué se ve y qué se pliega (el más reciente siempre + los que tienen respuesta) → Task 1 Step 3, con dos tests dedicados.
- §3.3 conteo en el encabezado → Task 1 (`dmEnviados`/`dmRespondidos`) + Task 3 (`summary`).
- §3.4 lo ven Juan y Natalia, `mias()` intacto → Task 2 Step 1, y el test de aislamiento lo verifica.
- §3.5 texto del DM plegado → Task 3 Step 2 (`<details>`).
- §4.1 consulta nueva con los DM sin contestar → Task 2 Step 1.
- §4.2 armado en el lib con los tres casos sin DM → Task 1, tests 4, 5 y 6.
- §4.3 panel con el pedido y las columnas en gris → Task 3 Step 3.
- §5 degradación: error de la consulta de señales → Task 2 Step 2; `respuesta_refs` vacío y `respuesta_texto` nulo → Task 3 Step 2.
- §6 tests → Task 1; typecheck y build en cada task.
- §7 y §8 alcance futuro y fuera de alcance → ninguna task los toca.

**Placeholders:** ninguno; cada paso que cambia código lo muestra completo.

**Consistencia de nombres:** `DmMensaje`, `DmEnviado`, `MotivoSinDm`, `Intercambio`, `HiloLinea`, `armarHilos` se definen en Task 1 y se usan con esos mismos nombres en Tasks 2 y 3. `dmsPorClave` es el nombre de la variable en Task 2 y de la prop en Task 3. `claveHilo` indexa el `Map` en Task 2 y lo consume `armarHilos` en Task 1 — misma clave (`lid || telefono`), que es la condición para que el emparejamiento funcione.

**Un riesgo que el plan no puede cerrar solo:** el `.or()` de Task 2 interpola lids y teléfonos en un filtro de PostgREST. Los lids son `<dígitos>@lid` y los teléfonos dígitos —ninguno trae comas ni paréntesis, que es lo que rompería el filtro— y salen de `linea_dm`, que los escribió `identidadDM` desde el chatId de WAHA. Si alguna vez un remitente llegara con otra forma, el filtro se degrada a "no encuentra" (el hilo se ve sin nuestro lado), no a una consulta alterada. Vale que la revisión lo mire.
