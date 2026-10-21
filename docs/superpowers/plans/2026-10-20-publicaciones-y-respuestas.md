# Publicaciones y respuestas de los grupos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar cada respuesta de un colega a una publicación nuestra en los grupos (por Sofi, por la línea de Daiana o citando el post), saber si fue atendida, recordarle a Daiana por el CRM y escribirle al colega (link a Sofi a las 3 h, seguimiento a las 24 h), y mostrarlo todo en una pestaña "Publicaciones" del CRM.

**Architecture:** Una tabla `respuestas_publicacion` (una fila por colega y ref) alimentada por tres ganchos (engine de Sofi, `dm.js` de la línea, webhook de grupos) a través de un solo módulo de atribución. Un scheduler hace los recordatorios con los frenos del carril (horario, topes, cuota, solo llamada, interruptor). El CRM lee la tabla y `grupo_publicaciones`.

**Tech Stack:** Node.js CommonJS + `node:test` (bot), Supabase, WAHA (NOWEB), Next.js + Tailwind (CRM).

Spec: `docs/superpowers/specs/2026-10-20-publicaciones-y-respuestas-design.md`. Mockup aprobado: `docs/superpowers/mockups/2026-10-20-publicaciones-respuestas.html`.

## Global Constraints

- Una respuesta = una fila por (`org_id`, `property_ref`, colega), colega = `colega_lid` o, si no hay, `colega_telefono`.
- Ventanas: ref publicada en los últimos **7 días**; atribución por pertenencia a grupo: post en las **48 h** previas y mensaje sin `senal_id`.
- Recordatorios (solo vías `linea` y `grupo`, solo abiertas): Daiana a las **2 h** (campana CRM, tipo `respuesta_sin_atender`); colega a las **3 h** (link a Sofi); colega **24 h** después de su último mensaje (seguimiento). Cada uno **una sola vez**.
- Horario de envío: **lunes a sábado, 8 a. m. a 7 p. m.** Bogotá (UTC−5).
- Frenos: máx. **2 mensajes al colega por fila**; nunca si atendida; `colegas.esSoloLlamada` (lo aplica `waha.enviarDm`); tope **20** DM/día de este carril; cuota de la línea < **80 %**; interruptor `RADAR_RESPUESTAS_POST=true` (apagado por defecto).
- Textos al colega (exactos):
  - 3 h: `Hola {nombre}, gracias por escribir por la Ref {ref} 🙌 Para responderte ya y agendar la visita, te atiende Sofi aquí: {link}`
  - 24 h: `Hola {nombre}, ¿tu cliente alcanzó a ver la Ref {ref}? Si quiere visitarla, la agendamos con Sofi: {link}`
  - `{nombre}` = `redactar.primerNombre(colega_nombre)`; si es null, se escribe `Hola,` sin nombre. `{link}` = `linkContactoOficial(org, "Hola Sofi, vi en un grupo la Ref {ref}")`.
- El aviso a Daiana va por la campana del CRM (`notificar`), nunca por WhatsApp.
- Todo falla abierto: un error al registrar una respuesta nunca corta el camino normal del mensaje.
- Nunca correr la migración ni SQL contra producción (la corre Juan). Nunca cambiar la sesión de WAHA en producción sin OK de Juan.
- Commits en español con prefijo y la línea `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Suite: `npm test` (base 2.399).

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `db/migrations/2026-10-20_respuestas_publicacion.sql` (crear) | Tabla, `linea_dm.direccion`, `grupo_publicaciones.origen`, RLS team read |
| `src/data/respuestas-publicacion.js` (crear) | I/O de la tabla y búsqueda de posts |
| `src/groups/respuestas-publicacion.js` (crear) | Atribución (3 vías) y marcar atendida |
| `src/lib/waha.js` (modificar) | Recordar wamids propios; evento `message.any`; `actualizarEventos` |
| `src/channels/whatsapp-group.js` (modificar) | `replyToId` en `normalizar`; gancho de grupo; salida humana a DM |
| `src/groups/dm.js` (modificar) | Gancho vía línea |
| `src/agent/engine.js` (modificar) | Gancho vía Sofi (también colegas) |
| `src/scheduler/respuestas-publicacion.js` (crear) | Recordatorios 2 h / 3 h / 24 h |
| `src/scheduler/resumen-pedidos.js` (modificar) | Sección "Respuestas sin atender" |
| `src/scheduler/publicador-grupos.js` (modificar) | `origen: 'auto'` al registrar |
| `src/api/crm.js` (modificar) | `POST /api/respuestas/atendida` |
| `crm/app/(dashboard)/publicaciones/page.tsx` (crear), `crm/components/publicaciones/*` (crear), `crm/app/api/respuestas/atendida/route.ts` (crear), `crm/app/(dashboard)/layout.tsx`, `crm/components/campana.tsx` (modificar) | Pestaña Publicaciones |

---

### Task 1: Migración

**Files:** Create `db/migrations/2026-10-20_respuestas_publicacion.sql`

**Interfaces:** Produces la tabla `respuestas_publicacion` con las columnas de abajo; `linea_dm.direccion`; `grupo_publicaciones.origen`.

- [ ] **Step 1: Escribir la migración**

```sql
-- Respuestas de colegas a nuestras publicaciones en grupos (spec
-- docs/superpowers/specs/2026-10-20-publicaciones-y-respuestas-design.md).
-- Solo agrega.

create table if not exists respuestas_publicacion (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  property_ref text not null,
  publicacion_id uuid references grupo_publicaciones(id) on delete set null,
  group_id uuid references whatsapp_groups(id) on delete set null,
  via text not null check (via in ('sofi', 'linea', 'grupo')),
  colega_lid text,
  colega_telefono text,
  colega_nombre text,
  colega_clave text not null, -- coalesce(colega_lid, colega_telefono)
  primer_texto text,
  primer_at timestamptz not null default now(),
  ultimo_entrante_at timestamptz not null default now(),
  mensajes integer not null default 1,
  atendida_at timestamptz,
  atendida_por text check (atendida_por is null or atendida_por in ('sofi', 'linea', 'manual')),
  recordatorio_at timestamptz,
  puente_at timestamptz,
  seguimiento_at timestamptz,
  lead_id uuid references leads(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, property_ref, colega_clave)
);
create index if not exists respuestas_publicacion_abiertas_idx
  on respuestas_publicacion (org_id, atendida_at, ultimo_entrante_at);
alter table respuestas_publicacion enable row level security;
drop policy if exists "team read" on respuestas_publicacion;
create policy "team read" on respuestas_publicacion for select to authenticated using (true);

-- El CRM lee las publicaciones (hoy sin politica: no las veria).
drop policy if exists "team read" on grupo_publicaciones;
create policy "team read" on grupo_publicaciones for select to authenticated using (true);

-- Lo que la linea le escribe a un colega (salida humana) para saber si atendio.
alter table linea_dm add column if not exists direccion text not null default 'entrada'
  check (direccion in ('entrada', 'salida'));

-- Automatico o a mano.
alter table grupo_publicaciones add column if not exists origen text not null default 'auto'
  check (origen in ('auto', 'manual'));
update grupo_publicaciones set origen = 'manual'
where property_ref = '10505566' and created_at >= '2026-10-20T20:00:00Z';
update grupo_publicaciones set origen = 'manual'
where created_at < '2026-10-19T21:00:00Z';
```

- [ ] **Step 2: Commit**

```bash
git add db/migrations/2026-10-20_respuestas_publicacion.sql
git commit -m "config: tabla de respuestas a publicaciones en grupos"
```

---

### Task 2: Datos y atribución

**Files:**
- Create: `src/data/respuestas-publicacion.js`, `src/groups/respuestas-publicacion.js`
- Test: `test/respuestas-publicacion.test.js`

**Interfaces:**
- Produces (data, objeto `self` con `_supabase` mockeable como `src/data/propiedades-asesor.js`):
  - `postReciente(orgId, ref, { dias = 7, ahora }) -> row|null` (última fila `enviado` de esa ref)
  - `postsEnGrupos(orgId, nombresGrupos: string[], { horas = 48, ahora }) -> row[]` (enviados recientes en grupos con esos nombres, más reciente primero; cada row con `group_id`, `property_ref`, `id`)
  - `postPorWamid(orgId, wamid) -> row|null`
  - `registrar(orgId, { ref, publicacionId, groupId, via, lid, telefono, nombre, texto, leadId, atendida }) -> { id, nueva: boolean }`
  - `marcarAtendidas(orgId, { lid, telefono }, por) -> number`
  - `abiertas(orgId) -> row[]` (vía linea|grupo, sin `atendida_at`)
  - `marcar(id, patch) -> void`
  - `colegaGrupos(orgId, { lid, telefono }) -> string[]` (de `colegas_grupos.grupos`)
- Produces (groups): `refDeTexto(texto) -> string|null`; `deLinea(org, { texto, senalId, identidad, nombre }) -> resultado|null`; `deSofi(org, { texto, telefono, nombre, leadId }) -> resultado|null`; `deGrupo(org, { replyToId, autorId, nombre, texto }) -> resultado|null`; `atendidaPorLinea(org, identidad) -> number`.

- [ ] **Step 1: Tests**

```js
// test/respuestas-publicacion.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const datos = require("../src/data/respuestas-publicacion");
const rp = require("../src/groups/respuestas-publicacion");

const ORG = { id: "org-1" };
const POST = { id: "pub-1", property_ref: "10505566", group_id: "g-1", created_at: "2026-10-20T20:16:00Z" };

test("refDeTexto encuentra una ref de Wasi o de asesor", () => {
  assert.strictEqual(rp.refDeTexto("Hola, el de la ref 10505566 sigue?"), "10505566");
  assert.strictEqual(rp.refDeTexto("me interesa la D1004"), "D1004");
  assert.strictEqual(rp.refDeTexto("tel 3001234567"), null); // un celular no es ref
  assert.strictEqual(rp.refDeTexto("hola"), null);
});

test("linea: ref explicita publicada -> registra via linea", async (t) => {
  t.mock.method(datos, "postReciente", async () => POST);
  const reg = t.mock.method(datos, "registrar", async () => ({ id: "r-1", nueva: true }));
  const r = await rp.deLinea(ORG, { texto: "¿la 10505566 tiene parqueadero?", senalId: null, identidad: { lid: "1@lid", telefono: null }, nombre: "Laura" });
  assert.deepStrictEqual(r, { id: "r-1", nueva: true, ref: "10505566", via: "linea" });
  const a = reg.mock.calls[0].arguments[1];
  assert.strictEqual(a.via, "linea");
  assert.strictEqual(a.publicacionId, "pub-1");
  assert.strictEqual(a.lid, "1@lid");
});

test("linea: sin ref, colega en un grupo con post en 48 h y sin pedido ligado -> el post mas reciente", async (t) => {
  t.mock.method(datos, "colegaGrupos", async () => ["ARRIENDOS 7AM 8PM"]);
  t.mock.method(datos, "postsEnGrupos", async () => [POST]);
  t.mock.method(datos, "registrar", async () => ({ id: "r-2", nueva: true }));
  const r = await rp.deLinea(ORG, { texto: "buenas, ¿sigue disponible?", senalId: null, identidad: { lid: "1@lid" }, nombre: null });
  assert.strictEqual(r.ref, "10505566");
});

test("linea: un mensaje ligado a un pedido del radar no se atribuye por grupo", async (t) => {
  const grupos = t.mock.method(datos, "colegaGrupos", async () => ["X"]);
  const r = await rp.deLinea(ORG, { texto: "gracias", senalId: "sig-1", identidad: { lid: "1@lid" } });
  assert.strictEqual(r, null);
  assert.strictEqual(grupos.mock.callCount(), 0);
});

test("sofi: 'vi en un grupo la Ref' publicada -> via sofi atendida", async (t) => {
  t.mock.method(datos, "postReciente", async () => POST);
  const reg = t.mock.method(datos, "registrar", async () => ({ id: "r-3", nueva: true }));
  const r = await rp.deSofi(ORG, { texto: "Hola, vi en un grupo la Ref 10505566", telefono: "573001112222", nombre: "Ana", leadId: "lead-1" });
  assert.strictEqual(r.via, "sofi");
  assert.strictEqual(reg.mock.calls[0].arguments[1].atendida, true);
  assert.strictEqual(reg.mock.calls[0].arguments[1].leadId, "lead-1");
});

test("sofi: ref no publicada en 7 dias -> nada", async (t) => {
  t.mock.method(datos, "postReciente", async () => null);
  assert.strictEqual(await rp.deSofi(ORG, { texto: "vi en un grupo la Ref 9999999", telefono: "57300" }), null);
});

test("grupo: cita a nuestro post -> via grupo", async (t) => {
  t.mock.method(datos, "postPorWamid", async (o, w) => (w === "3EB0WAMID" ? POST : null));
  const reg = t.mock.method(datos, "registrar", async () => ({ id: "r-4", nueva: true }));
  const r = await rp.deGrupo(ORG, { replyToId: "3EB0WAMID", autorId: "9@lid", nombre: "Pedro", texto: "info al privado" });
  assert.strictEqual(r.via, "grupo");
  assert.strictEqual(reg.mock.calls[0].arguments[1].lid, "9@lid");
  assert.strictEqual(await rp.deGrupo(ORG, { replyToId: null, autorId: "9@lid", texto: "x" }), null);
});

test("atendidaPorLinea marca las abiertas del colega", async (t) => {
  const m = t.mock.method(datos, "marcarAtendidas", async () => 2);
  assert.strictEqual(await rp.atendidaPorLinea(ORG, { lid: "1@lid" }), 2);
  assert.deepStrictEqual(m.mock.calls[0].arguments, ["org-1", { lid: "1@lid" }, "linea"]);
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `node --test test/respuestas-publicacion.test.js` → FAIL (`Cannot find module`).

- [ ] **Step 3: `src/data/respuestas-publicacion.js`**

```js
// Respuestas de colegas a nuestras publicaciones (spec 2026-10-20-publicaciones-y-respuestas).
const DIA_MS = 86400000;
const self = { _supabase: () => require("./supabase") };

self.postReciente = async function postReciente(orgId, ref, { dias = 7, ahora = new Date() } = {}) {
  const desde = new Date(ahora.getTime() - dias * DIA_MS).toISOString();
  const { data, error } = await self._supabase()
    .from("grupo_publicaciones").select("id, property_ref, group_id, created_at")
    .eq("org_id", orgId).eq("estado", "enviado").eq("property_ref", String(ref)).gte("created_at", desde)
    .order("created_at", { ascending: false }).limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
};

self.postsEnGrupos = async function postsEnGrupos(orgId, nombresGrupos, { horas = 48, ahora = new Date() } = {}) {
  if (!nombresGrupos || nombresGrupos.length === 0) return [];
  const { data: grupos, error: e1 } = await self._supabase()
    .from("whatsapp_groups").select("id, nombre").eq("org_id", orgId).in("nombre", nombresGrupos);
  if (e1) throw e1;
  const ids = (grupos || []).map((g) => g.id);
  if (!ids.length) return [];
  const desde = new Date(ahora.getTime() - horas * 3600e3).toISOString();
  const { data, error } = await self._supabase()
    .from("grupo_publicaciones").select("id, property_ref, group_id, created_at")
    .eq("org_id", orgId).eq("estado", "enviado").in("group_id", ids).gte("created_at", desde)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
};

self.postPorWamid = async function postPorWamid(orgId, wamid) {
  if (!wamid) return null;
  const { data, error } = await self._supabase()
    .from("grupo_publicaciones").select("id, property_ref, group_id, created_at")
    .eq("org_id", orgId).eq("wamid", String(wamid)).limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
};

self.colegaGrupos = async function colegaGrupos(orgId, { lid = null, telefono = null } = {}) {
  let q = self._supabase().from("colegas_grupos").select("grupos").eq("org_id", orgId).limit(1);
  if (lid) q = q.eq("lid", String(lid).replace(/@lid$/, ""));
  else if (telefono) q = q.eq("telefono", String(telefono));
  else return [];
  const { data, error } = await q;
  if (error) throw error;
  return (data && data[0] && data[0].grupos) || [];
};

self.registrar = async function registrar(orgId, { ref, publicacionId = null, groupId = null, via, lid = null, telefono = null, nombre = null, texto = null, leadId = null, atendida = false }) {
  const clave = lid || telefono;
  const ahora = new Date().toISOString();
  const { data: previa, error: e1 } = await self._supabase()
    .from("respuestas_publicacion").select("id, mensajes")
    .eq("org_id", orgId).eq("property_ref", String(ref)).eq("colega_clave", clave).maybeSingle();
  if (e1) throw e1;
  if (previa) {
    const { error } = await self._supabase().from("respuestas_publicacion")
      .update({ ultimo_entrante_at: ahora, mensajes: (previa.mensajes || 1) + 1, ...(leadId ? { lead_id: leadId } : {}) })
      .eq("id", previa.id);
    if (error) throw error;
    return { id: previa.id, nueva: false };
  }
  const fila = {
    org_id: orgId, property_ref: String(ref), publicacion_id: publicacionId, group_id: groupId, via,
    colega_lid: lid, colega_telefono: telefono, colega_nombre: nombre, colega_clave: clave,
    primer_texto: texto ? String(texto).slice(0, 500) : null, lead_id: leadId,
    ...(atendida ? { atendida_at: ahora, atendida_por: via === "sofi" ? "sofi" : "linea" } : {}),
  };
  const { data, error } = await self._supabase().from("respuestas_publicacion").insert(fila).select("id").single();
  if (error) throw error;
  return { id: data.id, nueva: true };
};

self.marcarAtendidas = async function marcarAtendidas(orgId, { lid = null, telefono = null }, por) {
  const clave = lid || telefono;
  if (!clave) return 0;
  const { data, error } = await self._supabase().from("respuestas_publicacion")
    .update({ atendida_at: new Date().toISOString(), atendida_por: por })
    .eq("org_id", orgId).eq("colega_clave", clave).is("atendida_at", null).select("id");
  if (error) throw error;
  return (data || []).length;
};

self.abiertas = async function abiertas(orgId) {
  const { data, error } = await self._supabase().from("respuestas_publicacion").select("*")
    .eq("org_id", orgId).in("via", ["linea", "grupo"]).is("atendida_at", null).limit(500);
  if (error) throw error;
  return data || [];
};

self.marcar = async function marcar(id, patch) {
  const { error } = await self._supabase().from("respuestas_publicacion").update(patch).eq("id", id);
  if (error) throw error;
};

module.exports = self;
```

- [ ] **Step 4: `src/groups/respuestas-publicacion.js`**

```js
// Atribucion de respuestas de colegas a nuestras publicaciones en grupos
// (spec 2026-10-20-publicaciones-y-respuestas §2-3). Nunca lanza: devuelve
// null y deja rastro en el log.
const datos = require("../data/respuestas-publicacion");
const { refDeKit } = require("../agent/kit-origen");

// Ref de Wasi (6 a 8 digitos) o de asesor (D + 4 o mas). Un celular
// colombiano (10 digitos que empiezan por 3) no es ref.
const REF_RE = /\b(D\d{4,}|\d{6,8})\b/i;

function refDeTexto(texto) {
  const m = REF_RE.exec(String(texto || ""));
  return m ? m[1].toUpperCase() : null;
}

async function seguro(etiqueta, fn) {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[respuestas-publicacion] ${etiqueta}:`, e.message);
    return null;
  }
}

async function deLinea(org, { texto, senalId = null, identidad = {}, nombre = null }) {
  return seguro("linea", async () => {
    const lid = identidad.lid || null;
    const telefono = identidad.telefono || null;
    let post = null;
    const ref = refDeTexto(texto);
    if (ref) post = await datos.postReciente(org.id, ref);
    if (!post && !senalId) {
      const grupos = await datos.colegaGrupos(org.id, { lid, telefono });
      const posts = await datos.postsEnGrupos(org.id, grupos);
      post = posts[0] || null;
    }
    if (!post) return null;
    const r = await datos.registrar(org.id, {
      ref: post.property_ref, publicacionId: post.id, groupId: post.group_id, via: "linea", lid, telefono, nombre, texto,
    });
    return { ...r, ref: post.property_ref, via: "linea" };
  });
}

async function deSofi(org, { texto, telefono, nombre = null, leadId = null }) {
  return seguro("sofi", async () => {
    const ref = refDeKit(texto);
    if (!ref) return null;
    const post = await datos.postReciente(org.id, ref);
    if (!post) return null;
    const r = await datos.registrar(org.id, {
      ref, publicacionId: post.id, groupId: post.group_id, via: "sofi", telefono, nombre, texto, leadId, atendida: true,
    });
    return { ...r, ref, via: "sofi" };
  });
}

async function deGrupo(org, { replyToId, autorId, nombre = null, texto }) {
  if (!replyToId || !autorId) return null;
  return seguro("grupo", async () => {
    const post = await datos.postPorWamid(org.id, replyToId);
    if (!post) return null;
    const esLid = String(autorId).endsWith("@lid");
    const r = await datos.registrar(org.id, {
      ref: post.property_ref, publicacionId: post.id, groupId: post.group_id, via: "grupo",
      lid: esLid ? autorId : null, telefono: esLid ? null : String(autorId).replace(/\D/g, ""), nombre, texto,
    });
    return { ...r, ref: post.property_ref, via: "grupo" };
  });
}

async function atendidaPorLinea(org, identidad) {
  return (await seguro("atendida", () => datos.marcarAtendidas(org.id, identidad, "linea"))) || 0;
}

module.exports = { refDeTexto, deLinea, deSofi, deGrupo, atendidaPorLinea };
```

- [ ] **Step 5: Correr** `node --test test/respuestas-publicacion.test.js` → PASS (8). `npm test` completo en verde.

- [ ] **Step 6: Commit**

```bash
git add src/data/respuestas-publicacion.js src/groups/respuestas-publicacion.js test/respuestas-publicacion.test.js
git commit -m "feat(radar): atribuir las respuestas de colegas a nuestras publicaciones"
```

---

### Task 3: Ganchos de Sofi y de la línea

**Files:** Modify `src/agent/engine.js` (bloque de `refDeKit`, ~línea 164), `src/groups/dm.js` (después de `lineaDm.create`, antes del puente). Test: `test/respuestas-ganchos.test.js`.

**Interfaces:** Consumes `deSofi`, `deLinea` (Task 2).

- [ ] **Step 1: Test** (`dm.js` llama `deLinea` con lo guardado; engine llama `deSofi` también para colegas)

```js
// test/respuestas-ganchos.test.js
const { test } = require("node:test");
const assert = require("node:assert");
process.env.RADAR_DM_CLASIFICAR = "false";
const rp = require("../src/groups/respuestas-publicacion");
const dm = require("../src/groups/dm");
const groupSignals = require("../src/data/group-signals");
const lineaDm = require("../src/data/linea-dm");
const puente = require("../src/groups/puente-sofi");

test("dm.procesarMensaje registra la respuesta por la linea con el pedido ligado", async (t) => {
  t.mock.method(groupSignals, "buscarPorLid", async () => null);
  t.mock.method(lineaDm, "create", async () => ({ mensaje: { id: "dm-1", created_at: "2026-10-21T13:00:00Z" }, duplicado: false }));
  t.mock.method(puente, "tenderPuente", async () => ({ resultado: "sin_senal" }));
  const llamado = t.mock.method(rp, "deLinea", async () => null);
  await dm.procesarMensaje({ id: "org-1" }, { waMessageId: "w1", sesion: "DaianaDiamond", remitenteLid: "1@lid", remitenteTelefono: null, remitenteNombre: "Laura", texto: "¿sigue la 10505566?" });
  const a = llamado.mock.calls[0].arguments[1];
  assert.strictEqual(a.texto, "¿sigue la 10505566?");
  assert.strictEqual(a.senalId, null);
  assert.deepStrictEqual(a.identidad, { telefono: null, lid: "1@lid" });
});
```

Para engine, agregar al test existente que cubre `kit_ref` (buscar `kit_ref` en `test/`) un caso de colega: con `colega` resuelto, el texto "vi en un grupo la Ref 10505566" llama `rp.deSofi` con `{ texto, telefono: phone, nombre: lead.nombre, leadId: lead.id }`. Si el arnés de engine es muy pesado, extraer la llamada a una función exportada `registrarRespuestaSofi(org, lead, phone, text)` en engine y testear esa.

- [ ] **Step 2: Implementar**

En `src/groups/dm.js`, justo después de `if (!guardado) return { resultado: "sin_tabla" };`:

```js
  // Respuesta a una publicacion nuestra (spec 2026-10-20-publicaciones-y-respuestas).
  // Falla abierta: nunca corta el camino del mensaje.
  await require("./respuestas-publicacion")
    .deLinea(org, { texto: mensaje.texto, senalId: señal ? señal.id : null, identidad, nombre: mensaje.remitenteNombre })
    .catch(() => null);
```

En `src/agent/engine.js`, FUERA del `if (!colega) {` (para que también cuente a colegas), justo antes de ese `if`:

```js
  // Respuesta a una publicacion en grupos (spec 2026-10-20): cuenta para
  // clientes y para colegas. Falla abierta.
  await require("../groups/respuestas-publicacion")
    .deSofi(org, { texto: text, telefono: phone, nombre: lead.nombre || null, leadId: lead.id })
    .catch(() => null);
```

- [ ] **Step 3: Correr** el test nuevo y `npm test` → verde.

- [ ] **Step 4: Commit** `feat(radar): las respuestas por Sofi y por la linea se registran contra la publicacion`

---

### Task 4: Grupo citado y salida humana (webhook + WAHA)

**Files:** Modify `src/lib/waha.js` (crearSesion ~108, enviarTexto ~430, enviarDm ~471, exports), `src/channels/whatsapp-group.js` (normalizar ~189, router ~396-440, procesar de grupo). Test: `test/respuestas-webhook.test.js`.

**Interfaces:** Produces `waha.esEnvioPropio(wamid) -> boolean`, `waha.actualizarEventos(nombreSesion) -> Promise`, `normalizar(...).replyToId`.

- [ ] **Step 1: Tests**

```js
// test/respuestas-webhook.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const wg = require("../src/channels/whatsapp-group");
const waha = require("../src/lib/waha");

test("normalizar conserva el id del mensaje citado", () => {
  const ev = wg._normalizar({ session: "S", payload: { id: "m1", from: "g@g.us", body: "info", replyTo: { id: "3EB0WAMID" } } });
  assert.strictEqual(ev.replyToId, "3EB0WAMID");
  const sin = wg._normalizar({ session: "S", payload: { id: "m2", from: "g@g.us", body: "x" } });
  assert.strictEqual(sin.replyToId, null);
});

test("un wamid enviado por el sistema se reconoce como propio", () => {
  waha._recordarEnvioPropio("3EBPROPIO");
  assert.strictEqual(waha.esEnvioPropio("3EBPROPIO"), true);
  assert.strictEqual(waha.esEnvioPropio("3EBHUMANO"), false);
});

test("la sesion se suscribe a message y message.any", () => {
  assert.deepStrictEqual(waha.EVENTOS_SESION, ["message", "message.any"]);
});
```

Y un test del ruteo: con `event: "message.any"`, `fromMe: true`, chat `@lid` y wamid no propio → llama `respuestas.atendidaPorLinea` y `lineaDm.create` con `direccion: "salida"`; con wamid propio → no llama nada; con `event: "message.any"` y `fromMe: false` → se ignora (ya llegó por `message`); con `event: "message"` de grupo con `replyToId` → llama `respuestas.deGrupo`. Seguir el patrón de `test/linea-dm-webhook.test.js` para armar el request.

- [ ] **Step 2: Implementar en `waha.js`**

```js
// Eventos de la sesion (2026-10-20): "message.any" trae tambien lo que la
// linea envia, para saber si Daiana le contesto a un colega. Los mensajes
// propios del sistema se reconocen por su wamid (esEnvioPropio).
const EVENTOS_SESION = ["message", "message.any"];
const enviosPropios = new Map(); // wamid -> ts
const TTL_PROPIO_MS = 6 * 3600e3;
function _recordarEnvioPropio(wamid) {
  if (!wamid) return;
  const ahora = Date.now();
  enviosPropios.set(String(wamid), ahora);
  for (const [k, ts] of enviosPropios) if (ahora - ts > TTL_PROPIO_MS) enviosPropios.delete(k);
}
function esEnvioPropio(wamid) {
  return enviosPropios.has(String(wamid || ""));
}
async function actualizarEventos(nombre, { webhookUrl, webhookSecret }) {
  const config = { webhooks: [{ url: webhookUrl, events: EVENTOS_SESION, customHeaders: [{ name: "x-api-key", value: webhookSecret }] }] };
  return pedir(`/api/sessions/${encodeURIComponent(nombre)}`, { metodo: "PUT", body: { config } });
}
```

En `crearSesion` reemplazar `events: ["message"]` por `events: EVENTOS_SESION` (y lo mismo en el PUT de reintento). En `enviarTexto` y `enviarDm`, tras obtener el `wamid` con éxito: `_recordarEnvioPropio(wamid);`. Exportar `EVENTOS_SESION, esEnvioPropio, actualizarEventos, _recordarEnvioPropio`. Nota: el wamid que devuelve WAHA puede venir como `true_<chat>_<id>`; guardar ambos (`wamid` y lo que va después del último `_`) y comparar igual en `esEnvioPropio`.

- [ ] **Step 3: Implementar en `whatsapp-group.js`**

En `normalizar`, agregar:

```js
    // Id del mensaje citado (respuesta a nuestro post). WAHA NOWEB lo manda en
    // payload.replyTo.id; si no viene, null y la via "grupo" queda en 0.
    replyToId: (p.replyTo && (p.replyTo.id || p.replyTo._serialized)) || (p._data && p._data.quotedStanzaID) || null,
```

En el router, reemplazar la condición del evento y el filtro `fromMe`:

```js
  const evento = req.body?.event;
  if ((evento !== "message" && evento !== "message.any") || !ev.waMessageId || (!esGrupo(ev.chatId) && !esDM(ev.chatId))) {
    return res.json({ ok: true });
  }
  // "message.any" solo interesa por lo que ENVIA la linea; lo entrante ya llega por "message".
  if (evento === "message.any" && !ev.fromMe) return res.json({ ok: true });
```

y, en lugar de `if (ev.fromMe) return res.json({ ok: true });`:

```js
    if (ev.fromMe) {
      // Salida humana a un colega (Daiana escribiendo desde su celular): marca
      // atendidas sus respuestas y queda en linea_dm. Lo que manda el propio
      // sistema (DM del radar, puente, publicador) no cuenta.
      if (esDM(ev.chatId) && !waha.esEnvioPropio(ev.waMessageId)) {
        res.json({ ok: true });
        const quien = identidadDM(ev.chatId);
        const identidad = { telefono: quien.telefono, lid: quien.lid };
        await lineaDm.create(org.id, { sesion: ev.sesion, waMessageId: ev.waMessageId, remitenteTelefono: identidad.telefono, remitenteLid: identidad.lid, remitenteNombre: null, texto: ev.texto, fechaMensaje: ev.tsMs ? new Date(ev.tsMs).toISOString() : null, senalId: null, direccion: "salida" }).catch(() => null);
        await require("../groups/respuestas-publicacion").atendidaPorLinea(org, identidad).catch(() => 0);
        return;
      }
      return res.json({ ok: true });
    }
```

En `src/data/linea-dm.js#create`, aceptar `direccion = "entrada"` y guardarlo; si la columna no existe (42703 / PGRST204 por `direccion`), reintentar sin ella (mismo patrón que la degradación de `remitente_lid`). En el procesamiento de mensajes de GRUPO (`procesar(org, ev, grupo, sesion)`), al inicio:

```js
  if (ev.replyToId) {
    require("../groups/respuestas-publicacion")
      .deGrupo(org, { replyToId: ev.replyToId, autorId: ev.autorId, nombre: ev.autorNombre, texto: ev.texto })
      .catch(() => null);
  }
```

Exportar `module.exports._normalizar = normalizar;` si no está.

- [ ] **Step 4: Correr** tests nuevos + `test/linea-dm-webhook.test.js` + `npm test` → verde.

- [ ] **Step 5: Commit** `feat(radar): la cita a nuestro post y la respuesta de Daiana cuentan en las respuestas`

---

### Task 5: Recordatorios

**Files:** Create `src/scheduler/respuestas-publicacion.js`; Modify `src/server.js` (junto a `publicador-grupos`), `src/scheduler/resumen-pedidos.js` (runOnce ~173), `src/scheduler/publicador-grupos.js` (registrar: `origen: "auto"`), `crm/components/campana.tsx` (icono `respuesta_sin_atender: "⏰"`). Test: `test/respuestas-recordatorios.test.js`.

**Interfaces:** Consumes `datos.abiertas`, `datos.marcar`, `visita-linea.asesoraDeLinea(org, sesion)`, `notificar`, `waha.enviarDm`, `waha.cuotaDeLinea`, `linkContactoOficial`, `redactar.primerNombre`. Produces `decidir(fila, ahora) -> "daiana"|"puente"|"seguimiento"|null`, `textoPuente(fila, link)`, `textoSeguimiento(fila, link)`, `runOnce({ ahora, deps })`, `start()`, `sinAtender(orgId) -> row[]` (para el resumen).

- [ ] **Step 1: Tests**

```js
// test/respuestas-recordatorios.test.js
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const rec = require("../src/scheduler/respuestas-publicacion");

const H = 3600e3;
const LUNES_10AM = new Date("2026-10-19T15:00:00Z");
const fila = (horas, extra = {}) => ({
  id: "r1", property_ref: "10505566", via: "linea", colega_lid: "1@lid", colega_nombre: "Laura Gómez",
  primer_at: new Date(LUNES_10AM - horas * H).toISOString(), ultimo_entrante_at: new Date(LUNES_10AM - horas * H).toISOString(),
  atendida_at: null, recordatorio_at: null, puente_at: null, seguimiento_at: null, ...extra,
});

beforeEach(() => { process.env.RADAR_RESPUESTAS_POST = "true"; });

test("decidir: 2 h -> daiana; 3 h -> puente; atendida y 24 h de silencio -> seguimiento", () => {
  assert.strictEqual(rec.decidir(fila(1), LUNES_10AM), null);
  assert.strictEqual(rec.decidir(fila(2.1), LUNES_10AM), "daiana");
  assert.strictEqual(rec.decidir(fila(3.1, { recordatorio_at: "x" }), LUNES_10AM), "puente");
  assert.strictEqual(rec.decidir(fila(25, { recordatorio_at: "x", puente_at: "x" }), LUNES_10AM), "seguimiento");
  assert.strictEqual(rec.decidir(fila(30, { recordatorio_at: "x", puente_at: "x", seguimiento_at: "x" }), LUNES_10AM), null);
});

test("textos exactos", () => {
  assert.strictEqual(rec.textoPuente(fila(3), "L"), "Hola Laura, gracias por escribir por la Ref 10505566 🙌 Para responderte ya y agendar la visita, te atiende Sofi aquí: L");
  assert.strictEqual(rec.textoSeguimiento(fila(3, { colega_nombre: "🏠" }), "L"), "Hola, ¿tu cliente alcanzó a ver la Ref 10505566? Si quiere visitarla, la agendamos con Sofi: L");
});

function deps(over = {}) {
  const log = { notif: [], dms: [], marcas: [] };
  return {
    log,
    d: {
      orgs: async () => [{ id: "org-1", name: "Diamond" }],
      abiertas: async () => [fila(3.1, { recordatorio_at: "x" })],
      asesora: async () => ({ id: "adv-1", name: "Daiana" }),
      sesion: async () => "DaianaDiamond",
      cuota: async () => ({ fraccion: 0.2 }),
      enviadosHoy: async () => 0,
      puenteReciente: async () => false,
      notificar: async (n) => { log.notif.push(n); return { ok: true }; },
      enviarDm: async (s, tel, texto, opts) => { log.dms.push({ texto, opts }); return { ok: true, wamid: "w" }; },
      marcar: async (id, patch) => log.marcas.push(patch),
      link: () => "L",
      ...over,
    },
  };
}

test("manda el link a Sofi por la linea al lid del colega y marca puente_at", async () => {
  const { d, log } = deps();
  await rec.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.strictEqual(log.dms.length, 1);
  assert.deepStrictEqual(log.dms[0].opts, { lid: "1@lid", orgId: "org-1" });
  assert.ok(log.marcas[0].puente_at);
});

test("recordatorio a Daiana por la campana", async () => {
  const { d, log } = deps({ abiertas: async () => [fila(2.5)] });
  await rec.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.strictEqual(log.notif[0].tipo, "respuesta_sin_atender");
  assert.strictEqual(log.notif[0].link, "/publicaciones");
  assert.ok(log.marcas[0].recordatorio_at);
  assert.strictEqual(log.dms.length, 0);
});

test("frenos: domingo, fuera de hora, tope, cuota, puente reciente, interruptor", async () => {
  for (const [ahora, over] of [
    [new Date("2026-10-18T15:00:00Z"), {}],                 // domingo
    [new Date("2026-10-20T01:00:00Z"), {}],                 // 8 p. m.
    [LUNES_10AM, { enviadosHoy: async () => 20 }],
    [LUNES_10AM, { cuota: async () => ({ fraccion: 0.85 }) }],
    [LUNES_10AM, { puenteReciente: async () => true }],
  ]) {
    const { d, log } = deps(over);
    await rec.runOnce({ ahora, deps: d });
    assert.strictEqual(log.dms.length, 0, JSON.stringify(over));
  }
  process.env.RADAR_RESPUESTAS_POST = "false";
  const { d, log } = deps();
  await rec.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.strictEqual(log.dms.length + log.notif.length, 0);
});

test("un envio que falla (solo llamada) no marca y no reintenta en el mismo tick", async () => {
  const { d, log } = deps({ enviarDm: async () => ({ ok: false, error: "colega_solo_llamada", previoAlEnvio: false }) });
  await rec.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.strictEqual(log.marcas.length, 1);
  assert.ok(log.marcas[0].puente_at, "solo llamada se marca para no insistir");
});
```

- [ ] **Step 2: Implementar `src/scheduler/respuestas-publicacion.js`**

```js
// Recordatorios de respuestas a publicaciones (spec 2026-10-20 §4): Daiana por
// la campana a las 2 h, link a Sofi al colega a las 3 h y seguimiento a las 24 h
// de su ultimo mensaje. RADAR_RESPUESTAS_POST=true lo enciende.
const { primerNombre } = require("../groups/redactar");

const H = 3600e3;
const TOPE_DIA = 20;
const CUOTA_MAX = 0.8;
const BOGOTA_UTC = 5;

function activo() {
  return String(process.env.RADAR_RESPUESTAS_POST || "").trim().toLowerCase() === "true";
}

function enHorario(ahora) {
  const b = new Date(ahora.getTime() - BOGOTA_UTC * H);
  const h = b.getUTCHours();
  return b.getUTCDay() !== 0 && h >= 8 && h < 19;
}

function decidir(f, ahora) {
  const desde = (iso) => ahora.getTime() - new Date(iso).getTime();
  const enviados = (f.puente_at ? 1 : 0) + (f.seguimiento_at ? 1 : 0);
  if (!f.atendida_at) {
    if (!f.recordatorio_at && desde(f.primer_at) >= 2 * H) return "daiana";
    if (!f.puente_at && desde(f.primer_at) >= 3 * H && enviados < 2) return "puente";
  }
  const hubo = f.atendida_at || f.puente_at;
  if (hubo && !f.seguimiento_at && enviados < 2 && desde(f.ultimo_entrante_at) >= 24 * H) return "seguimiento";
  return null;
}

function saludo(f) {
  const n = primerNombre(f.colega_nombre);
  return n ? `Hola ${n},` : "Hola,";
}
function textoPuente(f, link) {
  return `${saludo(f)} gracias por escribir por la Ref ${f.property_ref} 🙌 Para responderte ya y agendar la visita, te atiende Sofi aquí: ${link}`;
}
function textoSeguimiento(f, link) {
  return `${saludo(f)} ¿tu cliente alcanzó a ver la Ref ${f.property_ref}? Si quiere visitarla, la agendamos con Sofi: ${link}`;
}

function depsPorDefecto() {
  const datos = require("../data/respuestas-publicacion");
  const sb = () => require("../data/supabase");
  return {
    orgs: () => require("../data/organizations").listActive(),
    abiertas: (org) => sinAtenderOSeguimiento(org.id),
    asesora: (org, sesion) => require("../groups/visita-linea").asesoraDeLinea(org, sesion),
    sesion: async (org) => {
      const s = await require("../data/whatsapp-groups").listSessions(org.id);
      const a = (s || []).filter((x) => x.estado === "activa");
      return a.length === 1 ? a[0].nombre : null;
    },
    cuota: (sesion) => require("../lib/waha").cuotaDeLinea(sesion),
    enviadosHoy: async (org, ahora) => {
      const b = new Date(ahora.getTime() - BOGOTA_UTC * H);
      const inicio = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate(), BOGOTA_UTC)).toISOString();
      const { count: c1 } = await sb().from("respuestas_publicacion").select("id", { count: "exact", head: true }).eq("org_id", org.id).gte("puente_at", inicio);
      const { count: c2 } = await sb().from("respuestas_publicacion").select("id", { count: "exact", head: true }).eq("org_id", org.id).gte("seguimiento_at", inicio);
      return (c1 || 0) + (c2 || 0);
    },
    // ¿puente-sofi ya le mando el link a este colega en 24 h? Se mira linea_dm:
    // el puente se tiende a la primera respuesta ligada a un pedido.
    puenteReciente: async () => false,
    notificar: (n) => require("../notifications/notificar").notificar(n),
    enviarDm: (s, tel, texto, opts) => require("../lib/waha").enviarDm(s, tel, texto, opts),
    marcar: (id, patch) => datos.marcar(id, patch),
    link: (org, f) => require("../lib/contacto").linkContactoOficial(org, `Hola Sofi, vi en un grupo la Ref ${f.property_ref}`),
  };
}

// Abiertas (para Daiana y puente) y atendidas sin seguimiento (para las 24 h).
async function sinAtenderOSeguimiento(orgId) {
  const { data, error } = await require("../data/supabase").from("respuestas_publicacion").select("*")
    .eq("org_id", orgId).in("via", ["linea", "grupo"]).is("seguimiento_at", null).limit(500);
  if (error) throw error;
  return data || [];
}

async function sinAtender(orgId, ahora = new Date()) {
  const corte = new Date(ahora.getTime() - 2 * H).toISOString();
  const { data, error } = await require("../data/supabase").from("respuestas_publicacion").select("property_ref, colega_nombre, via, primer_at, primer_texto")
    .eq("org_id", orgId).in("via", ["linea", "grupo"]).is("atendida_at", null).lte("primer_at", corte).order("primer_at").limit(20);
  if (error) throw error;
  return data || [];
}

async function runOnce({ ahora = new Date(), deps = null } = {}) {
  if (!activo() || !enHorario(ahora)) return;
  const d = deps || depsPorDefecto();
  for (const org of await d.orgs()) {
    try {
      const sesion = await d.sesion(org);
      const asesora = await d.asesora(org, sesion).catch(() => null);
      let enviados = await d.enviadosHoy(org, ahora).catch(() => TOPE_DIA);
      for (const f of await d.abiertas(org)) {
        const accion = decidir(f, ahora);
        if (!accion) continue;
        const marca = new Date(ahora).toISOString();
        if (accion === "daiana") {
          if (!asesora) continue;
          await d.notificar({ orgId: org.id, advisor: asesora, tipo: "respuesta_sin_atender",
            titulo: `⏰ Un colega espera respuesta (Ref ${f.property_ref})`,
            cuerpo: `${f.colega_nombre || "Un colega"} escribió hace más de 2 h y nadie le ha respondido.`, link: "/publicaciones" }).catch(() => null);
          await d.marcar(f.id, { recordatorio_at: marca });
          continue;
        }
        if (!sesion || enviados >= TOPE_DIA) continue;
        const cuota = await d.cuota(sesion).catch(() => null);
        if (!cuota || !(cuota.fraccion < CUOTA_MAX)) continue;
        if (accion === "puente" && (await d.puenteReciente(org, f).catch(() => true))) {
          await d.marcar(f.id, { puente_at: marca });
          continue;
        }
        const link = d.link(org, f);
        const texto = accion === "puente" ? textoPuente(f, link) : textoSeguimiento(f, link);
        const r = await d.enviarDm(sesion, f.colega_telefono || null, texto, { ...(f.colega_lid ? { lid: f.colega_lid } : {}), orgId: org.id }).catch((e) => ({ ok: false, error: e.message }));
        const campo = accion === "puente" ? "puente_at" : "seguimiento_at";
        // Solo llamada o enviado: se marca para no insistir. Un fallo de red, no.
        if ((r && r.ok) || (r && r.error === "colega_solo_llamada")) await d.marcar(f.id, { [campo]: marca });
        if (r && r.ok) enviados++;
      }
    } catch (e) {
      console.error("[respuestas-publicacion] error en", org.name, e.message);
    }
  }
}

function start() {
  const tick = () => runOnce().catch((e) => console.error("[respuestas-publicacion] runOnce:", e.message));
  setTimeout(tick, 4 * 60 * 1000);
  setInterval(tick, 15 * 60 * 1000);
  console.log(`[respuestas-publicacion] ${activo() ? "PRENDIDO" : "apagado"} (RADAR_RESPUESTAS_POST)`);
}

module.exports = { decidir, textoPuente, textoSeguimiento, runOnce, start, sinAtender, activo };
```

**Puente ya tendido por `puente-sofi`:** sus envíos son propios (no quedan en `linea_dm`), así que en vez de consultar se marca en el momento. Agregar a `src/data/respuestas-publicacion.js`:

```js
self.marcarPuente = async function marcarPuente(orgId, { lid = null, telefono = null }) {
  const clave = lid || telefono;
  if (!clave) return 0;
  const { data, error } = await self._supabase().from("respuestas_publicacion")
    .update({ puente_at: new Date().toISOString() })
    .eq("org_id", orgId).eq("colega_clave", clave).is("puente_at", null).select("id");
  if (error) throw error;
  return (data || []).length;
};
```

y en `src/groups/puente-sofi.js#tenderPuente`, justo después de un envío con `ok`: `await require("../data/respuestas-publicacion").marcarPuente(orgId, identidad).catch(() => 0);`. Como las filas de la línea se crean en `dm.js` ANTES del puente (Task 3), la fila del mismo mensaje queda marcada. `puenteReciente` del scheduler queda `async () => false` en producción (el test lo inyecta). Test: `marcarPuente` actualiza solo filas con `puente_at` null del colega (fake client, patrón de `test/propiedades-asesor-data.test.js`).

- [ ] **Step 3: `server.js`** después del publicador:

```js
  // Recordatorios de respuestas a publicaciones (Juan, 2026-10-20).
  if (config.supabaseUrl) require("./scheduler/respuestas-publicacion").start();
```

- [ ] **Step 4: Resumen de pedidos.** En `resumen-pedidos.runOnce`, cambiar `if (!mensajes.length) continue;` por armar además `const pendientes = await require("./respuestas-publicacion").sinAtender(org.id, ahora).catch(() => []);` y, si hay pendientes, agregar un mensaje al final de `mensajes`:

```js
const lineaR = (r) => `• Ref ${r.property_ref} · ${r.colega_nombre || "colega"} (${r.via === "grupo" ? "en el grupo" : "en tu línea"}): "${String(r.primer_texto || "").slice(0, 80)}"`;
if (pendientes.length) mensajes.push([`⏰ *Respuestas a nuestras publicaciones sin atender* (${pendientes.length})`, ...pendientes.map(lineaR)].join("\n"));
if (!mensajes.length) continue;
```

Test en `test/resumen-pedidos.test.js`: sin pedidos pero con 1 pendiente → sale 1 mensaje con "Respuestas a nuestras publicaciones sin atender (1)".

- [ ] **Step 5: Publicador** — en `src/scheduler/publicador-grupos.js` la `fila` registrada lleva `origen: "auto"`; si la columna no existe aún (antes de la migración), `registrar` reintenta sin `origen` (detectar `origen` en el mensaje de error 42703/PGRST204). Test existente actualizado para esperar `origen: "auto"`.

- [ ] **Step 6: Correr** tests nuevos y `npm test` → verde. **Commit** `feat(radar): recordatorios de respuestas a Daiana y al colega`.

---

### Task 6: Pestaña "Publicaciones" del CRM

**Files:** Create `crm/app/(dashboard)/publicaciones/page.tsx`, `crm/components/publicaciones/lista-publicaciones.tsx`, `crm/components/publicaciones/marcar-atendida.tsx`, `crm/app/api/respuestas/atendida/route.ts`; Modify `crm/app/(dashboard)/layout.tsx` (entrada `{ href: "/publicaciones", label: "Publicaciones" }` junto a `/amoblados`), `src/api/crm.js` (ruta del bot). Test: `test/crm-publicaciones.test.js` (lógica pura) y `test/respuestas-endpoint.test.js`.

**Interfaces:** Consumes `grupo_publicaciones` (con `origen`), `respuestas_publicacion`, `whatsapp_groups`, `properties`, `leads.cita`. Produces `crm/lib/publicaciones.ts` con funciones puras `resumen(posts, respuestas, citas) -> { posts, respuestas, colegas, visitas, pctConRespuesta, porVia: {sofi, linea, grupo}, sinAtender }` y `agrupar(posts, respuestas) -> Array<{ ref, titulo, tipo, precio, grupos: string[], primera, ultima, origen, respuestas: Respuesta[] }>` y `estadoDe(respuesta, ahora) -> "atendida"|"visita"|"seguimiento"|"link_sofi"|"recordatorio"|"sin_atender"`.

- [ ] **Step 1: Tests de la lógica pura** (`test/crm-publicaciones.test.js`, importando `../crm/lib/publicaciones.ts` como hace `test/crm-amoblados.test.js`):
  - `resumen` cuenta posts enviados, respuestas, colegas distintos por `colega_clave`, % de refs publicadas con al menos una respuesta, y `sinAtender` = vía linea|grupo sin `atendida_at` con `primer_at` de hace más de 2 h.
  - `agrupar` junta filas de `grupo_publicaciones` por `property_ref`, lista los grupos, y pega las respuestas por `property_ref`.
  - `estadoDe`: atendida si `atendida_at`; si no: `seguimiento_at` → "seguimiento"; `puente_at` → "link_sofi"; `recordatorio_at` → "recordatorio"; si > 2 h → "sin_atender".

- [ ] **Step 2: Página.** Server component con `createClient()` de `@/lib/supabase/server`; período por `searchParams.dias` (1 | 7 | 30, default 7). Consultas con `fetchSafe` (patrón de `amoblados/page.tsx`): `grupo_publicaciones` (estado enviado, desde), `respuestas_publicacion` (desde), `whatsapp_groups` (id, nombre), `properties` (ref, titulo, tipo, operacion, precio, images, disponible) por las refs publicadas, y `leads` con `cita` de colegas para contar visitas (`cita.origen = 'linea_dm'` o `cita.ref` en las refs publicadas). Render igual al mockup: franja navy con 5 KPIs (sky / indigo / teal / amber / slate) y desglose por vía, alerta roja si `sinAtender > 0`; lista "Lo que enviamos" con filtros en cliente (Todos / Con respuesta / Sin atender / Amoblados / Venta / Fincas / grupo) en `lista-publicaciones.tsx`; respuestas desplegables con el estado como chip; lateral con "Fichas que más responden" y "Grupos que más responden" (barras), y la leyenda de las vías. Imágenes con `<img>` (sin optimizador). Mobile: una columna.

- [ ] **Step 3: Marcar atendida.** `crm/app/api/respuestas/atendida/route.ts` igual a `crm/app/api/citas/accion/route.ts`: sesión obligatoria, body `{ id }`, `callBot("/api/respuestas/atendida", { id, authUserId: user.id })`. En `src/api/crm.js`, junto a `/api/citas/accion`: resolver org como esa ruta, verificar que `authUserId` es un asesor activo o admin, y `update respuestas_publicacion set atendida_at = now(), atendida_por = 'manual' where id and org_id`; 403 si no es del equipo. Test del endpoint con el patrón de `test/vigencia-endpoint.test.js`.

- [ ] **Step 4: Verificar** `cd crm && npm run build` y `npm test`. **Commit** `feat(crm): pestaña Publicaciones con las respuestas de los colegas`.

---

### Task 7: Activación y verificación real (con Juan)

- [ ] **Step 1:** CLAUDE.md, §2: entrada "Publicaciones y respuestas (rama `modulo-publicaciones`)" con interruptor `RADAR_RESPUESTAS_POST`, migración pendiente y el paso de WAHA. Commit `docs: estado del modulo de publicaciones`.
- [ ] **Step 2 (Juan):** correr `2026-10-20_respuestas_publicacion.sql`; verificar por REST que `respuestas_publicacion` y `linea_dm.direccion` existen.
- [ ] **Step 3 (con OK de Juan):** desplegar; actualizar los eventos de la sesión `DaianaDiamond` con `waha.actualizarEventos` (script de una línea con `railway run`); confirmar en el log que llega un `message.any` cuando Daiana escribe desde su celular a un colega (y que se guarda con `direccion = 'salida'`), y que una respuesta citando un post trae `replyToId` (si no, la vía grupo queda en 0 y se reporta).
- [ ] **Step 4 (con OK de Juan):** `RADAR_RESPUESTAS_POST=true` en Railway; verificar en el log `[respuestas-publicacion] PRENDIDO`.
