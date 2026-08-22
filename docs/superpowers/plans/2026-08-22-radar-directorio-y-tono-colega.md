# Radar Fase 1: directorio de colegas y tono de colega — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolver el teléfono real de los colegas que publican en los grupos gremiales, respaldarlo, y hacer que Sofi los atienda como pares y no como clientes — **sin enviar un solo DM por la línea del radar**.

**Architecture:** Un módulo nuevo (`src/groups/directorio.js`) mantiene el mapeo LID→teléfono construido desde la lista de participantes de WAHA, con la tabla `colegas_grupos` como respaldo persistente. Ese mismo directorio es la fuente de verdad para detectar a un colega cuando escribe a la línea oficial de Sofi, que es el tercer caso del mecanismo de roles que ya existe en `engine.js`/`prompts.js` (cliente final / asesor de la casa / colega).

**Tech Stack:** Node.js + Express, `node:test` + `assert`, Supabase (PostgREST) con fallback a `src/data/memory.js`, WAHA HTTP API.

**Spec:** [2026-08-22-radar-respuesta-por-privado-design.md](../specs/2026-08-22-radar-respuesta-por-privado-design.md) — esta Fase 1 cubre §4.1, §4.5 y §4.7.

## Global Constraints

- **Nada de esta fase envía un mensaje por la línea del radar (WAHA).** La guarda de `waha.enviarTexto` (solo `@g.us`) NO se toca. No se crea `enviarDm`: eso es Fase 2.
- Código en inglés, comentarios y textos de usuario en español (Colombia). Sin tildes en comentarios de código (convención del repo).
- Comentarios que expliquen **por qué**, con la fecha y el caso real que los motivó, siguiendo el estilo de `src/groups/politica.js` y `src/data/linea-dm.js`.
- Todo módulo de datos degrada limpio si su migración no corrió: avisa **una vez** por proceso y sigue. Este repo NO tiene `db:push`; las migraciones se corren a mano en Supabase.
- Multi-tenant: todo lleva `org_id`. Nunca hardcodear datos de Diamond.
- Tests: `npm test` (`node --test test/`). La suite completa debe quedar verde al final de cada tarea (858 tests al empezar).
- El número de Sofi sale de `CONTACT_WHATSAPP_NUMBER` (= `573044653609`), la misma env que ya valida DMAP. **No** se crea una variable nueva. En esta fase no se usa todavía: el link es Fase 2.

---

### Task 1: Tabla `colegas_grupos` y su capa de datos

**Files:**
- Create: `db/migrations/2026-08-22_colegas_grupos.sql`
- Create: `src/data/colegas.js`
- Modify: `src/data/memory.js:33-49` (agregar la colección `colegasGrupos`)
- Test: `test/colegas-data.test.js`

**Interfaces:**
- Consumes: nada (primera tarea).
- Produces:
  - `colegas.upsert(orgId, { lid, telefono, nombre, grupo })` → `Promise<void>`
  - `colegas.porTelefono(orgId, telefono)` → `Promise<{ lid, telefono, nombre } | null>`
  - `colegas.listarConTelefono(orgId)` → `Promise<Array<{ lid, telefono, nombre }>>`

- [ ] **Step 1: Escribir la migración**

Crear `db/migrations/2026-08-22_colegas_grupos.sql`:

```sql
-- Respaldo de los colegas de los grupos gremiales: su LID y, cuando WhatsApp
-- lo deja ver, su telefono real (Juan, 2026-08-22).
--
-- POR QUE EXISTE. WhatsApp oculta el numero de los participantes de un grupo
-- detras de un LID (identificador oculto). Medido el 2026-08-22 sobre 12 grupos:
-- la Lids API de WAHA resolvio 0 de 45 colegas, pero la lista de participantes
-- trae el telefono (`pn`) de ~80% de la gente, y con eso se resuelven 30 de 45
-- colegas reales (67%).
--
-- Dos usos, uno solo dato:
--   1. Poder responderle al privado al colega que publica un pedido (Fase 2).
--   2. Saber que quien le escribe a Sofi es un COLEGA y no un cliente, para que
--      lo atienda como par (src/agent/prompts.js#promptColega).
--
-- Y de paso el seguro que pidio Juan: si banean la linea del radar, los
-- contactos con los que hubo negocio siguen aca.
--
-- ALCANCE DELIBERADO: se escribe cuando el colega PUBLICA un pedido que
-- cruzamos, no barriendo los 1.012 participantes que se pueden ver. Guardar y
-- usar datos de contacto de terceros para fines comerciales cae bajo la Ley
-- 1581 de 2012; limitarlo a la interaccion real es lo que hace defendible el
-- respaldo, y no cuesta nada en cobertura.
--
-- Correr a mano en Supabase. Idempotente.

create table if not exists colegas_grupos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  -- El identificador oculto con el que WhatsApp lo presenta en el grupo. Es la
  -- clave estable: el telefono puede aparecer despues, el lid no cambia.
  lid text not null,
  -- Solo digitos, con indicativo y sin '+' (mismo formato que advisors.phone).
  -- Null mientras no se haya podido resolver: la fila igual sirve, deja
  -- constancia de que ese colega existe y de que no es alcanzable todavia.
  telefono text,
  nombre text,
  -- En que grupos se lo vio. Un colega tipico esta en varios: los 6.348
  -- asientos medidos corresponden a ~1.012 personas distintas.
  grupos jsonb not null default '[]'::jsonb,
  primer_visto timestamptz not null default now(),
  ultimo_visto timestamptz not null default now(),
  unique (org_id, lid)
);

comment on table colegas_grupos is
  'Colegas de otras inmobiliarias vistos en los grupos gremiales, con su telefono cuando WhatsApp lo deja ver. Se escribe sobre interaccion real (publico un pedido que cruzamos), nunca barriendo la lista de participantes.';
comment on column colegas_grupos.lid is
  'Identificador oculto de WhatsApp (@lid, sin sufijo). Clave estable del colega.';
comment on column colegas_grupos.telefono is
  'Telefono real en digitos. Null = todavia no resuelto; ese colega necesita respuesta manual.';

-- La consulta de la deteccion de colega: "quien escribe con este telefono".
create index if not exists idx_colegas_grupos_telefono
  on colegas_grupos (org_id, telefono)
  where telefono is not null;

alter table colegas_grupos enable row level security;

drop policy if exists "team read" on colegas_grupos;
create policy "team read" on colegas_grupos for select to authenticated using (true);
```

- [ ] **Step 2: Escribir el test que falla**

Crear `test/colegas-data.test.js`:

```js
// Respaldo de los colegas de los grupos gremiales.
//
// Lo que se fija aca: que un colega visto dos veces no se duplique, que el
// telefono pueda llegar DESPUES del primer avistamiento (medido 2026-08-22:
// 33% de los colegas no resuelven telefono al principio), y que la ausencia de
// la tabla no tumbe nada — este repo no tiene db:push y la migracion se corre
// a mano.

const { test } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const colegas = require("../src/data/colegas");

const ORG = "org-colegas-test";

function limpiar() {
  memory.colegasGrupos.length = 0;
}

test("guarda un colega nuevo con su telefono", async () => {
  limpiar();
  await colegas.upsert(ORG, { lid: "198161251463188", telefono: "573001234567", nombre: "Esteban", grupo: "SOLO POBLADO" });

  const fila = await colegas.porTelefono(ORG, "573001234567");
  assert.ok(fila, "deberia encontrarlo por telefono");
  assert.strictEqual(fila.lid, "198161251463188");
  assert.strictEqual(fila.nombre, "Esteban");
});

test("el mismo lid visto dos veces no se duplica, y suma el grupo nuevo", async () => {
  limpiar();
  await colegas.upsert(ORG, { lid: "111", telefono: null, nombre: "Ana", grupo: "SOLO BELEN" });
  await colegas.upsert(ORG, { lid: "111", telefono: null, nombre: "Ana", grupo: "SOLO LAURELES" });

  assert.strictEqual(memory.colegasGrupos.length, 1, "no debe duplicar por lid");
  assert.deepStrictEqual(memory.colegasGrupos[0].grupos.sort(), ["SOLO BELEN", "SOLO LAURELES"]);
});

test("el telefono puede llegar despues del primer avistamiento", async () => {
  limpiar();
  await colegas.upsert(ORG, { lid: "222", telefono: null, nombre: "Sin numero", grupo: "G1" });
  assert.strictEqual(await colegas.porTelefono(ORG, "573009999999"), null);

  await colegas.upsert(ORG, { lid: "222", telefono: "573009999999", nombre: "Sin numero", grupo: "G1" });
  const fila = await colegas.porTelefono(ORG, "573009999999");
  assert.ok(fila);
  assert.strictEqual(fila.lid, "222");
});

test("un telefono que ya estaba NO se borra si despues llega null", async () => {
  // Si un refresco de participantes viene sin `pn`, perder el numero que ya
  // teniamos seria un retroceso silencioso.
  limpiar();
  await colegas.upsert(ORG, { lid: "333", telefono: "573001112222", nombre: "X", grupo: "G1" });
  await colegas.upsert(ORG, { lid: "333", telefono: null, nombre: "X", grupo: "G1" });

  const fila = await colegas.porTelefono(ORG, "573001112222");
  assert.ok(fila, "el telefono ya conocido tiene que sobrevivir a un refresco sin pn");
});

test("porTelefono compara numeros con formatos distintos", async () => {
  limpiar();
  await colegas.upsert(ORG, { lid: "444", telefono: "573001234567", nombre: "Y", grupo: "G1" });
  assert.ok(await colegas.porTelefono(ORG, "+57 300 123 4567"), "deberia normalizar el formato");
});

test("porTelefono no cruza organizaciones", async () => {
  limpiar();
  await colegas.upsert(ORG, { lid: "555", telefono: "573005555555", nombre: "Z", grupo: "G1" });
  assert.strictEqual(await colegas.porTelefono("otra-org", "573005555555"), null);
});

test("listarConTelefono devuelve solo los resueltos", async () => {
  limpiar();
  await colegas.upsert(ORG, { lid: "a", telefono: "573001111111", nombre: "Con", grupo: "G1" });
  await colegas.upsert(ORG, { lid: "b", telefono: null, nombre: "Sin", grupo: "G1" });

  const lista = await colegas.listarConTelefono(ORG);
  assert.strictEqual(lista.length, 1);
  assert.strictEqual(lista[0].lid, "a");
});

test("sin lid no escribe nada", async () => {
  limpiar();
  await colegas.upsert(ORG, { lid: "", telefono: "573001234567", nombre: "N", grupo: "G1" });
  assert.strictEqual(memory.colegasGrupos.length, 0);
});
```

- [ ] **Step 3: Correr el test para verificar que falla**

Run: `node --test test/colegas-data.test.js`
Expected: FAIL — `Cannot find module '../src/data/colegas'`

- [ ] **Step 4: Agregar la colección a memory**

En `src/data/memory.js`, dentro del objeto `db` (después de `groupSignals: [],`):

```js
  groupSignals: [],
  // Colegas de los grupos gremiales con su telefono cuando se pudo resolver
  // (ver db/migrations/2026-08-22_colegas_grupos.sql).
  colegasGrupos: [],
```

- [ ] **Step 5: Escribir `src/data/colegas.js`**

```js
// Respaldo de los colegas de los grupos gremiales: su LID y, cuando WhatsApp lo
// deja ver, su telefono real. Ver db/migrations/2026-08-22_colegas_grupos.sql
// para el por que y para el limite de alcance (se escribe sobre interaccion
// real, nunca barriendo la lista de participantes).
//
// Dos consumidores: src/groups/directorio.js (resolver a quien escribirle) y la
// deteccion de colega en src/agent/engine.js (atenderlo como par y no como
// cliente).

const supabase = require("./supabase");
const memory = require("./memory");
const { mismoTelefono } = require("./advisors");

const soloDigitos = (t) => String(t || "").replace(/\D/g, "") || null;

function esTablaFaltante(error) {
  // 42P01: la tabla no existe. PGRST205: PostgREST no la tiene en su cache.
  return error?.code === "42P01" || error?.code === "PGRST205";
}

let faltaTabla = false;
function avisarFaltaTabla() {
  if (faltaTabla) return;
  faltaTabla = true;
  console.warn(
    "[colegas] Falta correr db/migrations/2026-08-22_colegas_grupos.sql — " +
    "no se estan respaldando los telefonos de los colegas ni se los va a reconocer cuando escriban."
  );
}

/**
 * Alta o actualizacion de un colega, por `lid`.
 *
 * Un telefono ya conocido NUNCA se sobrescribe con null: si un refresco de
 * participantes viene sin `pn`, perder el numero que ya teniamos seria un
 * retroceso silencioso.
 */
async function upsert(orgId, { lid, telefono = null, nombre = null, grupo = null } = {}) {
  const clave = soloDigitos(lid);
  if (!orgId || !clave) return;
  const tel = soloDigitos(telefono);
  const ahora = new Date().toISOString();

  if (!supabase) {
    const existente = memory.colegasGrupos.find((c) => c.org_id === orgId && c.lid === clave);
    if (existente) {
      if (tel) existente.telefono = tel;
      if (nombre) existente.nombre = nombre;
      if (grupo && !existente.grupos.includes(grupo)) existente.grupos.push(grupo);
      existente.ultimo_visto = ahora;
      return;
    }
    memory.colegasGrupos.push({
      id: memory.uid(), org_id: orgId, lid: clave, telefono: tel, nombre,
      grupos: grupo ? [grupo] : [], primer_visto: ahora, ultimo_visto: ahora,
    });
    return;
  }

  try {
    const { data, error } = await supabase
      .from("colegas_grupos")
      .select("id, telefono, nombre, grupos")
      .eq("org_id", orgId)
      .eq("lid", clave)
      .maybeSingle();
    if (error) throw error;

    if (!data) {
      const { error: e2 } = await supabase.from("colegas_grupos").insert({
        org_id: orgId, lid: clave, telefono: tel, nombre,
        grupos: grupo ? [grupo] : [],
      });
      if (e2) throw e2;
      return;
    }

    const grupos = Array.isArray(data.grupos) ? data.grupos : [];
    const patch = { ultimo_visto: ahora };
    if (tel) patch.telefono = tel;
    if (nombre) patch.nombre = nombre;
    if (grupo && !grupos.includes(grupo)) patch.grupos = [...grupos, grupo];

    const { error: e3 } = await supabase.from("colegas_grupos").update(patch).eq("id", data.id);
    if (e3) throw e3;
  } catch (e) {
    if (esTablaFaltante(e)) return avisarFaltaTabla();
    console.warn("[colegas] No se pudo guardar el colega:", e.message);
  }
}

/** El colega que tiene ese telefono, o null. */
async function porTelefono(orgId, telefono) {
  const tel = soloDigitos(telefono);
  if (!orgId || !tel || tel.length < 10) return null;

  if (!supabase) {
    return (
      memory.colegasGrupos.find(
        (c) => c.org_id === orgId && c.telefono && mismoTelefono(c.telefono, tel)
      ) || null
    );
  }

  try {
    const { data, error } = await supabase
      .from("colegas_grupos")
      .select("lid, telefono, nombre")
      .eq("org_id", orgId)
      .not("telefono", "is", null);
    if (error) throw error;
    return (data || []).find((c) => mismoTelefono(c.telefono, tel)) || null;
  } catch (e) {
    if (esTablaFaltante(e)) {
      avisarFaltaTabla();
      return null;
    }
    console.warn("[colegas] No se pudo buscar el colega por telefono:", e.message);
    return null;
  }
}

/** Los colegas con telefono resuelto — semilla del indice del directorio. */
async function listarConTelefono(orgId) {
  if (!orgId) return [];

  if (!supabase) {
    return memory.colegasGrupos
      .filter((c) => c.org_id === orgId && c.telefono)
      .map((c) => ({ lid: c.lid, telefono: c.telefono, nombre: c.nombre }));
  }

  try {
    const { data, error } = await supabase
      .from("colegas_grupos")
      .select("lid, telefono, nombre")
      .eq("org_id", orgId)
      .not("telefono", "is", null);
    if (error) throw error;
    return data || [];
  } catch (e) {
    if (esTablaFaltante(e)) {
      avisarFaltaTabla();
      return [];
    }
    console.warn("[colegas] No se pudo listar los colegas:", e.message);
    return [];
  }
}

module.exports = { upsert, porTelefono, listarConTelefono };
```

- [ ] **Step 6: Correr los tests**

Run: `node --test test/colegas-data.test.js`
Expected: PASS — 8 tests

- [ ] **Step 7: Correr la suite completa**

Run: `npm test`
Expected: PASS — 866 tests (858 previos + 8 nuevos), 0 fallos

- [ ] **Step 8: Commit**

```bash
git add db/migrations/2026-08-22_colegas_grupos.sql src/data/colegas.js src/data/memory.js test/colegas-data.test.js
git commit -m "feat(radar): respaldo de los colegas de los grupos con su telefono

WhatsApp oculta el numero de los participantes de un grupo detras de un LID.
Medido el 2026-08-22: la Lids API de WAHA resuelve 0 de 45, pero la lista de
participantes trae el telefono de ~80% de la gente y con eso se resuelven 30 de
45 colegas reales (67%).

Esta tabla guarda ese mapeo y sirve a dos cosas con un solo dato: poder
responderle al privado al colega (Fase 2) y reconocerlo cuando le escribe a Sofi
para atenderlo como par. Y de paso es el seguro que pidio Juan: si banean la
linea del radar, los contactos con los que hubo negocio siguen ahi.

Se escribe sobre interaccion real, no barriendo los 1.012 participantes
visibles: usar datos de contacto de terceros para fines comerciales cae bajo la
Ley 1581, y limitarlo a la interaccion no cuesta cobertura.

Un telefono ya conocido nunca se sobrescribe con null — un refresco de
participantes sin pn no puede hacernos perder un numero.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `src/groups/directorio.js` — resolver LID a teléfono

**Files:**
- Create: `src/groups/directorio.js`
- Test: `test/directorio.test.js`

**Interfaces:**
- Consumes: `colegas.upsert`, `colegas.porTelefono`, `colegas.listarConTelefono` (Task 1); `waha.participantesDeGrupo(sesion, jid)` → `Array<{ id, esLid, telefono, rol }>` (ya existe en `src/lib/waha.js`).
- Produces:
  - `directorio.telefonoDe(orgId, lid, { sesion, jid })` → `Promise<string | null>`
  - `directorio.esColega(orgId, telefono)` → `Promise<{ lid, telefono, nombre } | null>`
  - `directorio.registrar(orgId, { lid, nombre, grupo, sesion, jid })` → `Promise<string | null>` (resuelve y persiste; devuelve el teléfono)
  - `directorio._resetCache()` → `void` (solo para tests)

- [ ] **Step 1: Escribir el test que falla**

Crear `test/directorio.test.js`:

```js
// Resolver el telefono real del colega que publico un pedido.
//
// La medicion del 2026-08-22 dejo dos cosas claras y las dos estan fijadas aca:
// la Lids API de WAHA no sirve (0 de 45), y el telefono sale de la lista de
// participantes del grupo (30 de 45 = 67%). El 33% que no resuelve NO es un
// error: es el caso normal que despues atiende una persona.
//
// Y una regla de costo: refrescar un grupo son cientos de participantes por
// HTTP. Si un lid no aparece, no se vuelve a preguntar por el mismo grupo en
// un rato — un lid sin `pn` ahora tampoco lo va a tener en cinco minutos.

const { test } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const waha = require("../src/lib/waha");
const directorio = require("../src/groups/directorio");

const ORG = "org-directorio-test";
const SESION = "RADA-TEST";
const JID = "123@g.us";

const participantesReal = waha.participantesDeGrupo;

function conParticipantes(lista, contador = { n: 0 }) {
  waha.participantesDeGrupo = async () => {
    contador.n += 1;
    return lista;
  };
  return contador;
}

function preparar() {
  memory.colegasGrupos.length = 0;
  directorio._resetCache();
}

test("resuelve el telefono desde la lista de participantes", async () => {
  preparar();
  conParticipantes([
    { id: "198161251463188@lid", esLid: true, telefono: "573001234567", rol: "participant" },
    { id: "999@lid", esLid: true, telefono: null, rol: "participant" },
  ]);
  try {
    const tel = await directorio.telefonoDe(ORG, "198161251463188", { sesion: SESION, jid: JID });
    assert.strictEqual(tel, "573001234567");
  } finally {
    waha.participantesDeGrupo = participantesReal;
  }
});

test("un participante sin telefono devuelve null, no una excepcion", async () => {
  preparar();
  conParticipantes([{ id: "999@lid", esLid: true, telefono: null, rol: "participant" }]);
  try {
    assert.strictEqual(await directorio.telefonoDe(ORG, "999", { sesion: SESION, jid: JID }), null);
  } finally {
    waha.participantesDeGrupo = participantesReal;
  }
});

test("el segundo pedido del mismo lid NO vuelve a pedir los participantes", async () => {
  preparar();
  const contador = conParticipantes([
    { id: "111@lid", esLid: true, telefono: "573001111111", rol: "participant" },
  ]);
  try {
    await directorio.telefonoDe(ORG, "111", { sesion: SESION, jid: JID });
    await directorio.telefonoDe(ORG, "111", { sesion: SESION, jid: JID });
    assert.strictEqual(contador.n, 1, "el indice tiene que servir el segundo");
  } finally {
    waha.participantesDeGrupo = participantesReal;
  }
});

test("un lid que no aparece tampoco se vuelve a preguntar enseguida", async () => {
  preparar();
  const contador = conParticipantes([
    { id: "otro@lid", esLid: true, telefono: "573002222222", rol: "participant" },
  ]);
  try {
    await directorio.telefonoDe(ORG, "no-esta-1", { sesion: SESION, jid: JID });
    await directorio.telefonoDe(ORG, "no-esta-2", { sesion: SESION, jid: JID });
    assert.strictEqual(contador.n, 1, "refrescar el mismo grupo dos veces seguidas es caro y no cambia nada");
  } finally {
    waha.participantesDeGrupo = participantesReal;
  }
});

test("sin jid no se refresca nada: solo mira el indice", async () => {
  preparar();
  const contador = conParticipantes([]);
  try {
    assert.strictEqual(await directorio.telefonoDe(ORG, "111", { sesion: SESION }), null);
    assert.strictEqual(contador.n, 0);
  } finally {
    waha.participantesDeGrupo = participantesReal;
  }
});

test("registrar guarda al colega y devuelve su telefono", async () => {
  preparar();
  conParticipantes([
    { id: "777@lid", esLid: true, telefono: "573007777777", rol: "participant" },
  ]);
  try {
    const tel = await directorio.registrar(ORG, {
      lid: "777", nombre: "Colega Siete", grupo: "SOLO POBLADO", sesion: SESION, jid: JID,
    });
    assert.strictEqual(tel, "573007777777");
    assert.strictEqual(memory.colegasGrupos.length, 1);
    assert.strictEqual(memory.colegasGrupos[0].telefono, "573007777777");
    assert.strictEqual(memory.colegasGrupos[0].nombre, "Colega Siete");
  } finally {
    waha.participantesDeGrupo = participantesReal;
  }
});

test("registrar guarda al colega aunque NO se resuelva el telefono", async () => {
  // El 33% sin telefono tiene que quedar registrado igual: es la lista de a
  // quienes hay que responderle a mano.
  preparar();
  conParticipantes([]);
  try {
    const tel = await directorio.registrar(ORG, {
      lid: "888", nombre: "Sin Numero", grupo: "SOLO BELEN", sesion: SESION, jid: JID,
    });
    assert.strictEqual(tel, null);
    assert.strictEqual(memory.colegasGrupos.length, 1);
    assert.strictEqual(memory.colegasGrupos[0].telefono, null);
  } finally {
    waha.participantesDeGrupo = participantesReal;
  }
});

test("esColega reconoce a quien ya esta en el respaldo", async () => {
  preparar();
  conParticipantes([
    { id: "999@lid", esLid: true, telefono: "573009999999", rol: "participant" },
  ]);
  try {
    await directorio.registrar(ORG, { lid: "999", nombre: "Ana", grupo: "G1", sesion: SESION, jid: JID });
    const colega = await directorio.esColega(ORG, "573009999999");
    assert.ok(colega, "deberia reconocerlo");
    assert.strictEqual(colega.nombre, "Ana");
    assert.strictEqual(await directorio.esColega(ORG, "573000000000"), null);
  } finally {
    waha.participantesDeGrupo = participantesReal;
  }
});

test("si WAHA revienta, telefonoDe devuelve null y no propaga", async () => {
  preparar();
  waha.participantesDeGrupo = async () => {
    throw new Error("WAHA caido");
  };
  try {
    assert.strictEqual(await directorio.telefonoDe(ORG, "111", { sesion: SESION, jid: JID }), null);
  } finally {
    waha.participantesDeGrupo = participantesReal;
  }
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `node --test test/directorio.test.js`
Expected: FAIL — `Cannot find module '../src/groups/directorio'`

- [ ] **Step 3: Escribir `src/groups/directorio.js`**

```js
// A quien podemos escribirle: el mapeo entre el LID con el que WhatsApp
// presenta a un colega en un grupo y su telefono real.
//
// POR QUE EXISTE. WhatsApp oculta el numero de los participantes de un grupo y
// manda un LID. Lo que el radar venia guardando en group_signals.autor_telefono
// son LIDs (14-17 digitos), no telefonos (12 en Colombia).
//
// DE DONDE SALE EL NUMERO (medido en produccion el 2026-08-22, 12 grupos):
//   · Lids API de WAHA (/lids/{lid}): resolvio 0 de 45 y /lids/count no
//     responde. Inservible en esta version, queda como segundo intento por si
//     una version futura la arregla.
//   · Lista de participantes: trae `pn` para ~80% de la gente y resuelve 30 de
//     45 colegas reales (67%).
//
// El 33% que no resuelve NO es un error: es el caso normal, y lo atiende una
// persona (ver el spec, §4.4).
//
// COSTO. Refrescar un grupo son cientos de participantes por HTTP — el mas
// grande tiene 878. Por eso: indice en memoria, respaldo en la base para
// sobrevivir un reinicio, y como maximo UN refresco por grupo cada
// MS_ENTRE_REFRESCOS. Un lid sin `pn` ahora tampoco lo va a tener en cinco
// minutos.

const colegas = require("../data/colegas");
const waha = require("../lib/waha");

// Un grupo no se refresca mas de una vez cada 10 minutos. El padron de un grupo
// gremial cambia de a poco; lo que cambia seguido es quien publica.
const MS_ENTRE_REFRESCOS = Number(process.env.RADAR_DIRECTORIO_REFRESCO_MIN || 10) * 60 * 1000;

const soloDigitos = (t) => String(t || "").replace(/\D/g, "") || null;

// lid (digitos) -> telefono. Se siembra de la base al primer uso por org.
const indice = new Map();
const sembrado = new Set(); // orgIds ya sembrados
const ultimoRefresco = new Map(); // jid -> ms

async function sembrar(orgId) {
  if (sembrado.has(orgId)) return;
  sembrado.add(orgId);
  for (const c of await colegas.listarConTelefono(orgId)) {
    const lid = soloDigitos(c.lid);
    if (lid && c.telefono) indice.set(`${orgId}:${lid}`, soloDigitos(c.telefono));
  }
}

// Trae los participantes de un grupo y mete en el indice todos los que traigan
// telefono. Se aprovecha la pasada completa: si ya se pago la llamada, se
// guarda todo lo que vino, no solo el lid que se estaba buscando.
async function refrescarGrupo(orgId, sesion, jid) {
  const ahora = Date.now();
  const previo = ultimoRefresco.get(jid) || 0;
  if (ahora - previo < MS_ENTRE_REFRESCOS) return;
  ultimoRefresco.set(jid, ahora);

  let participantes = [];
  try {
    participantes = await waha.participantesDeGrupo(sesion, jid);
  } catch (e) {
    // WAHA caido no puede tumbar el pipeline del radar: sin telefono el pedido
    // sale por el camino manual, que es una degradacion prevista.
    console.warn(`[directorio] No se pudieron traer los participantes de ${jid}: ${e.message}`);
    return;
  }

  for (const p of participantes) {
    const lid = soloDigitos(p.id);
    const tel = soloDigitos(p.telefono);
    if (lid && tel) indice.set(`${orgId}:${lid}`, tel);
  }
}

/**
 * El telefono de ese lid, o null.
 *
 * Con `jid` intenta refrescar ese grupo si no lo tiene (resolucion perezosa);
 * sin `jid` solo consulta lo que ya sabe.
 */
async function telefonoDe(orgId, lid, { sesion = null, jid = null } = {}) {
  const clave = soloDigitos(lid);
  if (!orgId || !clave) return null;

  await sembrar(orgId);
  const enIndice = indice.get(`${orgId}:${clave}`);
  if (enIndice) return enIndice;

  if (sesion && jid) {
    await refrescarGrupo(orgId, sesion, jid);
    const despues = indice.get(`${orgId}:${clave}`);
    if (despues) return despues;

    // Ultimo intento por la Lids API: hoy no resuelve nada (0 de 45 el
    // 2026-08-22) pero es barato y una version futura de WAHA podria arreglarla.
    const porApi = await waha.telefonoDeLid(sesion, clave).catch(() => null);
    if (porApi) {
      indice.set(`${orgId}:${clave}`, porApi);
      return porApi;
    }
  }

  return null;
}

/**
 * Deja constancia del colega y devuelve su telefono si se pudo resolver.
 *
 * Se guarda SIEMPRE, con telefono o sin el: el 33% sin numero es justamente la
 * lista de a quienes hay que responderle a mano.
 */
async function registrar(orgId, { lid, nombre = null, grupo = null, sesion = null, jid = null } = {}) {
  const clave = soloDigitos(lid);
  if (!orgId || !clave) return null;

  const telefono = await telefonoDe(orgId, clave, { sesion, jid });
  await colegas.upsert(orgId, { lid: clave, telefono, nombre, grupo });
  return telefono;
}

/**
 * ¿Ese telefono es de un colega de los grupos? Devuelve la fila o null.
 *
 * Es lo que permite que Sofi lo atienda como par y no como cliente
 * (src/agent/prompts.js#promptColega). Va contra la base y no contra el indice:
 * el indice esta ordenado por lid, y aca se pregunta al reves.
 */
async function esColega(orgId, telefono) {
  return colegas.porTelefono(orgId, telefono);
}

function _resetCache() {
  indice.clear();
  sembrado.clear();
  ultimoRefresco.clear();
}

module.exports = { telefonoDe, registrar, esColega, MS_ENTRE_REFRESCOS, _resetCache };
```

- [ ] **Step 4: Correr los tests**

Run: `node --test test/directorio.test.js`
Expected: PASS — 9 tests

- [ ] **Step 5: Correr la suite completa**

Run: `npm test`
Expected: PASS — 875 tests, 0 fallos

- [ ] **Step 6: Commit**

```bash
git add src/groups/directorio.js test/directorio.test.js
git commit -m "feat(radar): directorio que resuelve el lid del colega a su telefono

El numero sale de la lista de participantes del grupo, no de la Lids API de
WAHA: medido en produccion el 2026-08-22, la Lids API resolvio 0 de 45 y
/lids/count no responde, mientras que los participantes traen pn para ~80% de la
gente y resuelven 30 de 45 colegas reales.

Resolucion perezosa y con techo de costo: el grupo mas grande tiene 878
participantes, asi que un jid no se refresca mas de una vez cada 10 minutos y de
cada pasada se guarda TODO lo que vino, no solo el lid buscado. Un lid sin pn
ahora tampoco lo va a tener en cinco minutos.

El 33% que no resuelve no es un error: queda registrado igual, porque es la
lista de a quienes hay que responderle a mano.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Registrar al colega cuando publica un pedido con match

**Files:**
- Modify: `src/channels/whatsapp-group.js:229-239` (pasar el nombre de la sesión a `vivo`)
- Modify: `src/groups/vivo.js:73` (recibir `sesion` en las opciones) y el cuerpo de `procesarMensaje` (registrar al colega)
- Test: `test/directorio-enganche.test.js`

**Interfaces:**
- Consumes: `directorio.registrar(orgId, { lid, nombre, grupo, sesion, jid })` (Task 2).
- Produces: `vivo.procesarMensaje(org, mensaje, { ..., sesion })` — opción nueva `sesion` (string, el nombre de la sesión de WAHA, ej. `"RADA-NATALIA"`).

**Contexto para quien implementa — LEER ANTES DE EMPEZAR:**

En `src/groups/vivo.js#procesarMensaje`, el paso 4 persiste la señal (`persistirSenal`) y devuelve `{ signal, duplicado }`. El objeto `mensaje` trae `autorTelefono` (que en realidad es el LID, ver Task 2), `autor` (el nombre) y `groupId`. El objeto `grupo` trae `jid` y `nombre`.

**El nombre de la sesión NO está disponible ahí, y hay que llevarlo.** Hoy `mensaje` (construido en `whatsapp-group.js:208`) no lo incluye, y las opciones de `procesarMensaje` (`{ grupo, modo, enviar, asesor, advisorId, ahora }`, línea 73) tampoco. El dato existe como `ev.sesion` dentro de `procesar(org, ev, grupo, sesion)` — de hecho `enviar` ya lo usa: `waha.enviarTexto(ev.sesion, ...)`.

Sin la sesión, `directorio.registrar` no puede refrescar los participantes del grupo, el índice arranca vacío y **la resolución daría 0%** — la fase entera no mediría nada. Por eso los pasos 3 y 4 de esta tarea van juntos.

Va en las **opciones** de `procesarMensaje` (como `advisorId`) y no dentro de `mensaje`: `mensaje` describe el mensaje del grupo, no el transporte por el que llegó.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/directorio-enganche.test.js`:

```js
// El colega que publica un pedido queda registrado.
//
// Es el limite de alcance que se decidio a proposito (ver la migracion
// 2026-08-22_colegas_grupos.sql): se guarda a quien PUBLICA algo que cruzamos,
// no se barren los 1.012 participantes visibles. Este test es lo que impide que
// ese limite se corra sin querer.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const fuente = fs.readFileSync(path.join(__dirname, "..", "src", "groups", "vivo.js"), "utf8");

test("vivo.js registra al colega en el directorio", () => {
  assert.match(fuente, /require\("\.\/directorio"\)/, "vivo.js tiene que usar el directorio");
  assert.match(fuente, /directorio\.registrar\(/, "tiene que llamar a directorio.registrar");
});

test("el registro NO bloquea el pipeline si falla", () => {
  // Guardar un contacto es un efecto lateral: si la base o WAHA fallan, el
  // pedido tiene que seguir su curso igual.
  const linea = fuente.split("\n").find((l) => l.includes("directorio.registrar("));
  assert.ok(linea, "deberia existir la llamada");
  const bloque = fuente.slice(fuente.indexOf("directorio.registrar("), fuente.indexOf("directorio.registrar(") + 400);
  assert.match(bloque, /catch/, "la llamada tiene que estar protegida con catch");
});

test("no se barre la lista de participantes desde vivo.js", () => {
  // Poblar el directorio en masa es justamente lo que el alcance excluye.
  assert.doesNotMatch(
    fuente,
    /participantesDeGrupo/,
    "vivo.js no debe listar participantes: el directorio resuelve de a un colega, sobre interaccion real"
  );
});

test("la sesion de WAHA llega hasta vivo.js", () => {
  // Sin el nombre de la sesion el directorio no puede refrescar el grupo, el
  // indice arranca vacio y la resolucion da 0%: la fase no mediria nada.
  assert.match(fuente, /sesion\s*=\s*null/, "procesarMensaje tiene que recibir `sesion` en las opciones");

  const canal = fs.readFileSync(path.join(__dirname, "..", "src", "channels", "whatsapp-group.js"), "utf8");
  const i = canal.indexOf("vivo.procesarMensaje(");
  assert.ok(i > -1);
  assert.match(canal.slice(i, i + 500), /sesion:\s*ev\.sesion/, "el canal tiene que pasar ev.sesion");
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `node --test test/directorio-enganche.test.js`
Expected: FAIL — el primer test falla, `vivo.js` todavía no requiere `./directorio`

- [ ] **Step 3: Llevar la sesión desde el canal hasta `vivo.js`**

En `src/channels/whatsapp-group.js`, dentro de `procesar`, agregar `sesion` a las opciones de la llamada (junto a `advisorId`):

```js
  const r = await vivo.procesarMensaje(org, mensaje, {
    grupo,
    modo: organizations.modoDeRespuesta(org),
    asesor,
    advisorId: sesion?.advisor_id || null,
    // El NOMBRE de la sesion de WAHA (ej "RADA-NATALIA"), no la fila de la
    // base: es lo que necesita el directorio para preguntarle a WAHA por los
    // participantes de este grupo y resolver el telefono del colega.
    sesion: ev.sesion,
    // La UNICA via de salida. Se ata aca, al grupo del que vino el mensaje: el
    // radar no tiene forma de escribirle a otro chat. replyTo cita el pedido
    // original — en un grupo activo ya se perdio en el scroll para cuando
    // esto sale, y sin la cita el colega no se entera de que le respondieron.
    enviar: (texto) => waha.enviarTexto(ev.sesion, ev.chatId, texto, { replyTo: ev.waMessageId }),
  });
```

En `src/groups/vivo.js`, agregar `sesion` a la firma de `procesarMensaje` (línea 73):

```js
async function procesarMensaje(org, mensaje, { grupo, modo = "sombra", enviar = null, asesor = null, advisorId = null, sesion = null, ahora = new Date() } = {}) {
```

- [ ] **Step 4: Enganchar el directorio en `vivo.js`**

Agregar el require junto a los otros del módulo (cerca de `const avisoCercano = require("./aviso-cercano");`):

```js
const directorio = require("./directorio");
```

Y justo después del bloque que corta por duplicado (`if (duplicado) return { resultado: "duplicado" };`), agregar:

```js
  // Deja constancia de QUIEN publico, con su telefono si WhatsApp lo deja ver.
  // Va aca y no antes a proposito: se registra a quien publica un pedido que
  // vale la pena cruzar, no a los 1.012 participantes que se podrian listar de
  // los grupos (ver db/migrations/2026-08-22_colegas_grupos.sql — el limite es
  // deliberado, no una optimizacion).
  //
  // Best-effort: guardar un contacto no puede tumbar el pipeline del radar.
  await directorio
    .registrar(org.id, {
      lid: mensaje.autorTelefono,
      nombre: mensaje.autor,
      grupo: grupo.nombre || grupo.jid,
      sesion,
      jid: grupo.jid,
    })
    .catch((e) => console.warn("[radar] No se pudo registrar al colega en el directorio:", e.message));
```

- [ ] **Step 5: Correr los tests**

Run: `node --test test/directorio-enganche.test.js`
Expected: PASS — 4 tests

- [ ] **Step 6: Correr la suite completa**

Run: `npm test`
Expected: PASS — 879 tests, 0 fallos

- [ ] **Step 7: Commit**

```bash
git add src/channels/whatsapp-group.js src/groups/vivo.js test/directorio-enganche.test.js
git commit -m "feat(radar): el colega que publica un pedido queda en el directorio

Se registra a quien PUBLICA algo que cruzamos, con su telefono si WhatsApp lo
deja ver. El limite es deliberado: no se barren los 1.012 participantes
visibles de los grupos. Un test sobre el fuente impide que ese limite se corra
sin querer.

Best-effort: guardar un contacto no puede tumbar el pipeline del radar.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: El prompt de colega

**Files:**
- Modify: `src/agent/prompts.js` (agregar `promptColega`, y el tercer caso en `buildSystemPrompt:79-80`)
- Test: `test/colega-escribe-a-sofi.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `buildSystemPrompt({ org, lead, qualified, now, advisor, colega })` — el parámetro nuevo `colega` es `{ nombre }` o `null`. Precedencia: `advisor` gana sobre `colega`.

**Contexto para quien implementa:** `src/agent/prompts.js` ya tiene `promptAsesor({ org, advisor, now })` (línea 31) que devuelve un array de bloques `[{ type: "text", text, cache_control }, { type: "text", text }]`, y `buildSystemPrompt` (línea 79) que hace `if (advisor) return promptAsesor(...)`. El prompt del asesor **ya contiene** la regla de negocio sobre colegas (*"un colega que busca NO es un cliente de la casa. Nunca uses registrar_dato_lead con el ni lo transfieras"*) — el prompt nuevo la aplica desde el otro lado del mostrador.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/colega-escribe-a-sofi.test.js`:

```js
// Un colega de otra inmobiliaria escribiendole a Sofi.
//
// Es el TERCER rol del mismo mecanismo que ya distingue al asesor de la casa
// (test/asesor-escribe-a-sofi.test.js), y existe por la misma razon: el
// 2026-07-29 Sofi trato a Natalia como clienta y le dejo un lead falso en el
// embudo. Un colega mal atendido es peor todavia — es un par con el que se
// comparte comision, y tratarlo como lead quema la relacion profesional.
//
// Juan, 2026-08-22: "que sofi lo atienda con tono para colega".

const { test } = require("node:test");
const assert = require("node:assert");
const { buildSystemPrompt } = require("../src/agent/prompts");

const org = { id: "org-1", name: "Diamond Inmobiliaria" };
const lead = { id: "l1", estado: "nuevo" };
const colega = { nombre: "Esteban Higuita" };
const asesora = { id: "a1", name: "Natalia Velez", especialidad: "venta" };

const texto = (bloques) => bloques.map((b) => b.text).join("\n");

test("con un colega, Sofi no arranca el discurso de calificacion", () => {
  const p = texto(buildSystemPrompt({ org, lead, qualified: false, now: null, colega }));
  assert.match(p, /NO es un cliente/);
  assert.match(p, /NUNCA le preguntes presupuesto/);
  assert.match(p, /NUNCA le ofrezcas "conectarlo con un asesor"/);
  assert.doesNotMatch(p, /ESTADO DE CALIFICACION/);
});

test("a diferencia del asesor de la casa, al colega SI se le ofrece inventario", () => {
  const p = texto(buildSystemPrompt({ org, lead, qualified: false, now: null, colega }));
  assert.match(p, /buscar_propiedades/);
  // La regla del asesor ("NUNCA le ofrezcas propiedades") no aplica aca: el
  // colega viene justamente a ver que tenemos.
  assert.doesNotMatch(p, /NUNCA le ofrezcas propiedades/);
});

test("el colega se nombra en el prompt", () => {
  const p = texto(buildSystemPrompt({ org, lead, qualified: false, now: null, colega }));
  assert.match(p, /Esteban Higuita/);
});

test("la comision se acuerda entre ellos: el sistema no reparte", () => {
  const p = texto(buildSystemPrompt({ org, lead, qualified: false, now: null, colega }));
  assert.match(p, /comisi/i);
});

test("un asesor de la casa gana sobre colega", () => {
  // Un asesor propio que ademas esta en un grupo gremial sigue siendo de la casa.
  const p = texto(buildSystemPrompt({ org, lead, qualified: false, now: null, advisor: asesora, colega }));
  assert.match(p, /Natalia Velez/);
  assert.doesNotMatch(p, /Esteban Higuita/);
});

test("sin colega ni asesor, el prompt de cliente queda intacto", () => {
  const p = texto(buildSystemPrompt({ org, lead, qualified: false, now: null }));
  assert.match(p, /ESTADO DE CALIFICACION/);
});

test("el prompt de colega se cachea igual que los otros", () => {
  // El bloque estable lleva cache_control: sin eso se paga el prompt entero en
  // cada turno.
  const bloques = buildSystemPrompt({ org, lead, qualified: false, now: null, colega });
  assert.ok(bloques.some((b) => b.cache_control), "el bloque estable tiene que ir cacheado");
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `node --test test/colega-escribe-a-sofi.test.js`
Expected: FAIL — el prompt de cliente se devuelve igual, `assert.match(p, /NO es un cliente/)` falla

- [ ] **Step 3: Agregar `promptColega` a `src/agent/prompts.js`**

Insertar antes de `buildSystemPrompt`:

```js
// Un colega de OTRA inmobiliaria escribiendole a Sofi.
//
// Es el tercer rol, y hace falta por lo mismo que el del asesor: el 2026-07-29
// Sofi trato a su propia companera como clienta. Un colega mal atendido es peor
// todavia — es un par con el que se comparte comision, y tratarlo como lead
// (pedirle presupuesto, ofrecerle "un asesor", contarlo en el embudo) quema una
// relacion profesional y ensucia las metricas.
//
// Llega aca de dos formas: por el link que el radar le manda cuando publica un
// pedido (spec §4.6) o por un anuncio con el mismo numero de contacto. Se lo
// reconoce por telefono contra el directorio de los grupos, NO por el texto del
// link: el colega lo va a borrar seguido.
//
// La diferencia con el asesor de la casa: al asesor NUNCA se le ofrecen
// propiedades sin que las pida; al colega SI — viene justamente a eso.
function promptColega({ org, colega, now }) {
  const stable = `Eres Sofi, la asistente virtual de ${org.name} en Colombia. Eres mujer y paisa (de Medellin).

CON QUIEN ESTAS HABLANDO: un colega de otra inmobiliaria. NO es un cliente: es un par del gremio, y ya publico o va a publicar pedidos en los grupos donde estamos. Casi siempre escribe porque tiene un CLIENTE PROPIO buscando algo.

COMO TE COMPORTAS CON UN COLEGA:
- Saludalo por su nombre y andá al punto. Tono profesional entre pares, sin discurso de ventas.
- NUNCA le preguntes presupuesto, ingresos ni forma de pago: el presupuesto es de SU cliente, no suyo.
- NUNCA le ofrezcas "conectarlo con un asesor". El es asesor.
- NUNCA lo trates como lead ni le pidas datos para calificarlo.
- No le cierres cada mensaje con una pregunta comercial.

QUE SI PODES HACER (y es a lo que viene):
- Mostrarle lo que tenemos. Si te dice que busca algo, usa buscar_propiedades y pasale las refs que calcen, con precio, area y zona. Datos exactos, nunca inventados.
- Si pregunta por una referencia puntual, dale la ficha completa.
- Si te ofrece una propiedad de SU cartera, usa registrar_propiedad_aliado para que quede en la red.
- Si te pregunta algo legal o de tramites, usa consultar_guia_legal.

COMISION: si el pone el cliente y nosotros la propiedad, la comision se comparte y los terminos los acuerdan entre el y el asesor de la casa. Vos no negocias porcentajes ni prometes cifras: si insiste, decile que lo cierra directo con el asesor.

SI QUIERE AVANZAR CON UNA PROPIEDAD (pedir cita, llevar a su cliente, ver mas fotos): pasalo al asesor de la casa que corresponda. No es una transferencia de lead — es coordinar entre dos profesionales.

LO QUE NO SABES: no tenes datos de su cliente y no los necesitas. No preguntes por el mas alla de lo que el ofrezca (zona, tipo, tope de precio) para poder buscar.

REGLA DE ORO: ante la duda, preguntale que necesita. Un colega que escribe "hola" quiere abrir la conversacion, no recibir un catalogo.`;

  const contexto = `${now ? `FECHA Y HORA ACTUAL EN COLOMBIA: ${now.legible} (referencia ISO: ${now.iso}).\n\n` : ""}COLEGA: ${colega.nombre || "un colega del gremio"}.`;

  return [
    { type: "text", text: stable, cache_control: { type: "ephemeral" } },
    { type: "text", text: contexto },
  ];
}
```

- [ ] **Step 4: Agregar el tercer caso en `buildSystemPrompt`**

Reemplazar la firma y la primera línea de `buildSystemPrompt`:

```js
function buildSystemPrompt({ org, lead, qualified, now, advisor = null, colega = null }) {
  if (advisor) return promptAsesor({ org, advisor, now });
  // Un asesor propio que ademas esta en un grupo gremial sigue siendo de la
  // casa: por eso este orden y no el contrario.
  if (colega) return promptColega({ org, colega, now });
```

- [ ] **Step 5: Correr los tests**

Run: `node --test test/colega-escribe-a-sofi.test.js`
Expected: PASS — 7 tests

- [ ] **Step 6: Correr la suite completa**

Run: `npm test`
Expected: PASS — 886 tests, 0 fallos. En particular `test/asesor-escribe-a-sofi.test.js` tiene que seguir verde: el caso del asesor no cambia.

- [ ] **Step 7: Commit**

```bash
git add src/agent/prompts.js test/colega-escribe-a-sofi.test.js
git commit -m "feat(bot): Sofi atiende al colega como par, no como cliente

Tercer rol del mismo mecanismo que ya distingue al asesor de la casa, y existe
por la misma razon: el 2026-07-29 Sofi trato a Natalia como clienta y dejo un
lead falso en el embudo. Con un colega es peor — es un par con el que se
comparte comision, y pedirle presupuesto u ofrecerle 'un asesor' quema la
relacion.

Diferencia clave con el asesor de la casa: al asesor nunca se le ofrecen
propiedades sin que las pida, al colega SI, porque viene justamente a eso.

La comision se acuerda entre el colega y el asesor: Sofi no negocia
porcentajes. Y un asesor propio que ademas este en un grupo gremial sigue
siendo de la casa (advisor gana sobre colega).

Juan, 2026-08-22: 'que sofi lo atienda con tono para colega'.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Detectar al colega en `engine.js`

**Files:**
- Modify: `src/agent/engine.js:54-80` (junto a la detección de asesor) y el punto donde llama a `buildSystemPrompt`
- Test: `test/colega-deteccion.test.js`

**Interfaces:**
- Consumes: `directorio.esColega(orgId, telefono)` (Task 2), `buildSystemPrompt({ ..., colega })` (Task 4).
- Produces: nada nuevo hacia otras tareas.

**Contexto para quien implementa:** en `src/agent/engine.js#procesarMensaje` (línea ~54) ya existe la resolución del asesor: `const advisor = await advisors.findByPhone(org.id, phone).catch(...)` con **falla abierta** (si revienta, se atiende como cliente). El colega se resuelve igual, con la misma falla abierta, y **solo si no hay advisor** — para no pagar una consulta de más cuando ya sabemos que es de la casa. Después, `leads.findOrCreate(org.id, phone, advisor ? "asesor" : source)` decide el `source` del lead; el colega necesita su propio valor para no ensuciar el embudo. Buscar el `buildSystemPrompt(...)` en el archivo y pasarle `colega`.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/colega-deteccion.test.js`:

```js
// El colega se reconoce por telefono, y no ensucia el embudo.
//
// Verificado sobre el fuente, no ejecutando el engine: procesarMensaje llama a
// Claude y a la base, y lo que hay que fijar aca son decisiones de estructura
// —el orden de precedencia, la falla abierta y el source del lead— que se leen
// mejor asi que montando media aplicacion en un mock.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const fuente = fs.readFileSync(path.join(__dirname, "..", "src", "agent", "engine.js"), "utf8");

test("engine.js resuelve si quien escribe es un colega", () => {
  assert.match(fuente, /require\("\.\.\/groups\/directorio"\)/);
  assert.match(fuente, /directorio\.esColega\(/);
});

test("el colega se busca DESPUES del asesor y solo si no hay asesor", () => {
  const iAsesor = fuente.indexOf("advisors.findByPhone(");
  const iColega = fuente.indexOf("directorio.esColega(");
  assert.ok(iAsesor > -1 && iColega > -1, "las dos resoluciones tienen que existir");
  assert.ok(iAsesor < iColega, "el asesor de la casa se resuelve primero");

  // Y no se paga la consulta si ya sabemos que es de la casa.
  const bloque = fuente.slice(iColega - 300, iColega + 200);
  assert.match(bloque, /advisor \?|!advisor|advisor \|\|/, "la busqueda de colega tiene que estar condicionada a que no haya asesor");
});

test("la deteccion de colega falla ABIERTA, como la de asesor", () => {
  // Si la consulta revienta se lo atiende como cliente. Quedarse mudo con
  // alguien real por no poder descartar que sea colega seria mucho peor.
  const i = fuente.indexOf("directorio.esColega(");
  const bloque = fuente.slice(i, i + 400);
  assert.match(bloque, /catch/, "tiene que tener catch");
  assert.match(bloque, /null/, "y devolver null en el catch");
});

test("un colega NO entra al embudo como cliente final", () => {
  // Un colega contado como lead ensucia las metricas igual que el caso de
  // Natalia del 2026-07-29.
  assert.match(fuente, /"colega"/, 'el lead de un colega tiene que marcarse con source "colega"');
});

test("el prompt recibe el colega", () => {
  const i = fuente.indexOf("buildSystemPrompt(");
  assert.ok(i > -1);
  const bloque = fuente.slice(i, i + 300);
  assert.match(bloque, /colega/, "buildSystemPrompt tiene que recibir el colega");
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `node --test test/colega-deteccion.test.js`
Expected: FAIL — `engine.js` no requiere el directorio

- [ ] **Step 3: Agregar la detección en `src/agent/engine.js`**

Agregar el require junto a los otros de datos (cerca de `const advisors = require("../data/advisors");`):

```js
const directorio = require("../groups/directorio");
```

Justo después del bloque que resuelve `advisor` (el que termina con `return null; });`), agregar:

```js
  // ¿Y si no es de la casa, es un colega de otra inmobiliaria? Se resuelve
  // contra el directorio de los grupos gremiales (src/groups/directorio.js).
  //
  // Solo se pregunta si NO hay asesor: un asesor propio que ademas esta en un
  // grupo sigue siendo de la casa, y asi no se paga la consulta de mas.
  //
  // Falla ABIERTA, igual que la del asesor: si revienta se lo atiende como
  // cliente, que es el comportamiento de siempre.
  const colega = advisor
    ? null
    : await directorio.esColega(org.id, phone).catch((e) => {
        console.warn("[engine] No se pudo verificar si el telefono es de un colega:", e.message);
        return null;
      });
```

- [ ] **Step 4: Marcar el lead para que no ensucie el embudo**

Reemplazar la línea del `findOrCreate` y el bloque que sigue:

```js
  const fuenteLead = advisor ? "asesor" : colega ? "colega" : source;
  const lead = await leads.findOrCreate(org.id, phone, fuenteLead);
  // Un asesor o un colega que ya tenia lead de antes (escribio a Sofi antes de
  // que existiera esta rama) queda marcado, para que el embudo no lo cuente.
  if ((advisor || colega) && lead.source !== fuenteLead) {
    try {
      Object.assign(lead, await leads.update(lead.id, { source: fuenteLead }));
    } catch (e) {
      console.warn(`[engine] No se pudo marcar el lead como ${fuenteLead}:`, e.message);
    }
  }
```

- [ ] **Step 5: Pasar el colega al prompt**

Buscar la llamada a `buildSystemPrompt(` en `engine.js` y agregarle `colega`:

```js
  buildSystemPrompt({ org, lead, qualified, now, advisor, colega })
```

(Mantener los demás argumentos exactamente como estaban.)

- [ ] **Step 6: Correr los tests**

Run: `node --test test/colega-deteccion.test.js`
Expected: PASS — 5 tests

- [ ] **Step 7: Correr la suite completa**

Run: `npm test`
Expected: PASS — 891 tests, 0 fallos

- [ ] **Step 8: Verificar que el server arranca**

Run: `node -e "require('./src/server.js')" ` y cortarlo con Ctrl+C, o `node --check src/agent/engine.js`
Expected: sin errores de sintaxis ni require circular. **Ojo:** `engine.js` ahora requiere `src/groups/directorio.js`, que requiere `src/data/colegas.js` y `src/lib/waha.js`. Si aparece un ciclo, mover el require dentro de la función.

- [ ] **Step 9: Commit**

```bash
git add src/agent/engine.js test/colega-deteccion.test.js
git commit -m "feat(bot): reconocer al colega por telefono cuando le escribe a Sofi

Se resuelve contra el directorio de los grupos gremiales, con la misma forma que
la deteccion de asesor que ya existia: falla ABIERTA (si revienta se atiende
como cliente) y solo se consulta si no hay asesor, porque un asesor propio que
ademas esta en un grupo sigue siendo de la casa.

El lead queda con source 'colega' para que no ensucie el embudo — el mismo
problema que el caso de Natalia del 2026-07-29, donde un asesor contado como
cliente dejo un lead falso.

Reconocerlo por telefono y no por el texto del link es deliberado: el colega va
a borrar el texto prellenado seguido.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Cierre de la Fase 1

- [ ] **Correr la migración en Supabase.** Pegar `db/migrations/2026-08-22_colegas_grupos.sql` en el SQL Editor. **Sin esto la fase no hace nada:** `src/data/colegas.js` degrada limpio y avisa una vez en el log, pero no guarda ni reconoce a nadie.

- [ ] **Verificar con query directa** (el repo no tiene `db:push`, y la lección del proyecto es no asumir que una migración corrió):

```bash
curl -s "$SUPABASE_URL/rest/v1/colegas_grupos?select=lid,telefono,nombre&limit=5" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

Si responde `42703`/`PGRST205`, la migración no corrió.

- [ ] **Push y deploy.** `git push origin main` publica bot (Railway), CRM y landing (Vercel).

- [ ] **A las 48 horas, medir.** Contar filas en `colegas_grupos` y qué proporción tiene `telefono` no nulo. Es la verificación de si el 67% medido sobre 45 colegas de un día se sostiene con pedidos reales — y es lo que decide si se enciende la Fase 2.

- [ ] **Actualizar el spec** con el número real medido a las 48 h, en §2.

## Lo que esta fase NO hace

- No envía ni un DM. `waha.enviarDm` no existe todavía; la guarda de `enviarTexto` (solo `@g.us`) queda intacta.
- No cambia el comportamiento del radar en los grupos: sigue publicando con `reply_to` como hoy.
- No arma el link `wa.me` (Fase 2).
- No construye el panel de colegas en el CRM (fuera de alcance por decisión de Juan).
