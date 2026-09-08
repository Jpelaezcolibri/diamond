# La línea de Natalia: puerta al @lid y panel de seguimiento — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que las respuestas de los colegas a los DM del radar (que hoy salen a `<lid>@lid` y se descartan en la primera línea del webhook) entren, se guarden con la identidad correcta, se liguen al pedido y a la propiedad, y se vean en el panel `/grupos` del CRM — con el clasificador de citas apagado por interruptor hasta la fase 2.

**Architecture:** Se extiende lo que existe desde el 2026-08-21 y nunca corrió: `whatsapp-group.js` deja pasar `@lid` y construye una identidad `{ telefono, lid }` en vez de fabricar un teléfono desde el chatId; `linea_dm` gana `remitente_lid`; `group-signals.js` gana `buscarPorLid` (contra `respuesta_destino_lid`, la más reciente); `dm.js` gana el interruptor `RADAR_DM_CLASIFICAR` y elige la búsqueda por identidad; el inbox del CRM agrupa por identidad, muestra la propiedad del pedido y deja las columnas de las fases 2-3 en gris.

**Tech Stack:** Node.js (bot, `node --test`), Supabase (PostgREST + SQL a mano), Next.js 16 / TypeScript (CRM, sin suite de tests — se verifica con `npx tsc --noEmit` y `npm run lint`).

**Spec:** `docs/superpowers/specs/2026-09-08-linea-dm-lid-y-seguimiento-design.md`

## Global Constraints

- Idioma de la app: español (Colombia). Código: inglés salvo donde el módulo ya usa nombres en español (`remitente`, `senal`, `hilo`) — seguir el archivo que se toca.
- Commits en español con prefijo convencional (`feat:`, `fix:`, `docs:`, `test:`). Terminar cada mensaje con `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **Ninguna vía de envío se toca.** `waha.enviarDm`, `waha.enviarTexto`, `politica.js` quedan como están. `test/group-canal.test.js` lo vigila.
- **Nunca registrar el contenido de un mensaje en logs de error.** Ya es la regla del canal.
- Un lid **nunca** se guarda en una columna que diga teléfono. `remitente_telefono` solo recibe lo que pasa `esCelularColombiano` y vino por `@c.us`.
- La migración se corre **a mano en Supabase** y se verifica por REST antes de declararla corrida (regla del CLAUDE.md, sección 2).
- Los tests del bot corren con `npm test` desde la raíz del repo (`node --test test/*.test.js`). Un test puntual: `node --test test/<archivo>.test.js`.
- Windows sin admin, Git Bash. Rutas con `/`.
- Trabajar desde la raíz del repo: `C:/Users/JuanPelaez/bot-inmobiliario`.

---

## Mapa de archivos

| Archivo | Responsabilidad en este plan |
|---|---|
| `db/migrations/2026-09-08_linea_dm_lid.sql` (crear) | Columna `remitente_lid` + índice. |
| `src/data/linea-dm.js` (modificar) | `create` guarda `remitente_lid`; `historialDe` y `ultimaCitaAlertada` reciben una identidad `{ telefono, lid }`. |
| `src/data/group-signals.js` (modificar) | `buscarPorLid`; `buscarPorTelefono` también mira `respuesta_destino_telefono`. |
| `src/channels/whatsapp-group.js` (modificar) | `esDM` acepta `@lid`; `identidadDM(chatId)`; `procesarDM` pasa la identidad; cola por chatId crudo; comentario de INVARIANTE 1 actualizado. |
| `src/groups/dm.js` (modificar) | Interruptor `RADAR_DM_CLASIFICAR`; elige `buscarPorLid`/`buscarPorTelefono`; pasa la identidad al hilo y al dedup. |
| `.env.example` (modificar) | Documentar `RADAR_DM_CLASIFICAR`. |
| `src/server.js` (modificar) | Una línea de log al arrancar con el estado del clasificador. |
| `test/linea-dm.test.js`, `test/group-signals-dm.test.js`, `test/group-canal.test.js`, `test/group-dm.test.js` (modificar) | Tests de cada pieza. |
| `crm/components/linea-dm-inbox.tsx` (modificar) | Hilo por identidad; cabecera con propiedad y fecha del DM; columnas fase 2-3 en gris; vacío con la fecha de arranque. |
| `crm/app/(dashboard)/grupos/page.tsx` (modificar) | Consulta trae `remitente_lid`; resuelve `respuesta_refs`/`respondida_at`/propiedad; el inbox sale del bloque admin-only. |
| `crm/lib/calendar-events.ts` (modificar) | El link "ver chat" usa la misma ancla por identidad. |

---

### Task 1: La columna `remitente_lid` y la identidad en `linea-dm.js`

**Files:**
- Create: `db/migrations/2026-09-08_linea_dm_lid.sql`
- Modify: `src/data/linea-dm.js`
- Test: `test/linea-dm.test.js`

**Interfaces:**
- Produces:
  - `create(orgId, { ..., remitenteTelefono, remitenteLid, ... })` — guarda `remitente_lid`.
  - `historialDe(orgId, identidad, { limite })` donde `identidad = { telefono: string|null, lid: string|null }`. Filtra por `remitente_lid` si hay lid; si no, por `remitente_telefono`. Sin ninguno de los dos: `[]` sin consultar.
  - `ultimaCitaAlertada(orgId, identidad)` — misma regla.
  - Export nuevo `columnaDeIdentidad(identidad)` → `{ columna: "remitente_lid"|"remitente_telefono", valor } | null`.

- [ ] **Step 1: Escribir la migración**

```sql
-- db/migrations/2026-09-08_linea_dm_lid.sql
--
-- QUIEN escribe cuando el chat llega por direccionamiento oculto (Juan,
-- 2026-09-08). Los DM del radar salen a `<lid>@lid` (politica.js#decidirDm
-- prefiere el lid siempre que exista: 82 de 82 desde el 4-sep), y la
-- respuesta del colega vuelve por el mismo chat. Hasta hoy
-- src/channels/whatsapp-group.js la descartaba en la primera linea porque
-- solo aceptaba @c.us — por eso linea_dm tenia 0 filas en toda su historia.
--
-- Esta columna es EXCLUYENTE con remitente_telefono: un mensaje llega por
-- @lid o por @c.us, nunca por los dos. Un lid no se guarda como telefono
-- (es el error que 2026-09-04_dm_destinatario.sql advierte) y un telefono
-- no se guarda como lid.
--
-- Correr a mano en Supabase. Idempotente.

alter table linea_dm add column if not exists remitente_lid text;

comment on column linea_dm.remitente_lid is
  'Lid crudo (<digitos>@lid) cuando el chat llego por direccionamiento oculto. Excluyente con remitente_telefono: un mensaje tiene uno u otro, nunca los dos.';

-- El hilo de un colega que escribe por lid: "que dijo este remitente, en
-- orden" — espejo de idx_linea_dm_remitente para la otra identidad.
create index if not exists idx_linea_dm_remitente_lid
  on linea_dm (org_id, remitente_lid, created_at);
```

- [ ] **Step 2: Escribir los tests que fallan**

Agregar al final de `test/linea-dm.test.js`:

```js
// ── Identidad por lid (Juan, 2026-09-08) ──────────────────────────────────
//
// Los DM del radar salen a <lid>@lid y la respuesta vuelve por ese chat. Un
// lid NUNCA va en remitente_telefono: es el error contra el que advierte
// db/migrations/2026-09-04_dm_destinatario.sql.

test("create guarda remitente_lid y deja remitente_telefono en null cuando el chat llego por lid", async (t) => {
  let recibido = null;
  t.mock.method(supabase, "from", () => {
    const c = chain({ data: null, error: null });
    c.insert = (row) => { recibido = row; return c; };
    c.single = () => Promise.resolve({ data: { id: "dm-2", ...recibido }, error: null });
    return c;
  });

  await lineaDm.create(ORG, {
    waMessageId: "wamid-2", remitenteTelefono: null, remitenteLid: "276467766300904@lid",
    remitenteNombre: "Carva", texto: "hola", fechaMensaje: "2026-09-08T10:00:00Z",
  });

  assert.strictEqual(recibido.remitente_lid, "276467766300904@lid");
  assert.strictEqual(recibido.remitente_telefono, null);
});

test("columnaDeIdentidad prefiere el lid, cae al telefono, y sin ninguno devuelve null", () => {
  assert.deepStrictEqual(
    lineaDm.columnaDeIdentidad({ telefono: null, lid: "276467766300904@lid" }),
    { columna: "remitente_lid", valor: "276467766300904@lid" }
  );
  assert.deepStrictEqual(
    lineaDm.columnaDeIdentidad({ telefono: "573001112222", lid: null }),
    { columna: "remitente_telefono", valor: "573001112222" }
  );
  assert.strictEqual(lineaDm.columnaDeIdentidad({ telefono: null, lid: null }), null);
  assert.strictEqual(lineaDm.columnaDeIdentidad(null), null);
});

test("historialDe por lid filtra por remitente_lid, no por telefono", async (t) => {
  const filtros = [];
  t.mock.method(supabase, "from", () => {
    const c = chain({ data: [{ id: "m1", texto: "a", created_at: "2026-09-08T10:00:00Z" }], error: null });
    c.eq = (col, val) => { filtros.push([col, val]); return c; };
    return c;
  });
  const h = await lineaDm.historialDe(ORG, { telefono: null, lid: "276467766300904@lid" });
  assert.deepStrictEqual(h.map((m) => m.texto), ["a"]);
  assert.ok(filtros.some(([c, v]) => c === "remitente_lid" && v === "276467766300904@lid"));
  assert.ok(!filtros.some(([c]) => c === "remitente_telefono"));
});

test("historialDe sin identidad no consulta la base", async (t) => {
  const espia = t.mock.method(supabase, "from", () => chain({ data: [], error: null }));
  assert.deepStrictEqual(await lineaDm.historialDe(ORG, { telefono: null, lid: null }), []);
  assert.strictEqual(espia.mock.callCount(), 0);
});

test("ultimaCitaAlertada por lid filtra por remitente_lid", async (t) => {
  const filtros = [];
  t.mock.method(supabase, "from", () => {
    const c = chain({ data: { cita_fecha_hora_iso: null, avance_tipo: "agendando" }, error: null });
    c.eq = (col, val) => { filtros.push([col, val]); return c; };
    return c;
  });
  const clave = await lineaDm.ultimaCitaAlertada(ORG, { telefono: null, lid: "276467766300904@lid" });
  assert.strictEqual(clave, "agendando");
  assert.ok(filtros.some(([c, v]) => c === "remitente_lid" && v === "276467766300904@lid"));
});
```

Y actualizar los dos tests existentes que llaman con un string para que usen la identidad (los nombres de los tests se conservan):

```js
// era: lineaDm.historialDe(ORG, null)
const h = await lineaDm.historialDe(ORG, { telefono: null, lid: null });

// era: lineaDm.historialDe(ORG, "573001112222")
const h = await lineaDm.historialDe(ORG, { telefono: "573001112222", lid: null });

// era: lineaDm.ultimaCitaAlertada(ORG, "573001112222") — en los tres tests de ultimaCitaAlertada
await lineaDm.ultimaCitaAlertada(ORG, { telefono: "573001112222", lid: null })
```

- [ ] **Step 3: Correr para verificar que fallan**

Run: `node --test test/linea-dm.test.js`
Expected: FAIL — `columnaDeIdentidad is not a function`, y los de `historialDe`/`ultimaCitaAlertada` fallan porque reciben un objeto donde esperaban string.

- [ ] **Step 4: Implementar en `src/data/linea-dm.js`**

Reemplazar `create`, `historialDe` y `ultimaCitaAlertada`, y agregar `columnaDeIdentidad`:

```js
// La IDENTIDAD de quien escribe (Juan, 2026-09-08): un chat 1 a 1 llega por
// `<telefono>@c.us` o por `<lid>@lid`, nunca por los dos. Se resuelve a UNA
// columna para consultar el hilo y el dedup de alertas. El lid gana si
// existe, porque es la unica identidad estable para el 98% de los colegas
// (ver docs/superpowers/specs/2026-09-08-linea-dm-lid-y-seguimiento-design.md).
function columnaDeIdentidad(identidad) {
  if (!identidad) return null;
  if (identidad.lid) return { columna: "remitente_lid", valor: identidad.lid };
  if (identidad.telefono) return { columna: "remitente_telefono", valor: identidad.telefono };
  return null;
}

// Alta con dedup por wa_message_id (mismo criterio que group-signals.js).
async function create(orgId, fields) {
  const row = {
    org_id: orgId,
    sesion: fields.sesion || null,
    wa_message_id: fields.waMessageId,
    remitente_telefono: fields.remitenteTelefono || null,
    remitente_lid: fields.remitenteLid || null,
    remitente_nombre: fields.remitenteNombre || null,
    texto: fields.texto || null,
    fecha_mensaje: fields.fechaMensaje || null,
    senal_id: fields.senalId || null,
  };

  if (!supabase) {
    memory.lineaDm = memory.lineaDm || [];
    const yaEsta = memory.lineaDm.find((m) => m.org_id === orgId && m.wa_message_id === row.wa_message_id);
    if (yaEsta) return { mensaje: yaEsta, duplicado: true };
    const creado = { id: memory.uid(), created_at: new Date().toISOString(), ...row };
    memory.lineaDm.push(creado);
    return { mensaje: creado, duplicado: false };
  }

  const { data, error } = await supabase.from("linea_dm").insert(row).select().single();
  if (!error) return { mensaje: data, duplicado: false };
  // 23505 = violacion de indice unico: dedup haciendo su trabajo, no un fallo.
  if (error.code === "23505") return { mensaje: null, duplicado: true };
  if (esTablaFaltante(error)) {
    avisarFaltaTabla();
    return { mensaje: null, duplicado: false };
  }
  throw error;
}

// Los ultimos mensajes de ESTE remitente, mas viejo primero — el contexto
// completo del hilo que necesita el clasificador (src/groups/dm.js): una
// fecha puede quedar dicha en un mensaje y la hora en el siguiente.
async function historialDe(orgId, identidad, { limite = 10 } = {}) {
  const filtro = columnaDeIdentidad(identidad);
  if (!filtro) return [];
  if (!supabase) {
    return (memory.lineaDm || [])
      .filter((m) => m.org_id === orgId && m[filtro.columna] === filtro.valor)
      .slice(-limite);
  }
  const { data, error } = await supabase
    .from("linea_dm")
    .select("id, texto, created_at")
    .eq("org_id", orgId)
    .eq(filtro.columna, filtro.valor)
    .order("created_at", { ascending: false })
    .limit(limite);
  if (error) {
    if (esTablaFaltante(error)) return [];
    throw error;
  }
  return (data || []).reverse();
}

// La CLAVE del ultimo avance YA alertado de este remitente (fecha_hora si la
// hay, si no el tipo de avance) — para no re-avisar el MISMO avance en cada
// mensaje nuevo del hilo, pero SI avisar de nuevo si cambia (reagenda, o
// paso de "agendando" a "cita_confirmada").
async function ultimaCitaAlertada(orgId, identidad) {
  const filtro = columnaDeIdentidad(identidad);
  if (!filtro) return null;
  const clave = (m) => m?.cita_fecha_hora_iso || m?.avance_tipo || null;
  if (!supabase) {
    const alertadas = (memory.lineaDm || [])
      .filter((m) => m.org_id === orgId && m[filtro.columna] === filtro.valor && m.alertado_at)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return clave(alertadas[0]);
  }
  const { data, error } = await supabase
    .from("linea_dm")
    .select("cita_fecha_hora_iso, avance_tipo")
    .eq("org_id", orgId)
    .eq(filtro.columna, filtro.valor)
    .not("alertado_at", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (esTablaFaltante(error)) return null;
    throw error;
  }
  return clave(data);
}
```

Y el export:

```js
module.exports = { create, historialDe, guardarClasificacion, marcarAlertado, ultimaCitaAlertada, columnaDeIdentidad };
```

- [ ] **Step 5: Correr los tests**

Run: `node --test test/linea-dm.test.js`
Expected: PASS, todos.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/2026-09-08_linea_dm_lid.sql src/data/linea-dm.js test/linea-dm.test.js
git commit -m "feat(radar): linea_dm distingue lid de telefono -- columna remitente_lid e identidad en el hilo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `buscarPorLid` y la búsqueda por destino en `group-signals.js`

**Files:**
- Modify: `src/data/group-signals.js` (junto a `buscarPorTelefono`, línea ~916, y el `module.exports`)
- Test: `test/group-signals-dm.test.js`

**Interfaces:**
- Produces:
  - `buscarPorLid(orgId, lid)` → la señal más reciente con `respuesta_destino_lid = lid` (lid crudo, con sufijo). Mismas columnas que `buscarPorTelefono`. `null` sin lid o sin resultado.
  - `buscarPorTelefono(orgId, telefono)` → ahora matchea `autor_telefono` **o** `respuesta_destino_telefono`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `test/group-signals-dm.test.js`:

```js
// ── Atribuir la respuesta de un colega al DM que la origino (Juan, 2026-09-08) ──
//
// "Al DM mas reciente de ese colega", sin ventana de tiempo. El lid crudo
// (con sufijo) es lo que marcarRespondida guardo en respuesta_destino_lid.

test("buscarPorLid sin lid no consulta nada", async () => {
  assert.strictEqual(await groupSignals.buscarPorLid("org-1", null), null);
  assert.strictEqual(await groupSignals.buscarPorLid("org-1", ""), null);
});

test("buscarPorLid en memoria devuelve la señal MAS RECIENTE con ese respuesta_destino_lid", async () => {
  const memory = require("../src/data/memory");
  const antes = memory.groupSignals.length;
  memory.groupSignals.push(
    { id: "s-vieja", org_id: "org-1", respuesta_destino_lid: "276467766300904@lid", created_at: "2026-09-01T10:00:00Z" },
    { id: "s-nueva", org_id: "org-1", respuesta_destino_lid: "276467766300904@lid", created_at: "2026-09-08T10:00:00Z" },
    { id: "s-otro", org_id: "org-1", respuesta_destino_lid: "111@lid", created_at: "2026-09-09T10:00:00Z" }
  );
  try {
    const s = await groupSignals.buscarPorLid("org-1", "276467766300904@lid");
    assert.strictEqual(s.id, "s-nueva");
  } finally {
    memory.groupSignals.length = antes;
  }
});

test("buscarPorLid con supabase filtra por org y por respuesta_destino_lid, ordenado por created_at desc, limit 1", async () => {
  const { mod, llamadasPorTabla } = instalarConSupabase({ data: { id: "s-1", texto_original: "Busco apto" }, error: null });
  const s = await mod.buscarPorLid("org-9", "276467766300904@lid");
  assert.strictEqual(s.id, "s-1");
  const llamadas = llamadasPorTabla[0].llamadas;
  assert.deepStrictEqual(llamadas.filter(([m]) => m === "eq"), [
    ["eq", "org_id", "org-9"],
    ["eq", "respuesta_destino_lid", "276467766300904@lid"],
  ]);
  assert.ok(llamadas.some(([m, col, opts]) => m === "order" && col === "created_at" && opts && opts.ascending === false));
  assert.ok(llamadas.some(([m, n]) => m === "limit" && n === 1));
});

test("buscarPorTelefono tambien encuentra la señal por respuesta_destino_telefono (el colega publico con lid y contesta desde @c.us)", async () => {
  const { mod, llamadasPorTabla } = instalarConSupabase({ data: { id: "s-2" }, error: null });
  const s = await mod.buscarPorTelefono("org-9", "573205938640");
  assert.strictEqual(s.id, "s-2");
  const llamadas = llamadasPorTabla[0].llamadas;
  const or = llamadas.find(([m]) => m === "or");
  assert.ok(or, "tiene que usar .or() para mirar las dos columnas");
  assert.strictEqual(or[1], "autor_telefono.eq.573205938640,respuesta_destino_telefono.eq.573205938640");
});
```

`construirQuery` en ese test solo conoce `select/eq/gte/order/limit/update`. Agregar `"or"` y `"maybeSingle"` a la lista para que el doble los acepte:

```js
for (const metodo of ["select", "eq", "gte", "order", "limit", "update", "or"]) {
  q[metodo] = (...args) => { llamadas.push([metodo, ...args]); return q; };
}
q.maybeSingle = () => Promise.resolve(resultado);
```

- [ ] **Step 2: Correr para verificar que fallan**

Run: `node --test test/group-signals-dm.test.js`
Expected: FAIL — `buscarPorLid is not a function`; el de `buscarPorTelefono` falla porque no hay llamada `or`.

- [ ] **Step 3: Implementar**

Reemplazar `buscarPorTelefono` y agregar `buscarPorLid` justo debajo:

```js
// El pedido mas reciente de este colega, para ligar lo que escribe al
// privado con lo que publico en el grupo. Dos identidades posibles (Juan,
// 2026-09-08): el telefono, que puede aparecer como autor del pedido O como
// destino del DM que le mandamos (un colega que publico con lid y contesta
// desde un @c.us expuesto); y el lid crudo, que solo vive en
// respuesta_destino_lid porque es donde marcarRespondida lo dejo.
//
// "Mas reciente" y sin ventana de tiempo, por decision de Juan: dos DM
// seguidos al mismo colega atribuyen la respuesta al segundo.
const COLUMNAS_SEÑAL_HILO = "id, texto_original, zona, tipo, operacion, created_at, matches, respuesta_refs, respondida_at";

async function buscarPorTelefono(orgId, telefono) {
  if (!telefono) return null;
  if (!supabase) {
    return (
      memory.groupSignals
        .filter(
          (s) =>
            s.org_id === orgId &&
            (s.autor_telefono === telefono || s.respuesta_destino_telefono === telefono) &&
            (s.clase === "demanda" || !s.clase)
        )
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null
    );
  }
  const { data, error } = await supabase
    .from("group_signals")
    .select(COLUMNAS_SEÑAL_HILO)
    .eq("org_id", orgId)
    .or(`autor_telefono.eq.${telefono},respuesta_destino_telefono.eq.${telefono}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[grupos] No se pudo buscar la señal por telefono:", error.message);
    return null;
  }
  return data;
}

async function buscarPorLid(orgId, lid) {
  if (!lid) return null;
  if (!supabase) {
    return (
      memory.groupSignals
        .filter((s) => s.org_id === orgId && s.respuesta_destino_lid === lid)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null
    );
  }
  const { data, error } = await supabase
    .from("group_signals")
    .select(COLUMNAS_SEÑAL_HILO)
    .eq("org_id", orgId)
    .eq("respuesta_destino_lid", lid)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[grupos] No se pudo buscar la señal por lid:", error.message);
    return null;
  }
  return data;
}
```

Nota: se quita el `.eq("clase", "demanda")` de `buscarPorTelefono`. Razón: un colega al que le mandamos un DM lo hizo por una demanda (es lo único que dispara DM), así que el filtro era redundante para el camino nuevo y excluía señales sin `clase` en memoria. Si un test existente dependía de `clase`, el filtro en memoria acepta `demanda` o sin clase.

Agregar `buscarPorLid` al `module.exports` (en la línea donde está `buscarPorTelefono`).

- [ ] **Step 4: Correr los tests**

Run: `node --test test/group-signals-dm.test.js && node --test test/group-dm.test.js`
Expected: PASS ambos (el segundo sigue mockeando `buscarPorTelefono` y no debería verse afectado todavía).

- [ ] **Step 5: Commit**

```bash
git add src/data/group-signals.js test/group-signals-dm.test.js
git commit -m "feat(radar): buscarPorLid -- la respuesta de un colega se liga al DM mas reciente que le salio

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: La puerta — `esDM` acepta `@lid` y `procesarDM` construye la identidad

**Files:**
- Modify: `src/channels/whatsapp-group.js` (líneas ~226-231, ~313-324, ~341-360, y el bloque de comentarios de INVARIANTE 1 en la cabecera ~líneas 26-40)
- Test: `test/group-canal.test.js`

**Interfaces:**
- Consumes: nada nuevo.
- Produces:
  - `_esDM(chatId)` → `true` para `@c.us` **y** `@lid`.
  - `_identidadDM(chatId)` → `{ id: string, telefono: string|null, lid: string|null }`. `id` es el chatId crudo. `telefono` solo si `@c.us` y `esCelularColombiano`; `lid` solo si `@lid`.
  - `procesarDM` pasa a `dm.procesarMensaje` un mensaje con `remitenteId`, `remitenteTelefono`, `remitenteLid` (Task 4 lo consume).

- [ ] **Step 1: Escribir los tests que fallan**

En `test/group-canal.test.js`, reemplazar el test `"_esDM reconoce un chat 1 a 1 (@c.us) y lo distingue de un grupo"` por:

```js
test("_esDM reconoce un chat 1 a 1 por @c.us O por @lid, y lo distingue de todo lo demas", () => {
  const canal = require("../src/channels/whatsapp-group");
  assert.strictEqual(canal._esDM("573001112222@c.us"), true);
  // Los DM del radar salen a <lid>@lid (politica.js prefiere el lid): la
  // respuesta del colega vuelve por ese mismo chat (Juan, 2026-09-08).
  assert.strictEqual(canal._esDM("276467766300904@lid"), true);
  assert.strictEqual(canal._esDM("123456@g.us"), false);
  assert.strictEqual(canal._esDM("status@broadcast"), false);
  assert.strictEqual(canal._esDM("123@broadcast"), false);
  assert.strictEqual(canal._esDM("123@newsletter"), false);
  assert.strictEqual(canal._esDM("573001112222"), false);
  assert.strictEqual(canal._esDM(null), false);
});

test("_identidadDM separa telefono de lid y nunca mete un lid donde dice telefono", () => {
  const canal = require("../src/channels/whatsapp-group");
  assert.deepStrictEqual(canal._identidadDM("573001112222@c.us"), {
    id: "573001112222@c.us", telefono: "573001112222", lid: null,
  });
  assert.deepStrictEqual(canal._identidadDM("276467766300904@lid"), {
    id: "276467766300904@lid", telefono: null, lid: "276467766300904@lid",
  });
  // Un @c.us que NO tiene forma de celular colombiano se guarda igual, pero
  // sin telefono: no se inventa un dato que despues alguien va a marcar.
  assert.deepStrictEqual(canal._identidadDM("14155550100@c.us"), {
    id: "14155550100@c.us", telefono: null, lid: null,
  });
});

test("procesarDM le pasa a dm.procesarMensaje la identidad completa, no un telefono fabricado", () => {
  const codigo = soloCodigo(leer("src/channels/whatsapp-group.js"));
  const inicio = codigo.indexOf("async function procesarDM");
  const fin = codigo.indexOf("router.post(\"/webhook/grupos\"");
  const cuerpo = codigo.slice(inicio, fin);
  assert.ok(cuerpo.includes("identidadDM(ev.chatId)"), "procesarDM tiene que resolver la identidad");
  assert.ok(cuerpo.includes("remitenteLid:"), "y pasar el lid por separado");
  assert.ok(!cuerpo.includes("remitenteTelefono: soloDigitos(ev.chatId)"), "nunca mas un telefono sacado del chatId a ciegas");
});

test("la cola del DM se arma con el chatId crudo, para que un lid y un telefono con los mismos digitos no se pisen", () => {
  const codigo = soloCodigo(leer("src/channels/whatsapp-group.js"));
  assert.ok(codigo.includes("enqueue(`dm:${ev.chatId}`"), "la clave de la cola es el chatId con su sufijo");
  assert.ok(!codigo.includes("enqueue(`dm:${soloDigitos(ev.chatId)}`"));
});
```

- [ ] **Step 2: Correr para verificar que fallan**

Run: `node --test test/group-canal.test.js`
Expected: FAIL en los 4 tests nuevos/modificados (`_esDM("...@lid")` da `false`, `_identidadDM` no existe, los dos de texto no encuentran las cadenas).

- [ ] **Step 3: Implementar**

En `src/channels/whatsapp-group.js`, reemplazar el bloque de `esDM` (~líneas 226-231):

```js
// Chat 1 a 1 de WhatsApp (protocolo NOWEB de WAHA). Dos direccionamientos
// (Juan, 2026-09-08): `<telefono>@c.us` cuando WhatsApp expone el numero, y
// `<lid>@lid` cuando lo oculta. El segundo importa porque es POR DONDE SALEN
// los DM del radar (politica.js#decidirDm prefiere el lid siempre que
// exista: 82 de 82 desde el 4-sep) — y la respuesta del colega vuelve por
// el mismo chat. Hasta hoy se descartaba aca, en silencio: linea_dm tenia 0
// filas en toda su historia. Distinto de @g.us (grupo) y de cualquier otro
// tipo de chat (broadcast, status, canales), que sigue sin procesarse — ver
// INVARIANTE 1 mas abajo.
const esDM = (chatId) => typeof chatId === "string" && (chatId.endsWith("@c.us") || chatId.endsWith("@lid"));
const soloDigitos = (jid) => String(jid || "").replace(/\D/g, "") || null;

// QUIEN escribe en un chat 1 a 1, separado en lo que ES: un telefono solo si
// vino por @c.us y tiene forma de celular colombiano; un lid solo si vino
// por @lid. Nunca los dos, y nunca un lid disfrazado de telefono — es el
// error que db/migrations/2026-09-04_dm_destinatario.sql advierte, y que
// hasta hoy `soloDigitos(ev.chatId)` cometia a ciegas. `id` es el chatId
// crudo, con sufijo: la unica clave que no confunde a nadie.
function identidadDM(chatId) {
  const id = String(chatId || "");
  if (id.endsWith("@lid")) return { id, telefono: null, lid: id };
  const digitos = soloDigitos(id);
  const telefono = id.endsWith("@c.us") && esCelularColombiano(digitos) ? digitos : null;
  return { id, telefono, lid: null };
}
```

Reemplazar `procesarDM` (~líneas 313-324):

```js
// Mensaje DIRECTO a la linea vinculada (Juan, 2026-08-21) — inbox pasivo, ver
// la nota de diseno completa en src/groups/dm.js. En un chat 1 a 1 `from` ES
// el JID de quien escribe (no hay "participant" como en un grupo).
async function procesarDM(org, ev, sesion) {
  const quien = identidadDM(ev.chatId);
  const mensaje = {
    waMessageId: ev.waMessageId,
    sesion: ev.sesion,
    remitenteId: quien.id,
    remitenteTelefono: quien.telefono,
    remitenteLid: quien.lid,
    remitenteNombre: ev.autorNombre,
    texto: ev.texto,
    fechaMensaje: typeof ev.tsMs === "number" ? new Date(ev.tsMs).toISOString() : null,
  };
  return dm.procesarMensaje(org, mensaje);
}
```

En el handler del webhook, la cola (~línea 352): cambiar

```js
enqueue(`dm:${soloDigitos(ev.chatId)}`, () =>
```

por

```js
enqueue(`dm:${ev.chatId}`, () =>
```

Actualizar el comentario de INVARIANTE 1 en la cabecera del archivo (el punto `1.` del bloque "LAS INVARIANTES DE PRIVACIDAD", ~línea 26):

```
//   1. Se descarta cualquier chat que no sea un grupo (@g.us) o un mensaje
//      directo (@c.us o @lid), en la primera linea, antes de cualquier log,
//      consulta o escritura. El DM se habilito el 2026-08-21 SOLO porque esta
//      linea es 100% dedicada al radar, sin uso personal (Juan, confirmado
//      ese dia); el direccionamiento @lid se sumo el 2026-09-08 porque es por
//      donde salen los DM del radar y por donde vuelven las respuestas — sin
//      el, el inbox estaba vacio por diseno. Ver la nota completa junto a
//      INVARIANTE 1 mas abajo y db/migrations/2026-08-21_linea_dm.sql y
//      2026-09-08_linea_dm_lid.sql. Cualquier OTRO tipo de chat (broadcast,
//      status, canales) sigue sin existir en ningun lado.
```

Y el comentario inline junto al guard (~línea 335, "── INVARIANTE 1 ──"): agregar tras "(DM) se descarta ACA":

```
  // ... Un DM llega por @c.us o por @lid (2026-09-08); los dos entran.
```

Exportar `_identidadDM` junto a `_esDM` al final del archivo:

```js
module.exports._esDM = esDM;
module.exports._identidadDM = identidadDM;
```

- [ ] **Step 4: Correr los tests**

Run: `node --test test/group-canal.test.js`
Expected: PASS. En particular, `"el canal no tiene ninguna via de salida propia"` y `"el camino de DM nunca llama a procesar()..."` siguen en verde: no se agregó ninguna vía de envío.

- [ ] **Step 5: Commit**

```bash
git add src/channels/whatsapp-group.js test/group-canal.test.js
git commit -m "fix(radar): la linea deja entrar las respuestas por @lid -- estaban muriendo en la primera linea del webhook

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: El interruptor `RADAR_DM_CLASIFICAR` y la identidad en `dm.js`

**Files:**
- Modify: `src/groups/dm.js` (cabecera de constantes ~línea 30, y `procesarMensaje` ~líneas 122-166)
- Modify: `.env.example` (después del bloque de `RADAR_VISITAS_ALERTA_TO`, ~línea 247)
- Modify: `src/server.js` (junto al `require("./scheduler/visitas-venta").start()`, ~línea 147)
- Test: `test/group-dm.test.js`

**Interfaces:**
- Consumes: `lineaDm.create({ remitenteLid })`, `lineaDm.historialDe(orgId, identidad)`, `lineaDm.ultimaCitaAlertada(orgId, identidad)` (Task 1); `groupSignals.buscarPorLid` (Task 2); el mensaje con `remitenteId/remitenteTelefono/remitenteLid` (Task 3).
- Produces:
  - `clasificadorActivo()` exportado → `boolean`. Lee `RADAR_DM_CLASIFICAR` en cada llamada (no al cargar): apagado salvo `"true"`/`"1"`/`"si"`/`"yes"` (trim + lowercase).
  - Con el clasificador apagado, `procesarMensaje` devuelve `{ resultado: "guardado", dmId }` sin tocar Anthropic.

- [ ] **Step 1: Escribir los tests que fallan**

En `test/group-dm.test.js`:

1. Justo después de `process.env.RADAR_VISITAS_ALERTA_TO = "573000000000";` agregar:

```js
// El clasificador arranca APAGADO por defecto (fase 1 = leer, Juan
// 2026-09-08). Los tests de clasificacion/alerta lo prenden explicitamente;
// los que prueban "apagado" lo borran. Se lee en cada llamada, asi que
// alcanza con setear la variable antes de procesar.
process.env.RADAR_DM_CLASIFICAR = "true";
```

2. Actualizar el `mensaje()` helper y el `beforeEach` para la identidad nueva:

```js
const mensaje = (extra = {}) => ({
  waMessageId: "wamid-1", sesion: "RADA-NATALIA",
  remitenteId: "573001112222@c.us", remitenteTelefono: "573001112222", remitenteLid: null,
  remitenteNombre: "Felipe Velez", texto: "hola", fechaMensaje: "2026-08-21T10:00:00Z", ...extra,
});

test.beforeEach((t) => {
  process.env.RADAR_DM_CLASIFICAR = "true";
  t.mock.method(groupSignals, "buscarPorTelefono", async () => null);
  t.mock.method(groupSignals, "buscarPorLid", async () => null);
  t.mock.method(lineaDm, "create", async () => ({ mensaje: { id: "dm-1", created_at: "2026-08-21T10:00:00Z" }, duplicado: false }));
  t.mock.method(lineaDm, "historialDe", async () => []);
  t.mock.method(lineaDm, "guardarClasificacion", async () => true);
  t.mock.method(lineaDm, "marcarAlertado", async () => true);
  t.mock.method(lineaDm, "ultimaCitaAlertada", async () => null);
});
```

3. Agregar al final del archivo:

```js
// ── Fase 1: leer, no interpretar (Juan, 2026-09-08) ──────────────────────

test("con RADAR_DM_CLASIFICAR apagado se guarda el mensaje y NO se llama a la IA ni se alerta", async (t) => {
  delete process.env.RADAR_DM_CLASIFICAR;
  let iaLlamada = false;
  _setClientForTests({ messages: { create: async () => { iaLlamada = true; throw new Error("no debia llamarse"); } } });
  t.after(() => _setClientForTests(null));
  let seEnvio = false;
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async () => { seEnvio = true; return { ok: true }; });
  const guardarClasif = t.mock.method(lineaDm, "guardarClasificacion", async () => true);

  const r = await dm.procesarMensaje(ORG, mensaje());

  assert.strictEqual(r.resultado, "guardado");
  assert.strictEqual(r.dmId, "dm-1");
  assert.strictEqual(iaLlamada, false);
  assert.strictEqual(seEnvio, false);
  assert.strictEqual(guardarClasif.mock.callCount(), 0);
});

test("clasificadorActivo entiende false/0/no y espacios; solo true/1/si/yes lo prenden", () => {
  const casos = [
    ["true", true], ["TRUE", true], [" 1 ", true], ["si", true], ["yes", true],
    ["false", false], ["0", false], ["no", false], ["", false], [undefined, false], ["cualquier cosa", false],
  ];
  for (const [valor, esperado] of casos) {
    if (valor === undefined) delete process.env.RADAR_DM_CLASIFICAR;
    else process.env.RADAR_DM_CLASIFICAR = valor;
    assert.strictEqual(dm.clasificadorActivo(), esperado, `RADAR_DM_CLASIFICAR=${JSON.stringify(valor)}`);
  }
});

test("un mensaje que llega por lid se liga con buscarPorLid, no por telefono, y guarda remitente_lid", async (t) => {
  delete process.env.RADAR_DM_CLASIFICAR;
  let porLid = null;
  let porTel = false;
  t.mock.method(groupSignals, "buscarPorLid", async (org, lid) => { porLid = lid; return { id: "sig-lid" }; });
  t.mock.method(groupSignals, "buscarPorTelefono", async () => { porTel = true; return null; });
  let creado = null;
  t.mock.method(lineaDm, "create", async (org, fields) => { creado = fields; return { mensaje: { id: "dm-9", created_at: "2026-09-08T10:00:00Z" }, duplicado: false }; });

  await dm.procesarMensaje(ORG, mensaje({ remitenteId: "276467766300904@lid", remitenteTelefono: null, remitenteLid: "276467766300904@lid" }));

  assert.strictEqual(porLid, "276467766300904@lid");
  assert.strictEqual(porTel, false);
  assert.strictEqual(creado.remitenteLid, "276467766300904@lid");
  assert.strictEqual(creado.remitenteTelefono, null);
  assert.strictEqual(creado.senalId, "sig-lid");
});

test("con el clasificador prendido, el hilo y el dedup se consultan por la identidad (lid), no por telefono", async (t) => {
  process.env.RADAR_DM_CLASIFICAR = "true";
  mockVeredicto(t, veredicto({ hay_avance: true, tipo: "agendando", resumen: "coordinando" }));
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async () => ({ ok: true }));
  let identidadHilo = null;
  let identidadDedup = null;
  t.mock.method(lineaDm, "historialDe", async (org, identidad) => { identidadHilo = identidad; return []; });
  t.mock.method(lineaDm, "ultimaCitaAlertada", async (org, identidad) => { identidadDedup = identidad; return null; });

  await dm.procesarMensaje(ORG, mensaje({ remitenteId: "276467766300904@lid", remitenteTelefono: null, remitenteLid: "276467766300904@lid" }));

  assert.deepStrictEqual(identidadHilo, { telefono: null, lid: "276467766300904@lid" });
  assert.deepStrictEqual(identidadDedup, { telefono: null, lid: "276467766300904@lid" });
});
```

- [ ] **Step 2: Correr para verificar que fallan**

Run: `node --test test/group-dm.test.js`
Expected: FAIL — `clasificadorActivo is not a function`; el de "apagado" devuelve `sin_clasificar` (llama a la IA); el de lid llama a `buscarPorTelefono` con `null`.

- [ ] **Step 3: Implementar en `src/groups/dm.js`**

Después de `const VISITAS_ALERTA_TO = ...` (~línea 31):

```js
// INTERRUPTOR del clasificador (Juan, 2026-09-08: "por ahora solo leer,
// luego las citas"). Apagado por defecto: en fase 1 el mensaje se guarda y se
// liga al pedido, pero no se interpreta ni se alerta — y no se paga IA
// mientras no haga falta. Se lee en CADA llamada, no al cargar el modulo,
// para que prenderlo en Railway no exija un despliegue.
//
// Valores que PRENDEN, con trim+lowercase (mismo criterio que
// carril-arriendo.js#carrilActivo, al reves: aca lo raro es prender):
// "true", "1", "si", "yes". Todo lo demas, incluida la ausencia, es apagado.
const VALORES_PRENDIDO = new Set(["true", "1", "si", "yes"]);
function clasificadorActivo() {
  const valor = String(process.env.RADAR_DM_CLASIFICAR ?? "").trim().toLowerCase();
  return VALORES_PRENDIDO.has(valor);
}
```

Reemplazar `procesarMensaje` completo:

```js
/**
 * @param org      organizacion resuelta
 * @param mensaje  { waMessageId, sesion, remitenteId, remitenteTelefono, remitenteLid, remitenteNombre, texto, fechaMensaje }
 *                 — remitenteTelefono y remitenteLid son excluyentes (ver
 *                 whatsapp-group.js#identidadDM).
 * @returns { resultado, dmId } — nunca lanza por un mensaje suelto: un error
 *          en uno no puede tumbar la escucha de la linea.
 */
async function procesarMensaje(org, mensaje, { ahora = new Date() } = {}) {
  const identidad = { telefono: mensaje.remitenteTelefono || null, lid: mensaje.remitenteLid || null };

  // El pedido que origino el DM: por lid si vino por lid (es lo que
  // marcarRespondida guardo en respuesta_destino_lid), por telefono si no.
  const señal = identidad.lid
    ? await groupSignals.buscarPorLid(org.id, identidad.lid).catch(() => null)
    : await groupSignals.buscarPorTelefono(org.id, identidad.telefono).catch(() => null);

  const { mensaje: guardado, duplicado } = await lineaDm.create(org.id, {
    sesion: mensaje.sesion,
    waMessageId: mensaje.waMessageId,
    remitenteTelefono: identidad.telefono,
    remitenteLid: identidad.lid,
    remitenteNombre: mensaje.remitenteNombre,
    texto: mensaje.texto,
    fechaMensaje: mensaje.fechaMensaje,
    senalId: señal ? señal.id : null,
  });
  if (duplicado) return { resultado: "duplicado" };
  if (!guardado) return { resultado: "sin_tabla" };

  // Fase 1 (Juan, 2026-09-08): leer, no interpretar. Se corta ACA, despues
  // de guardar y ligar, y antes de cualquier llamada a la IA.
  if (!clasificadorActivo()) return { resultado: "guardado", dmId: guardado.id };

  const historial = await lineaDm.historialDe(org.id, identidad, { limite: 10 });
  const hilo = historial.length ? historial : [{ texto: mensaje.texto, created_at: guardado.created_at }];
  const veredicto = await clasificarAvance(hilo, ahora);
  if (!veredicto) return { resultado: "sin_clasificar", dmId: guardado.id };

  await lineaDm.guardarClasificacion(org.id, guardado.id, {
    tieneCita: veredicto.hay_avance,
    avanceTipo: veredicto.tipo || null,
    fechaHoraIso: veredicto.fecha_hora_iso || null,
    confianza: veredicto.confianza,
  });

  if (!veredicto.hay_avance) return { resultado: "sin_avance", dmId: guardado.id };

  // Dedup del aviso: no re-alertar el MISMO avance en cada mensaje nuevo del
  // hilo, pero SI avisar si la fecha cambio (reagenda) o si el tipo de
  // avance escalo (de "agendando" a "cita_confirmada", por ejemplo).
  const clave = veredicto.fecha_hora_iso || veredicto.tipo;
  const ultima = await lineaDm.ultimaCitaAlertada(org.id, identidad).catch(() => null);
  if (ultima && ultima === clave) return { resultado: "avance_ya_alertado", dmId: guardado.id };

  if (!VISITAS_ALERTA_TO) return { resultado: "sin_destinatario", dmId: guardado.id };

  const texto = construirAlerta(mensaje, veredicto, señal);
  const envio = await mensajeAsesor.enviarYRegistrar(org, VISITAS_ALERTA_TO, texto).catch((e) => ({ ok: false, error: e.message }));
  if (envio && envio.ok) await lineaDm.marcarAlertado(org.id, guardado.id).catch(() => {});

  return { resultado: envio && envio.ok ? "alertado" : "error_envio", dmId: guardado.id, error: envio && envio.error };
}

module.exports = { procesarMensaje, clasificarAvance, construirAlerta, clasificadorActivo, ESQUEMA, MODELO };
```

En `construirAlerta`, la línea `Colega: ${mensaje.remitenteNombre || mensaje.remitenteTelefono || "sin nombre"}` pasa a:

```js
    `Colega: ${mensaje.remitenteNombre || mensaje.remitenteTelefono || "sin nombre (escribe por lid)"}`,
```

- [ ] **Step 4: Documentar la variable en `.env.example`**

Insertar después del bloque de `RADAR_VISITAS_ALERTA_TO=` (antes de `# Hora (Colombia, 24h) del cruce diario`):

```
# Clasificador de avances del inbox de la linea (src/groups/dm.js): lee el
# hilo del colega con Haiku y detecta cita confirmada / coordinando /
# interes avanzado, y alerta a RADAR_VISITAS_ALERTA_TO. APAGADO por defecto
# (Juan, 2026-09-08: "por ahora solo leer, luego las citas"): en fase 1 los
# mensajes se guardan y se ligan al pedido, nada mas. Prenderlo es la fase 2
# — "true", "1", "si" o "yes"; cualquier otra cosa lo deja apagado. Se lee en
# cada mensaje, asi que cambiarlo en Railway no necesita despliegue.
RADAR_DM_CLASIFICAR=false
```

- [ ] **Step 5: Log de arranque en `src/server.js`**

Justo después de `if (config.supabaseUrl) require("./scheduler/visitas-venta").start();`:

```js
  // Inbox de la linea: dice al arrancar si el clasificador esta prendido, como
  // hacen los otros carriles — un interruptor que no se ve es uno que se olvida.
  if (config.supabaseUrl) {
    const { clasificadorActivo } = require("./groups/dm");
    console.log(
      clasificadorActivo()
        ? "[linea-dm] clasificador de avances PRENDIDO — fase 2, alerta citas"
        : "[linea-dm] clasificador apagado — fase 1, solo lectura (RADAR_DM_CLASIFICAR)"
    );
  }
```

- [ ] **Step 6: Correr los tests**

Run: `node --test test/group-dm.test.js && npm test`
Expected: PASS. Toda la suite en verde (los tests de `group-canal` y `linea-dm` de las tareas anteriores incluidos).

- [ ] **Step 7: Commit**

```bash
git add src/groups/dm.js src/server.js .env.example test/group-dm.test.js
git commit -m "feat(radar): interruptor RADAR_DM_CLASIFICAR -- fase 1 lee y liga, no interpreta; el hilo se resuelve por identidad

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: El panel — hilos por identidad, con la propiedad y las columnas de las fases siguientes

**Files:**
- Modify: `crm/components/linea-dm-inbox.tsx`
- Modify: `crm/app/(dashboard)/grupos/page.tsx` (consulta ~línea 359-370, resolución de pedido ~línea 380-400, render ~línea 538-590)
- Modify: `crm/lib/calendar-events.ts` (select ~línea 133, `linkChat` ~línea 216)

**Interfaces:**
- Consumes: `linea_dm.remitente_lid` (Task 1). `group_signals.respuesta_refs`, `respondida_at`, `texto_original` (ya existen).
- Produces:
  - `DmMensaje` gana `remitente_lid`, `pedido_respondida_at`, `propiedad` (`{ ref, titulo, link } | null`).
  - `anclaHilo(identidad: { lid: string|null; telefono: string|null })` → `dm-<lid sin sufijo>` o `dm-<telefono>` o `dm-sin-identidad`.
  - `claveHilo(m)` exportada — la misma clave que usa `agruparPorRemitente`.

No hay suite de tests en `crm/`. Verificación: `npx tsc --noEmit` y `npm run lint` desde `crm/`, y una prueba visual con datos de ejemplo (Step 6).

- [ ] **Step 1: Tipos y agrupación por identidad en `linea-dm-inbox.tsx`**

Reemplazar el bloque desde `export type DmMensaje` hasta el final de `agruparPorRemitente`:

```tsx
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
  /** Texto del pedido de grupo que este remitente publicó, si se resolvió
   *  (group_signals.texto_original). Opcional: la consulta cruda de linea_dm
   *  no lo trae, se agrega después en page.tsx. */
  pedido_original?: string | null;
  /** Cuándo le salió el DM del radar a este colega (group_signals.respondida_at).
   *  Es el "desde cuándo esperamos respuesta" — base del tiempo de respuesta
   *  de la fase 3. */
  pedido_respondida_at?: string | null;
  /** La propiedad que se le ofreció en ese DM (group_signals.respuesta_refs[0]
   *  → properties). Es lo que convierte esto en seguimiento de propiedades y
   *  no en un inbox más. */
  propiedad?: { ref: string; titulo: string | null; link: string | null } | null;
};

const AVANCE_LABEL: Record<string, { texto: string; clase: string }> = {
  cita_confirmada: { texto: "📅 Cita confirmada", clase: "bg-emerald-50 text-emerald-700" },
  agendando: { texto: "🗓️ Coordinando visita", clase: "bg-amber-50 text-amber-700" },
  interes_avanzado: { texto: "🔥 Posible venta", clase: "bg-rose-50 text-rose-700" },
};

export type IdentidadHilo = { lid: string | null; telefono: string | null };

/** La clave del hilo: el lid si lo hay, si no el teléfono. Un lid y un
 *  teléfono con los mismos dígitos son dos personas distintas. */
export function claveHilo(m: Pick<DmMensaje, "remitente_lid" | "remitente_telefono">): string | null {
  return m.remitente_lid || m.remitente_telefono || null;
}

/** id estable del anchor de un hilo — el mismo que usa calendar-events.ts
 *  para el link "ver chat" desde el Calendario del equipo. Sin el sufijo
 *  `@lid` para que sea un id de HTML válido. */
export function anclaHilo(identidad: IdentidadHilo): string {
  if (identidad.lid) return `dm-${identidad.lid.replace(/@lid$/, "")}`;
  if (identidad.telefono) return `dm-${identidad.telefono}`;
  return "dm-sin-identidad";
}

type Hilo = {
  identidad: IdentidadHilo;
  nombre: string | null;
  mensajes: DmMensaje[];
  avanceMasReciente: DmMensaje | null;
};

function agruparPorRemitente(mensajes: DmMensaje[]): Hilo[] {
  const porClave = new Map<string, DmMensaje[]>();
  for (const m of mensajes) {
    const key = claveHilo(m) || `sin-identidad:${m.id}`;
    if (!porClave.has(key)) porClave.set(key, []);
    porClave.get(key)!.push(m);
  }
  const hilos: Hilo[] = [];
  for (const lista of porClave.values()) {
    lista.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const avance = [...lista].reverse().find((m) => m.tiene_cita && m.avance_tipo && m.avance_tipo !== "ninguno") || null;
    hilos.push({
      identidad: { lid: lista[0].remitente_lid, telefono: lista[0].remitente_telefono },
      nombre: lista[lista.length - 1].remitente_nombre,
      mensajes: lista,
      avanceMasReciente: avance,
    });
  }
  // Más reciente actividad primero.
  hilos.sort(
    (a, b) =>
      new Date(b.mensajes[b.mensajes.length - 1].created_at).getTime() -
      new Date(a.mensajes[a.mensajes.length - 1].created_at).getTime()
  );
  return hilos;
}
```

- [ ] **Step 2: El componente `Hilo` con la propiedad, la fecha del DM y las columnas en gris**

Reemplazar la función `Hilo` completa:

```tsx
/** Una celda de "todavía no": la columna existe desde la fase 1 para que el
 *  panel no cambie de forma cuando la fase que la llena se prenda. */
function Pendiente({ etiqueta, fase }: { etiqueta: string; fase: string }) {
  return (
    <span className="text-xs text-slate-400" title={`Se llena en la ${fase}`}>
      {etiqueta}: —
    </span>
  );
}

function Hilo({ hilo }: { hilo: Hilo }) {
  const ultimo = hilo.mensajes[hilo.mensajes.length - 1];
  const badge = hilo.avanceMasReciente?.avance_tipo ? AVANCE_LABEL[hilo.avanceMasReciente.avance_tipo] : null;
  const conPedido = hilo.mensajes.find((m) => m.pedido_original || m.propiedad || m.pedido_respondida_at);
  const pedido = conPedido?.pedido_original ?? null;
  const propiedad = conPedido?.propiedad ?? null;
  const dmSalio = conPedido?.pedido_respondida_at ?? null;
  const quien = hilo.nombre || (hilo.identidad.telefono ? `+${hilo.identidad.telefono}` : null) || "Colega sin nombre";

  return (
    <details id={anclaHilo(hilo.identidad)} className="group scroll-mt-24 px-4 py-3 open:bg-slate-50">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">
            {quien}
            {propiedad ? (
              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-600">
                Ref {propiedad.ref}
              </span>
            ) : (
              <span className="ml-2 text-xs font-normal text-slate-400">sin propiedad ligada</span>
            )}
          </p>
          <p className="truncate text-sm text-slate-500">{ultimo.texto || "(imagen o adjunto)"}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {badge ? (
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge.clase}`}>{badge.texto}</span>
          ) : (
            <Pendiente etiqueta="Cita" fase="fase 2 (clasificador)" />
          )}
          <span className="text-xs text-slate-400">{fechaHoraLarga(ultimo.created_at)}</span>
        </div>
      </summary>

      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
        {propiedad ? (
          <p className="rounded bg-slate-100 px-3 py-2 text-sm text-slate-600">
            <span className="font-medium">Propiedad ofrecida: </span>
            {propiedad.link ? (
              <a href={propiedad.link} target="_blank" rel="noreferrer" className="underline">
                {propiedad.titulo || `Ref ${propiedad.ref}`}
              </a>
            ) : (
              propiedad.titulo || `Ref ${propiedad.ref}`
            )}
          </p>
        ) : null}
        {pedido ? (
          <p className="rounded bg-slate-100 px-3 py-2 text-sm text-slate-600">
            <span className="font-medium">Pedido original: </span>
            {pedido}
          </p>
        ) : (
          <p className="text-xs text-slate-400">Sin pedido ligado — puede ser alguien que nunca publicó, o un pedido anterior al 4-sep.</p>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          {dmSalio ? <span>DM enviado: {fechaHoraLarga(dmSalio)}</span> : <span className="text-slate-400">DM enviado: —</span>}
          <Pendiente etiqueta="Tiempo hasta responder" fase="fase 3 (tiempos)" />
        </div>
        {hilo.mensajes.map((m) => (
          <div key={m.id} className="flex items-baseline justify-between gap-3 text-sm">
            <p className="min-w-0 flex-1 text-slate-700">{m.texto || "(imagen o adjunto)"}</p>
            <span className="shrink-0 text-xs text-slate-400">{fechaHoraLarga(m.created_at)}</span>
          </div>
        ))}
      </div>
    </details>
  );
}
```

Y en `LineaDmInbox`, el estado vacío y la key del hilo:

```tsx
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
        <Hilo key={claveHilo(h.mensajes[0]) || h.mensajes[0].id} hilo={h} />
      ))}
    </div>
  );
```

- [ ] **Step 3: La consulta y la resolución en `page.tsx`**

**3a. Sacar el inbox del bloque admin.** La consulta (~línea 359) hoy es `const [dmRes, ventasRes] = admin ? await Promise.all([...]) : [null, null];`. Separarla en dos:

```tsx
  // Inbox de la línea: lo ve TODO el equipo (Juan, 2026-09-08). Seguimiento
  // de propiedades es trabajo diario de la asesora que atiende la línea, no
  // una decisión sobre la privacidad de nadie — mismo criterio que
  // /api/grupos/venta. La política RLS "team read" ya lo permite.
  const dmRes = await fetchSafe<DmMensaje>(
    supabase
      .from("linea_dm")
      .select("id, remitente_telefono, remitente_lid, remitente_nombre, texto, created_at, tiene_cita, avance_tipo, cita_fecha_hora_iso, senal_id")
      .order("created_at", { ascending: false })
      .limit(300),
    "grupos:linea_dm"
  );

  // "Posibles ventas" sigue admin-only: son cifras de toda la organización.
  const ventasRes = admin
    ? await fetchSafe<PosibleVenta>(
        supabase
          .from("visita_venta_alertas")
          .select("id, ref, visita_quien, visita_origen, visita_fecha_hora_iso, alertado_at, estado")
          .order("alertado_at", { ascending: false })
          .limit(200),
        "grupos:visita_venta_alertas"
      )
    : null;
```

**3b. Resolver pedido + propiedad + fecha del DM.** Reemplazar el bloque "Pedido original de cada hilo de DM" (~líneas 380-400):

```tsx
  // Pedido original, fecha del DM y propiedad ofrecida de cada hilo, via
  // group_signals.senal_id (un solo viaje a la base para todos los hilos).
  // La consulta sigue pasando por mias(): un asesor ve el pedido solo si la
  // señal es suya; el hilo se ve igual, con "sin pedido ligado".
  const dmMensajes = dmRes?.data || [];
  const idsSeñalDm = [...new Set(dmMensajes.map((m) => m.senal_id).filter(Boolean))] as string[];
  type SeñalHilo = { id: string; texto_original: string | null; respondida_at: string | null; respuesta_refs: string[] | null };
  const señalPorId = new Map<string, SeñalHilo>();
  if (idsSeñalDm.length > 0) {
    // select("*") y no una lista de columnas: con una lista angosta el
    // helper generico de mias() dispara TS2589 (no logra resolver el tipo
    // de retorno). El aislamiento por asesor sigue siendo el mismo filtro,
    // sin excepciones — ver test/crm-grupos-aislamiento.test.js.
    const { data: señales } = await mias(
      supabase.from("group_signals").select("*").in("id", idsSeñalDm)
    );
    for (const s of (señales || []) as SeñalHilo[]) señalPorId.set(s.id, s);
  }

  // La propiedad que se le ofreció: el primer ref de respuesta_refs (lo que
  // de verdad salió en el DM, no todo `matches`). Título/link se leen de
  // `properties` al mostrar, nunca se arrastran: precio y disponibilidad
  // pueden haber cambiado.
  const refsDm = [...new Set([...señalPorId.values()].map((s) => s.respuesta_refs?.[0]).filter(Boolean))] as string[];
  const propiedadDmPorRef = new Map<string, { ref: string; titulo: string | null; link: string | null }>();
  if (refsDm.length > 0) {
    const { data: props } = await supabase.from("properties").select("ref, titulo, link").in("ref", refsDm);
    for (const p of props || []) {
      propiedadDmPorRef.set(p.ref as string, { ref: p.ref as string, titulo: p.titulo as string | null, link: p.link as string | null });
    }
  }

  const dmConPedido: DmMensaje[] = dmMensajes.map((m) => {
    const s = m.senal_id ? señalPorId.get(m.senal_id) : undefined;
    const ref = s?.respuesta_refs?.[0] ?? null;
    return {
      ...m,
      pedido_original: s?.texto_original ?? null,
      pedido_respondida_at: s?.respondida_at ?? null,
      propiedad: ref ? propiedadDmPorRef.get(ref) ?? { ref, titulo: null, link: null } : null,
    };
  });
```

**3c. El render.** El bloque `{admin && (<section className="grid gap-4 lg:grid-cols-3">...)}` tiene tres tarjetas: Posibles ventas, Inbox de la línea, Mensajes por asesora. Sacar la tarjeta del inbox de ese `section` y ponerla en un `section` propio **antes** del bloque admin, visible para todos:

```tsx
      {/* Inbox de la línea -- lo ve todo el equipo (Juan, 2026-09-08). Es el
          panel de seguimiento de propiedades: cada hilo es colega + pedido +
          propiedad ofrecida. Las columnas de las fases 2-3 ya están, en gris. */}
      <section>
        <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
            <h2
              className="font-display text-sm font-bold text-slate-900"
              title="Respuestas de colegas a los DM del radar, por hilo. Solo lectura: nadie responde desde acá. Los mensajes se guardan desde el 2026-09-08."
            >
              Inbox de la línea
            </h2>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">
              {dmConPedido.length} mensaje{dmConPedido.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {dmRes.hasError && <ErrorBanner message={dmRes.message} />}
            <LineaDmInbox mensajes={dmConPedido} embebido />
          </div>
        </div>
      </section>

      {admin && (
        <section className="grid gap-4 lg:grid-cols-2">
          {/* Posibles ventas ... (sin cambios) */}
          {/* Mensajes por asesora ... (sin cambios) */}
        </section>
      )}
```

El `grid` del bloque admin pasa de `lg:grid-cols-3` a `lg:grid-cols-2` porque quedan dos tarjetas. Los `dmRes?.hasError` que había pasan a `dmRes.hasError` (ya no es nullable).

- [ ] **Step 4: El link del calendario en `calendar-events.ts`**

Select (~línea 133): agregar `remitente_lid`:

```ts
      .select("id, remitente_nombre, remitente_telefono, remitente_lid, cita_fecha_hora_iso, avance_tipo, senal_id")
```

Tipo `LineaDmAvance` (~línea 84): agregar `remitente_lid: string | null;`.

`linkChat` (~línea 216) — reemplazar la línea y su comentario:

```ts
      // Misma ancla que crm/components/linea-dm-inbox.tsx#anclaHilo (se
      // importa, no se duplica): lid sin sufijo si lo hay, si no el teléfono.
      linkChat: `/grupos#${anclaHilo({ lid: m.remitente_lid, telefono: m.remitente_telefono })}`,
```

Y el import al inicio del archivo:

```ts
import { anclaHilo } from "@/components/linea-dm-inbox";
```

`linea-dm-inbox.tsx` es `"use client"`; importar una función pura desde un módulo de servidor es válido en Next 16 (no arrastra el componente). Si `tsc` o el build se quejan, mover `anclaHilo`, `claveHilo` e `IdentidadHilo` a `crm/lib/linea-dm-hilo.ts` y que ambos archivos importen de ahí.

- [ ] **Step 5: Typecheck y lint**

Run (desde `crm/`):
```bash
npx tsc --noEmit && npm run lint
```
Expected: sin errores. Si `tsc` marca `TS2589` en la consulta de `group_signals`, ya está el `select("*")` — verificar que no se cambió por una lista de columnas.

- [ ] **Step 6: Verificación visual con datos de ejemplo**

Sin filas reales en `linea_dm` el panel muestra el vacío. Para ver un hilo armado, insertar UNA fila de prueba en la Supabase de desarrollo (no en producción) ligada a una señal existente con `respuesta_refs`:

```sql
insert into linea_dm (org_id, sesion, wa_message_id, remitente_lid, remitente_nombre, texto, fecha_mensaje, senal_id)
select org_id, 'PRUEBA', 'wamid-prueba-1', '276467766300904@lid', 'Colega de prueba', 'Hola, me interesa, ¿se puede ver el jueves?', now(), id
from group_signals where respuesta_destino_lid = '276467766300904@lid' order by created_at desc limit 1;
```

Levantar el CRM (`npm run dev` en `crm/`, puerto 3100), abrir `/grupos` con un usuario NO admin y otro admin, y confirmar:
- El hilo aparece para los dos, con "Ref …" en la cabecera y "Propiedad ofrecida" abierto.
- "Cita: —" y "Tiempo hasta responder: —" en gris.
- "DM enviado: <fecha>" con la fecha de `respondida_at`.
- Para el no-admin cuya señal no es suya: el hilo se ve, con "sin pedido ligado".

Borrar la fila de prueba después:

```sql
delete from linea_dm where wa_message_id = 'wamid-prueba-1';
```

- [ ] **Step 7: Commit**

```bash
git add crm/components/linea-dm-inbox.tsx "crm/app/(dashboard)/grupos/page.tsx" crm/lib/calendar-events.ts
git commit -m "feat(crm): el inbox de la linea agrupa por identidad, muestra la propiedad ofrecida y lo ve todo el equipo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Documentación del estado y verificación en producción

**Files:**
- Modify: `CLAUDE.md` (sección 2 "Estado actual")
- Modify: `docs/superpowers/specs/2026-09-08-linea-dm-lid-y-seguimiento-design.md` (sección 9, marcar lo verificado)

Esta tarea no tiene tests: es el cierre operativo. Los pasos 2-4 los hace Juan o quien tenga acceso a Supabase y Railway; el plan los deja escritos para que nadie declare "corrido" lo que no se verificó.

- [ ] **Step 1: Correr toda la suite del bot una vez más**

Run (desde la raíz): `npm test`
Expected: PASS completo.

- [ ] **Step 2: Correr la migración en Supabase y verificarla por REST**

Correr `db/migrations/2026-09-08_linea_dm_lid.sql` en el SQL editor de Supabase (proyecto `qwqmlmyyswpdypdfvmiv`). Después, con las claves de producción (`railway run --service diamond node -e "..."`), confirmar que la columna existe:

```js
// verificación de solo lectura
const s = require("./src/data/supabase");
s.from("linea_dm").select("remitente_lid").limit(1).then(({ error }) =>
  console.log(error ? `FALTA: ${error.message}` : "OK: remitente_lid existe"));
```

Expected: `OK: remitente_lid existe`. Un `42703` significa que la migración no corrió — **no desplegar hasta que esté**.

- [ ] **Step 3: Actualizar el CLAUDE.md**

En la sección 2 "Estado actual", agregar al bloque de migraciones:

```
  `2026-09-08_linea_dm_lid.sql` (columna `remitente_lid` en `linea_dm`)
  corrida y verificada por REST el 2026-09-08.
```

Y un ítem nuevo al inicio de la sección:

```
- **La línea de Natalia empezó a recibir respuestas (2026-09-08).** Los DM
  del radar salen a `<lid>@lid` y el webhook solo aceptaba `@c.us`: toda
  respuesta de un colega moría en la primera línea, en silencio, desde el
  2026-08-21. `linea_dm` tenía 0 filas. Ahora entra `@lid`, se guarda con
  `remitente_lid`, se liga al pedido por `respuesta_destino_lid` y se ve en
  `/grupos` (todo el equipo). El clasificador de citas
  (`RADAR_DM_CLASIFICAR`) está **apagado** — fase 1 es leer. No hay
  backfill: lo anterior no quedó en ningún lado. Spec y plan en
  `docs/superpowers/`. **Supuesto no probado:** que la respuesta llegue
  etiquetada `@lid`; si en 48 h no entra ninguna fila, mirar los eventos
  crudos de WAHA.
```

- [ ] **Step 4: Desplegar y observar**

```bash
git push origin main
```

Railway despliega el bot; Vercel el CRM. Confirmar en el log de Railway la línea `[linea-dm] clasificador apagado — fase 1, solo lectura (RADAR_DM_CLASIFICAR)`.

Esperar la primera respuesta real de un colega. Verificar con `railway run --service diamond node -e "..."`:

```js
const s = require("./src/data/supabase");
s.from("linea_dm").select("id, remitente_lid, remitente_telefono, senal_id, created_at").order("created_at", { ascending: false }).limit(5)
  .then(({ data, error }) => console.log(error ? error.message : JSON.stringify(data, null, 2)));
```

Expected: al menos una fila con `remitente_lid` no nulo y `senal_id` no nulo. Si `senal_id` es NULL pero `remitente_lid` no: la atribución falló — comparar el lid guardado con `group_signals.respuesta_destino_lid` (¿mismo formato, con sufijo?).

Si en 48 h no hay ninguna fila: pedir a WAHA los últimos eventos de la sesión y mirar el `from` de un mensaje entrante de un colega al que se le mandó DM. Ese es el único supuesto de la spec que no se pudo probar antes de desplegar.

- [ ] **Step 5: Commit de la documentación**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-09-08-linea-dm-lid-y-seguimiento-design.md
git commit -m "docs(radar): la linea de Natalia recibe respuestas por @lid -- estado, migracion verificada y supuesto pendiente

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

**Cobertura de la spec:**
- 5.1 puerta → Task 3. 5.2 identidad + migración → Task 1. 5.3 atribución → Task 2 + Task 4. 5.4 interruptor → Task 4. 5.5 panel (agrupación, propiedad, fecha DM, columnas en gris, admin-only fuera, vacío con fecha, ancla del calendario) → Task 5. 5.6 (lo que no se toca) → ningún task toca `visitas.js`, `leads.cita`, ni envío. 7 degradación → Task 1 (`columnaDeIdentidad` null → `[]`), Task 5 (`sin propiedad ligada` / `sin pedido ligado` / `(imagen o adjunto)`). 8 tests → 1 (Task 3), 2 (Task 3), 3 (Task 2), 4 (Task 4), 5 (Task 1), 6 (Task 5 — sin suite en CRM, se cubre con la verificación visual del Step 6). 9 verificación → Task 6.
- Un hueco cerrado en el plan: la spec dice "si faltara la columna, la consulta por lid devuelve vacío y avisa una vez por proceso". Task 1 devuelve vacío por `esTablaFaltante` solo para 42P01/PGRST205; un 42703 (columna faltante) hoy lanzaría. Es aceptable porque Task 6 exige verificar la migración antes de desplegar, y el `create` con una columna desconocida falla ruidoso en el log — mejor que en silencio.

**Placeholders:** ninguno. Todo paso con código lo muestra.

**Consistencia de nombres:** `columnaDeIdentidad` (Task 1) ↔ usado solo dentro de `linea-dm.js`. `identidad = { telefono, lid }` (Task 1) ↔ Task 4 construye exactamente ese shape. `remitenteLid` (Task 1 `create`) ↔ Task 3 lo emite ↔ Task 4 lo pasa. `buscarPorLid(orgId, lid)` (Task 2) ↔ Task 4 lo llama con `identidad.lid`. `_identidadDM` (Task 3) ↔ test en Task 3. `clasificadorActivo` (Task 4) ↔ `server.js` y test. `anclaHilo(identidad)` / `claveHilo(m)` / `IdentidadHilo` (Task 5) ↔ `calendar-events.ts` en la misma task.
