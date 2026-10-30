# Pendientes por Excel — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada asesora reciba a las 8 a. m. y a las 2 p. m. un Excel con las personas por contactar, lo devuelva lleno al número de Sofi, y Sofi lo valide y aplique en el CRM (cita confirmada, estado del lead, nota del chat).

**Architecture:** Tabla nueva `contactos_pendientes` como fuente de verdad. `scheduler/sin-respuesta.js` crea los pendientes. `scheduler/excel-pendientes.js` arma y envía el Excel (exceljs). `engine.js` reconoce el .xlsx que devuelve una asesora y lo pasa a `lib/devolucion-excel.js`, que lee (`lib/pendientes-excel.js`), valida y aplica (`lib/aplicar-pendiente.js`).

**Tech Stack:** Node.js (CommonJS), Supabase (supabase-js), WhatsApp Cloud API, exceljs 4.4.0, `node --test`.

Spec: `docs/superpowers/specs/2026-10-30-pendientes-excel-asesoras-design.md`.

## Global Constraints

- Código en inglés o español como el resto del módulo (este repo usa español en nombres de dominio: `pendiente`, `asesora`); textos visibles en español de Colombia, **tuteo** (nunca voseo).
- Hacia el colega o el cliente, el asesor es "Asesor N" (`identidad-publica.js`); hacia adentro, el nombre real.
- Links a fichas: `linkWasi` (`info.wasi.co/…?shared=whatsapp`), nunca armados a mano.
- Sin la tabla `contactos_pendientes` todo falla cerrado: `sin-respuesta.js` sigue como hoy (avisos de a uno) y no sale ningún Excel.
- Interruptor `PENDIENTES_EXCEL` (apagado salvo `"true"`). No lo apaga `ASESORA_SOLO_VISITAS`.
- Horario: L-S, Excel a las 8:00 y a las 14:00 hora de Bogotá; tope 40 filas por Excel.
- Nunca correr migraciones ni scripts con escritura contra producción: la migración la corre Juan.
- Commits en español con prefijo convencional y la línea `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Tabla y capa de datos `contactos_pendientes`

**Files:**
- Create: `db/migrations/2026-10-30_contactos_pendientes.sql`
- Create: `src/data/contactos-pendientes.js`
- Modify: `src/data/memory.js` (agregar `contactosPendientes: []`)
- Test: `test/contactos-pendientes-data.test.js`

**Interfaces:**
- Produces:
  - `abrir({ orgId, leadId, conversationId, asesorId, motivo })` → `{ pendiente, nuevo }` (si el lead ya tiene uno abierto lo devuelve con `nuevo:false` y actualiza `motivo`).
  - `abiertos(orgId)` → filas con estado `pendiente|enviado`, por `created_at`.
  - `porCodigos(orgId, codigos)` → filas.
  - `marcarEnviados(ids, { loteId, asesorId })`.
  - `cerrar(id, { estado, resultado, nota, por, intentos, archivoUrl })` → fila | null (solo si seguía abierta).
  - `volverAPendiente(id, { intentos, nota, por })` → fila | null.
  - `resolverPorLead(leadId, resultado)` → número de filas.
  - `disponible()` → boolean (false si la tabla no existe; se cachea).
  - Fila: `{ id, codigo, org_id, lead_id, conversation_id, asesor_id, motivo, estado, intentos, lote_id, enviado_at, resultado, nota, resuelto_at, resuelto_por, archivo_url, created_at }`.

- [ ] **Step 1: Migración**

```sql
-- Pendientes de contactar por la asesora (spec 2026-10-30-pendientes-excel-asesoras).
-- Los crea scheduler/sin-respuesta.js; los manda scheduler/excel-pendientes.js
-- en un Excel a las 8 a. m. y 2 p. m.; los cierra la devolucion del Excel.
create sequence if not exists contactos_pendientes_seq;
create table if not exists contactos_pendientes (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default ('C-' || lpad(nextval('contactos_pendientes_seq')::text, 4, '0')),
  org_id uuid not null references organizations(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  asesor_id uuid references advisors(id) on delete set null,
  motivo text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente','enviado','resuelto','cerrado')),
  intentos int not null default 0,
  lote_id text,
  enviado_at timestamptz,
  resultado text,
  nota text,
  resuelto_at timestamptz,
  resuelto_por text,
  archivo_url text,
  created_at timestamptz not null default now()
);
create unique index if not exists contactos_pendientes_uno_abierto on contactos_pendientes (lead_id) where estado in ('pendiente','enviado');
create index if not exists contactos_pendientes_org_estado on contactos_pendientes (org_id, estado);
alter table contactos_pendientes enable row level security;
drop policy if exists "team read" on contactos_pendientes;
create policy "team read" on contactos_pendientes for select to authenticated using (true);
```

- [ ] **Step 2: Test que falla** (`test/contactos-pendientes-data.test.js`, en memoria):

```js
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const cp = require("../src/data/contactos-pendientes");

beforeEach(() => { memory.contactosPendientes.length = 0; });

test("abrir crea uno con código y no duplica el abierto del mismo lead", async () => {
  const a = await cp.abrir({ orgId: "o1", leadId: "l1", conversationId: "c1", asesorId: "a1", motivo: "no_contesto" });
  assert.strictEqual(a.nuevo, true);
  assert.match(a.pendiente.codigo, /^C-\d{4}$/);
  const b = await cp.abrir({ orgId: "o1", leadId: "l1", conversationId: "c1", asesorId: "a1", motivo: "pide_asesor" });
  assert.strictEqual(b.nuevo, false);
  assert.strictEqual(b.pendiente.id, a.pendiente.id);
  assert.strictEqual(b.pendiente.motivo, "pide_asesor");
});

test("enviar, cerrar una sola vez y volver a pendiente", async () => {
  const { pendiente } = await cp.abrir({ orgId: "o1", leadId: "l1", asesorId: "a1", motivo: "no_contesto" });
  await cp.marcarEnviados([pendiente.id], { loteId: "L1", asesorId: "a2" });
  const [e] = await cp.porCodigos("o1", [pendiente.codigo]);
  assert.deepStrictEqual([e.estado, e.lote_id, e.asesor_id], ["enviado", "L1", "a2"]);
  const v = await cp.volverAPendiente(pendiente.id, { intentos: 1, nota: "no contesta", por: "Daiana" });
  assert.deepStrictEqual([v.estado, v.intentos], ["pendiente", 1]);
  assert.ok(await cp.cerrar(pendiente.id, { estado: "resuelto", resultado: "visita", por: "Daiana" }));
  assert.strictEqual(await cp.cerrar(pendiente.id, { estado: "resuelto", resultado: "visita", por: "Daiana" }), null);
  assert.strictEqual((await cp.abiertos("o1")).length, 0);
});

test("resolverPorLead cierra el abierto cuando la persona vuelve a escribir", async () => {
  await cp.abrir({ orgId: "o1", leadId: "l1", asesorId: "a1", motivo: "no_contesto" });
  assert.strictEqual(await cp.resolverPorLead("l1", "volvio_a_escribir"), 1);
  assert.strictEqual((await cp.abiertos("o1")).length, 0);
});
```

- [ ] **Step 3: Correr y ver que falla:** `node --test test/contactos-pendientes-data.test.js` → FAIL (`Cannot find module`).

- [ ] **Step 4: Implementación** (`src/data/contactos-pendientes.js`):

```js
// Pendientes de contactar por la asesora (spec 2026-10-30). Sin SUPABASE_URL
// usa src/data/memory.js, como el resto de src/data. Si la tabla no existe
// (migracion 2026-10-30_contactos_pendientes sin correr), disponible() da
// false y los que llaman siguen como antes.
const supabase = require("./supabase");
const memory = require("./memory");

const ABIERTOS = ["pendiente", "enviado"];
let tablaAusente = false;
let correlativo = 0;

function esTablaAusente(error) {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || (/contactos_pendientes/.test(String(error.message || "")) && /does not exist|Could not find/i.test(String(error.message || "")));
}
function vigilar(error) {
  if (esTablaAusente(error)) {
    if (!tablaAusente) console.warn("[contactos-pendientes] falta la tabla: correr db/migrations/2026-10-30_contactos_pendientes.sql");
    tablaAusente = true;
  }
  throw error;
}

async function disponible() {
  if (!supabase) return true;
  if (tablaAusente) return false;
  const { error } = await supabase.from("contactos_pendientes").select("id").limit(1);
  if (error && esTablaAusente(error)) { tablaAusente = true; return false; }
  return !error;
}

async function abrir({ orgId, leadId, conversationId = null, asesorId = null, motivo }) {
  if (!supabase) {
    const ya = memory.contactosPendientes.find((p) => p.lead_id === leadId && ABIERTOS.includes(p.estado));
    if (ya) { ya.motivo = motivo; return { pendiente: ya, nuevo: false }; }
    correlativo += 1;
    const fila = {
      id: memory.uid(), codigo: `C-${String(correlativo).padStart(4, "0")}`, org_id: orgId, lead_id: leadId,
      conversation_id: conversationId, asesor_id: asesorId, motivo, estado: "pendiente", intentos: 0,
      lote_id: null, enviado_at: null, resultado: null, nota: null, resuelto_at: null, resuelto_por: null,
      archivo_url: null, created_at: new Date().toISOString(),
    };
    memory.contactosPendientes.push(fila);
    return { pendiente: fila, nuevo: true };
  }
  const { data: ya, error: e1 } = await supabase.from("contactos_pendientes").select("*").eq("lead_id", leadId).in("estado", ABIERTOS).limit(1);
  if (e1) vigilar(e1);
  if (ya && ya[0]) {
    const { data } = await supabase.from("contactos_pendientes").update({ motivo }).eq("id", ya[0].id).select("*").maybeSingle();
    return { pendiente: data || ya[0], nuevo: false };
  }
  const { data, error } = await supabase
    .from("contactos_pendientes")
    .insert({ org_id: orgId, lead_id: leadId, conversation_id: conversationId, asesor_id: asesorId, motivo })
    .select("*").single();
  if (error) vigilar(error);
  return { pendiente: data, nuevo: true };
}

async function abiertos(orgId) {
  if (!supabase) return memory.contactosPendientes.filter((p) => p.org_id === orgId && ABIERTOS.includes(p.estado));
  const { data, error } = await supabase.from("contactos_pendientes").select("*").eq("org_id", orgId).in("estado", ABIERTOS).order("created_at").limit(500);
  if (error) vigilar(error);
  return data || [];
}

async function porCodigos(orgId, codigos) {
  const lista = [...new Set((codigos || []).map((c) => String(c).trim().toUpperCase()).filter(Boolean))];
  if (lista.length === 0) return [];
  if (!supabase) return memory.contactosPendientes.filter((p) => p.org_id === orgId && lista.includes(p.codigo));
  const { data, error } = await supabase.from("contactos_pendientes").select("*").eq("org_id", orgId).in("codigo", lista);
  if (error) vigilar(error);
  return data || [];
}

async function marcarEnviados(ids, { loteId, asesorId }) {
  if (!ids || ids.length === 0) return;
  const patch = { estado: "enviado", lote_id: loteId, asesor_id: asesorId, enviado_at: new Date().toISOString() };
  if (!supabase) {
    for (const p of memory.contactosPendientes) if (ids.includes(p.id) && ABIERTOS.includes(p.estado)) Object.assign(p, patch);
    return;
  }
  const { error } = await supabase.from("contactos_pendientes").update(patch).in("id", ids).in("estado", ABIERTOS);
  if (error) vigilar(error);
}

// Solo si sigue abierto: mandar el mismo Excel dos veces no aplica nada dos veces.
async function actualizarSiAbierto(id, patch) {
  if (!supabase) {
    const p = memory.contactosPendientes.find((x) => x.id === id && ABIERTOS.includes(x.estado));
    if (!p) return null;
    Object.assign(p, patch);
    return p;
  }
  const { data, error } = await supabase.from("contactos_pendientes").update(patch).eq("id", id).in("estado", ABIERTOS).select("*").maybeSingle();
  if (error) vigilar(error);
  return data || null;
}

function cerrar(id, { estado = "resuelto", resultado, nota = null, por = null, intentos, archivoUrl = null }) {
  const patch = { estado, resultado, nota, resuelto_por: por, resuelto_at: new Date().toISOString(), archivo_url: archivoUrl };
  if (intentos !== undefined) patch.intentos = intentos;
  return actualizarSiAbierto(id, patch);
}

function volverAPendiente(id, { intentos, nota = null, por = null }) {
  return actualizarSiAbierto(id, { estado: "pendiente", intentos, nota, resuelto_por: por, resultado: "no_contesta" });
}

async function resolverPorLead(leadId, resultado) {
  const patch = { estado: "resuelto", resultado, resuelto_at: new Date().toISOString(), resuelto_por: "sistema" };
  if (!supabase) {
    let n = 0;
    for (const p of memory.contactosPendientes) if (p.lead_id === leadId && ABIERTOS.includes(p.estado)) { Object.assign(p, patch); n++; }
    return n;
  }
  if (tablaAusente) return 0;
  const { data, error } = await supabase.from("contactos_pendientes").update(patch).eq("lead_id", leadId).in("estado", ABIERTOS).select("id");
  if (error) vigilar(error);
  return (data || []).length;
}

module.exports = { abrir, abiertos, porCodigos, marcarEnviados, cerrar, volverAPendiente, resolverPorLead, disponible, esTablaAusente };
```

Y en `src/data/memory.js`, junto a `preguntasAsesor: [],` agregar `contactosPendientes: [],`.

- [ ] **Step 5: Correr y ver que pasa:** `node --test test/contactos-pendientes-data.test.js` → PASS.
- [ ] **Step 6: Commit** `feat(pendientes): tabla y datos de contactos pendientes`.

---

### Task 2: Armar y leer el Excel (`src/lib/pendientes-excel.js`)

**Files:**
- Modify: `package.json` (`npm install exceljs@4.4.0`)
- Create: `src/lib/pendientes-excel.js`
- Test: `test/pendientes-excel.test.js`

**Interfaces:**
- Produces:
  - `RESULTADOS`: `[{ clave, texto }]` con claves `visita`, `interesado`, `otras_opciones`, `no_contesta`, `no_interesa`, `numero_equivocado`.
  - `armarLibro({ loteId, asesorId, casos })` → `Promise<Buffer>`; caso = `{ codigo, nombre, tipo, whatsapp, porQue, pidio, ofrecido, ultimoSuyo, ultimoSofi, chatUrl }`.
  - `leerLibro(buffer)` → `Promise<{ ok:true, loteId, asesorId, filas:[{ fila, codigo, resultado, fecha, hora, ref, nota }] } | { ok:false, error:"ilegible"|"no_es_nuestro" }>`.
  - `validarFila(fila, { ahora })` → `{ vacia:true } | { ok:true, accion:{ tipo, fechaHoraIso?, ref?, nota } } | { ok:false, error }`.
  - `fechaHoraBogota(fecha, hora, ahora)` → ISO | null.

- [ ] **Step 1: `npm install exceljs@4.4.0`** (agrega la dependencia a `package.json` y `package-lock.json`).

- [ ] **Step 2: Test que falla** (`test/pendientes-excel.test.js`):

```js
const { test } = require("node:test");
const assert = require("node:assert");
const ExcelJS = require("exceljs");
const px = require("../src/lib/pendientes-excel");

const AHORA = new Date("2026-10-30T13:00:00Z"); // vie 8 a. m. Bogota
const caso = (over = {}) => ({ codigo: "C-0001", nombre: "Clara", tipo: "colega", whatsapp: "wa.me/573014521622", porQue: "no le contestó a Sofi", pidio: "Casa en arriendo en El Poblado", ofrecido: "Ref 10414675 https://info.wasi.co/x/10414675?shared=whatsapp", ultimoSuyo: "quiero agendar", ultimoSofi: "¿te sirve el jueves?", chatUrl: "https://crm.x/inbox/c1", ...over });

async function llenar(buffer, valores) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet("Pendientes");
  const col = {};
  ws.getRow(1).eachCell((c, i) => { col[String(c.value)] = i; });
  valores.forEach((v, i) => { for (const [k, x] of Object.entries(v)) ws.getRow(i + 2).getCell(col[k]).value = x; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test("arma el libro, con lista desplegable, y lo vuelve a leer con el lote", async () => {
  const buf = await px.armarLibro({ loteId: "L-1", asesorId: "a1", casos: [caso(), caso({ codigo: "C-0002", nombre: "Luz" })] });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet("Pendientes");
  const colRes = ws.getRow(1).values.indexOf("Resultado");
  assert.strictEqual(ws.getRow(2).getCell(colRes).dataValidation.type, "list");
  const leido = await px.leerLibro(buf);
  assert.deepStrictEqual([leido.ok, leido.loteId, leido.asesorId, leido.filas.length], [true, "L-1", "a1", 2]);
  assert.strictEqual(leido.filas[0].codigo, "C-0001");
});

test("lee lo que llenó la asesora, con fecha y hora como celdas o como texto", async () => {
  const base = await px.armarLibro({ loteId: "L-1", asesorId: "a1", casos: [caso(), caso({ codigo: "C-0002" })] });
  const buf = await llenar(base, [
    { Resultado: "Agendó visita", "Fecha visita": new Date(Date.UTC(2026, 9, 31)), Hora: "10:00 a. m.", "Ref visita": 10414675, Nota: "va con la esposa" },
    { Resultado: "No contesta" },
  ]);
  const { filas } = await px.leerLibro(buf);
  const v = px.validarFila(filas[0], { ahora: AHORA });
  assert.deepStrictEqual(v, { ok: true, accion: { tipo: "visita", fechaHoraIso: "2026-10-31T15:00:00.000Z", ref: "10414675", nota: "va con la esposa" } });
  assert.deepStrictEqual(px.validarFila(filas[1], { ahora: AHORA }).accion.tipo, "no_contesta");
});

test("errores de llenado", () => {
  const f = (o) => ({ fila: 2, codigo: "C-0001", resultado: "", fecha: null, hora: null, ref: "", nota: "", ...o });
  assert.deepStrictEqual(px.validarFila(f({}), { ahora: AHORA }), { vacia: true });
  assert.match(px.validarFila(f({ resultado: "lo llamé" }), { ahora: AHORA }).error, /no es una de las opciones/);
  assert.match(px.validarFila(f({ resultado: "Agendó visita", fecha: "31/10", ref: "1" }), { ahora: AHORA }).error, /falta la hora/);
  assert.match(px.validarFila(f({ resultado: "Agendó visita", hora: "10:00", ref: "1" }), { ahora: AHORA }).error, /falta la fecha/);
  assert.match(px.validarFila(f({ resultado: "Agendó visita", fecha: "29/10/2026", hora: "10:00", ref: "1" }), { ahora: AHORA }).error, /ya pasó/);
  assert.match(px.validarFila(f({ resultado: "Agendó visita", fecha: "31/10", hora: "10:00" }), { ahora: AHORA }).error, /falta la ref/);
  assert.match(px.validarFila(f({ resultado: "Agendó visita", fecha: "mañana", hora: "10:00", ref: "1" }), { ahora: AHORA }).error, /no entiendo la fecha/);
});

test("horas escritas de varias formas", () => {
  const iso = (h) => px.fechaHoraBogota("31/10/2026", h, AHORA);
  assert.strictEqual(iso("15:30"), "2026-10-31T20:30:00.000Z");
  assert.strictEqual(iso("3:30 pm"), "2026-10-31T20:30:00.000Z");
  assert.strictEqual(iso("3 p. m."), "2026-10-31T20:00:00.000Z");
  assert.strictEqual(iso("3"), "2026-10-31T20:00:00.000Z"); // sin am/pm, 1 a 6 se lee de la tarde
  assert.strictEqual(iso("9"), "2026-10-31T14:00:00.000Z");
});

test("un archivo que no es nuestro o no es Excel", async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Hoja1").addRow(["hola"]);
  assert.deepStrictEqual(await px.leerLibro(Buffer.from(await wb.xlsx.writeBuffer())), { ok: false, error: "no_es_nuestro" });
  assert.deepStrictEqual(await px.leerLibro(Buffer.from("no soy un excel")), { ok: false, error: "ilegible" });
});
```

- [ ] **Step 3: Correr y ver que falla:** `node --test test/pendientes-excel.test.js` → FAIL.

- [ ] **Step 4: Implementación** (`src/lib/pendientes-excel.js`):

```js
// El Excel de pendientes de la asesora (spec 2026-10-30 §5-6). Puro: arma el
// libro, lo lee de vuelta y valida cada fila. No toca base ni WhatsApp.
// Columnas por NOMBRE (no por posicion): Excel o Google Sheets pueden
// reordenarlas. Sin la hoja _lote, igual se acepta si trae la columna Codigo:
// el codigo de cada fila es lo que manda (Google Sheets puede soltar la hoja oculta).
const ExcelJS = require("exceljs");

const RESULTADOS = [
  { clave: "visita", texto: "Agendó visita" },
  { clave: "interesado", texto: "Interesado, sigue en conversación" },
  { clave: "otras_opciones", texto: "Quiere otras opciones" },
  { clave: "no_contesta", texto: "No contesta" },
  { clave: "no_interesa", texto: "No le interesa / ya consiguió" },
  { clave: "numero_equivocado", texto: "Número equivocado" },
];

const INFO = [
  ["Código", "codigo", 9], ["Nombre", "nombre", 22], ["Colega / cliente", "tipo", 10], ["WhatsApp", "whatsapp", 22],
  ["Por qué", "porQue", 30], ["Qué pidió", "pidio", 40], ["Qué se le ofreció", "ofrecido", 40],
  ["Lo último que dijo", "ultimoSuyo", 35], ["Lo último de Sofi", "ultimoSofi", 40], ["Chat CRM", "chatUrl", 14],
];
const LLENAR = [["Resultado", "resultado", 28], ["Fecha visita", "fecha", 13], ["Hora", "hora", 10], ["Ref visita", "ref", 11], ["Nota", "nota", 35]];

const GRIS = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEDED" } };
const AMARILLO = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2B3" } };

async function armarLibro({ loteId, asesorId, casos }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Pendientes", { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
  ws.columns = [...INFO, ...LLENAR].map(([header, key, width]) => ({ header, key, width }));
  ws.getRow(1).font = { bold: true };
  const lista = `"${RESULTADOS.map((r) => r.texto).join(",")}"`;
  for (const c of casos) {
    const row = ws.addRow({ ...c, chatUrl: c.chatUrl ? { text: "Abrir chat", hyperlink: c.chatUrl } : "" });
    if (/^wa\.me\//.test(c.whatsapp || "")) row.getCell("whatsapp").value = { text: c.whatsapp, hyperlink: `https://${c.whatsapp}` };
    row.alignment = { vertical: "top", wrapText: true };
    INFO.forEach(([, key]) => { row.getCell(key).fill = GRIS; });
    LLENAR.forEach(([, key]) => { const cell = row.getCell(key); cell.fill = AMARILLO; cell.protection = { locked: false }; });
    row.getCell("resultado").dataValidation = { type: "list", allowBlank: true, formulae: [lista], showErrorMessage: true, errorTitle: "Resultado", error: "Elige una opción de la lista." };
  }
  await ws.protect("", { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, formatRows: true });
  const meta = wb.addWorksheet("_lote", { state: "veryHidden" });
  meta.getCell("A1").value = loteId;
  meta.getCell("B1").value = asesorId;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Valor plano de una celda de exceljs: texto, numero, fecha, link o formula.
function plano(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === "number") return v;
  if (typeof v === "object") {
    if (v.richText) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return plano(v.result);
    if ("text" in v) return plano(v.text);
    return null;
  }
  const s = String(v).trim();
  return s === "" ? null : s;
}
const texto = (v) => { const p = plano(v); return p === null ? "" : String(p).trim(); };

async function leerLibro(buffer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { return { ok: false, error: "ilegible" }; }
  const ws = wb.getWorksheet("Pendientes") || wb.worksheets.find((w) => w.state !== "veryHidden" && w.state !== "hidden");
  if (!ws) return { ok: false, error: "no_es_nuestro" };
  const col = {};
  ws.getRow(1).eachCell((c, i) => { col[texto(c.value).toLowerCase()] = i; });
  if (!col["código"] && !col["codigo"]) return { ok: false, error: "no_es_nuestro" };
  const idx = (nombre) => col[nombre.toLowerCase()];
  const meta = wb.getWorksheet("_lote");
  const filas = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const codigo = texto(row.getCell(idx("Código") || col["codigo"]).value).toUpperCase();
    if (!/^C-\d+$/.test(codigo)) return;
    const celda = (h) => (idx(h) ? plano(row.getCell(idx(h)).value) : null);
    filas.push({ fila: n, codigo, resultado: texto(celda("Resultado")), fecha: celda("Fecha visita"), hora: celda("Hora"), ref: texto(celda("Ref visita")), nota: texto(celda("Nota")) });
  });
  return { ok: true, loteId: meta ? texto(meta.getCell("A1").value) || null : null, asesorId: meta ? texto(meta.getCell("B1").value) || null : null, filas };
}

const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function claveResultado(t) {
  const s = sinTildes(t);
  if (!s) return null;
  if (s.startsWith("agend")) return "visita";
  if (s.startsWith("interes")) return "interesado";
  if (s.includes("otras opciones")) return "otras_opciones";
  if (s.startsWith("no contesta")) return "no_contesta";
  if (s.startsWith("no le interesa") || s.includes("ya consigu")) return "no_interesa";
  if (s.includes("equivocado")) return "numero_equivocado";
  return null;
}

function partesFecha(v, ahora) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return { y: v.getUTCFullYear(), m: v.getUTCMonth() + 1, d: v.getUTCDate() };
  if (typeof v === "number") return partesFecha(new Date(Math.round((v - 25569) * 86400000)), ahora);
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(s);
  if (!m) return undefined; // texto que no es fecha
  const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : ahora.getUTCFullYear();
  return { y, m: +m[2], d: +m[1] };
}

function partesHora(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return { h: v.getUTCHours(), min: v.getUTCMinutes() };
  if (typeof v === "number") { const t = Math.round((v % 1) * 1440); return { h: Math.floor(t / 60), min: t % 60 }; }
  const s = sinTildes(v).replace(/\s+/g, " ");
  const m = /^(\d{1,2})(?:[:.h](\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?$/.exec(s);
  if (!m) return undefined;
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  if (m[3] && m[3].startsWith("p") && h < 12) h += 12;
  if (m[3] && m[3].startsWith("a") && h === 12) h = 0;
  if (!m[3] && h >= 1 && h <= 6) h += 12; // nadie visita a las 3 de la madrugada
  if (h > 23 || min > 59) return undefined;
  return { h, min };
}

// Fecha y hora de Bogota (UTC-5, sin horario de verano) -> ISO UTC.
function fechaHoraBogota(fecha, hora, ahora = new Date()) {
  const f = partesFecha(fecha, ahora);
  const h = partesHora(hora);
  if (!f || !h) return null;
  const dia = new Date(Date.UTC(f.y, f.m - 1, f.d));
  if (isNaN(dia.getTime()) || dia.getUTCMonth() + 1 !== f.m || dia.getUTCDate() !== f.d) return null; // 31/02
  return new Date(Date.UTC(f.y, f.m - 1, f.d, h.h + 5, h.min)).toISOString();
}

function validarFila(fila, { ahora = new Date() } = {}) {
  if (!fila.resultado) return { vacia: true };
  const tipo = claveResultado(fila.resultado);
  if (!tipo) return { ok: false, error: `"${fila.resultado}" no es una de las opciones de la lista` };
  const nota = fila.nota || "";
  if (tipo !== "visita") return { ok: true, accion: { tipo, nota } };
  if (partesFecha(fila.fecha, ahora) === null) return { ok: false, error: "falta la fecha de la visita" };
  if (partesFecha(fila.fecha, ahora) === undefined) return { ok: false, error: `no entiendo la fecha "${fila.fecha}" (escríbela así: 31/10)` };
  if (partesHora(fila.hora) === null) return { ok: false, error: "falta la hora de la visita" };
  if (partesHora(fila.hora) === undefined) return { ok: false, error: `no entiendo la hora "${fila.hora}" (escríbela así: 10:00 a. m.)` };
  const fechaHoraIso = fechaHoraBogota(fila.fecha, fila.hora, ahora);
  if (!fechaHoraIso) return { ok: false, error: "la fecha no existe" };
  if (new Date(fechaHoraIso).getTime() <= ahora.getTime()) return { ok: false, error: "esa fecha y hora ya pasó" };
  const ref = String(fila.ref || "").replace(/\D/g, "");
  if (!ref) return { ok: false, error: "falta la ref de la visita" };
  return { ok: true, accion: { tipo, fechaHoraIso, ref, nota } };
}

module.exports = { RESULTADOS, armarLibro, leerLibro, validarFila, fechaHoraBogota, claveResultado };
```

- [ ] **Step 5: Correr y ver que pasa:** `node --test test/pendientes-excel.test.js` → PASS.
- [ ] **Step 6: Commit** `feat(pendientes): armar y leer el Excel de pendientes`.

---

### Task 3: Aplicar un resultado en el CRM (`src/lib/aplicar-pendiente.js`)

**Files:**
- Create: `src/lib/aplicar-pendiente.js`
- Test: `test/aplicar-pendiente.test.js`

**Interfaces:**
- Consumes: `contactos-pendientes.cerrar/volverAPendiente` (Task 1); `accion` de `validarFila` (Task 2); `confirmar-cita.confirmar({ org, lead, advisor })`.
- Produces: `aplicar({ org, advisor, pendiente, lead, accion, archivoUrl, deps })` → `{ ok:true, resumen } | { ok:false, error }`. `resumen` ∈ `visita|nota|no_contesta|cerrado|descartado|ya_aplicado`. `MAX_INTENTOS = 3`.

- [ ] **Step 1: Test que falla** (`test/aplicar-pendiente.test.js`):

```js
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const cp = require("../src/data/contactos-pendientes");
const { aplicar } = require("../src/lib/aplicar-pendiente");

const ORG = { id: "o1", name: "Diamond" };
const ADV = { id: "a1", name: "Daiana" };
let log, lead, pend;
const deps = () => ({
  actualizarLead: async (id, patch) => { log.push({ lead: patch }); Object.assign(lead, patch); return lead; },
  nota: async (convId, texto) => { log.push({ nota: texto }); },
  confirmarCita: async ({ lead: l, advisor }) => { log.push({ confirmar: l.cita, advisor: advisor.id }); return { ok: true }; },
});

beforeEach(async () => {
  memory.contactosPendientes.length = 0;
  log = [];
  lead = { id: "l1", phone: "573014521622", nombre: "Clara", source: "colega", estado: "nuevo", atencion_pendiente: "sin_respuesta" };
  pend = (await cp.abrir({ orgId: "o1", leadId: "l1", conversationId: "c1", asesorId: "a1", motivo: "no_contesto" })).pendiente;
});

test("agendó visita: crea la cita y la confirma esa asesora", async () => {
  const r = await aplicar({ org: ORG, advisor: ADV, pendiente: pend, lead, accion: { tipo: "visita", fechaHoraIso: "2026-10-31T15:00:00.000Z", ref: "10414675", nota: "con la esposa" }, deps: deps() });
  assert.deepStrictEqual(r, { ok: true, resumen: "visita" });
  const c = log.find((x) => x.confirmar);
  assert.deepStrictEqual([c.confirmar.fecha_hora, c.confirmar.ref, c.confirmar.origen, c.advisor], ["2026-10-31T15:00:00.000Z", "10414675", "excel", "a1"]);
  assert.match(log.find((x) => x.nota).nota, /Daiana \(Excel\): Agendó visita.*ref 10414675.*con la esposa/);
  assert.strictEqual(lead.atencion_pendiente, null);
  assert.strictEqual((await cp.abiertos("o1")).length, 0);
});

test("no contesta: vuelve a la cola; al tercer intento se cierra y el lead queda perdido", async () => {
  const acc = { tipo: "no_contesta", nota: "" };
  assert.strictEqual((await aplicar({ org: ORG, advisor: ADV, pendiente: pend, lead, accion: acc, deps: deps() })).resumen, "no_contesta");
  let [p] = await cp.porCodigos("o1", [pend.codigo]);
  assert.deepStrictEqual([p.estado, p.intentos], ["pendiente", 1]);
  await aplicar({ org: ORG, advisor: ADV, pendiente: p, lead, accion: acc, deps: deps() });
  [p] = await cp.porCodigos("o1", [pend.codigo]);
  const r = await aplicar({ org: ORG, advisor: ADV, pendiente: p, lead, accion: acc, deps: deps() });
  assert.strictEqual(r.resumen, "cerrado");
  assert.strictEqual(lead.estado, "cerrado_perdido");
  assert.strictEqual((await cp.abiertos("o1")).length, 0);
});

test("no le interesa cierra; número equivocado descarta; interesado deja nota", async () => {
  assert.strictEqual((await aplicar({ org: ORG, advisor: ADV, pendiente: pend, lead, accion: { tipo: "no_interesa", nota: "" }, deps: deps() })).resumen, "cerrado");
  assert.strictEqual(lead.estado, "cerrado_perdido");
  const p2 = (await cp.abrir({ orgId: "o1", leadId: "l1", asesorId: "a1", motivo: "x" })).pendiente;
  await aplicar({ org: ORG, advisor: ADV, pendiente: p2, lead, accion: { tipo: "numero_equivocado", nota: "" }, deps: deps() });
  assert.strictEqual(lead.estado, "descartado");
  const p3 = (await cp.abrir({ orgId: "o1", leadId: "l1", asesorId: "a1", motivo: "x" })).pendiente;
  assert.strictEqual((await aplicar({ org: ORG, advisor: ADV, pendiente: p3, lead, accion: { tipo: "interesado", nota: "llamar el lunes" }, deps: deps() })).resumen, "nota");
});

test("aplicar dos veces no duplica", async () => {
  const acc = { tipo: "interesado", nota: "" };
  await aplicar({ org: ORG, advisor: ADV, pendiente: pend, lead, accion: acc, deps: deps() });
  log = [];
  const r = await aplicar({ org: ORG, advisor: ADV, pendiente: pend, lead, accion: acc, deps: deps() });
  assert.deepStrictEqual(r, { ok: true, resumen: "ya_aplicado" });
  assert.strictEqual(log.length, 0);
});
```

- [ ] **Step 2: Correr y ver que falla.**

- [ ] **Step 3: Implementación** (`src/lib/aplicar-pendiente.js`):

```js
// Aplica en el CRM el resultado que la asesora puso en el Excel (spec
// 2026-10-30 §5-6). Cada fila es independiente: lo que falle en una no frena
// las demas. Primero se cierra el pendiente (condicional a que siga abierto):
// si ya lo estaba, no se toca nada y vuelve "ya_aplicado".
const cp = require("../data/contactos-pendientes");
const { RESULTADOS } = require("./pendientes-excel");

const MAX_INTENTOS = 3;
const TEXTO = Object.fromEntries(RESULTADOS.map((r) => [r.clave, r.texto]));

function depsPorDefecto() {
  return {
    actualizarLead: (id, patch) => require("../data/leads").update(id, patch),
    nota: (convId, texto) => require("../data/conversations").appendMessage(convId, "system", texto),
    confirmarCita: (args) => require("./confirmar-cita").confirmar(args),
  };
}

function fechaLegible(iso) {
  return new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

async function aplicar({ org, advisor, pendiente, lead, accion, archivoUrl = null, deps = null }) {
  const d = { ...depsPorDefecto(), ...(deps || {}) };
  const por = advisor.name;
  const limpiar = ["sin_respuesta", "pide_asesor"].includes(lead.atencion_pendiente) ? { atencion_pendiente: null, atencion_desde: null } : {};
  let resumen;
  let patchLead = { ...limpiar };

  if (accion.tipo === "no_contesta") {
    const intentos = (pendiente.intentos || 0) + 1;
    if (intentos >= MAX_INTENTOS) {
      if (!(await cp.cerrar(pendiente.id, { estado: "cerrado", resultado: "no_contesta", nota: accion.nota, por, intentos, archivoUrl }))) return { ok: true, resumen: "ya_aplicado" };
      patchLead.estado = "cerrado_perdido";
      resumen = "cerrado";
    } else {
      if (!(await cp.volverAPendiente(pendiente.id, { intentos, nota: accion.nota, por }))) return { ok: true, resumen: "ya_aplicado" };
      patchLead = {}; // sigue en "Para atender" hasta el proximo intento
      resumen = "no_contesta";
    }
  } else {
    if (!(await cp.cerrar(pendiente.id, { estado: "resuelto", resultado: accion.tipo, nota: accion.nota, por, archivoUrl }))) return { ok: true, resumen: "ya_aplicado" };
    if (accion.tipo === "no_interesa") { patchLead.estado = "cerrado_perdido"; resumen = "cerrado"; }
    else if (accion.tipo === "numero_equivocado") { patchLead.estado = "descartado"; resumen = "descartado"; }
    else if (accion.tipo === "visita") resumen = "visita";
    else resumen = "nota";
  }

  if (Object.keys(patchLead).length) await d.actualizarLead(lead.id, patchLead);

  if (accion.tipo === "visita") {
    const cita = {
      descripcion: `Visita a la ref ${accion.ref} (Excel de ${por})`, tipo: "visita", fecha_hora: accion.fechaHoraIso,
      ref: accion.ref, estado: "propuesta", origen: "excel", creada_at: new Date().toISOString(), asesor_id: advisor.id,
    };
    await d.confirmarCita({ org, lead: { ...lead, ...patchLead, cita }, advisor });
  }

  const detalle = accion.tipo === "visita" ? ` ${fechaLegible(accion.fechaHoraIso)} · ref ${accion.ref}` : "";
  const intento = accion.tipo === "no_contesta" ? ` (intento ${(pendiente.intentos || 0) + 1} de ${MAX_INTENTOS})` : "";
  const notaTxt = accion.nota ? ` · nota: ${accion.nota}` : "";
  if (pendiente.conversation_id) await d.nota(pendiente.conversation_id, `📋 ${por} (Excel): ${TEXTO[accion.tipo]}${detalle}${intento}${notaTxt}`).catch(() => {});
  return { ok: true, resumen };
}

module.exports = { aplicar, MAX_INTENTOS };
```

- [ ] **Step 4: Correr y ver que pasa.**
- [ ] **Step 5: Commit** `feat(pendientes): aplicar en el CRM el resultado del Excel`.

---

### Task 4: La devolución: Sofi recibe el Excel, lo valida, aplica y responde

**Files:**
- Create: `src/lib/devolucion-excel.js`
- Modify: `src/agent/engine.js` (después de `appendMessage` del usuario y del chequeo de `modo === "humano"`)
- Test: `test/devolucion-excel.test.js`

**Interfaces:**
- Consumes: `leerLibro`, `validarFila` (Task 2), `aplicar` (Task 3), `cp.porCodigos` (Task 1).
- Produces:
  - `esExcel({ type, media_mime })` → boolean.
  - `procesar({ org, advisor, mediaUrl, ahora, deps })` → `Promise<string>` (el texto que Sofi le contesta a la asesora).

- [ ] **Step 1: Test que falla** (`test/devolucion-excel.test.js`):

```js
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const ExcelJS = require("exceljs");
const memory = require("../src/data/memory");
const cp = require("../src/data/contactos-pendientes");
const px = require("../src/lib/pendientes-excel");
const dev = require("../src/lib/devolucion-excel");

const ORG = { id: "o1", name: "Diamond" };
const ADV = { id: "a1", name: "Daiana" };
const AHORA = new Date("2026-10-30T13:00:00Z");
let aplicados, p1, p2, p3;

async function excelLleno(valores, { asesorId = "a1" } = {}) {
  const casos = [p1, p2, p3].map((p) => ({ codigo: p.codigo, nombre: "x" }));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await px.armarLibro({ loteId: "L-1", asesorId, casos }));
  const ws = wb.getWorksheet("Pendientes");
  const col = {};
  ws.getRow(1).eachCell((c, i) => { col[String(c.value)] = i; });
  valores.forEach((v, i) => { for (const [k, x] of Object.entries(v)) ws.getRow(i + 2).getCell(col[k]).value = x; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const deps = (buf, over = {}) => ({
  descargar: async () => buf,
  lead: async (_o, id) => ({ id, phone: "57300", source: "colega" }),
  refExiste: async (_o, ref) => ref === "10414675",
  choca: async () => false,
  aplicar: async (a) => { aplicados.push([a.pendiente.codigo, a.accion.tipo]); return { ok: true, resumen: a.accion.tipo === "visita" ? "visita" : "nota" }; },
  ...over,
});

beforeEach(async () => {
  memory.contactosPendientes.length = 0;
  aplicados = [];
  p1 = (await cp.abrir({ orgId: "o1", leadId: "l1", asesorId: "a1", motivo: "no_contesto" })).pendiente;
  p2 = (await cp.abrir({ orgId: "o1", leadId: "l2", asesorId: "a1", motivo: "no_contesto" })).pendiente;
  p3 = (await cp.abrir({ orgId: "o1", leadId: "l3", asesorId: "a2", motivo: "no_contesto" })).pendiente;
});

test("aplica lo válido y le cuenta qué falta corregir", async () => {
  const buf = await excelLleno([
    { Resultado: "Agendó visita", "Fecha visita": "31/10", Hora: "10:00", "Ref visita": "10414675" },
    { Resultado: "Agendó visita", "Fecha visita": "31/10" },
    { Resultado: "Interesado, sigue en conversación" },
  ]);
  const txt = await dev.procesar({ org: ORG, advisor: ADV, mediaUrl: "u", ahora: AHORA, deps: deps(buf) });
  assert.deepStrictEqual(aplicados, [[p1.codigo, "visita"]]);
  assert.match(txt, /apliqué 1/);
  assert.match(txt, new RegExp(`fila 3 \\(${p2.codigo}\\): falta la hora`));
  assert.match(txt, new RegExp(`fila 4 \\(${p3.codigo}\\): no es tuyo`));
});

test("ref inexistente y choque de agenda son errores de la fila", async () => {
  const buf = await excelLleno([
    { Resultado: "Agendó visita", "Fecha visita": "31/10", Hora: "10:00", "Ref visita": "999" },
    { Resultado: "Agendó visita", "Fecha visita": "31/10", Hora: "10:00", "Ref visita": "10414675" },
  ]);
  const txt = await dev.procesar({ org: ORG, advisor: ADV, mediaUrl: "u", ahora: AHORA, deps: deps(buf, { choca: async () => true }) });
  assert.strictEqual(aplicados.length, 0);
  assert.match(txt, /la ref 999 no está en el inventario/);
  assert.match(txt, /ya tienes otra visita a esa hora/);
});

test("sin nada llenado, o un archivo que no es el nuestro", async () => {
  const vacio = await excelLleno([]);
  assert.match(await dev.procesar({ org: ORG, advisor: ADV, mediaUrl: "u", ahora: AHORA, deps: deps(vacio) }), /no veo ningún resultado/);
  assert.match(await dev.procesar({ org: ORG, advisor: ADV, mediaUrl: "u", ahora: AHORA, deps: deps(Buffer.from("x")) }), /no lo pude abrir/);
});

test("reconoce un .xlsx", () => {
  assert.strictEqual(dev.esExcel({ type: "document", media_mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), true);
  assert.strictEqual(dev.esExcel({ type: "document", media_mime: "application/pdf" }), false);
  assert.strictEqual(dev.esExcel({ type: "image", media_mime: "image/jpeg" }), false);
});
```

- [ ] **Step 2: Correr y ver que falla.**

- [ ] **Step 3: Implementación** (`src/lib/devolucion-excel.js`):

```js
// La asesora le devuelve a Sofi el Excel de pendientes (spec 2026-10-30 §6):
// leer, validar cada fila, aplicar lo valido y contestarle con el resumen y lo
// que falta corregir. Una fila con error no frena las demas; las filas sin
// resultado no son error (siguen pendientes).
const px = require("./pendientes-excel");
const cp = require("../data/contactos-pendientes");

const XLSX = /spreadsheetml|ms-excel|\.xlsx?$/i;
function esExcel(extras) {
  return Boolean(extras && extras.type === "document" && XLSX.test(String(extras.media_mime || "") + " " + String(extras.filename || "")));
}

const BLOQUE_MS = () => require("./agenda-reglas").DURACION_MIN * 60 * 1000;

function depsPorDefecto() {
  return {
    descargar: async (url) => Buffer.from(await (await fetch(url)).arrayBuffer()),
    lead: (orgId, id) => require("../data/leads").findById(orgId, id),
    refExiste: async (org, ref) => Boolean(await require("../data/properties").findByRef(org, ref)),
    // ¿La asesora ya tiene una visita viva que se cruce con esta hora?
    choca: async (org, advisor, iso, leadId) => {
      const citasOrg = await require("../data/appointments").citasDeLaOrg(org.id);
      const ocupadas = require("../data/rotacion-citas").ocupadasDe(citasOrg, advisor, { excluirLeadId: leadId });
      const t = new Date(iso).getTime();
      return ocupadas.some((f) => Math.abs(new Date(f).getTime() - t) < BLOQUE_MS());
    },
    aplicar: (args) => require("./aplicar-pendiente").aplicar(args),
  };
}

const RESUMEN = { visita: "visita confirmada", nota: "con nota", no_contesta: "vuelve a salir (no contesta)", cerrado: "cerrado", descartado: "descartado" };

async function procesar({ org, advisor, mediaUrl, ahora = new Date(), deps = null }) {
  const d = { ...depsPorDefecto(), ...(deps || {}) };
  const nombre = String(advisor.name || "").split(/\s+/)[0];
  let buffer;
  try { buffer = await d.descargar(mediaUrl); } catch { buffer = null; }
  const libro = buffer ? await px.leerLibro(buffer) : { ok: false, error: "ilegible" };
  if (!libro.ok) {
    return libro.error === "no_es_nuestro"
      ? `${nombre}, ese Excel no es uno de los de pendientes que te mandé. Devuélveme el que te llegó, con la columna Resultado llena.`
      : `${nombre}, no lo pude abrir. Mándame el archivo de Excel (.xlsx) que te llegó, no una foto ni un PDF.`;
  }
  const conResultado = libro.filas.filter((f) => f.resultado);
  if (conResultado.length === 0) return `${nombre}, recibí el Excel pero no veo ningún resultado llenado. Llena la columna Resultado de las personas que ya contactaste y me lo devuelves.`;

  const pendientes = await cp.porCodigos(org.id, conResultado.map((f) => f.codigo));
  const porCodigo = new Map(pendientes.map((p) => [p.codigo, p]));
  const errores = [];
  const cuenta = {};
  let ya = 0;
  for (const f of conResultado) {
    const err = (msg) => errores.push(`fila ${f.fila} (${f.codigo}): ${msg}`);
    try {
      const p = porCodigo.get(f.codigo);
      if (!p) { err("ese código no existe"); continue; }
      if (p.asesor_id && p.asesor_id !== advisor.id) { err("no es tuyo, es de otra asesora"); continue; }
      if (!["pendiente", "enviado"].includes(p.estado)) { ya++; continue; }
      const v = px.validarFila(f, { ahora });
      if (v.vacia) continue;
      if (!v.ok) { err(v.error); continue; }
      if (v.accion.tipo === "visita") {
        if (!(await d.refExiste(org, v.accion.ref))) { err(`la ref ${v.accion.ref} no está en el inventario`); continue; }
        if (await d.choca(org, advisor, v.accion.fechaHoraIso, p.lead_id)) { err("ya tienes otra visita a esa hora"); continue; }
      }
      const lead = await d.lead(org.id, p.lead_id);
      if (!lead) { err("no encontré a esa persona en el CRM"); continue; }
      const r = await d.aplicar({ org, advisor, pendiente: p, lead, accion: v.accion, archivoUrl: mediaUrl });
      if (r.resumen === "ya_aplicado") { ya++; continue; }
      cuenta[r.resumen] = (cuenta[r.resumen] || 0) + 1;
    } catch (e) {
      console.error("[devolucion-excel] fila", f.fila, e.message);
      err("no la pude aplicar por un error mío; intenta de nuevo más tarde");
    }
  }
  const total = Object.values(cuenta).reduce((a, b) => a + b, 0);
  const partes = Object.entries(cuenta).map(([k, n]) => `${n} ${RESUMEN[k] || k}`).join(", ");
  let txt = total ? `Listo, ${nombre}: apliqué ${total} en el CRM (${partes}).` : `${nombre}, no apliqué nada nuevo.`;
  if (ya) txt += ` ${ya} ya estaban aplicadas de antes.`;
  if (errores.length) txt += `\n\nMe faltan ${errores.length}:\n- ${errores.join("\n- ")}\n\nCorrígelas y devuélveme el Excel cuando quieras.`;
  console.log(`[devolucion-excel] ${advisor.name}: aplicadas=${total} ya=${ya} errores=${errores.length}`);
  return txt;
}

module.exports = { esExcel, procesar };
```

- [ ] **Step 4: Engancharlo en `src/agent/engine.js`.** Justo después del bloque `if (conv.modo === "humano") { ... }`:

```js
  // La asesora devuelve el Excel de pendientes (spec 2026-10-30 §6): Sofi lo
  // lee, lo aplica en el CRM y le contesta el resumen. No pasa por Claude.
  if (advisor && require("../lib/devolucion-excel").esExcel(messageExtras) && messageExtras.media_url) {
    const reply = await require("../lib/devolucion-excel")
      .procesar({ org, advisor, mediaUrl: messageExtras.media_url })
      .catch((e) => { console.error("[engine] devolucion de Excel:", e.message); return "No pude procesar el Excel por un error mío. Intenta de nuevo en un rato."; });
    const msg = await conversations.appendMessage(conv.id, "assistant", reply);
    return { reply, lead, transfer: null, assistantMessageId: msg && msg.id };
  }
```

Y en el mismo archivo, en el bloque que limpia `sin_respuesta` cuando la persona vuelve a escribir, agregar (solo para quien no es asesora):

```js
  if (!advisor) await require("../data/contactos-pendientes").resolverPorLead(lead.id, "volvio_a_escribir").catch(() => 0);
```

Además, en `src/channels/whatsapp.js`, al armar `extras` para un documento, guardar `extras.filename = mediaObj.filename || null;` (el MIME de Meta a veces llega como `application/octet-stream`).

- [ ] **Step 5: Correr** `node --test test/devolucion-excel.test.js` → PASS, y `npm test` completo.
- [ ] **Step 6: Commit** `feat(pendientes): Sofi recibe el Excel devuelto, lo valida y lo aplica`.

---

### Task 5: `sin-respuesta.js` crea pendientes; solo lo urgente sale por WhatsApp

**Files:**
- Modify: `src/scheduler/sin-respuesta.js`
- Test: `test/sin-respuesta.test.js` (agregar)

**Interfaces:**
- Consumes: `cp.disponible()`, `cp.abrir(...)` (Task 1).
- Produces: con la tabla disponible y `PENDIENTES_EXCEL=true`, los motivos `no_contesto` y `sin_seguimiento` solo crean el pendiente y la campana (sin WhatsApp); `pide_asesor` y `nota_de_voz` crean el pendiente y además salen de a uno como hoy. `res.soloExcel` cuenta los primeros.

- [ ] **Step 1: Tests que fallan** (agregar a `test/sin-respuesta.test.js`; los deps nuevos: `pendientes: { disponible: async () => true, abrir: async (a) => { log.push({ abrir: a.motivo }); return { pendiente: { codigo: "C-0001" }, nuevo: true }; } }`, `excelActivo: () => true`):

```js
test("con el Excel encendido, lo no urgente solo queda pendiente y lo urgente sale de a uno", async () => {
  const pend = { disponible: async () => true, abrir: async (a) => { log.push({ abrir: a.motivo }); return { pendiente: { codigo: "C-0001" }, nuevo: true }; } };
  const r = await sched.runOnce({ ahora: AHORA, deps: deps({ pendientes: pend, excelActivo: () => true }) });
  // c1 = Clara (no_contesto) -> solo Excel; c2 = Luz Stella (nota de voz) -> WhatsApp.
  assert.deepStrictEqual(log.filter((x) => x.abrir).map((x) => x.abrir), ["no_contesto", "nota_de_voz"]);
  const wa = log.filter((x) => x.wa);
  assert.strictEqual(wa.length, 1);
  assert.match(wa[0].texto, /Luz Stella/);
  assert.strictEqual(r.soloExcel, 1);
});

test("sin la tabla de pendientes sigue como hoy", async () => {
  const pend = { disponible: async () => false, abrir: async () => { throw new Error("no"); } };
  const r = await sched.runOnce({ ahora: AHORA, deps: deps({ pendientes: pend, excelActivo: () => true }) });
  assert.strictEqual(r.soloExcel, 0);
  assert.strictEqual(log.filter((x) => x.wa).length, 1);
});
```

En `deps()` del test agregar por defecto `pendientes: { disponible: async () => false, abrir: async () => ({}) }, excelActivo: () => false`.

- [ ] **Step 2: Correr y ver que fallan.**

- [ ] **Step 3: Implementación** en `src/scheduler/sin-respuesta.js`:
  - En `depsPorDefecto()` agregar:
    ```js
    pendientes: require("../data/contactos-pendientes"),
    excelActivo: () => /^(true|1|si|sí|on)$/i.test(String(process.env.PENDIENTES_EXCEL || "")),
    ```
  - `res` arranca con `soloExcel: 0`.
  - Antes del loop de conversaciones: `const conExcel = d.excelActivo() && (await d.pendientes.disponible().catch(() => false));`
  - Dentro del loop, después de calcular `paso` y el filtro de agente, y **antes** del chequeo "de a uno":
    ```js
    const urgente = paso.motivo === "pide_asesor" || paso.motivo === "nota_de_voz";
    if (conExcel && !urgente) {
      if (!ciclo) { ciclo = await d.ciclo(org.id).catch(() => []); abiertas = await d.conVentana(org, ciclo, ahora).catch(() => []); }
      const duenaX = ciclo.find((a) => a.id === lead.transferido_advisor_id);
      const advisorX = duenaX || (abiertas.length ? abiertas[turno++ % abiertas.length] : ciclo[0]);
      if (!advisorX || !(await d.claim(lead.id))) continue;
      await d.pendientes.abrir({ orgId: org.id, leadId: lead.id, conversationId: conv.id, asesorId: advisorX.id, motivo: paso.motivo });
      await d.avisarAsesor({ org, advisor: advisorX, motivo: "sin_respuesta", lead, titulo: `Por contactar: ${lead.nombre || `+${lead.phone}`}`, cuerpo: "Va en tu próximo Excel de pendientes.", whatsapp: false }).catch(() => {});
      res.soloExcel++; res.escalados++;
      continue;
    }
    ```
  - Para los urgentes con `conExcel`, después del `claim` exitoso: `await d.pendientes.abrir({ orgId: org.id, leadId: lead.id, conversationId: conv.id, asesorId: advisor.id, motivo: paso.motivo }).catch(() => {});`
  - Actualizar el comentario de cabecera: "Con PENDIENTES_EXCEL y la tabla, lo no urgente va al Excel (scheduler/excel-pendientes.js) y solo lo urgente sale por WhatsApp de a uno".

- [ ] **Step 4: Correr** `node --test test/sin-respuesta.test.js` → PASS.
- [ ] **Step 5: Commit** `feat(pendientes): lo no urgente va al Excel; lo urgente sigue de a uno`.

---

### Task 6: El Excel de las 8 a. m. y las 2 p. m. (`src/scheduler/excel-pendientes.js`)

**Files:**
- Create: `src/lib/caso-pendiente.js` (arma la fila de un pendiente con lo que pidió y lo que se le ofreció)
- Create: `src/scheduler/excel-pendientes.js`
- Modify: `src/channels/whatsapp.js` (`sendWhatsAppTemplate` acepta `headerDocument: { id, filename }`)
- Modify: `src/server.js` (arranque)
- Test: `test/caso-pendiente.test.js`, `test/excel-pendientes-scheduler.test.js`

**Interfaces:**
- Consumes: `cp.abiertos`, `cp.marcarEnviados` (Task 1); `armarLibro` (Task 2); `conVentana` (`src/lib/ventana-asesoras.js`); `POR_QUE` (`src/lib/sin-respuesta.js`); `codigoColega.leerCodigo/resolver`; `properties.findByRef`; `colegas.porTelefono`.
- Produces:
  - `armarCaso({ org, pendiente, lead, mensajes, deps })` → caso para `armarLibro`.
  - `refsDe(textos)` → `string[]` (refs de 7-8 dígitos, sin repetir, en orden).
  - `turnoDe(ahora)` → `"8am" | "2pm" | null` (L-S, 8:00-8:29 y 14:00-14:29 Bogotá).
  - `runOnce({ ahora, deps })` → `{ enviados, filas, porPlantilla, reasignados }`.

- [ ] **Step 1: Tests que fallan.**

`test/caso-pendiente.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { armarCaso, refsDe } = require("../src/lib/caso-pendiente");

test("refsDe saca las refs de los mensajes de Sofi sin repetir", () => {
  assert.deepStrictEqual(refsDe(["la ref 10414675 y la 9944723", "otra vez la 10414675"]), ["10414675", "9944723"]);
});

test("el caso de un colega trae su pedido, lo ofrecido con link de Wasi y el chat", async () => {
  const mensajes = [
    { role: "user", content: "Hola Sofi, sobre mi PEDIDO (cód. U9QT): Hola", created_at: "2026-10-27T12:55:00Z" },
    { role: "assistant", content: "Te pasé la ref 10414675", created_at: "2026-10-27T12:56:00Z" },
  ];
  const caso = await armarCaso({
    org: { id: "o1" }, crmUrl: "https://crm.x",
    pendiente: { codigo: "C-0001", motivo: "no_contesto", conversation_id: "c1" },
    lead: { id: "l1", phone: "573014521622", source: "colega", nombre: null },
    mensajes,
    deps: {
      pedido: async (_o, cod) => (cod === "U9QT" ? { texto_original: "Busco casa en arriendo en El Poblado, 3 alcobas" } : null),
      ficha: async (_o, ref) => ({ ref, tipo: "Casa", zona: "El Poblado", precio: 19900000, linkWasi: `https://info.wasi.co/casa/${ref}?shared=whatsapp` }),
      nombreColega: async () => "Clara Segura",
    },
  });
  assert.strictEqual(caso.nombre, "Clara Segura");
  assert.strictEqual(caso.whatsapp, "wa.me/573014521622");
  assert.match(caso.pidio, /El Poblado, 3 alcobas/);
  assert.match(caso.ofrecido, /Ref 10414675 · Casa · El Poblado · \$19\.900\.000 · https:\/\/info\.wasi\.co\/casa\/10414675\?shared=whatsapp/);
  assert.strictEqual(caso.chatUrl, "https://crm.x/inbox/c1");
});
```

`test/excel-pendientes-scheduler.test.js`:

```js
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const sched = require("../src/scheduler/excel-pendientes");

const A1 = { id: "a1", name: "Daiana", phone: "573011880668" };
const A2 = { id: "a2", name: "Claudia", phone: "573003418113" };
const VIE_8AM = new Date("2026-10-30T13:05:00Z");
let log, filas;
const deps = (over = {}) => ({
  orgs: async () => [{ id: "o1", name: "Diamond" }],
  activo: () => true,
  abiertos: async () => filas,
  ciclo: async () => [A1, A2],
  conVentana: async () => [A1],
  armarCaso: async ({ pendiente }) => ({ codigo: pendiente.codigo, nombre: "x" }),
  lead: async (_o, id) => ({ id, phone: "57300" }),
  mensajes: async () => [],
  armarLibro: async ({ casos }) => Buffer.from(`xlsx:${casos.length}`),
  subir: async () => "media-1",
  documento: async (_o, tel) => { log.push({ doc: tel }); return "wamid-1"; },
  plantilla: async (_o, tel) => { log.push({ plantilla: tel }); return { ok: true }; },
  texto: async (_o, tel, t) => { log.push({ texto: tel, t }); return { ok: true }; },
  marcarEnviados: async (ids, o) => { log.push({ marcados: ids, ...o }); },
  campana: async (a) => { log.push({ campana: a.advisor.id }); },
  nombrePlantilla: null,
  ...over,
});
const fila = (codigo, asesor, over = {}) => ({ id: codigo, codigo, lead_id: `l-${codigo}`, asesor_id: asesor, estado: "pendiente", enviado_at: null, ...over });

beforeEach(() => { log = []; filas = []; });

test("fuera de las 8 a. m. y las 2 p. m., o domingo, no manda nada", async () => {
  filas = [fila("C-1", "a1")];
  assert.strictEqual(sched.turnoDe(new Date("2026-10-30T15:00:00Z")), null);
  assert.strictEqual(sched.turnoDe(new Date("2026-11-01T13:05:00Z")), null); // domingo
  assert.strictEqual(sched.turnoDe(VIE_8AM), "8am");
  assert.strictEqual(sched.turnoDe(new Date("2026-10-30T19:10:00Z")), "2pm");
  const r = await sched.runOnce({ ahora: new Date("2026-10-30T15:00:00Z"), deps: deps() });
  assert.strictEqual(r.enviados, 0);
});

test("sin pendientes no manda nada", async () => {
  const r = await sched.runOnce({ ahora: VIE_8AM, deps: deps() });
  assert.strictEqual(r.enviados, 0);
  assert.strictEqual(log.length, 0);
});

test("cada una lo suyo; la de ventana cerrada sin plantilla pasa a la que la tiene abierta", async () => {
  filas = [fila("C-1", "a1"), fila("C-2", "a2"), fila("C-3", "a1")];
  const r = await sched.runOnce({ ahora: VIE_8AM, deps: deps() });
  assert.deepStrictEqual([r.enviados, r.filas, r.reasignados], [1, 3, 1]);
  assert.deepStrictEqual(log.filter((x) => x.doc).map((x) => x.doc), ["573011880668"]);
  const m = log.find((x) => x.marcados);
  assert.deepStrictEqual([m.marcados.sort(), m.asesorId], [["C-1", "C-2", "C-3"], "a1"]);
  assert.match(log.find((x) => x.texto).t, /Daiana, tienes 3 personas por contactar/);
});

test("con plantilla, a la de ventana cerrada le llega por plantilla", async () => {
  filas = [fila("C-1", "a1"), fila("C-2", "a2")];
  const r = await sched.runOnce({ ahora: VIE_8AM, deps: deps({ nombrePlantilla: "pendientes_contacto" }) });
  assert.deepStrictEqual([r.enviados, r.porPlantilla], [2, 1]);
  assert.deepStrictEqual(log.filter((x) => x.plantilla).map((x) => x.plantilla), ["573003418113"]);
});

test("no repite el Excel del mismo turno si ya salió (reinicio del servidor)", async () => {
  filas = [fila("C-1", "a1", { estado: "enviado", enviado_at: "2026-10-30T13:01:00Z" })];
  const r = await sched.runOnce({ ahora: VIE_8AM, deps: deps() });
  assert.strictEqual(r.enviados, 0);
});

test("lo del Excel de la mañana que no volvió sale otra vez a las 2 p. m.", async () => {
  filas = [fila("C-1", "a1", { estado: "enviado", enviado_at: "2026-10-30T13:01:00Z" })];
  const r = await sched.runOnce({ ahora: new Date("2026-10-30T19:05:00Z"), deps: deps() });
  assert.strictEqual(r.enviados, 1);
});

test("si nadie tiene la ventana abierta ni hay plantilla, va por la campana", async () => {
  filas = [fila("C-1", "a1")];
  const r = await sched.runOnce({ ahora: VIE_8AM, deps: deps({ conVentana: async () => [] }) });
  assert.strictEqual(r.enviados, 0);
  assert.deepStrictEqual(log.filter((x) => x.campana).map((x) => x.campana), ["a1"]);
});
```

- [ ] **Step 2: Correr y ver que fallan.**

- [ ] **Step 3: `src/lib/caso-pendiente.js`:**

```js
// La fila del Excel para un pendiente (spec 2026-10-30 §5): quien es, como
// contactarlo, por que, que pidio y que se le ofrecio (con link de Wasi).
const { POR_QUE } = require("./sin-respuesta");

const recorte = (s, n) => { const x = String(s || "").replace(/\s+/g, " ").trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };
const pesos = (n) => (Number(n) > 0 ? `$${Math.round(Number(n)).toLocaleString("es-CO")}` : null);

function refsDe(textos) {
  const out = [];
  for (const t of textos || []) for (const m of String(t || "").matchAll(/\b(\d{7,8})\b/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

function depsPorDefecto() {
  const codigoColega = require("../groups/codigo-colega");
  return {
    pedido: (orgId, codigo) => codigoColega.resolver(orgId, codigo),
    ficha: (org, ref) => require("../data/properties").findByRef(org, ref),
    nombreColega: async (orgId, tel) => ((await require("../data/colegas").porTelefono(orgId, tel)) || {}).nombre || null,
  };
}

async function armarCaso({ org, pendiente, lead, mensajes, crmUrl = null, deps = null }) {
  const d = { ...depsPorDefecto(), ...(deps || {}) };
  const { leerCodigo } = require("../groups/codigo-colega");
  const deLaPersona = (mensajes || []).filter((m) => m.role === "user");
  const deSofi = (mensajes || []).filter((m) => m.role === "assistant");
  const nombre = lead.nombre || (lead.source === "colega" ? await d.nombreColega(org.id, lead.phone).catch(() => null) : null);

  let pidio = "";
  const codigo = deLaPersona.map((m) => leerCodigo(m.content)).filter(Boolean).pop();
  if (codigo) {
    const senal = await d.pedido(org.id, codigo).catch(() => null);
    if (senal && senal.texto_original) pidio = recorte(senal.texto_original, 300);
  }
  if (!pidio && deLaPersona.length) pidio = recorte(deLaPersona.map((m) => m.content).join(" · "), 300);

  const fichas = [];
  for (const ref of refsDe(deSofi.map((m) => m.content)).slice(0, 4)) {
    const p = await d.ficha(org, ref).catch(() => null);
    fichas.push(p ? [`Ref ${ref}`, p.tipo, p.zona, pesos(p.precio), p.linkWasi].filter(Boolean).join(" · ") : `Ref ${ref}`);
  }
  const tel = String(lead.phone || "");
  return {
    codigo: pendiente.codigo,
    nombre: recorte(nombre, 60) || "(sin nombre)",
    tipo: lead.source === "colega" ? "colega" : "cliente",
    whatsapp: /^\d{8,15}$/.test(tel) ? `wa.me/${tel}` : "sin número: escríbele desde el CRM",
    porQue: POR_QUE[pendiente.motivo] || "no le contestó a Sofi",
    pidio,
    ofrecido: fichas.join("\n"),
    ultimoSuyo: recorte(deLaPersona.length ? deLaPersona[deLaPersona.length - 1].content : "", 200),
    ultimoSofi: recorte(deSofi.length ? deSofi[deSofi.length - 1].content : "", 250),
    chatUrl: crmUrl && pendiente.conversation_id ? `${crmUrl}/inbox/${pendiente.conversation_id}` : null,
  };
}

module.exports = { armarCaso, refsDe };
```

- [ ] **Step 4: `src/channels/whatsapp.js`**, en `sendWhatsAppTemplate`, agregar el parámetro `headerDocument` y, antes del `body`:

```js
  if (headerDocument && headerDocument.id) {
    components.unshift({ type: "header", parameters: [{ type: "document", document: { id: headerDocument.id, filename: headerDocument.filename || "archivo.xlsx" } }] });
  }
```

(firma: `{ name, language = "es", bodyParams = [], buttonPayloads = [], headerDocument = null, fromPhoneId } = {}`).

- [ ] **Step 5: `src/scheduler/excel-pendientes.js`:**

```js
// El Excel de pendientes de cada asesora, a las 8 a. m. y a las 2 p. m., de
// lunes a sabado (spec 2026-10-30 §5). Junta los pendientes abiertos de cada
// asesora, arma el .xlsx y se lo manda: documento si tiene la ventana de 24 h
// abierta; plantilla PENDIENTES_EXCEL_PLANTILLA (encabezado de documento) si
// la tiene cerrada; si no hay plantilla, sus casos pasan a una con la ventana
// abierta, y si ninguna la tiene, campana. Lo que no vuelve sale otra vez en
// el siguiente turno. Interruptor PENDIENTES_EXCEL (apagado salvo "true").
// No lo apaga ASESORA_SOLO_VISITAS (pedido de Juan, 2026-10-30).
const INTERVALO_MIN = 10;
const MAX_FILAS = 40;
const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function minutosBogota(fecha) {
  const t = new Date(fecha.getTime() - 5 * 3600 * 1000);
  return { dia: t.getUTCDay(), min: t.getUTCHours() * 60 + t.getUTCMinutes(), fecha: t.toISOString().slice(0, 10) };
}
// "8am" de 8:00 a 8:29 y "2pm" de 14:00 a 14:29, de lunes a sabado.
function turnoDe(ahora) {
  const { dia, min } = minutosBogota(ahora);
  if (dia === 0) return null;
  if (min >= 480 && min < 510) return "8am";
  if (min >= 840 && min < 870) return "2pm";
  return null;
}
function inicioTurno(ahora, turno) {
  const { fecha } = minutosBogota(ahora);
  return new Date(`${fecha}T${turno === "8am" ? "08" : "14"}:00:00-05:00`).getTime();
}

function depsPorDefecto() {
  const wa = require("../channels/whatsapp");
  return {
    orgs: () => require("../data/organizations").listActive(),
    activo: () => /^(true|1|si|sí|on)$/i.test(String(process.env.PENDIENTES_EXCEL || "")),
    abiertos: async (orgId) => {
      const cp = require("../data/contactos-pendientes");
      return (await cp.disponible()) ? cp.abiertos(orgId) : [];
    },
    ciclo: (orgId) => require("../data/rotacion-citas").asesoresDelCiclo(orgId),
    conVentana: (org, ciclo, ahora) => require("../lib/ventana-asesoras").conVentana(org, ciclo, { ahora }),
    lead: (orgId, id) => require("../data/leads").findById(orgId, id),
    mensajes: (convId) => (convId ? require("../data/conversations").getRecentMessages(convId, 16) : []),
    armarCaso: (args) => require("../lib/caso-pendiente").armarCaso({ ...args, crmUrl: String(process.env.CRM_PUBLIC_URL || "").trim().replace(/\/$/, "") || null }),
    armarLibro: (args) => require("../lib/pendientes-excel").armarLibro(args),
    subir: (org, buffer, filename) => wa.uploadMediaToMeta(org, buffer, MIME, filename),
    documento: (org, tel, mediaId, filename) => wa.sendWhatsAppMedia(org, tel, { type: "document", mediaId, filename }),
    plantilla: (org, tel, args) => wa.sendWhatsAppTemplate(org, tel, args),
    texto: (org, tel, t) => require("../lib/mensaje-asesor").enviarYRegistrar(org, tel, t),
    marcarEnviados: (ids, o) => require("../data/contactos-pendientes").marcarEnviados(ids, o),
    campana: (args) => require("../notifications/avisar-asesor").avisarAsesor(args),
    nombrePlantilla: String(process.env.PENDIENTES_EXCEL_PLANTILLA || "").trim() || null,
  };
}

const tel = (a) => String((a && a.phone) || "").replace(/\D/g, "");
const fechaCorta = (ahora) => new Date(ahora.getTime() - 5 * 3600 * 1000).toLocaleDateString("es-CO", { timeZone: "UTC", day: "numeric", month: "short" }).replace(".", "");

let corriendo = false;
async function runOnce({ ahora = new Date(), deps = null } = {}) {
  const res = { enviados: 0, filas: 0, porPlantilla: 0, reasignados: 0 };
  const turno = turnoDe(ahora);
  const d = { ...depsPorDefecto(), ...(deps || {}) };
  if (!turno || corriendo || !d.activo()) return res;
  corriendo = true;
  try {
    const desde = inicioTurno(ahora, turno);
    for (const org of await d.orgs()) {
      const abiertos = await d.abiertos(org.id).catch((e) => { console.error("[excel-pendientes] no se pudieron leer:", e.message); return []; });
      if (abiertos.length === 0) continue;
      const ciclo = await d.ciclo(org.id).catch(() => []);
      if (ciclo.length === 0) continue;
      const abiertas = await d.conVentana(org, ciclo, ahora).catch(() => []);
      const conVentana = new Set(abiertas.map((a) => a.id));

      // A quien le toca cada pendiente este turno.
      const grupos = new Map(); // advisor.id -> { advisor, filas, porPlantilla }
      for (const p of abiertos) {
        let a = ciclo.find((x) => x.id === p.asesor_id) || ciclo[0];
        let porPlantilla = false;
        if (!conVentana.has(a.id)) {
          if (d.nombrePlantilla) porPlantilla = true;
          else if (abiertas.length) { a = abiertas[0]; res.reasignados++; }
        }
        if (!grupos.has(a.id)) grupos.set(a.id, { advisor: a, filas: [], porPlantilla });
        grupos.get(a.id).filas.push(p);
      }

      for (const { advisor, filas, porPlantilla } of grupos.values()) {
        // Reinicio dentro del turno: si ya salio este turno, no se repite.
        if (filas.some((p) => p.enviado_at && new Date(p.enviado_at).getTime() >= desde)) continue;
        const lote = filas.slice(0, MAX_FILAS);
        const nombre = String(advisor.name || "").split(/\s+/)[0];
        if (!conVentana.has(advisor.id) && !porPlantilla) {
          await d.campana({ org, advisor, motivo: "aviso", lead: null, titulo: `Tienes ${lote.length} personas por contactar`, cuerpo: "Escríbele a Sofi para que te llegue el Excel de pendientes.", whatsapp: true }).catch(() => {});
          continue;
        }
        try {
          const casos = [];
          for (const p of lote) {
            const lead = await d.lead(org.id, p.lead_id).catch(() => null);
            if (!lead) continue;
            casos.push(await d.armarCaso({ org, pendiente: p, lead, mensajes: await d.mensajes(p.conversation_id).catch(() => []) }));
          }
          if (casos.length === 0) continue;
          const loteId = `L-${minutosBogota(ahora).fecha}-${turno}-${advisor.id.slice(0, 8)}`;
          const filename = `Pendientes Diamond - ${nombre} - ${fechaCorta(ahora)} ${turno}.xlsx`;
          const buffer = await d.armarLibro({ loteId, asesorId: advisor.id, casos });
          const mediaId = await d.subir(org, buffer, filename);
          const instrucciones = `${nombre}, tienes ${casos.length} personas por contactar. Escríbeles o llámalas, llena la columna Resultado (y fecha, hora y ref si agendaste visita) y devuélveme el Excel por este chat.`;
          if (porPlantilla) {
            const r = await d.plantilla(org, tel(advisor), { name: d.nombrePlantilla, bodyParams: [String(casos.length)], headerDocument: { id: mediaId, filename } });
            if (!r || !r.ok) throw new Error(`plantilla: ${r && r.error}`);
            res.porPlantilla++;
          } else {
            await d.documento(org, tel(advisor), mediaId, filename);
            await d.texto(org, tel(advisor), instrucciones);
          }
          await d.marcarEnviados(lote.map((p) => p.id), { loteId, asesorId: advisor.id });
          res.enviados++;
          res.filas += casos.length;
          console.log(`[excel-pendientes] ${turno} -> ${advisor.name}: ${casos.length} pendientes${porPlantilla ? " (plantilla)" : ""}`);
        } catch (e) {
          console.error(`[excel-pendientes] no salio el Excel a ${advisor.name}:`, e.message);
        }
      }
    }
    return res;
  } finally {
    corriendo = false;
  }
}

let timer = null;
function start() {
  const tick = () => runOnce().catch((e) => console.error("[excel-pendientes] runOnce:", e.message));
  timer = setInterval(tick, INTERVALO_MIN * 60 * 1000);
  setTimeout(tick, 2 * 60 * 1000);
  console.log(`[excel-pendientes] ${depsPorDefecto().activo() ? "activo" : "apagado (PENDIENTES_EXCEL)"} — 8 a. m. y 2 p. m.`);
  return timer;
}

module.exports = { runOnce, start, turnoDe, MAX_FILAS };
```

> En los tests, `fila(...)` usa el código como `id`; por eso `marcados` se compara con los códigos.

- [ ] **Step 6: `src/server.js`**, después de la línea de `sin-respuesta`:

```js
  // Excel de pendientes a las asesoras, 8 a. m. y 2 p. m. (spec 2026-10-30).
  if (config.supabaseUrl) require("./scheduler/excel-pendientes").start();
```

- [ ] **Step 7: Correr** los dos tests nuevos y `npm test` → PASS.
- [ ] **Step 8: Commit** `feat(pendientes): Excel de pendientes a las asesoras a las 8 a. m. y 2 p. m.`.

---

### Task 7: Prueba en seco, documentación y estado

**Files:**
- Create: `scripts/excel-pendientes-en-seco.js`
- Modify: `CLAUDE.md` (sección 2, entrada nueva arriba), `.env.example` (`PENDIENTES_EXCEL`, `PENDIENTES_EXCEL_PLANTILLA`)
- Create: `docs/plantillas-meta-pendientes.md` (texto de la plantilla `pendientes_contacto`)

- [ ] **Step 1: Script en seco** (`scripts/excel-pendientes-en-seco.js`): lee de producción, no escribe ni envía nada; arma un Excel por asesora con los pendientes abiertos (o, si la tabla no existe todavía, con los casos que `motivoEscalar` daría hoy) y los guarda en `Claude outputs/`.

```js
#!/usr/bin/env node
// Prueba en seco del Excel de pendientes (spec 2026-10-30 §9). Solo lee: no
// escribe en la base ni manda WhatsApp. Guarda un .xlsx por asesora en
// "Claude outputs/". Se corre desde la raiz:
//   railway run --service diamond node scripts/excel-pendientes-en-seco.js
const fs = require("fs");
const path = require("path");
const supabase = require("../src/data/supabase");
const cp = require("../src/data/contactos-pendientes");
const conversations = require("../src/data/conversations");
const { motivoEscalar } = require("../src/lib/sin-respuesta");
const { armarCaso } = require("../src/lib/caso-pendiente");
const { armarLibro } = require("../src/lib/pendientes-excel");

async function main() {
  const org = (await require("../src/data/organizations").listActive())[0];
  const ciclo = await require("../src/data/rotacion-citas").asesoresDelCiclo(org.id);
  let pendientes = (await cp.disponible()) ? await cp.abiertos(org.id) : [];
  if (pendientes.length === 0) {
    console.log("Sin pendientes en la tabla: uso los casos que el sistema pasaría hoy.");
    const { data } = await supabase.from("conversations").select("id, leads!inner(*)").eq("org_id", org.id).eq("estado", "activa")
      .gte("last_activity_at", new Date(Date.now() - 48 * 3600 * 1000).toISOString()).neq("leads.source", "asesor").limit(200);
    let n = 0;
    for (const c of data || []) {
      const msgs = await conversations.getRecentMessages(c.id, 12);
      const u = [...msgs].reverse().find((m) => m.role === "user");
      const paso = motivoEscalar({ lead: { ...c.leads, seguimiento: { ...(c.leads.seguimiento || {}), asesor_at: null } }, ultimoUsuario: u, ultimoMensaje: msgs[msgs.length - 1] });
      if (paso) pendientes.push({ id: c.id, codigo: `C-${String(++n).padStart(4, "0")}`, lead_id: c.leads.id, conversation_id: c.id, motivo: paso.motivo, asesor_id: ciclo[0].id });
    }
  }
  const porAsesora = new Map();
  for (const p of pendientes) {
    const a = ciclo.find((x) => x.id === p.asesor_id) || ciclo[0];
    if (!porAsesora.has(a.id)) porAsesora.set(a.id, { a, filas: [] });
    porAsesora.get(a.id).filas.push(p);
  }
  for (const { a, filas } of porAsesora.values()) {
    const casos = [];
    for (const p of filas) {
      const lead = await require("../src/data/leads").findById(org.id, p.lead_id);
      casos.push(await armarCaso({ org, pendiente: p, lead, mensajes: await conversations.getRecentMessages(p.conversation_id, 16), crmUrl: process.env.CRM_PUBLIC_URL || null }));
    }
    const archivo = path.join(__dirname, "..", "Claude outputs", `pendientes-en-seco-${a.name.split(" ")[0]}.xlsx`);
    fs.writeFileSync(archivo, await armarLibro({ loteId: "EN-SECO", asesorId: a.id, casos }));
    console.log(`${a.name}: ${casos.length} pendientes -> ${archivo}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Correr** `railway run --service diamond node scripts/excel-pendientes-en-seco.js` y abrir el Excel generado: columnas, lista desplegable, links.

- [ ] **Step 3: `docs/plantillas-meta-pendientes.md`** con la plantilla para Juan:
  - Nombre `pendientes_contacto`, categoría Utilidad, idioma es.
  - Encabezado: Documento.
  - Cuerpo: "Hola, tienes {{1}} personas por contactar. Escríbeles o llámalas, llena la columna Resultado del Excel y devuélvelo a este chat." Ejemplo de {{1}}: 6.
  - Pie: Diamond Inmobiliaria.
  - Al aprobarse: `PENDIENTES_EXCEL_PLANTILLA=pendientes_contacto` en Railway.

- [ ] **Step 4: `.env.example`**: `PENDIENTES_EXCEL=false` y `PENDIENTES_EXCEL_PLANTILLA=` con un comentario de una línea cada uno.

- [ ] **Step 5: `CLAUDE.md` §2**, entrada nueva arriba de "Publicador mixto":
  - **Pendientes por Excel (2026-10-30, SIN encender).** Spec `docs/superpowers/specs/2026-10-30-pendientes-excel-asesoras-design.md`.
  - `sin-respuesta.js` crea `contactos_pendientes`.
  - `excel-pendientes.js` manda el Excel a las 8 a. m. y a las 2 p. m.
  - La asesora lo devuelve a Sofi y `devolucion-excel.js` lo aplica.
  - Pendiente (Juan): migración `2026-10-30_contactos_pendientes.sql`, plantilla `pendientes_contacto` y `PENDIENTES_EXCEL=true`.

- [ ] **Step 6: `npm test` completo** → PASS (salvo `agendar-cita-rotacion` si sigue cayendo en lunes: falla preexistente por la fecha).
- [ ] **Step 7: Commit** `feat(pendientes): prueba en seco, plantilla de Meta y estado`.

---

## Self-review

- Spec §3 (unidades) → Tasks 1-6. §4 (tabla) → Task 1. §5 (Excel y envío) → Tasks 2 y 6. §6 (devolución) → Tasks 3 y 4. §7 (urgentes, convivencia, "volvió a escribir") → Tasks 4 (engine) y 5. §8 (frenos: interruptor, tope 40, falla cerrado, tuteo) → Tasks 5 y 6. §9 (pruebas y prueba en seco) → todas + Task 7. §10 (para encender) → Task 7.
- Cambio respecto de la spec: sin la hoja `_lote` igual se acepta si trae la columna Código (Google Sheets puede soltar la hoja oculta). Se actualiza la spec en la Task 7.
- Nombres consistentes: `abrir/abiertos/porCodigos/marcarEnviados/cerrar/volverAPendiente/resolverPorLead/disponible`; `armarLibro/leerLibro/validarFila`; `aplicar`; `esExcel/procesar`; `armarCaso/refsDe`; `turnoDe/runOnce`.
