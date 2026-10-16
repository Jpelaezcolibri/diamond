# Kit de publicación + dueños para arriendo — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que las asesoras publiquen propiedades en sus grupos de WhatsApp desde el celular con un kit del CRM (fotos + texto + Compartir nativo), y que Sofi y la landing capten dueños que quieren arrendar (mensual o renta corta).

**Architecture:** La lógica vive en el bot (Node/Express, `src/`), donde ya están la compuerta de inventario, la verificación del link de Wasi y la redacción de fichas; el CRM (Next.js, `crm/`) la consume por `callBot` y solo pinta la página `/kit` y hace de proxy de fotos. La captación de dueños es una intención nueva (`consignar_arriendo`) que recorre detección determinista → tool de ficha → transferencia → alerta, igual que la captación para vender.

**Tech Stack:** Node 22 + `node:test` (bot), Next.js 16 + React 19 + Tailwind 4 (CRM y landing), Supabase.

**Spec:** `docs/superpowers/specs/2026-10-16-kit-publicacion-y-duenos-arriendo-design.md` · **Mockup:** `docs/superpowers/mockups/2026-10-16-kit-publicacion.html`

## Global Constraints

- App en español (Colombia); código en inglés o el español que ya usa el módulo (el bot usa nombres en español: seguir el archivo que se toca).
- Commits en español con prefijo convencional (`feat:`, `fix:`, `docs:`), terminados en `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Nunca** el nombre ni el celular de una asesora hacia afuera: solo `aliasPublico(advisor)` ("Asesor N"), de `src/lib/identidad-publica.js`.
- Todo lo que escribe columnas o tablas nuevas es **best-effort**: si la migración no corrió, se loguea (`[kit]`, `[tools]`) y el flujo sigue.
- La migración la corre Juan. **No** correr SQL contra Supabase ni pasar URLs de `.env*` a ninguna herramienta de Prisma/Supabase.
- El kit **no** envía nada por WAHA ni por la Cloud API.
- El texto del post se arma sin IA.
- Tests del bot: `npm test` desde la raíz (`node --test test/*.test.js`). CRM y landing: `npm run lint` y `npm run build` en `crm/` y `web/`.
- Desviación aceptada de la spec §3.2: los endpoints del bot resuelven la org con `organizations.getDefault()`, igual que `/api/grupos/metricas`, en vez de recibir `orgId` del CRM.

## Mapa de archivos

| Archivo | Qué hace |
|---|---|
| `db/migrations/2026-10-16_kit_publicacion.sql` (nuevo) | Tabla `kit_publicaciones`; `leads.kit_ref`, `leads.kit_at`, `leads.inmueble_ofrecido` |
| `db/schema.sql` | Refleja lo mismo |
| `src/agent/intent.js` | `detectOwnerRentIntent` |
| `src/agent/kit-origen.js` (nuevo) | `refDeKit(text)`: lee "vi en un grupo la Ref N" |
| `src/agent/engine.js` | Aplica la intención de dueño y la atribución del kit |
| `src/agent/tools.js` | Mapeo de `consignar_arriendo`, tool `registrar_inmueble_ofrecido`, transferencia |
| `src/notifications/advisor.js` | Encabezado "Dueño · …" y ficha del inmueble en la alerta |
| `src/agent/prompts.js` | Reglas de captación para arriendo |
| `src/groups/redactar.js` | `postGrupo(propiedad, { org, comision })` |
| `src/groups/kit.js` (nuevo) | Filtro del inventario, etiquetas de última publicación, KPIs, registro |
| `src/api/crm.js` | `POST /api/kit/propiedades`, `/api/kit/post`, `/api/kit/registrar` |
| `crm/app/api/kit/route.ts` (nuevo) | Proxy autenticado a los tres endpoints |
| `crm/app/api/kit/foto/route.ts` (nuevo) | Devuelve la foto i de una ref (no es proxy abierto) |
| `crm/app/(dashboard)/kit/page.tsx` (nuevo) | Página |
| `crm/components/kit-publicacion.tsx` (nuevo) | Lista, ficha, Compartir |
| `crm/app/(dashboard)/layout.tsx` | Link "Kit" en la navegación |
| `web/lib/lead-schema.ts`, `web/components/forms/lead-form.tsx`, `web/config/i18n.ts`, `web/lib/whatsapp.ts`, `web/app/api/leads/route.ts`, `web/config/tenants/diamond.ts` | Opción "Arrendar mi propiedad" |

---

### Task 1: Migración

**Files:**
- Create: `db/migrations/2026-10-16_kit_publicacion.sql`
- Modify: `db/schema.sql` (al final de la definición de `leads` y nueva tabla al final del archivo)

**Interfaces:**
- Produces: tabla `kit_publicaciones(id, org_id, property_ref, user_id, accion, created_at)`; columnas `leads.kit_ref text`, `leads.kit_at timestamptz`, `leads.inmueble_ofrecido jsonb`.

- [ ] **Step 1: Escribir la migración**

```sql
-- Migracion: kit de publicacion en grupos + captacion de duenos para arriendo
-- (spec docs/superpowers/specs/2026-10-16-kit-publicacion-y-duenos-arriendo-design.md).
-- Solo AGREGA: no borra ni cambia nada existente. Ejecutar en Supabase SQL Editor.
-- El bot y el CRM funcionan sin ella (escritura best-effort); sin ella el kit
-- no muestra "compartida hace N dias" ni el KPI de clientes, y la ficha del
-- dueno no se guarda en la base (si viaja en la alerta).

-- 1. Cada vez que una asesora comparte/copia/descarga un post del kit.
create table if not exists kit_publicaciones (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  property_ref text not null,
  user_id uuid references auth.users(id) on delete set null,
  accion text not null, -- compartir | copiar | descargar
  created_at timestamptz not null default now()
);
create index if not exists kit_publicaciones_org_ref_idx
  on kit_publicaciones (org_id, property_ref, created_at desc);
alter table kit_publicaciones enable row level security;

-- 2. Lead que llego por un post del kit ("Hola, vi en un grupo la Ref N").
alter table leads add column if not exists kit_ref text;
alter table leads add column if not exists kit_at timestamptz;

-- 3. Ficha del inmueble de un dueno que quiere arrendar:
--    { zona, tipo, habitaciones, canon, amoblado, periodo: mensual|corta, rnt, ph_permite }
alter table leads add column if not exists inmueble_ofrecido jsonb;
```

- [ ] **Step 2: Reflejar en `db/schema.sql`**

Después de la última línea `alter table leads add column …` que ya exista en `db/schema.sql` (o, si `schema.sql` no tiene `alter`s, al final del archivo), agregar el mismo bloque 1-3 de arriba sin los comentarios de cabecera.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/2026-10-16_kit_publicacion.sql db/schema.sql
git commit -m "feat(db): migracion del kit de publicacion y ficha del dueno para arriendo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Detectar al dueño que quiere arrendar

**Files:**
- Modify: `src/agent/intent.js`
- Test: `test/intent.test.js`

**Interfaces:**
- Produces: `detectOwnerRentIntent(text: string): "consignar_arriendo" | null`, exportado junto a `detectSellerIntent`.

- [ ] **Step 1: Escribir el test que falla** (agregar al final de `test/intent.test.js`)

```js
const { detectOwnerRentIntent } = require("../src/agent/intent");

const duenoArrienda = [
  "Hola, quiero arrendar mi apartamento con ustedes",
  "quiero poner en arriendo mi casa",
  "necesito arrendar mi apto de Envigado",
  "tengo un apartamento para arrendar",
  "tengo un apto para rentar en Sabaneta",
  "quiero rentar mi apto por noches",
  "quiero poner mi apto en Airbnb",
  "mi apartamento lo quiero arrendar",
  "ustedes administran arriendos?",
  "Hola, quiero poner en arriendo mi propiedad",
];

const inquilino = [
  "busco arrendar un apartamento en Envigado",
  "quiero arrendar un apto en el poblado",
  "necesito un apartamento en arriendo",
  "tienen apartamentos para arrendar en Laureles?",
  "busco algo en renta corta para diciembre",
  "quiero vender mi apartamento",
  "me interesa la propiedad 10077063",
];

test("detecta al dueno que quiere arrendar su inmueble (mensual o renta corta)", () => {
  for (const t of duenoArrienda) {
    assert.strictEqual(detectOwnerRentIntent(t), "consignar_arriendo", `deberia detectar dueno en: "${t}"`);
  }
});

test("NO confunde a un inquilino ni a un vendedor con un dueno que arrienda", () => {
  for (const t of inquilino) {
    assert.strictEqual(detectOwnerRentIntent(t), null, `NO deberia detectar dueno en: "${t}"`);
  }
});

test("las frases de vender siguen dando vender y no consignar_arriendo", () => {
  assert.strictEqual(detectSellerIntent("quiero vender mi casa"), "vender");
  assert.strictEqual(detectOwnerRentIntent("quiero vender mi casa"), null);
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `node --test test/intent.test.js`
Expected: FAIL con `detectOwnerRentIntent is not a function`.

- [ ] **Step 3: Implementar** (en `src/agent/intent.js`, después de `detectSellerIntent`)

```js
// Dueno que quiere ARRENDAR su propio inmueble (2026-10-16, spec kit +
// duenos para arriendo). Antes no existia: "quiero arrendar mi apto" caia en
// tools.js como `arrendar` (inquilino) y Sofi le ofrecia inventario a un
// propietario. Mismo criterio que SELLER_RE: solo frases de ALTA precision,
// con el posesivo ("mi", "mis") o "tengo un ... para arrendar". "busco
// arrendar un apto" es un inquilino y no dispara.
const INMUEBLE = "(propiedad|casa|apartamento|apto|apartaestudio|inmueble|finca|local|oficina)";
const OWNER_RENT_RE = new RegExp(
  [
    String.raw`\b(arrendar|rentar|alquilar|arriendo|alquilo|rento)\s+(mi|mis|nuestr[ao]s?)\b`,
    String.raw`\bpon(er|go|dr[ée])\s+(en\s+(arriendo|renta|alquiler)\s+(mi|mis|nuestr[ao]s?)|(mi|mis|nuestr[ao]s?)\s+${INMUEBLE}\s+en\s+(arriendo|renta|alquiler|airbnb))\b`,
    String.raw`\btengo\s+(un|una)\s+${INMUEBLE}\s+para\s+(arrendar|rentar|alquilar|arriendo|renta)\b`,
    String.raw`\bmi\s+${INMUEBLE}\b[^.?!]{0,40}\b(arrendar|rentar|alquilar|arriendo|airbnb)\b`,
    String.raw`\b(administran|manejan|reciben)\s+(arriendos|propiedades\s+para\s+arriendo|inmuebles\s+para\s+arrendar)\b`,
  ].join("|"),
  "i"
);

// Devuelve "consignar_arriendo" si el mensaje expresa intencion de arrendar el
// propio inmueble (arriendo mensual o renta corta).
function detectOwnerRentIntent(text) {
  return OWNER_RENT_RE.test(String(text || "")) ? "consignar_arriendo" : null;
}
```

Y cambiar el export:

```js
module.exports = { detectSellerIntent, detectOwnerRentIntent, detectClientLanguage };
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `node --test test/intent.test.js`
Expected: PASS (los 5 tests). Si una frase de `inquilino` dispara, ajustar el regex para esa frase y volver a correr; no quitar frases de las listas.

- [ ] **Step 5: Commit**

```bash
git add src/agent/intent.js test/intent.test.js
git commit -m "feat(sofi): detecta al dueno que quiere arrendar su inmueble

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Atribución del kit y dueño en el engine

**Files:**
- Create: `src/agent/kit-origen.js`
- Modify: `src/agent/engine.js:12` (import), `:150-170` (bloque `if (!colega)`), `:199-210` (bloque de intención de venta)
- Test: `test/kit-origen.test.js`

**Interfaces:**
- Consumes: `detectOwnerRentIntent` (Task 2).
- Produces: `refDeKit(text: string): string | null` en `src/agent/kit-origen.js`.

- [ ] **Step 1: Test que falla** (`test/kit-origen.test.js`)

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { refDeKit } = require("../src/agent/kit-origen");

test("lee la ref del texto prellenado del kit", () => {
  assert.strictEqual(refDeKit("Hola, vi en un grupo la Ref 10077063"), "10077063");
  assert.strictEqual(refDeKit("hola vi en un grupo la ref AP004 me interesa"), "AP004");
});

test("no confunde otros mensajes con una ref", () => {
  assert.strictEqual(refDeKit("me interesa la ref 10077063"), null);
  assert.strictEqual(refDeKit("vi en un grupo un apartamento"), null);
  assert.strictEqual(refDeKit(""), null);
  assert.strictEqual(refDeKit(null), null);
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `node --test test/kit-origen.test.js`
Expected: FAIL con `Cannot find module '../src/agent/kit-origen'`.

- [ ] **Step 3: Implementar `src/agent/kit-origen.js`**

```js
// El texto prellenado del link a Sofi que va en cada post del kit de
// publicacion (src/groups/redactar.js#postGrupo): "Hola, vi en un grupo la
// Ref N". Si un lead llega con esa frase, el negocio vino de un post en un
// grupo (spec 2026-10-16, §3.5). Mismo formato de ref que REF_PATTERN de
// engine.js.
const KIT_RE = /\bvi en un grupo la ref\s+([A-Z]{2}\d{3}|\d{6,8})\b/i;

function refDeKit(text) {
  const m = String(text || "").match(KIT_RE);
  return m ? m[1].toUpperCase() : null;
}

module.exports = { refDeKit, KIT_RE };
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `node --test test/kit-origen.test.js`
Expected: PASS.

- [ ] **Step 5: Conectar en `src/agent/engine.js`**

Import (línea 12 y una nueva debajo):

```js
const { detectSellerIntent, detectOwnerRentIntent, detectClientLanguage } = require("./intent");
const { refDeKit } = require("./kit-origen");
```

Dentro de `if (!colega) {`, justo después del bloque de `refMatch` / `property_ref_origen`:

```js
  // Lead que llego por un post del kit de publicacion (spec 2026-10-16).
  // No se toca `source` (es el canal). Best-effort: sin la migracion
  // 2026-10-16_kit_publicacion.sql solo se pierde la medicion.
  const refKit = refDeKit(text);
  if (refKit && !lead.kit_ref) {
    try {
      Object.assign(lead, await leads.update(lead.id, { kit_ref: refKit, kit_at: new Date().toISOString() }));
    } catch (e) {
      console.warn("[kit] No se pudo guardar el origen del kit (revisar migracion 2026-10-16_kit_publicacion):", e.message);
    }
  }
```

Después del bloque `if (!advisor && !colega && lead.intencion !== "vender") { … }` existente, agregar el equivalente para el dueño que arrienda:

```js
  // Dueno que quiere ARRENDAR su inmueble (2026-10-16): mismo piso de
  // confiabilidad que el vendedor, con el mismo blindaje para asesor y colega.
  // Vender gana: si en el historial dijo las dos cosas, sigue el flujo de venta.
  if (!advisor && !colega && !["vender", "consignar_arriendo"].includes(lead.intencion)) {
    const clienteDijoArrendarSuyo = history.some((m) => m.role === "user" && detectOwnerRentIntent(m.content));
    if (clienteDijoArrendarSuyo) {
      lead.intencion = "consignar_arriendo";
      try {
        Object.assign(lead, await leads.update(lead.id, { intencion: "consignar_arriendo" }));
      } catch {
        // Sin la columna queda en memoria; se re-detecta del historial.
      }
    }
  }
```

- [ ] **Step 6: Correr la suite completa**

Run: `npm test`
Expected: todo en verde (el número total sube en 2 por `kit-origen.test.js` y en 3 por intent).

- [ ] **Step 7: Commit**

```bash
git add src/agent/kit-origen.js src/agent/engine.js test/kit-origen.test.js
git commit -m "feat(sofi): marca el lead que llega por el kit y al dueno que arrienda

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Tools — intención, ficha del inmueble y transferencia

**Files:**
- Modify: `src/agent/tools.js` (definición de `registrar_dato_lead` ~l.40-56, `transferir_a_asesor` ~l.113-134, nueva definición de tool, `resolveLeadAdvisor` ~l.367, handler `registrar_dato_lead` ~l.702-720, handler `transferir_a_asesor` ~l.874-925)
- Test: `test/duenos-arriendo-tools.test.js`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: tool `registrar_inmueble_ofrecido` con input `{ zona?, tipo?, habitaciones?, canon?, amoblado?: "si"|"no", periodo?: "mensual"|"corta", rnt?: string, ph_permite?: "si"|"no"|"no_sabe" }`, que hace merge en `ctx.lead.inmueble_ofrecido`. La transferencia con `intencion = consignar_arriendo` deja `ctx.transfer.especialidad = "arriendo"` y `categoria = "alquiler"`.

- [ ] **Step 1: Test que falla** (`test/duenos-arriendo-tools.test.js`)

```js
// Captacion de duenos para arriendo (spec 2026-10-16 §4). Mismo patron de
// mocks que captador-transfer.test.js.
const { test } = require("node:test");
const assert = require("node:assert");
const { executeTool, TOOL_DEFINITIONS: TOOLS } = require("../src/agent/tools");
const advisors = require("../src/data/advisors");
const leads = require("../src/data/leads");

function baseCtx(extra = {}) {
  return {
    org: { id: "org-1", name: "Diamond" },
    lead: { id: "lead-1", phone: "573001112233", categoria: "otros", estado: "en_conversacion", score: 10 },
    propertyInteres: null, transfer: null, cita: null, allyMatch: null, allyAlert: null, captadorAlert: null,
    lastUserMessage: "quiero arrendar mi apto",
    ...extra,
  };
}

const DAIANA = { id: "adv-2", name: "Daiana", phone: "573011880668", especialidad: "arriendo", activo: true, alias_publico: "Asesor 1" };

test("registrar_dato_lead: 'consignar_arriendo' no se vuelve 'arrendar'", async (t) => {
  t.mock.method(leads, "update", async (id, patch) => patch);
  const ctx = baseCtx();
  const r = await executeTool("registrar_dato_lead", { campo: "intencion", valor: "consignar_arriendo" }, ctx);
  assert.strictEqual(ctx.lead.intencion, "consignar_arriendo");
  assert.match(r, /PROPIETARIO que quiere ARRENDAR/);
});

test("registrar_dato_lead: 'arrendar' sigue siendo inquilino", async (t) => {
  t.mock.method(leads, "update", async (id, patch) => patch);
  const ctx = baseCtx();
  await executeTool("registrar_dato_lead", { campo: "intencion", valor: "arrendar" }, ctx);
  assert.strictEqual(ctx.lead.intencion, "arrendar");
});

test("registrar_inmueble_ofrecido hace merge y persiste", async (t) => {
  const update = t.mock.method(leads, "update", async (id, patch) => patch);
  const ctx = baseCtx({ lead: { id: "lead-1", phone: "573001112233", intencion: "consignar_arriendo", inmueble_ofrecido: { zona: "Provenza" } } });
  await executeTool("registrar_inmueble_ofrecido", { habitaciones: 2, periodo: "corta", rnt: "en tramite" }, ctx);
  assert.deepStrictEqual(ctx.lead.inmueble_ofrecido, { zona: "Provenza", habitaciones: 2, periodo: "corta", rnt: "en tramite" });
  assert.deepStrictEqual(update.mock.calls[0].arguments[1], { inmueble_ofrecido: ctx.lead.inmueble_ofrecido });
});

test("registrar_inmueble_ofrecido sin la columna no rompe y queda en memoria", async (t) => {
  t.mock.method(leads, "update", async () => { throw new Error('column "inmueble_ofrecido" does not exist'); });
  const ctx = baseCtx();
  const r = await executeTool("registrar_inmueble_ofrecido", { zona: "Envigado" }, ctx);
  assert.deepStrictEqual(ctx.lead.inmueble_ofrecido, { zona: "Envigado" });
  assert.match(r, /registrad/i);
});

test("registrar_inmueble_ofrecido ignora campos vacios y desconocidos", async (t) => {
  t.mock.method(leads, "update", async (id, patch) => patch);
  const ctx = baseCtx();
  await executeTool("registrar_inmueble_ofrecido", { zona: "  ", tipo: "apartamento", hackeo: "x" }, ctx);
  assert.deepStrictEqual(ctx.lead.inmueble_ofrecido, { tipo: "apartamento" });
});

test("transferir con consignar_arriendo va a arriendo, categoria alquiler, sin captador", async (t) => {
  t.mock.method(leads, "update", async (id, patch) => patch);
  const findById = t.mock.method(advisors, "findById", async () => ({ id: "adv-9", activo: true }));
  const forTransfer = t.mock.method(advisors, "findForTransfer", async () => DAIANA);
  const ctx = baseCtx({
    lead: { id: "lead-1", phone: "573001112233", categoria: "otros", intencion: "consignar_arriendo" },
    propertyInteres: { id: "p", ref: "1", operacion: "Venta", captador_id: "adv-9" },
  });
  await executeTool("transferir_a_asesor", { motivo: "dueno quiere arrendar", especialidad: "venta", intencion: "consignar_arriendo" }, ctx);
  assert.strictEqual(ctx.transfer.especialidad, "arriendo");
  assert.strictEqual(forTransfer.mock.calls[0].arguments[1], "arriendo");
  assert.strictEqual(findById.mock.calls.length, 0);
  assert.strictEqual(ctx.lead.categoria, "alquiler");
});

test("la tool nueva esta declarada y transferir acepta la intencion", () => {
  const tool = TOOLS.find((x) => x.name === "registrar_inmueble_ofrecido");
  assert.ok(tool, "falta la definicion de registrar_inmueble_ofrecido");
  const transferir = TOOLS.find((x) => x.name === "transferir_a_asesor");
  assert.ok(transferir.input_schema.properties.intencion.enum.includes("consignar_arriendo"));
  const dato = TOOLS.find((x) => x.name === "registrar_dato_lead");
  assert.match(dato.input_schema.properties.valor.description, /consignar_arriendo/);
});
```


- [ ] **Step 2: Correr y ver que falla**

Run: `node --test test/duenos-arriendo-tools.test.js`
Expected: FAIL (tool desconocida / intención `arrendar` en vez de `consignar_arriendo`).

- [ ] **Step 3: Definiciones de tools**

En `registrar_dato_lead`, reemplazar la `description` de `valor`:

```js
        valor: { type: "string", description: "El valor tal como lo expreso el cliente. Para intencion usa exactamente: comprar, arrendar (busca inmueble para arrendar), vender, o consignar_arriendo (es DUENO y quiere que le arrendemos SU inmueble, mensual o por noches)." },
```

En `transferir_a_asesor`, cambiar el `enum` y la descripción de `intencion`:

```js
          enum: ["comprar", "arrendar", "vender", "consignar_arriendo", "vehiculos", "otro"],
          description:
            "Que quiere hacer el cliente (define el mensaje que recibe el asesor): comprar o arrendar (busca inmueble), vender (quiere que la inmobiliaria venda SU propiedad), consignar_arriendo (es dueno y quiere que le arrendemos SU propiedad; va con especialidad 'arriendo'), vehiculos, u otro. IMPORTANTE: si el cliente quiere vender su propiedad usa 'vender' con especialidad 'venta'.",
```

Agregar la definición nueva justo después de `transferir_a_asesor`:

```js
  {
    name: "registrar_inmueble_ofrecido",
    description:
      "Guarda los datos del inmueble de un DUENO que quiere que le arrendemos su propiedad (intencion consignar_arriendo). Llamala cada vez que el dueno cuente un dato nuevo; solo manda los campos que dijo. NO la uses con alguien que busca arrendar (inquilino) ni con quien quiere vender.",
    input_schema: {
      type: "object",
      properties: {
        zona: { type: "string", description: "Barrio y municipio, como lo dijo" },
        tipo: { type: "string", description: "apartamento, casa, apartaestudio, local, oficina, finca..." },
        habitaciones: { type: "number" },
        canon: { type: "string", description: "Lo que espera recibir, tal como lo dijo (por mes o por noche)" },
        amoblado: { type: "string", enum: ["si", "no"] },
        periodo: { type: "string", enum: ["mensual", "corta"], description: "mensual = arriendo tradicional; corta = por noches (Airbnb)" },
        rnt: { type: "string", description: "Solo renta corta: si tiene Registro Nacional de Turismo (si, no, en tramite)" },
        ph_permite: { type: "string", enum: ["si", "no", "no_sabe"], description: "Solo renta corta: si el edificio permite renta por noches" },
      },
    },
  },
```

- [ ] **Step 4: Handlers**

En el handler `registrar_dato_lead`, reemplazar la línea `const intencion = /vend|consign/.test(v) ? …` y el `return` del bloque de intención:

```js
      // consignar_arriendo va PRIMERO (2026-10-16): el regex de "arrend" lo
      // convertia en inquilino y Sofi le ofrecia inventario a un dueno.
      const intencion = /consignar_arriendo|dueno.*arrend|due[ñn]o.*renta/.test(v)
        ? "consignar_arriendo"
        : /vend|consign/.test(v)
          ? "vender"
          : /arriendo|arrend|alquil|rentar|renta/.test(v)
            ? "arrendar"
            : "comprar";
```

```js
      return `Intencion registrada: ${intencion}. ${
        intencion === "vender"
          ? "El cliente es un PROPIETARIO que quiere vender: no le ofrezcas inventario para comprar; conectalo con el asesor de ventas (intencion vender)."
          : intencion === "consignar_arriendo"
            ? "El cliente es un PROPIETARIO que quiere ARRENDAR su inmueble: no le ofrezcas inventario. Ve guardando su ficha con registrar_inmueble_ofrecido y transfierelo con especialidad arriendo e intencion consignar_arriendo."
            : "Sigue asesorando segun lo que busca."
      }`;
```

Agregar el handler nuevo justo antes de `if (name === "transferir_a_asesor")`:

```js
  if (name === "registrar_inmueble_ofrecido") {
    const CAMPOS = ["zona", "tipo", "habitaciones", "canon", "amoblado", "periodo", "rnt", "ph_permite"];
    const nuevos = {};
    for (const campo of CAMPOS) {
      const v = input?.[campo];
      if (v === undefined || v === null) continue;
      if (typeof v === "string" && !v.trim()) continue;
      nuevos[campo] = typeof v === "string" ? v.trim() : v;
    }
    const ficha = { ...(ctx.lead.inmueble_ofrecido || {}), ...nuevos };
    ctx.lead.inmueble_ofrecido = ficha;
    // Best-effort como `intencion`: sin la columna la ficha igual viaja en la
    // alerta de este turno (ctx.lead).
    try {
      await leads.update(ctx.lead.id, { inmueble_ofrecido: ficha });
    } catch (e) {
      console.warn("[tools] No se pudo persistir inmueble_ofrecido (revisar migracion 2026-10-16_kit_publicacion):", e.message);
    }
    const falta = ["zona", "tipo"].filter((c) => !ficha[c]);
    return `Datos del inmueble registrados. ${
      falta.length
        ? `Todavia falta: ${falta.join(", ")}.`
        : "Con zona, tipo y su nombre ya puedes transferir con especialidad arriendo e intencion consignar_arriendo."
    }`;
  }
```

En `resolveLeadAdvisor`, la línea de `sigueFlujoEspecial`:

```js
  const sigueFlujoEspecial =
    intencion === "vender" || intencion === "consignar_arriendo" || intencion === "vehiculos" || especialidad === "vehiculos";
```

En el handler `transferir_a_asesor`:

```js
    const ESP_POR_INTENCION = { vender: "venta", comprar: "venta", arrendar: "arriendo", consignar_arriendo: "arriendo", vehiculos: "vehiculos" };
```

(la línea de `categoria` queda igual: `consignar_arriendo` → especialidad `arriendo` → `alquiler`).

- [ ] **Step 5: Correr y ver que pasa**

Run: `node --test test/duenos-arriendo-tools.test.js test/captador-transfer.test.js`
Expected: PASS.

- [ ] **Step 6: Suite completa**

Run: `npm test`
Expected: verde. Si un test viejo fija el texto exacto de una descripción de tool que se cambió, actualizar ese texto esperado en el test (no la descripción).

- [ ] **Step 7: Commit**

```bash
git add src/agent/tools.js test/duenos-arriendo-tools.test.js
git commit -m "feat(sofi): ficha del dueno que quiere arrendar y transferencia a arriendo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: La alerta a la asesora dice "Dueño · …" y trae la ficha

**Files:**
- Modify: `src/notifications/advisor.js:4-9` (`INTENCION_LABEL`), `:374-413` (`buildAdvisorAlert`), y el bloque de `buildClientLink` (~l.64) para el texto del link del cliente
- Test: `test/alerta-dueno-arriendo.test.js`

**Interfaces:**
- Consumes: `lead.intencion = "consignar_arriendo"`, `lead.inmueble_ofrecido` (Task 4).
- Produces: `fichaInmuebleOfrecido(ficha): string[]` (exportada para tests).

- [ ] **Step 1: Test que falla** (`test/alerta-dueno-arriendo.test.js`)

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { buildAdvisorAlert, fichaInmuebleOfrecido } = require("../src/notifications/advisor");

const org = { id: "org-1", name: "Diamond" };

function lead(extra = {}) {
  return { id: "l1", phone: "573001112233", nombre: "Marta Restrepo", score: 40, intencion: "consignar_arriendo", ...extra };
}

test("renta corta: encabezado y ficha con RNT y edificio", () => {
  const txt = buildAdvisorAlert(org, lead({
    inmueble_ofrecido: { tipo: "apartamento", zona: "Provenza, El Poblado", habitaciones: 2, amoblado: "si", canon: "$280.000 por noche", periodo: "corta", rnt: "en tramite", ph_permite: "si" },
  }), "dueno quiere arrendar", null, "arriendo", null, null);
  assert.match(txt, /Dueño · renta corta/);
  assert.match(txt, /Inmueble: apartamento amoblado/);
  assert.match(txt, /Zona: Provenza, El Poblado/);
  assert.match(txt, /Espera: \$280\.000 por noche/);
  assert.match(txt, /RNT: en tramite/);
  assert.match(txt, /Edificio permite renta corta: si/);
  assert.doesNotMatch(txt, /Propiedad de interes/);
});

test("arriendo mensual: encabezado propio y sin lineas de renta corta", () => {
  const txt = buildAdvisorAlert(org, lead({ inmueble_ofrecido: { tipo: "casa", zona: "Envigado", periodo: "mensual" } }), "m", null, "arriendo", null, null);
  assert.match(txt, /Dueño · arriendo mensual/);
  assert.doesNotMatch(txt, /RNT/);
});

test("sin ficha todavia: encabezado generico de dueno", () => {
  const txt = buildAdvisorAlert(org, lead(), "m", null, "arriendo", null, null);
  assert.match(txt, /Dueño · quiere arrendar su propiedad/);
});

test("fichaInmuebleOfrecido omite lo que no esta", () => {
  assert.deepStrictEqual(fichaInmuebleOfrecido({ zona: "Sabaneta" }), ["Zona: Sabaneta"]);
  assert.deepStrictEqual(fichaInmuebleOfrecido(null), []);
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `node --test test/alerta-dueno-arriendo.test.js`
Expected: FAIL.

- [ ] **Step 3: Implementar**

En `INTENCION_LABEL` agregar:

```js
  consignar_arriendo: "Dueño · quiere arrendar su propiedad",
```

Encima de `buildAdvisorAlert`:

```js
// Ficha del inmueble de un dueno que quiere arrendar (spec 2026-10-16 §4.3).
// Solo lo que dijo: un dato que falta no aparece.
function fichaInmuebleOfrecido(ficha) {
  if (!ficha || typeof ficha !== "object") return [];
  const inmueble = [ficha.tipo, ficha.amoblado === "si" ? "amoblado" : ficha.amoblado === "no" ? "sin amoblar" : null]
    .filter(Boolean)
    .join(" ");
  const corta = ficha.periodo === "corta";
  return [
    inmueble && `Inmueble: ${inmueble}`,
    ficha.zona && `Zona: ${ficha.zona}`,
    ficha.habitaciones && `Alcobas: ${ficha.habitaciones}`,
    ficha.canon && `Espera: ${ficha.canon}`,
    corta && ficha.rnt && `RNT: ${ficha.rnt}`,
    corta && ficha.ph_permite && `Edificio permite renta corta: ${ficha.ph_permite.replace("_", " ")}`,
  ].filter(Boolean);
}

function encabezadoDueno(lead) {
  const periodo = lead.inmueble_ofrecido?.periodo;
  if (periodo === "corta") return "Dueño · renta corta";
  if (periodo === "mensual") return "Dueño · arriendo mensual";
  return INTENCION_LABEL.consignar_arriendo;
}
```

En `buildAdvisorAlert`:

```js
  const esDuenoArriendo = intencion === "consignar_arriendo";
  const encabezadoIntencion = esDuenoArriendo ? encabezadoDueno(lead) : INTENCION_LABEL[intencion];
```

(reemplaza la línea `const encabezadoIntencion = INTENCION_LABEL[intencion];`). En el arreglo `lines`, justo después de `Numero: …` / `idiomaLine(lead)`, agregar `...(esDuenoArriendo ? fichaInmuebleOfrecido(lead.inmueble_ofrecido) : []),` y cambiar la condición del bloque de propiedad:

```js
    esVendedor || esDuenoArriendo
      ? lead.property_ref_origen && `Entro por la publicacion: ${lead.property_ref_origen}`
      : propertyInteres
```

En `buildClientLink`, después del `else if (intencion === "vender") { … }`:

```js
  } else if (intencion === "consignar_arriendo") {
    texto = en ? `${saludo}I want to rent out my property with you` : `${saludo}quiero poner en arriendo mi propiedad con ustedes`;
```

Exportar `fichaInmuebleOfrecido` en `module.exports`.

- [ ] **Step 4: Correr y ver que pasa**

Run: `node --test test/alerta-dueno-arriendo.test.js` y luego `npm test`
Expected: PASS y suite en verde.

- [ ] **Step 5: Commit**

```bash
git add src/notifications/advisor.js test/alerta-dueno-arriendo.test.js
git commit -m "feat(alertas): la asesora recibe la ficha del dueno que quiere arrendar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Reglas del prompt para el dueño que arrienda

**Files:**
- Modify: `src/agent/prompts.js` (después de la regla 33, ~l.303)
- Test: `test/prompt-dueno-arriendo.test.js`

- [ ] **Step 1: Test que falla** (`test/prompt-dueno-arriendo.test.js`)

`buildSystemPrompt(org)` (`src/agent/prompts.js:341`) devuelve un arreglo de bloques `{ text }`, igual que lo usa `test/agendar-cita.test.js:187`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const prompts = require("../src/agent/prompts");

function textoDelPrompt() {
  const p = prompts.buildSystemPrompt({ id: "org-1", name: "Diamond" });
  return Array.isArray(p) ? p.map((b) => b.text || "").join("\n") : String(p);
}

test("el prompt tiene el flujo del dueno que quiere arrendar", () => {
  const t = textoDelPrompt();
  assert.match(t, /DUENO QUE QUIERE ARRENDAR/);
  assert.match(t, /consignar_arriendo/);
  assert.match(t, /registrar_inmueble_ofrecido/);
  assert.match(t, /RNT/);
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `node --test test/prompt-dueno-arriendo.test.js`
Expected: FAIL en `DUENO QUE QUIERE ARRENDAR`.

- [ ] **Step 3: Agregar las reglas** (después de la regla 33, antes de la siguiente sección; numerar 33a-33d para no renumerar el resto)

```
DUENO QUE QUIERE ARRENDAR SU PROPIEDAD (captacion para arriendo — mensual o por noches):
33a. Si el cliente es DUENO y quiere que le arrendemos SU inmueble ("quiero arrendar mi apto", "tengo un apartamento para rentar", "lo quiero poner en Airbnb"), registralo de una con registrar_dato_lead campo "intencion" valor "consignar_arriendo". No es alguien que busca arrendar: NUNCA le ofrezcas inventario ni le armes un link de "estoy interesado".
33b. Arma su ficha de a poco, una o dos preguntas por mensaje, sin repetir lo que ya te dijo: zona y barrio, tipo de inmueble, alcobas, cuanto espera recibir, si esta amoblado, y si es arriendo mensual o por noches. Cada dato que te cuente lo guardas con registrar_inmueble_ofrecido.
33c. Si es por noches (renta corta / Airbnb), pregunta tambien si tiene RNT (Registro Nacional de Turismo) y si el edificio permite renta por noches. Solo lo anotas: no le das asesoria legal ni le prometes que se puede.
33d. Con zona, tipo y su nombre, transfierelo con transferir_a_asesor especialidad "arriendo" e intencion "consignar_arriendo", y dile que la asesora de arriendos lo contacta para coordinar la visita al inmueble. Lo que falte lo completa ella.
```

Y en la regla 31, al final de la frase `(Igual registra "comprar" o "arrendar" cuando quede clara la intencion del que busca inmueble.)` agregar: ` Si es dueno y quiere ARRENDAR su inmueble, aplica 33a-33d.`

- [ ] **Step 4: Correr y ver que pasa**

Run: `node --test test/prompt-dueno-arriendo.test.js` y `npm test`
Expected: PASS y suite verde. Si un test de cache fija el tamaño del bloque estable del prompt (`grep -ln "cache" test/*.test.js`), actualizar el número esperado y anotar en el commit el tamaño nuevo.

- [ ] **Step 5: Golden set con la clave de producción (lo corre quien ejecute el plan con acceso a Railway)**

Run: `railway run --service diamond node scripts/golden-revalidar.js`
Expected: 6/6 como el 2026-09-07. Si baja, **parar** y reportar a Juan antes de seguir.

- [ ] **Step 6: Commit**

```bash
git add src/agent/prompts.js test/prompt-dueno-arriendo.test.js
git commit -m "feat(sofi): reglas para captar al dueno que quiere arrendar (mensual o por noches)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `redactar.postGrupo` — el texto del post

**Files:**
- Modify: `src/groups/redactar.js` (función nueva y export)
- Test: `test/kit-post.test.js`

**Interfaces:**
- Consumes: `tituloUtil`, `textoAdministracion`, `formato.*`, `linkContactoOficial` (ya en el archivo).
- Produces: `postGrupo(propiedad, { org = null, comision = true } = {}): string`. `propiedad` es una fila de `properties` pasada por `withLandingLink` (trae `linkWasi`).

- [ ] **Step 1: Test que falla** (`test/kit-post.test.js`)

```js
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const { postGrupo } = require("../src/groups/redactar");

let previo;
beforeEach(() => { previo = process.env.CONTACT_WHATSAPP_NUMBER; process.env.CONTACT_WHATSAPP_NUMBER = "573044653609"; });
afterEach(() => { if (previo === undefined) delete process.env.CONTACT_WHATSAPP_NUMBER; else process.env.CONTACT_WHATSAPP_NUMBER = previo; });

function prop(extra = {}) {
  return {
    ref: "10077063",
    titulo: "Apartamento en La Frontera",
    zona: "Envigado",
    operacion: "Venta",
    area: "85m2",
    habitaciones: 3,
    precio: "$480.000.000",
    banos: 2,
    garajes: 1,
    estrato: 4,
    administracion: "$350.000",
    caracteristicas: "Piscina, Gimnasio, Porteria 24 h",
    linkWasi: "https://info.wasi.co/apartamento-venta-envigado/10077063?shared=whatsapp",
    ...extra,
  };
}

test("post completo: titulo, identidad, medidas, detalles, comision y los dos links", () => {
  const t = postGrupo(prop());
  const lineas = t.split("\n");
  assert.strictEqual(lineas[0], "Apartamento en La Frontera");
  assert.strictEqual(lineas[1], "Ref 10077063 · Venta · Envigado");
  assert.match(t, /3 alcobas/);
  assert.match(t, /\$480\.000\.000/);
  assert.match(t, /administración \$350\.000/);
  assert.match(t, /Piscina · Gimnasio · Porteria 24 h/);
  assert.match(t, /Comparto comisión con colegas/);
  assert.match(t, /Fotos y ficha: https:\/\/info\.wasi\.co\/apartamento-venta-envigado\/10077063/);
  assert.match(t, /Info o visita con Sofi: https:\/\/wa\.me\/573044653609\?text=Hola%2C%20vi%20en%20un%20grupo%20la%20Ref%2010077063/);
});

test("sin comision no aparece la linea", () => {
  assert.doesNotMatch(postGrupo(prop(), { comision: false }), /comisión/);
});

test("lo que no esta cargado no aparece", () => {
  const t = postGrupo(prop({ banos: null, garajes: null, estrato: null, administracion: null, caracteristicas: "" }));
  assert.doesNotMatch(t, /baño|garaje|estrato|administración/);
  assert.doesNotMatch(t, /undefined|null|NaN/);
});

test("sin numero oficial de contacto se omite la linea de Sofi", () => {
  delete process.env.CONTACT_WHATSAPP_NUMBER;
  const t = postGrupo(prop());
  assert.doesNotMatch(t, /Sofi/);
  assert.match(t, /Fotos y ficha:/);
});

test("nunca lleva el indice '1)' ni sangria de la ficha del DM", () => {
  const t = postGrupo(prop());
  assert.doesNotMatch(t, /^1\)/m);
  assert.doesNotMatch(t, /^ {3}/m);
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `node --test test/kit-post.test.js`
Expected: FAIL con `postGrupo is not a function`.

- [ ] **Step 3: Implementar** (en `src/groups/redactar.js`, después de `ficha()`)

```js
// EL POST DEL KIT DE PUBLICACION (spec 2026-10-16 §3.3). La asesora lo pega
// en sus grupos desde su celular junto con las fotos. Mismos datos que la
// ficha del DM —se reusan sus helpers para que "lo no cargado no aparece"
// sea una sola regla—, pero sin el "1)" ni la sangria: es un post suelto, no
// un item de una lista. Nunca lleva el nombre ni el celular de la asesora.
// El link a Sofi trae la ref escrita para que el lead quede atribuido
// (src/agent/kit-origen.js).
function postGrupo(propiedad, { org = null, comision = true } = {}) {
  const titulo = tituloUtil(propiedad) || `Propiedad Ref ${propiedad.ref}`;
  const identidad = [`Ref ${propiedad.ref}`, String(propiedad.operacion || "").trim() || null, String(propiedad.zona || "").trim() || null]
    .filter(Boolean)
    .join(" · ");
  const medidas = [
    formato.formatearArea(propiedad.area),
    formato.pluralizar(propiedad.habitaciones, "alcoba"),
    formato.formatearPrecio(propiedad.precio),
  ]
    .filter(Boolean)
    .join(" · ");
  const detalles = [
    formato.pluralizar(propiedad.banos, "baño", "baños"),
    formato.pluralizar(propiedad.garajes, "garaje"),
    formato.datoCargado(propiedad.estrato) ? `estrato ${propiedad.estrato}` : null,
    textoAdministracion(propiedad.administracion),
  ]
    .filter(Boolean)
    .join(" · ");
  const caracteristicas = String(propiedad.caracteristicas || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 6)
    .join(" · ");

  const lineas = [titulo, identidad, medidas, detalles, caracteristicas].filter(Boolean);
  if (comision) lineas.push("", "Comparto comisión con colegas 🤝");
  lineas.push("", `Fotos y ficha: ${propiedad.linkWasi}`);
  const sofi = linkContactoOficial(org, `Hola, vi en un grupo la Ref ${propiedad.ref}`);
  if (sofi) lineas.push(`Info o visita con Sofi: ${sofi}`);
  return lineas.join("\n");
}
```

Agregar `postGrupo` al `module.exports` de `redactar.js`.

- [ ] **Step 4: Correr y ver que pasa**

Run: `node --test test/kit-post.test.js test/group-redactar.test.js`
Expected: PASS. Si el formato de `formatearArea`/`pluralizar` difiere de lo esperado (por ejemplo "85 m²"), ajustar solo las aserciones de formato del test a lo que devuelve `formato`, no el helper.

- [ ] **Step 5: Commit**

```bash
git add src/groups/redactar.js test/kit-post.test.js
git commit -m "feat(kit): texto del post para grupos, sin IA

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Módulo `src/groups/kit.js` y endpoints del bot

**Files:**
- Create: `src/groups/kit.js`
- Modify: `src/api/crm.js` (tres rutas nuevas, después de `/api/grupos/metricas`)
- Test: `test/kit.test.js`, `test/crm-api-kit.test.js`

**Interfaces:**
- Consumes: `postGrupo` (Task 7), `withLandingLink` y `enlazarWasiPublico` (`src/data/properties.js`), `estadoDelInventario` (`src/data/sync-estado.js`), `REFS_BLOQUEADAS` (`src/groups/publicable.js`), `verificar` (`src/groups/verificar-link.js`), `aliasPublico` (`src/lib/identidad-publica.js`).
- Produces:
  - `aptaParaKit(p, { refsBloqueadas }): boolean` (pura)
  - `etiquetaUltima(publicacion, aliasPorUsuario, ahora): { texto, reciente } ` (pura)
  - `listar(org, { operacion, zona }): Promise<{ fresco, items: Item[], kpis }>` donde `Item = { ref, titulo, zona, operacion, area, habitaciones, precio, foto, etiqueta: { texto, reciente } }` y `kpis = { compartidasSemana, clientesSemana, listas }`
  - `post(org, ref, { comision }): Promise<{ texto, fotos: string[], linkOk: boolean } | null>`
  - `registrar(org, { ref, userId, accion }): Promise<{ ok: boolean }>`
  - Rutas `POST /api/kit/propiedades {operacion, zona?}`, `POST /api/kit/post {ref, comision}`, `POST /api/kit/registrar {ref, userId, accion}`.

- [ ] **Step 1: Test de las partes puras** (`test/kit.test.js`)

```js
const { test } = require("node:test");
const assert = require("node:assert");
const kit = require("../src/groups/kit");

const base = {
  ref: "10077063", disponible: true, link: "https://info.wasi.co/apartamento-venta-envigado/10077063",
  images: ["https://img/1.jpg", "https://img/2.jpg"], titulo: "Apto", zona: "Envigado", operacion: "Venta",
};

test("aptaParaKit: disponible, con link de Wasi, con foto y no bloqueada", () => {
  const bloq = new Set(["9921388"]);
  assert.strictEqual(kit.aptaParaKit(base, { refsBloqueadas: bloq }), true);
  assert.strictEqual(kit.aptaParaKit({ ...base, disponible: false }, { refsBloqueadas: bloq }), false);
  assert.strictEqual(kit.aptaParaKit({ ...base, link: "" }, { refsBloqueadas: bloq }), false);
  assert.strictEqual(kit.aptaParaKit({ ...base, images: [] }, { refsBloqueadas: bloq }), false);
  assert.strictEqual(kit.aptaParaKit({ ...base, ref: "9921388" }, { refsBloqueadas: bloq }), false);
});

test("etiquetaUltima: nunca, reciente con alias, vieja", () => {
  const ahora = new Date("2026-10-16T12:00:00Z");
  assert.deepStrictEqual(kit.etiquetaUltima(null, {}, ahora), { texto: "Nunca compartida", reciente: false });
  assert.deepStrictEqual(
    kit.etiquetaUltima({ user_id: "u1", created_at: "2026-10-14T12:00:00Z" }, { u1: "Asesor 1" }, ahora),
    { texto: "Compartida hace 2 días por Asesor 1", reciente: true }
  );
  assert.deepStrictEqual(
    kit.etiquetaUltima({ user_id: "u9", created_at: "2026-10-07T12:00:00Z" }, {}, ahora),
    { texto: "Compartida hace 9 días", reciente: false }
  );
  assert.deepStrictEqual(
    kit.etiquetaUltima({ user_id: "u1", created_at: "2026-10-16T09:00:00Z" }, { u1: "Asesor 1" }, ahora),
    { texto: "Compartida hoy por Asesor 1", reciente: true }
  );
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `node --test test/kit.test.js`
Expected: FAIL con `Cannot find module '../src/groups/kit'`.

- [ ] **Step 3: Implementar `src/groups/kit.js`**

```js
// Kit de publicacion en grupos (spec docs/superpowers/specs/2026-10-16-kit-
// publicacion-y-duenos-arriendo-design.md §3). La asesora comparte desde SU
// celular: aca no se envia nada a WhatsApp, solo se decide QUE propiedades se
// pueden publicar, se arma el texto y se registra quien compartio que.
const supabase = require("../data/supabase");
const { withLandingLink } = require("../data/properties");
const { estadoDelInventario } = require("../data/sync-estado");
const { REFS_BLOQUEADAS } = require("./publicable");
const verificarLink = require("./verificar-link");
const { postGrupo } = require("./redactar");
const { aliasPublico } = require("../lib/identidad-publica");

const FOTOS_MAX = 4;
const DIAS_RECIENTE = 7;
const DIA_MS = 86400000;

// Sin pedido de por medio: solo la calidad del dato. Lo que no pasa no se
// muestra, para que nunca salga una vendida o una sin link.
function aptaParaKit(p, { refsBloqueadas = REFS_BLOQUEADAS } = {}) {
  if (!p || p.disponible !== true) return false;
  if (!String(p.link || "").trim()) return false;
  if (!Array.isArray(p.images) || p.images.filter(Boolean).length === 0) return false;
  if (refsBloqueadas.has(String(p.ref || "").toUpperCase())) return false;
  return true;
}

function etiquetaUltima(publicacion, aliasPorUsuario, ahora = new Date()) {
  if (!publicacion) return { texto: "Nunca compartida", reciente: false };
  const dias = Math.floor((ahora.getTime() - new Date(publicacion.created_at).getTime()) / DIA_MS);
  const cuando = dias <= 0 ? "hoy" : dias === 1 ? "hace 1 día" : `hace ${dias} días`;
  const alias = aliasPorUsuario[publicacion.user_id];
  return { texto: `Compartida ${cuando}${alias ? ` por ${alias}` : ""}`, reciente: dias < DIAS_RECIENTE };
}

// Ultima publicacion por ref. Best-effort: sin la tabla, todo "Nunca".
async function ultimasPublicaciones(orgId) {
  const { data, error } = await supabase
    .from("kit_publicaciones")
    .select("property_ref, user_id, created_at")
    .eq("org_id", orgId)
    .gte("created_at", new Date(Date.now() - 60 * DIA_MS).toISOString())
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[kit] No se pudo leer kit_publicaciones (revisar migracion 2026-10-16_kit_publicacion):", error.message);
    return [];
  }
  return data || [];
}

// Alias publico por auth user id: nunca el nombre.
async function aliasPorUsuario(orgId) {
  const { data, error } = await supabase.from("advisors").select("auth_user_id, alias_publico, name").eq("org_id", orgId);
  if (error) return {};
  const mapa = {};
  for (const a of data || []) if (a.auth_user_id) mapa[a.auth_user_id] = aliasPublico(a);
  return mapa;
}

async function contarDesde(tabla, orgId, columna, desdeIso) {
  const { count, error } = await supabase
    .from(tabla)
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .gte(columna, desdeIso);
  return error ? null : count;
}

async function listar(org, { operacion = "Venta", zona = null } = {}) {
  const inventario = await estadoDelInventario(org.id);
  if (!inventario.fresco) return { fresco: false, horas: inventario.horas, items: [], kpis: null };

  let q = supabase.from("properties").select("*").eq("org_id", org.id).eq("disponible", true).eq("operacion", operacion);
  if (zona) q = q.ilike("zona", `%${zona}%`);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(300);
  if (error) throw error;

  const [publicaciones, alias] = await Promise.all([ultimasPublicaciones(org.id), aliasPorUsuario(org.id)]);
  const ultimaPorRef = {};
  for (const p of publicaciones) if (!ultimaPorRef[p.property_ref]) ultimaPorRef[p.property_ref] = p;

  const ahora = new Date();
  const items = (data || [])
    .filter((p) => aptaParaKit(p))
    .map((p) => ({
      ref: p.ref,
      titulo: p.titulo,
      zona: p.zona,
      operacion: p.operacion,
      area: p.area,
      habitaciones: p.habitaciones,
      precio: p.precio,
      foto: p.images.filter(Boolean)[0],
      etiqueta: etiquetaUltima(ultimaPorRef[p.ref], alias, ahora),
    }));

  const semana = new Date(ahora.getTime() - 7 * DIA_MS).toISOString();
  const [compartidasSemana, clientesSemana] = await Promise.all([
    contarDesde("kit_publicaciones", org.id, "created_at", semana),
    contarDesde("leads", org.id, "kit_at", semana),
  ]);
  return { fresco: true, horas: inventario.horas, items, kpis: { compartidasSemana, clientesSemana, listas: items.length } };
}

async function post(org, ref, { comision = true } = {}) {
  const { data, error } = await supabase
    .from("properties")
    .select("*")
    .eq("org_id", org.id)
    .eq("disponible", true)
    .ilike("ref", ref)
    .maybeSingle();
  if (error) throw error;
  if (!data || !aptaParaKit(data)) return null;
  const propiedad = withLandingLink(data, org.landing_base_url);
  // El link se verifica al abrir la ficha, no al listar (spec §3.2).
  const { verificadas } = await verificarLink.verificar([propiedad]);
  return {
    texto: postGrupo(propiedad, { org, comision }),
    fotos: propiedad.images.filter(Boolean).slice(0, FOTOS_MAX),
    linkOk: verificadas.length === 1,
  };
}

const ACCIONES = new Set(["compartir", "copiar", "descargar"]);

async function registrar(org, { ref, userId = null, accion }) {
  if (!ref || !ACCIONES.has(accion)) return { ok: false };
  const { error } = await supabase
    .from("kit_publicaciones")
    .insert({ org_id: org.id, property_ref: String(ref), user_id: userId, accion });
  if (error) {
    console.warn("[kit] No se pudo registrar la publicacion (revisar migracion 2026-10-16_kit_publicacion):", error.message);
    return { ok: false };
  }
  return { ok: true };
}

module.exports = { aptaParaKit, etiquetaUltima, listar, post, registrar, FOTOS_MAX, ACCIONES };
```

Verificar con `grep -n "module.exports" src/lib/identidad-publica.js src/data/sync-estado.js` que los nombres importados existen (sí, según la exploración del 2026-10-16: `aliasPublico`, `estadoDelInventario`).

- [ ] **Step 4: Correr y ver que pasa**

Run: `node --test test/kit.test.js`
Expected: PASS.

- [ ] **Step 5: Test de las rutas** (`test/crm-api-kit.test.js`, mismo patrón que `crm-api-amoblados.test.js`)

```js
const { test } = require("node:test");
const assert = require("node:assert");
const router = require("../src/api/crm");
const kit = require("../src/groups/kit");
const organizations = require("../src/data/organizations");

function handler(path) {
  const capa = router.stack.find((c) => c.route?.path === path && c.route.methods.post);
  assert.ok(capa, `No existe POST ${path}`);
  return capa.route.stack[capa.route.stack.length - 1].handle;
}

async function llamar(path, body) {
  let cuerpo = null;
  let status = 200;
  const res = { json: (b) => { cuerpo = b; return res; }, status: (s) => { status = s; return res; } };
  await handler(path)({ body }, res);
  return { status, cuerpo };
}

const ORG = { id: "org-1", name: "Diamond" };

test("propiedades: pasa operacion y zona al modulo", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  const listar = t.mock.method(kit, "listar", async () => ({ fresco: true, items: [], kpis: {} }));
  const r = await llamar("/api/kit/propiedades", { operacion: "Arriendo", zona: "Envigado" });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(listar.mock.calls[0].arguments, [ORG, { operacion: "Arriendo", zona: "Envigado" }]);
});

test("propiedades: operacion invalida cae a Venta", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  const listar = t.mock.method(kit, "listar", async () => ({ fresco: true, items: [], kpis: {} }));
  await llamar("/api/kit/propiedades", { operacion: "DROP" });
  assert.strictEqual(listar.mock.calls[0].arguments[1].operacion, "Venta");
});

test("post: 404 si la propiedad no se puede publicar", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  t.mock.method(kit, "post", async () => null);
  const r = await llamar("/api/kit/post", { ref: "999" });
  assert.strictEqual(r.status, 404);
});

test("post: sin ref es 400", async (t) => {
  const r = await llamar("/api/kit/post", {});
  assert.strictEqual(r.status, 400);
});

test("registrar: devuelve lo del modulo", async (t) => {
  t.mock.method(organizations, "getDefault", async () => ORG);
  const reg = t.mock.method(kit, "registrar", async () => ({ ok: true }));
  const r = await llamar("/api/kit/registrar", { ref: "10077063", userId: "u1", accion: "compartir" });
  assert.deepStrictEqual(r.cuerpo, { ok: true });
  assert.deepStrictEqual(reg.mock.calls[0].arguments[1], { ref: "10077063", userId: "u1", accion: "compartir" });
});
```

- [ ] **Step 6: Rutas en `src/api/crm.js`** (después del handler de `/api/grupos/metricas`)

```js
// ── Kit de publicacion (spec 2026-10-16) ───────────────────────────────
// Se llama `kit.<funcion>` (no destructurado) para que los tests puedan
// pisarlas con t.mock.method.
const kit = require("../groups/kit");

router.post("/api/kit/propiedades", async (req, res) => {
  try {
    const org = await organizations.getDefault();
    const operacion = req.body?.operacion === "Arriendo" ? "Arriendo" : "Venta";
    const zona = String(req.body?.zona || "").trim() || null;
    res.json(await kit.listar(org, { operacion, zona }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/kit/post", async (req, res) => {
  const ref = String(req.body?.ref || "").trim();
  if (!ref) return res.status(400).json({ error: "Falta la ref" });
  try {
    const org = await organizations.getDefault();
    const r = await kit.post(org, ref, { comision: req.body?.comision !== false });
    if (!r) return res.status(404).json({ error: "Esta propiedad no se puede publicar (no disponible, sin link o sin fotos)" });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/kit/registrar", async (req, res) => {
  try {
    const org = await organizations.getDefault();
    const { ref, userId = null, accion } = req.body || {};
    res.json(await kit.registrar(org, { ref, userId, accion }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 7: Correr y ver que pasa**

Run: `node --test test/crm-api-kit.test.js test/kit.test.js` y `npm test`
Expected: PASS y suite verde.

- [ ] **Step 8: Commit**

```bash
git add src/groups/kit.js src/api/crm.js test/kit.test.js test/crm-api-kit.test.js
git commit -m "feat(kit): inventario publicable, post y registro expuestos al CRM

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Rutas del CRM (proxy y fotos)

**Files:**
- Create: `crm/app/api/kit/route.ts`, `crm/app/api/kit/foto/route.ts`

**Interfaces:**
- Consumes: rutas del bot de Task 8; `callBot` (`crm/lib/bot.ts`); `createClient` (`crm/lib/supabase/server`); `createAdminClient` (`crm/lib/supabase/admin`).
- Produces: `POST /api/kit` con `{ action: "propiedades" | "post" | "registrar", … }`; `GET /api/kit/foto?ref=…&i=0..3` que devuelve la imagen.

- [ ] **Step 1: `crm/app/api/kit/route.ts`**

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callBot } from "@/lib/bot";

// Proxy autenticado al kit de publicacion del bot (spec 2026-10-16 §3.2).
// Cualquier usuario logueado del CRM puede usarlo: no hace falta ser admin.
// El userId que se registra sale de la sesion, nunca del browser.
export const maxDuration = 30;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const action = body.action as "propiedades" | "post" | "registrar";

  const llamada =
    action === "propiedades"
      ? callBot("/api/kit/propiedades", { operacion: body.operacion, zona: body.zona })
      : action === "post"
        ? callBot("/api/kit/post", { ref: body.ref, comision: body.comision !== false })
        : action === "registrar"
          ? callBot("/api/kit/registrar", { ref: body.ref, accion: body.accion, userId: user.id })
          : null;
  if (!llamada) return NextResponse.json({ error: "Acción inválida" }, { status: 400 });

  const r = await llamada;
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}
```

- [ ] **Step 2: `crm/app/api/kit/foto/route.ts`**

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Foto i de una propiedad, servida desde el CRM para que el navegador pueda
// armar los archivos de navigator.share (Wasi no deja bajarlas por CORS).
// NO es un proxy abierto: la URL sale de properties.images de esa ref, nunca
// de un parametro (spec 2026-10-16 §3.4).
const FOTOS_MAX = 4;

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const url = new URL(request.url);
  const ref = (url.searchParams.get("ref") || "").trim();
  const i = Number(url.searchParams.get("i"));
  if (!ref || !Number.isInteger(i) || i < 0 || i >= FOTOS_MAX) {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data } = await admin.from("properties").select("images").ilike("ref", ref).eq("disponible", true).maybeSingle();
  const fotos = Array.isArray(data?.images) ? (data.images as string[]).filter(Boolean) : [];
  const fuente = fotos[i];
  if (!fuente) return NextResponse.json({ error: "No existe esa foto" }, { status: 404 });

  const res = await fetch(fuente, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res || !res.ok) return NextResponse.json({ error: "No se pudo traer la foto" }, { status: 502 });
  const tipo = res.headers.get("content-type") || "image/jpeg";
  if (!tipo.startsWith("image/")) return NextResponse.json({ error: "No es una imagen" }, { status: 502 });

  return new NextResponse(res.body, {
    headers: { "content-type": tipo, "cache-control": "private, max-age=3600" },
  });
}
```

Si el CRM es multi-org en `properties` (verificar con `grep -rn "org_id" crm/app/\(dashboard\)/amoblados/page.tsx`), agregar el mismo filtro de org que use esa página.

- [ ] **Step 3: Lint y build**

Run: `cd crm && npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add crm/app/api/kit
git commit -m "feat(crm): rutas del kit de publicacion y fotos para compartir

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Página `/kit` del CRM

**Files:**
- Create: `crm/app/(dashboard)/kit/page.tsx`, `crm/components/kit-publicacion.tsx`
- Modify: `crm/app/(dashboard)/layout.tsx` (arreglo `links`, después de "Amoblados")

**Interfaces:**
- Consumes: `POST /api/kit` y `GET /api/kit/foto` (Task 9).

- [ ] **Step 1: Página** (`crm/app/(dashboard)/kit/page.tsx`)

```tsx
import KitPublicacion from "@/components/kit-publicacion";

export const metadata = { title: "Kit de publicación" };

export default function KitPage() {
  return <KitPublicacion />;
}
```

- [ ] **Step 2: Componente** (`crm/components/kit-publicacion.tsx`), fiel al mockup aprobado: KPIs de color sólido, Venta/Arriendo, chips de zona, lista, ficha con galería, texto, interruptor de comisión, botón verde Compartir y Copiar / Descargar.

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";

type Etiqueta = { texto: string; reciente: boolean };
type Item = {
  ref: string;
  titulo: string | null;
  zona: string | null;
  operacion: string;
  area: string | null;
  habitaciones: number | null;
  precio: string | null;
  foto: string;
  etiqueta: Etiqueta;
};
type Lista = {
  fresco: boolean;
  horas: number | null;
  items: Item[];
  kpis: { compartidasSemana: number | null; clientesSemana: number | null; listas: number } | null;
};
type Post = { texto: string; fotos: string[]; linkOk: boolean };

const ZONAS = ["Envigado", "El Poblado", "Laureles", "Sabaneta", "Itagüí", "Belén"];

async function kitApi<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/kit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Error del servidor");
  return data as T;
}

async function fotosComoArchivos(ref: string, cantidad: number): Promise<File[]> {
  const archivos = await Promise.all(
    Array.from({ length: cantidad }, async (_, i) => {
      const res = await fetch(`/api/kit/foto?ref=${encodeURIComponent(ref)}&i=${i}`).catch(() => null);
      if (!res || !res.ok) return null;
      const blob = await res.blob();
      const ext = blob.type.split("/")[1] || "jpg";
      return new File([blob], `ref-${ref}-${i + 1}.${ext}`, { type: blob.type });
    })
  );
  return archivos.filter((f): f is File => f !== null);
}

export default function KitPublicacion() {
  const [operacion, setOperacion] = useState<"Venta" | "Arriendo">("Venta");
  const [zona, setZona] = useState<string | null>(null);
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elegida, setElegida] = useState<Item | null>(null);

  const cargar = useCallback(async () => {
    setLista(null);
    setError(null);
    try {
      setLista(await kitApi<Lista>({ action: "propiedades", operacion, zona }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [operacion, zona]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (elegida) return <FichaPost item={elegida} onVolver={() => { setElegida(null); cargar(); }} />;

  return (
    <div className="mx-auto w-full max-w-md px-3 py-4">
      <h1 className="mb-3 text-lg font-semibold text-slate-900">Kit de publicación</h1>

      {lista?.kpis && (
        <div className="mb-3 grid grid-cols-3 gap-2">
          <Kpi color="bg-indigo-600" valor={lista.kpis.compartidasSemana} texto="compartidas esta semana" />
          <Kpi color="bg-teal-600" valor={lista.kpis.clientesSemana} texto="clientes llegaron a Sofi" />
          <Kpi color="bg-amber-600" valor={lista.kpis.listas} texto="listas para publicar" />
        </div>
      )}

      <div className="mb-2 flex rounded-lg bg-slate-200 p-1">
        {(["Venta", "Arriendo"] as const).map((op) => (
          <button
            key={op}
            onClick={() => setOperacion(op)}
            className={`flex-1 rounded-md py-1.5 text-sm ${operacion === op ? "bg-white font-semibold text-slate-900 shadow-sm" : "text-slate-500"}`}
          >
            {op}
          </button>
        ))}
      </div>

      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
        <Chip activo={zona === null} onClick={() => setZona(null)}>Todas las zonas</Chip>
        {ZONAS.map((z) => (
          <Chip key={z} activo={zona === z} onClick={() => setZona(z)}>{z}</Chip>
        ))}
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!lista && !error && <p className="text-sm text-slate-500">Cargando propiedades…</p>}
      {lista && !lista.fresco && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          El inventario no está al día (último sync hace {lista.horas ?? "?"} h). No publiques hasta que se sincronice Wasi.
        </p>
      )}
      {lista?.fresco && lista.items.length === 0 && <p className="text-sm text-slate-500">No hay propiedades listas con este filtro.</p>}

      <ul className="space-y-2">
        {lista?.items.map((p) => (
          <li key={p.ref}>
            <button onClick={() => setElegida(p)} className="flex w-full gap-2.5 rounded-xl border border-slate-200 bg-white p-2 text-left">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.foto} alt="" className="h-20 w-20 shrink-0 rounded-lg object-cover" loading="lazy" />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">{p.titulo || `Ref ${p.ref}`}</div>
                <div className="text-xs text-slate-500">
                  {[p.zona, p.area, p.habitaciones ? `${p.habitaciones} alc` : null, `Ref ${p.ref}`].filter(Boolean).join(" · ")}
                </div>
                <div className="mt-1 text-sm font-bold text-slate-900">{p.precio}</div>
                <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] ${p.etiqueta.reciente ? "bg-amber-100 text-amber-800" : "bg-teal-100 text-teal-800"}`}>
                  {p.etiqueta.texto}
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Kpi({ color, valor, texto }: { color: string; valor: number | null; texto: string }) {
  return (
    <div className={`rounded-xl p-2.5 text-white ${color}`}>
      <b className="block text-xl">{valor ?? "—"}</b>
      <small className="text-[11px] leading-tight opacity-90">{texto}</small>
    </div>
  );
}

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs ${activo ? "border-[#0b1526] bg-[#0b1526] text-white" : "border-slate-200 bg-white text-slate-700"}`}
    >
      {children}
    </button>
  );
}

function FichaPost({ item, onVolver }: { item: Item; onVolver: () => void }) {
  const [comision, setComision] = useState(true);
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [estado, setEstado] = useState<string | null>(null);

  useEffect(() => {
    setPost(null);
    kitApi<Post>({ action: "post", ref: item.ref, comision })
      .then(setPost)
      .catch((e) => setError((e as Error).message));
  }, [item.ref, comision]);

  const registrar = (accion: "compartir" | "copiar" | "descargar") =>
    kitApi({ action: "registrar", ref: item.ref, accion }).catch(() => undefined);

  async function compartir() {
    if (!post) return;
    setEstado("Preparando fotos…");
    const archivos = await fotosComoArchivos(item.ref, post.fotos.length);
    const datos: ShareData = archivos.length ? { files: archivos, text: post.texto } : { text: post.texto };
    if (!navigator.canShare?.(datos)) {
      setEstado("Este celular no deja compartir fotos desde el navegador: usá Copiar texto y Descargar fotos.");
      return;
    }
    try {
      await navigator.share(datos);
      await registrar("compartir");
      setEstado(archivos.length < post.fotos.length ? "Compartida (algunas fotos no bajaron)." : "Compartida.");
    } catch {
      setEstado(null); // la asesora cerró el menú
    }
  }

  async function copiar() {
    if (!post) return;
    await navigator.clipboard.writeText(post.texto);
    await registrar("copiar");
    setEstado("Texto copiado.");
  }

  async function descargar() {
    if (!post) return;
    const archivos = await fotosComoArchivos(item.ref, post.fotos.length);
    for (const f of archivos) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(f);
      a.download = f.name;
      a.click();
      URL.revokeObjectURL(a.href);
    }
    await registrar("descargar");
    setEstado(`${archivos.length} fotos descargadas.`);
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col">
      <div className="flex items-center gap-2 bg-[#0b1526] px-3 py-3 text-white">
        <button onClick={onVolver} className="text-xl text-[#c9a24b]" aria-label="Volver">‹</button>
        <b>Ref {item.ref}</b>
      </div>

      <div className="flex-1 space-y-2 bg-slate-50 p-3">
        {item.etiqueta.reciente && (
          <p className="rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
            {item.etiqueta.texto}. Si la vuelven a ver en los mismos grupos tan seguido, se quema.
          </p>
        )}
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {post && !post.linkOk && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">El link de Wasi de esta propiedad no abre. No la compartas hasta corregirla.</p>
        )}

        {post && (
          <div className="grid h-48 grid-cols-3 grid-rows-2 gap-1 overflow-hidden rounded-xl">
            {post.fotos.slice(0, 3).map((_, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={`/api/kit/foto?ref=${encodeURIComponent(item.ref)}&i=${i}`}
                alt=""
                className={`h-full w-full object-cover ${i === 0 ? "col-span-2 row-span-2" : ""}`}
              />
            ))}
          </div>
        )}

        <div className="flex justify-between px-0.5 text-xs text-slate-500">
          <span>Texto del post</span>
          <span>sin IA · $0</span>
        </div>
        <pre className="whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-white p-3 font-sans text-[13px] leading-relaxed text-slate-900">
          {post ? post.texto : "Armando el texto…"}
        </pre>

        <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
          <span>Incluir “Comparto comisión con colegas”</span>
          <input type="checkbox" checked={comision} onChange={(e) => setComision(e.target.checked)} className="h-5 w-5 accent-teal-600" />
        </label>
        {estado && <p className="text-center text-sm text-slate-600">{estado}</p>}
      </div>

      <div className="sticky bottom-0 border-t border-slate-200 bg-white p-3">
        <button
          onClick={compartir}
          disabled={!post || !post.linkOk}
          className="w-full rounded-xl bg-[#25d366] py-3 text-base font-semibold text-white disabled:opacity-40"
        >
          Compartir en WhatsApp
        </button>
        <div className="mt-2 flex gap-2">
          <button onClick={copiar} disabled={!post || !post.linkOk} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm disabled:opacity-40">
            Copiar texto
          </button>
          <button onClick={descargar} disabled={!post || !post.linkOk} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm disabled:opacity-40">
            Descargar fotos
          </button>
        </div>
      </div>
    </div>
  );
}
```

Nota sobre `p.foto` en la lista: es la URL de Wasi y se muestra con `<img>` directo (mostrar una imagen no tiene problema de CORS; solo bajarla como archivo).

- [ ] **Step 3: Navegación** (`crm/app/(dashboard)/layout.tsx`, en `links`, después de Amoblados)

```tsx
    { href: "/kit", label: "Kit" },
```

Si existe una navegación móvil aparte (`grep -rn "links" crm/components/*nav*`), confirmar que usa el mismo arreglo; si tiene su propia lista, agregar ahí también `/kit`.

- [ ] **Step 4: Lint y build**

Run: `cd crm && npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 5: Verificación visual** con el bot y el CRM locales (`.claude/launch.json` si existe; si no, pedirle a Juan que inicie sesión en la pestaña del panel). `resize_window` preset `mobile`, abrir `/kit`, entrar a una propiedad, comprobar fotos, texto, interruptor de comisión y botones; captura de pantalla para Juan. `navigator.share` con archivos solo se prueba de verdad en un celular: dejar anotado que Juan lo confirme en el suyo.

- [ ] **Step 6: Commit**

```bash
git add crm/app/\(dashboard\)/kit crm/components/kit-publicacion.tsx crm/app/\(dashboard\)/layout.tsx
git commit -m "feat(crm): pagina /kit para publicar propiedades en grupos desde el celular

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Landing — "Arrendar mi propiedad"

**Files:**
- Modify: `web/lib/lead-schema.ts:13`, `web/config/i18n.ts` (leadForm es y en), `web/components/forms/lead-form.tsx:132-136`, `web/lib/whatsapp.ts`, `web/config/tenants/diamond.ts` (`contact.whatsapp`), `web/app/api/leads/route.ts`
- `web/config/tenant-schema.ts:164` (tipo de `contact.whatsapp`)

- [ ] **Step 1: Esquema** (`web/lib/lead-schema.ts`)

```ts
  operacion: z.enum(["comprar", "arrendar", "vender", "arrendar_propiedad"], { message: "Elige una opción" }),
```

- [ ] **Step 2: Textos** (`web/config/i18n.ts`, en los dos bloques `leadForm` de español y en los dos de inglés)

```ts
      operationRentOut: "Arrendar mi propiedad",
```

```ts
      operationRentOut: "Rent out my property",
```

- [ ] **Step 3: Formulario** (`web/components/forms/lead-form.tsx`, en el `NativeSelect` de operación, después de la opción `vender`)

```tsx
            <option value="arrendar_propiedad">{t("leadForm.operationRentOut")}</option>
```

- [ ] **Step 4: Mensaje de WhatsApp para el dueño** (`web/config/tenants/diamond.ts`, junto a `sellerMessage`, mismo formato que ese campo)

```ts
      ownerRentMessage: {
        es: "Hola, quiero poner en arriendo mi propiedad",
        en: "Hi, I want to rent out my property",
      },
```

En `web/config/tenant-schema.ts:164`, junto a `sellerMessage: LocalizedString,`, agregar `ownerRentMessage?: LocalizedString,`.

`web/lib/whatsapp.ts`, después de `sellerWhatsAppUrl`:

```ts
/** Dueno que quiere arrendar su inmueble: Sofi lo reconoce (detectOwnerRentIntent). */
export function ownerRentWhatsAppUrl(config: TenantConfig, lang: Language = "es"): string {
  const message = config.contact.whatsapp.ownerRentMessage
    ? localizeText(config.contact.whatsapp.ownerRentMessage, lang)
    : lang === "en"
      ? "Hi, I want to rent out my property"
      : "Hola, quiero poner en arriendo mi propiedad";
  return waUrl(config.contact.whatsapp.number, message);
}
```

- [ ] **Step 5: API** (`web/app/api/leads/route.ts`)

```ts
import { generalWhatsAppUrl, ownerRentWhatsAppUrl, propertyWhatsAppUrl, sellerWhatsAppUrl } from "@/lib/whatsapp";

const CATEGORIA: Record<string, string> = {
  comprar: "compra",
  arrendar: "alquiler",
  vender: "otros",
  arrendar_propiedad: "alquiler",
};
```

`whatsappFor` recibe la operación:

```ts
function whatsappFor(context: string, propertyRef: string | undefined, lang: "es" | "en" = "es", operacion?: string) {
  const config = getTenantConfig();
  if (operacion === "arrendar_propiedad") return ownerRentWhatsAppUrl(config, lang);
  if (context === "property" && propertyRef) return propertyWhatsAppUrl(config, propertyRef, lang);
  if (context === "seller") return sellerWhatsAppUrl(config, lang);
  return generalWhatsAppUrl(config, lang);
}
```

y las dos llamadas pasan `values.operacion` como cuarto argumento. En el `insert` del lead nuevo, la `row` lleva además `intencion` cuando es dueño, con el mismo reintento best-effort que ya existe para `idioma`:

```ts
    if (values.operacion === "arrendar_propiedad") row.intencion = "consignar_arriendo";
```

(`intencion` existe desde la migración `2026-07-05_agenda.sql`, ya corrida; no necesita reintento propio.)

- [ ] **Step 6: Lint y build**

Run: `cd web && npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add web
git commit -m "feat(web): opcion 'Arrendar mi propiedad' para duenos en el formulario

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Cierre — verificación y despliegue

- [ ] **Step 1: Suite completa y builds**

Run: `npm test` (raíz), `cd crm && npm run build`, `cd web && npm run build`
Expected: todo verde.

- [ ] **Step 2: Conversaciones de prueba con Sofi** (local, `npm run dev` con la clave de pruebas, nunca contra el WhatsApp de producción): dueño mensual ("tengo un apartamento en Sabaneta para arrendar"), dueño Airbnb ("quiero poner mi apto de Provenza en Airbnb"), inquilino ("busco arrendar un apto en Envigado"). Confirmar: los dueños no reciben inventario, la ficha se va llenando y la transferencia sale con "Dueño · …"; el inquilino sigue igual.

- [ ] **Step 3: Pedirle a Juan que corra la migración** `db/migrations/2026-10-16_kit_publicacion.sql` en el SQL Editor de Supabase, y verificarla por REST con un `select` (no por suposición): `kit_publicaciones?select=id&limit=1` y `leads?select=kit_ref,kit_at,inmueble_ofrecido&limit=1` responden sin `42703`/`42P01`.

- [ ] **Step 4: Actualizar `CLAUDE.md`** §2 con una entrada corta "Kit de publicación + dueños para arriendo (2026-10-16)": qué hace, la migración y su estado verificado, y que el kit no envía por WAHA.

- [ ] **Step 5: Push** (publica bot, CRM y landing): `git log origin/main..HEAD --oneline` para ver qué sale, y `git push origin main` **solo con el OK de Juan**.

- [ ] **Step 6: Después del deploy:** Juan abre `crm.diamondinmobiliaria.com/kit` en su celular y comparte una propiedad a un chat de prueba; confirmar que llegan las fotos con el texto y que aparece "Compartida hoy" en la lista.
