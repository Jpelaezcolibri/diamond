# Panel de amoblados (`/amoblados`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una página `/amoblados` en el CRM que muestre solo los pedidos de arriendo con match, lo que salió para cada uno (aviso a la asesora, DM al colega o descarte de Sofi) y el inventario amoblado con sus alertas de Wasi. Además, `/grupos` deja de mostrar los pedidos de arriendo.

**Architecture:**
- La lógica pura (clasificar la salida, detectar amoblado y periodo, contar pedidos por ref) vive en `crm/lib/amoblados.ts`. Se prueba desde `test/` con Node 24, que importa `.ts` sin compilar.
- La página es un server component que reutiliza `SenalesGrupos`, la misma tarjeta de `/grupos`, con dos campos opcionales nuevos: `aviso_texto` y `descarte_motivo`.
- El estado del carril se le pregunta al bot con una ruta nueva, `POST /api/grupos/amoblados/estado`.

**Tech Stack:** Next.js 15 (CRM, `crm/`), Supabase (`@supabase/ssr`), Express (bot, `src/api/crm.js`), `node:test` (Node 24.20).

## Global Constraints

- Toda consulta a `group_signals` de la página nueva pasa por `mias(` justo antes de `supabase.from("group_signals")` (aislamiento por asesora; lo verifica `test/crm-grupos-aislamiento.test.js`).
- Con `mias()` se usa siempre `select("*")`, nunca una lista angosta de columnas, porque dispara TS2589. Los filtros extra (`.neq`, `.or`, `.gte`) van **después** de `mias(...)`.
- Un error de consulta se muestra con `ErrorBanner` o "—". Nunca como un cero (`fetchSafe`/`countSafe`).
- Nada hardcodeado de Diamond. `properties.operacion` vale `"Arriendo"` (con mayúscula) y `group_signals.operacion` vale `"arriendo"` (en minúscula).
- La copia de la interfaz sigue el tono que ya tiene el CRM (voseo en las acciones: "Escribile").
- No hay migraciones: `amoblado`, `periodo`, `aviso_wamid`, `revalidacion` y `messages.wa_message_id` ya existen.
- Los commits van en español, con prefijo convencional y rutas explícitas (nunca `git add .`). Terminan con `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: Lógica pura del panel (`crm/lib/amoblados.ts`)

**Files:**
- Create: `crm/lib/amoblados.ts`
- Test: `test/crm-amoblados.test.js`

**Interfaces:**
- Produces:
  - `type SalidaPedido = "dm" | "aviso" | "descartado" | "sin_dueno"`
  - `salidaDelPedido(s: SenalSalida): SalidaPedido`
  - `resumenSalidas(senales: SenalSalida[]): Record<SalidaPedido, number>`
  - `esAmoblada(p: { titulo?: string | null; caracteristicas?: string | null }): boolean | null`
  - `type Periodo = "mensual" | "noche" | "sin_periodo"`
  - `periodoDePropiedad(p: { titulo?: string | null; descripcion?: string | null }): Periodo`
  - `pedidosPorRef(senales: { matches?: { ref?: string | null }[] | null }[]): Map<string, number>`

- [ ] **Step 1: Write the failing test**

`test/crm-amoblados.test.js`:

```js
// Logica pura del panel de amoblados del CRM (spec 2026-09-12-panel-amoblados).
// Node 24 importa el .ts directo (sin imports "@/": el archivo es hoja).
const { test } = require("node:test");
const assert = require("node:assert");
const lib = require("../crm/lib/amoblados.ts");
const bot = require("../src/groups/amoblado");

test("salidaDelPedido: DM al colega manda sobre todo lo demas", () => {
  assert.strictEqual(lib.salidaDelPedido({ respondida_at: "2026-09-12T10:00:00Z", respuesta_modo: "auto", aviso_advisor_id: "a1" }), "dm");
});

test("salidaDelPedido: aviso a la asesora (por advisor o por wamid)", () => {
  assert.strictEqual(lib.salidaDelPedido({ aviso_advisor_id: "a1" }), "aviso");
  assert.strictEqual(lib.salidaDelPedido({ aviso_wamid: "wamid.X" }), "aviso");
});

test("salidaDelPedido: sombra no cuenta como DM", () => {
  assert.strictEqual(lib.salidaDelPedido({ respondida_at: "2026-09-12T10:00:00Z", respuesta_modo: "sombra" }), "sin_dueno");
});

test("salidaDelPedido: Sofi lo descarto (caso Niko, edificio especifico)", () => {
  assert.strictEqual(lib.salidaDelPedido({ revalidacion: { sirve_alguna: false } }), "descartado");
});

test("salidaDelPedido: con match y sin nada es 'sin_dueno'", () => {
  assert.strictEqual(lib.salidaDelPedido({ revalidacion: null }), "sin_dueno");
  assert.strictEqual(lib.salidaDelPedido({ revalidacion: { sirve_alguna: true } }), "sin_dueno");
});

test("resumenSalidas cuenta una salida por pedido", () => {
  const r = lib.resumenSalidas([
    { aviso_advisor_id: "a1" },
    { revalidacion: { sirve_alguna: false } },
    { respondida_at: "x", respuesta_modo: "auto" },
    {},
  ]);
  assert.deepStrictEqual(r, { dm: 1, aviso: 1, descartado: 1, sin_dueno: 1 });
});

test("esAmoblada es el MISMO veredicto que src/groups/amoblado.js", () => {
  const casos = [
    { titulo: "Apartamento Amoblado en Arriendo en Don Quijote", caracteristicas: null },
    { titulo: "RENTA DE HERMOSO APARTAMENTO EN DON QUIJOTE", caracteristicas: "Admite mascotas, Clósets" },
    { titulo: "WALL BY LINARES", caracteristicas: "Amoblado, Balcón" },
    { titulo: "Apartamento sin amoblar en Belén", caracteristicas: "" },
    { titulo: "Apartamento Desamoblado", caracteristicas: null },
    { titulo: "", caracteristicas: "" },
  ];
  for (const p of casos) assert.strictEqual(lib.esAmoblada(p), bot.esAmoblada(p), JSON.stringify(p));
});

test("periodoDePropiedad: lee la descripcion (con HTML de Wasi) y el titulo", () => {
  assert.strictEqual(lib.periodoDePropiedad({ descripcion: "<div>RENTA MINIMA: 3 MESES</div><div>$ 6.800.000</div>" }), "mensual");
  assert.strictEqual(lib.periodoDePropiedad({ descripcion: "<div>°Mes $4,500.000</div>" }), "mensual");
  assert.strictEqual(lib.periodoDePropiedad({ descripcion: "Valor por noche: $1.700.000 · mínimo 2 noches" }), "noche");
  assert.strictEqual(lib.periodoDePropiedad({ descripcion: "Ven a disfrutar de esta hermosa casa campestre" }), "sin_periodo");
  assert.strictEqual(lib.periodoDePropiedad({ titulo: "Canon mensual", descripcion: null }), "mensual");
});

test("periodoDePropiedad: si dice mes Y noche, gana noche (hay que revisarla)", () => {
  assert.strictEqual(lib.periodoDePropiedad({ descripcion: "Por mes $7.000.000 o por noche $400.000" }), "noche");
});

test("pedidosPorRef cuenta cada ref una vez por pedido", () => {
  const m = lib.pedidosPorRef([
    { matches: [{ ref: "10383636" }, { ref: "10319552" }, { ref: "10383636" }] },
    { matches: [{ ref: "10319552" }, { ref: null }] },
    { matches: null },
  ]);
  assert.strictEqual(m.get("10383636"), 1);
  assert.strictEqual(m.get("10319552"), 2);
  assert.strictEqual(m.size, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/crm-amoblados.test.js`
Expected: FAIL with `Cannot find module '../crm/lib/amoblados.ts'`

- [ ] **Step 3: Write minimal implementation**

`crm/lib/amoblados.ts`:

```ts
// Logica pura del panel de amoblados (spec 2026-09-12-panel-amoblados).
// Archivo HOJA a proposito: sin imports "@/", para que test/crm-amoblados.test.js
// lo importe directo con Node.

export type SalidaPedido = "dm" | "aviso" | "descartado" | "sin_dueno";

export type SenalSalida = {
  respondida_at?: string | null;
  respuesta_modo?: string | null;
  aviso_advisor_id?: string | null;
  aviso_wamid?: string | null;
  revalidacion?: { sirve_alguna?: boolean | null } | null;
};

// Que salio para un pedido con match. Precedencia: DM > aviso > descarte.
// "sombra" no cuenta como DM: se redacto pero no salio.
export function salidaDelPedido(s: SenalSalida): SalidaPedido {
  if (s.respondida_at && s.respuesta_modo === "auto") return "dm";
  if (s.aviso_advisor_id || s.aviso_wamid) return "aviso";
  if (s.revalidacion && s.revalidacion.sirve_alguna === false) return "descartado";
  return "sin_dueno";
}

export function resumenSalidas(senales: SenalSalida[]): Record<SalidaPedido, number> {
  const r: Record<SalidaPedido, number> = { dm: 0, aviso: 0, descartado: 0, sin_dueno: 0 };
  for (const s of senales) r[salidaDelPedido(s)]++;
  return r;
}

// ESPEJO de src/groups/amoblado.js#esAmoblada: se duplica a proposito (el CRM
// no importa codigo del bot). test/crm-amoblados.test.js compara los dos
// veredictos caso por caso, asi que si uno cambia sin el otro, la suite falla.
const PATRON_SI = /\bamoblad|\bamueblad/i;
const PATRON_NO = /\bsin\s+amoblar|\bsin\s+amueblar|\bsin\s+muebles|\bno\s+amoblad|\bno\s+amueblad/i;

export function esAmoblada(p: { titulo?: string | null; caracteristicas?: string | null }): boolean | null {
  const texto = [p.titulo, p.caracteristicas].filter(Boolean).join(" ");
  if (!texto.trim()) return null;
  if (PATRON_NO.test(texto)) return false;
  if (PATRON_SI.test(texto)) return true;
  return null;
}

export type Periodo = "mensual" | "noche" | "sin_periodo";

// Si el precio de un arriendo es por mes o por noche, leido del texto de
// Wasi (la descripcion llega con HTML). El sistema trata todo arriendo como
// mensual: "noche" y "sin_periodo" son alertas para corregir en Wasi.
// Si dice las dos cosas gana "noche": hay que revisarla igual.
const NOCHE = /\bnoches?\b|\bpor\s+d[ií]as?\b|\bdiari[oa]\b/i;
const MES = /\bmes(es)?\b|\bmensual\b|\bcanon\b/i;

export function periodoDePropiedad(p: { titulo?: string | null; descripcion?: string | null }): Periodo {
  const texto = [p.titulo, p.descripcion]
    .filter(Boolean)
    .join(" ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ");
  if (NOCHE.test(texto)) return "noche";
  if (MES.test(texto)) return "mensual";
  return "sin_periodo";
}

// Cuantos pedidos con match trajeron cada propiedad (una vez por pedido).
export function pedidosPorRef(senales: { matches?: { ref?: string | null }[] | null }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of senales) {
    const refs = new Set((s.matches || []).map((x) => x.ref).filter(Boolean) as string[]);
    for (const ref of refs) m.set(ref, (m.get(ref) ?? 0) + 1);
  }
  return m;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/crm-amoblados.test.js`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add crm/lib/amoblados.ts test/crm-amoblados.test.js
git commit -m "feat(crm): logica pura del panel de amoblados"
```

---

### Task 2: El bot responde el estado del carril (`POST /api/grupos/amoblados/estado`)

**Files:**
- Modify: `src/api/crm.js` (ruta nueva, a continuación de `router.post("/api/grupos/metricas", ...)`)
- Test: `test/crm-api-amoblados.test.js`

**Interfaces:**
- Consumes: `src/groups/carril-arriendo.js#carrilActivo()`, `#umbralDm()`
- Produces: `POST /api/grupos/amoblados/estado` → `{ activo: boolean, umbral: number }` (lo consume Task 4 con `callBot<{ activo: boolean; umbral: number }>`)

- [ ] **Step 1: Write the failing test**

`test/crm-api-amoblados.test.js`:

```js
// El CRM pregunta si el carril de amoblados esta prendido (spec 2026-09-12).
// Se toma el handler del router real, igual que test/whatsapp-usuario-sin-telefono.test.js.
const { test } = require("node:test");
const assert = require("node:assert");
const router = require("../src/api/crm");

function handler() {
  const capa = router.stack.find((c) => c.route?.path === "/api/grupos/amoblados/estado" && c.route.methods.post);
  assert.ok(capa, "No existe POST /api/grupos/amoblados/estado");
  return capa.route.stack[capa.route.stack.length - 1].handle;
}

async function llamar() {
  let cuerpo = null;
  const res = { json: (b) => { cuerpo = b; return res; }, status: () => res };
  await handler()({ body: {} }, res);
  return cuerpo;
}

function conEnv(t, valor) {
  const previo = process.env.RADAR_AMOBLADO_ACTIVO;
  if (valor === undefined) delete process.env.RADAR_AMOBLADO_ACTIVO;
  else process.env.RADAR_AMOBLADO_ACTIVO = valor;
  t.after(() => {
    if (previo === undefined) delete process.env.RADAR_AMOBLADO_ACTIVO;
    else process.env.RADAR_AMOBLADO_ACTIVO = previo;
  });
}

test("carril apagado: activo false", async (t) => {
  conEnv(t, "false");
  const r = await llamar();
  assert.strictEqual(r.activo, false);
  assert.strictEqual(typeof r.umbral, "number");
});

test("sin variable: el carril esta prendido (mismo default que carril-arriendo.js)", async (t) => {
  conEnv(t, undefined);
  assert.strictEqual((await llamar()).activo, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/crm-api-amoblados.test.js`
Expected: FAIL with `No existe POST /api/grupos/amoblados/estado`

- [ ] **Step 3: Write minimal implementation**

En `src/api/crm.js`, justo antes de `router.post("/api/grupos/metricas", async (req, res) => {`:

```js
// Estado del carril de amoblados, para el panel /amoblados del CRM (spec
// 2026-09-12). Se lee en cada llamada, igual que carril-arriendo.js: el
// interruptor se cambia en Railway sin redesplegar el CRM.
router.post("/api/grupos/amoblados/estado", (req, res) => {
  const carrilArriendo = require("../groups/carril-arriendo");
  res.json({ activo: carrilArriendo.carrilActivo(), umbral: carrilArriendo.umbralDm() });
});

```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/crm-api-amoblados.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/api/crm.js test/crm-api-amoblados.test.js
git commit -m "feat(api): el CRM puede consultar si el carril de amoblados esta prendido"
```

---

### Task 3: La tarjeta muestra lo que salió (`senales-grupos.tsx`)

**Files:**
- Modify: `crm/components/senales-grupos.tsx` (tipo `Signal`; `MENSAJE_RESULTADO_DM`; cuerpo de `Ficha` después de `{extraido && ...}`)
- Modify: `crm/components/dashboard-matches.tsx` (exportar `Kpi` y agregar el tono `slate`)

**Interfaces:**
- Produces: `Signal.aviso_texto?: string | null`, `Signal.descarte_motivo?: string | null` (Task 4 los llena). `export function Kpi(...)` con `tono: "indigo" | "teal" | "amber" | "sky" | "green" | "rose" | "slate"`.

Es un componente de cliente sin arnés de pruebas en el CRM. Su verificación es `tsc --noEmit` más la revisión visual (Task 6).

- [ ] **Step 1: Agregar los campos al tipo `Signal`**, a continuación de `aviso_advisor_id?: string | null;`:

```ts
  /** Texto del aviso que recibió la asesora (messages.content por
   *  aviso_wamid). Lo llena /amoblados; /grupos no lo trae. */
  aviso_texto?: string | null;
  /** Por qué Sofi descartó el pedido (revalidacion.por_que cuando
   *  sirve_alguna === false). Lo llena /amoblados. */
  descarte_motivo?: string | null;
```

- [ ] **Step 2: Mensaje del DM manual con el carril apagado.** En `MENSAJE_RESULTADO_DM`, a continuación de `colega_solo_llamada: ...,`:

```ts
  // Carril de amoblados apagado (Juan, 2026-09-12: "por ahora solo
  // transferencia a Daiana"): el bot no le escribe al colega por ningun camino.
  carril_apagado: "El carril de amoblados está apagado: por ahora los arriendos no se le escriben al colega desde el sistema. Escribile vos desde tu WhatsApp.",
```

- [ ] **Step 3: Mostrar lo que salió en la tarjeta.** En `Ficha`, inmediatamente después de `{extraido && <p className="mt-1 text-xs text-slate-500">{extraido}</p>}`:

```tsx
      {/* Lo que salió (Juan, 2026-09-12): "que se muestre con el mensaje
          enviado al DM del colega... y lo mismo si la respuesta va a
          Daiana". Plegado para no alargar la lista. */}
      {s.respondida_at && s.respuesta_modo === "auto" && s.respuesta_texto && (
        <details className="mt-2 rounded-lg border border-teal-200 bg-teal-50/50">
          <summary className="cursor-pointer px-3 py-1.5 text-xs font-bold text-teal-900">
            Lo que salió · DM al colega · {fechaHora(s.respondida_at)}
          </summary>
          <p className="whitespace-pre-wrap px-3 pb-2 text-xs leading-relaxed text-slate-700">{s.respuesta_texto}</p>
        </details>
      )}
      {s.aviso_texto && (
        <details className="mt-2 rounded-lg border border-amber-200 bg-amber-50/60">
          <summary className="cursor-pointer px-3 py-1.5 text-xs font-bold text-amber-900">
            Lo que salió · aviso a la asesora
          </summary>
          <p className="whitespace-pre-wrap px-3 pb-2 text-xs leading-relaxed text-slate-700">{s.aviso_texto}</p>
        </details>
      )}
      {s.descarte_motivo && (
        <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <b>Descartó Sofi:</b> {s.descarte_motivo}
        </p>
      )}
```

- [ ] **Step 4: Exportar `Kpi` y sumar el tono `slate`** en `crm/components/dashboard-matches.tsx`. En `TONO` agregar `slate: "bg-slate-500",` y cambiar `function Kpi({` por `export function Kpi({`.

- [ ] **Step 5: Typecheck**

Run: `cd crm && npx tsc --noEmit`
Expected: sin errores

- [ ] **Step 6: Commit**

```bash
git add crm/components/senales-grupos.tsx crm/components/dashboard-matches.tsx
git commit -m "feat(crm): la tarjeta del pedido muestra el DM, el aviso a la asesora o el descarte de Sofi"
```

---

### Task 4: La página `/amoblados` y el menú

**Files:**
- Create: `crm/app/(dashboard)/amoblados/page.tsx`
- Create: `crm/components/amoblados-dashboard.tsx`
- Create: `crm/components/inventario-amoblado.tsx`
- Modify: `crm/app/(dashboard)/layout.tsx` (menú)
- Modify: `test/crm-grupos-aislamiento.test.js` (agregar la página nueva)

**Interfaces:**
- Consumes: todo lo de Task 1 (`salidaDelPedido`, `resumenSalidas`, `pedidosPorRef`, `esAmoblada`, `periodoDePropiedad`, `type Periodo`, `type SalidaPedido`); de Task 2, `POST /api/grupos/amoblados/estado`; de Task 3, `Signal.aviso_texto`, `Signal.descarte_motivo` y `Kpi`.

- [ ] **Step 1: Write the failing test.** Al final de `test/crm-grupos-aislamiento.test.js`:

```js
// La pagina de amoblados (spec 2026-09-12) lee las mismas señales: mismo filtro.
test("/amoblados: toda consulta a group_signals pasa por el filtro por asesor", () => {
  const PAGINA_AMOBLADOS = path.join(__dirname, "../crm/app/(dashboard)/amoblados/page.tsx");
  const src = readFileSync(PAGINA_AMOBLADOS, "utf8");
  const re = /supabase\s*\.from\(\s*["']group_signals["']\s*\)/g;
  const consultas = [...src.matchAll(re)];
  assert.ok(consultas.length >= 2, "la pagina tiene que consultar group_signals");
  const sinFiltro = consultas
    .filter((m) => !src.slice(0, m.index).replace(/\s+$/, "").endsWith("mias("))
    .map((m) => src.slice(Math.max(0, m.index - 60), m.index + 45).replace(/\s+/g, " "));
  assert.deepStrictEqual(sinFiltro, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/crm-grupos-aislamiento.test.js`
Expected: FAIL with `ENOENT` (la página no existe)

- [ ] **Step 3: `crm/components/amoblados-dashboard.tsx`**

```tsx
import { Kpi } from "@/components/dashboard-matches";
import type { SalidaPedido } from "@/lib/amoblados";

// Isla oscura del panel de amoblados (mockup aprobado 2026-09-12): mismo
// navy/dorado que el dashboard de /grupos. Solo presentación.
export default function AmobladosDashboard({
  dias,
  arriendo,
  conMatch,
  salidas,
}: {
  dias: number;
  /** null = el conteo falló: se muestra "—", nunca un cero. */
  arriendo: number | null;
  conMatch: number;
  salidas: Record<SalidaPedido, number>;
}) {
  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0b1526] via-[#13223a] to-[#1b2b47] p-5 text-white sm:p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(600px 220px at 85% -10%, rgba(201,162,75,.18), transparent 70%)" }}
      />
      <div className="relative">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-lg font-bold">Arriendo · últimos {dias} días</h2>
          <span className="text-xs text-slate-400">sale de la base, no se reinicia con los despliegues</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-2.5">
          <Kpi n={arriendo ?? "—"} titulo="Pedidos de arriendo" detalle="detectados en los grupos" tono="sky" />
          <Kpi n={conMatch} titulo="Con match" detalle="calzan con un amoblado" tono="indigo" href="#pedidos" />
          <Kpi n={salidas.aviso} titulo="Aviso a la asesora" detalle="para que ella le escriba" tono="amber" />
          <Kpi n={salidas.dm} titulo="DM al colega" detalle="salió solo, sin asesora" tono="teal" />
          <Kpi n={salidas.descartado} titulo="Descartó Sofi" detalle="revisó y no le servía" tono="slate" />
        </div>
        {salidas.sin_dueno > 0 && (
          <p className="mt-3 rounded-md bg-rose-500/20 px-3 py-2 text-xs text-rose-100">
            <b>{salidas.sin_dueno} sin dueño:</b> pedidos con match sin aviso, sin DM y sin descarte de Sofi. Un
            match nunca debería quedar sin salida: revisalos abajo.
          </p>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: `crm/components/inventario-amoblado.tsx`**

```tsx
import type { Periodo } from "@/lib/amoblados";

export type PropiedadArriendo = {
  ref: string;
  titulo: string | null;
  zona: string | null;
  precio: string | null;
  amoblada: boolean | null;
  periodo: Periodo;
  pedidos: number;
};

// Qué le falta a cada propiedad en Wasi para que Sofi y el radar la ofrezcan
// bien. Las alertas se van solas cuando se corrige allá (sync de las 7 p. m.).
function alertas(p: PropiedadArriendo): { texto: string; tono: string }[] {
  const a: { texto: string; tono: string }[] = [];
  if (p.amoblada !== true) a.push({ texto: "⚠ falta marcar Amoblado en Wasi", tono: "text-amber-700" });
  if (p.periodo === "noche") a.push({ texto: "⚠ se renta por noche: el sistema la trata como mensual", tono: "text-rose-700" });
  if (p.periodo === "sin_periodo") a.push({ texto: "⚠ no dice si el precio es por mes o por noche", tono: "text-rose-700" });
  return a;
}

export default function InventarioAmoblado({ propiedades }: { propiedades: PropiedadArriendo[] }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="font-display text-sm font-bold text-slate-900">Inventario en arriendo</h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{propiedades.length} en Wasi</span>
      </div>
      {propiedades.length === 0 ? (
        <p className="px-4 py-4 text-sm italic text-slate-400">No hay propiedades en arriendo disponibles.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {propiedades.map((p) => {
            const avisos = alertas(p);
            return (
              <li key={p.ref} className="flex items-start justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0">
                  <p>
                    <b className="font-mono">{p.ref}</b> · {p.zona || "sin zona"}
                  </p>
                  <p className="truncate text-xs text-slate-500" title={p.titulo || ""}>{p.titulo}</p>
                  {avisos.length === 0 ? (
                    <p className="text-xs text-slate-500">✓ amoblado · mensual</p>
                  ) : (
                    avisos.map((x) => (
                      <p key={x.texto} className={`text-xs ${x.tono}`}>{x.texto}</p>
                    ))
                  )}
                </div>
                <div className="whitespace-nowrap text-right">
                  <span className="tabular-nums">{p.precio || "—"}</span>
                  <p className={`text-xs ${p.pedidos > 0 ? "text-slate-600" : "text-slate-400"}`}>
                    {p.pedidos} pedido{p.pedidos === 1 ? "" : "s"}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
        Las alertas salen de lo que dice Wasi y se van solas cuando se corrige allá (sync de las 7 p. m.).
      </p>
    </section>
  );
}
```

- [ ] **Step 5: `crm/app/(dashboard)/amoblados/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { callBot } from "@/lib/bot";
import { fetchSafe, countSafe } from "@/lib/fetch-safe";
import ErrorBanner from "@/components/error-banner";
import SenalesGrupos, { type Signal } from "@/components/senales-grupos";
import AmobladosDashboard from "@/components/amoblados-dashboard";
import InventarioAmoblado, { type PropiedadArriendo } from "@/components/inventario-amoblado";
import { esAmoblada, pedidosPorRef, periodoDePropiedad, resumenSalidas, salidaDelPedido } from "@/lib/amoblados";

export const dynamic = "force-dynamic";

// Panel de amoblados (spec 2026-09-12-panel-amoblados, mockup aprobado).
// Solo pedidos de arriendo CON match, y lo que salio para cada uno. Aparte de
// /grupos "para que no se sature" (Juan).
const DIAS = 7;

type SenalArriendo = Signal & {
  aviso_wamid?: string | null;
  revalidacion?: { sirve_alguna?: boolean | null; por_que?: string | null } | null;
};

type Propiedad = {
  ref: string;
  titulo: string | null;
  zona: string | null;
  precio: string | null;
  caracteristicas: string | null;
  descripcion: string | null;
};

export default async function AmobladosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = isAdmin(user);

  // Mismo aislamiento que /grupos: un asesor ve solo lo que el observo.
  const { data: miAdvisor } = await supabase
    .from("advisors").select("id").eq("auth_user_id", user.id).limit(1).maybeSingle();
  const miAdvisorId: string | null = miAdvisor?.id ?? null;
  const mias = <T extends { eq: (c: string, v: string) => T }>(q: T): T =>
    admin || !miAdvisorId ? q : q.eq("advisor_id", miAdvisorId);

  const desde = new Date(Date.now() - DIAS * 86400e3);

  const [conMatchRes, arriendo7dRes, gruposRes, propsRes] = await Promise.all([
    fetchSafe<SenalArriendo>(
      mias(supabase.from("group_signals").select("*").eq("clase", "demanda").eq("operacion", "arriendo"))
        .neq("matches", "[]")
        .order("created_at", { ascending: false })
        .limit(200),
      "amoblados:con_match"
    ),
    countSafe(
      mias(
        supabase
          .from("group_signals")
          .select("*", { count: "exact", head: true })
          .eq("clase", "demanda")
          .eq("operacion", "arriendo")
      ).gte("created_at", desde.toISOString()),
      "amoblados:arriendo_7d"
    ),
    fetchSafe<{ id: string; nombre: string | null; jid: string }>(
      supabase.from("whatsapp_groups").select("*"),
      "amoblados:grupos"
    ),
    fetchSafe<Propiedad>(
      supabase
        .from("properties")
        .select("ref, titulo, zona, precio, caracteristicas, descripcion")
        .eq("operacion", "Arriendo")
        .eq("disponible", true),
      "amoblados:inventario"
    ),
  ]);

  const senales = conMatchRes.data;

  // El texto del aviso que recibio la asesora: messages por aviso_wamid (lo
  // guarda src/lib/mensaje-asesor.js). RLS "team read" lo deja leer.
  const wamids = [...new Set(senales.map((s) => s.aviso_wamid).filter(Boolean))] as string[];
  const avisosRes = wamids.length
    ? await fetchSafe<{ wa_message_id: string; content: string }>(
        supabase.from("messages").select("wa_message_id, content").in("wa_message_id", wamids),
        "amoblados:avisos"
      )
    : null;
  const avisoPorWamid = new Map((avisosRes?.data || []).map((m) => [m.wa_message_id, m.content]));

  // En que quedo cada oportunidad (mismo criterio que /grupos).
  const ultimoEvento = new Map<string, string>();
  if (senales.length > 0) {
    const { data: eventos } = await supabase
      .from("signal_events")
      .select("signal_id, tipo, created_at")
      .in("signal_id", senales.map((s) => s.id))
      .order("created_at", { ascending: true });
    for (const e of eventos || []) ultimoEvento.set(e.signal_id as string, e.tipo as string);
  }

  const grupoPorId = new Map(gruposRes.data.map((g) => [g.id, g]));
  const lista: Signal[] = senales.map((s) => ({
    ...s,
    grupo_nombre: grupoPorId.get(s.group_id)?.nombre ?? null,
    grupo_jid: grupoPorId.get(s.group_id)?.jid ?? null,
    ultimo_evento: ultimoEvento.get(s.id) ?? null,
    aviso_texto: s.aviso_wamid ? avisoPorWamid.get(s.aviso_wamid) ?? null : null,
    descarte_motivo:
      salidaDelPedido(s) === "descartado"
        ? s.revalidacion?.por_que || "Sofi revisó el pedido y ninguna propiedad le servía."
        : null,
  }));

  const ultimos = senales.filter((s) => new Date(s.created_at) >= desde);
  const salidas = resumenSalidas(ultimos);

  const porRef = pedidosPorRef(senales);
  const inventario: PropiedadArriendo[] = propsRes.data
    .map((p) => ({
      ref: String(p.ref),
      titulo: p.titulo,
      zona: p.zona,
      precio: p.precio,
      amoblada: esAmoblada(p),
      periodo: periodoDePropiedad(p),
      pedidos: porRef.get(String(p.ref)) ?? 0,
    }))
    .sort((a, b) => b.pedidos - a.pedidos);

  const carril = await callBot<{ activo: boolean; umbral: number }>("/api/grupos/amoblados/estado", {});

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-4 px-3 py-4 sm:gap-5 sm:px-6 sm:py-6 2xl:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-slate-900">Amoblados</h1>
          <p className="mt-1 max-w-[62ch] text-sm text-slate-600">
            Pedidos de arriendo de los colegas que calzan con nuestro inventario, y qué se respondió a cada uno.
          </p>
        </div>
        <div className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700">
          {!carril.ok ? (
            <span>No se pudo consultar el carril de amoblados.</span>
          ) : carril.data.activo ? (
            <span>
              <i className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500 align-middle" />
              <b>Carril encendido</b> · sale solo al colega si calza {carril.data.umbral} o más
            </span>
          ) : (
            <span>
              <i className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-400 align-middle" />
              <b>Carril apagado</b> · nada sale solo al colega: todo le llega a la asesora
            </span>
          )}
        </div>
      </div>

      <AmobladosDashboard
        dias={DIAS}
        arriendo={arriendo7dRes.hasError ? null : arriendo7dRes.count}
        conMatch={ultimos.length}
        salidas={salidas}
      />
      {conMatchRes.hasError && <ErrorBanner message={conMatchRes.message} />}
      {arriendo7dRes.hasError && <ErrorBanner message={arriendo7dRes.message} />}
      {avisosRes?.hasError && <ErrorBanner message={avisosRes.message} />}
      {propsRes.hasError && <ErrorBanner message={propsRes.message} />}

      <section className="grid items-start gap-4 xl:grid-cols-[1.6fr_1fr]">
        <div id="pedidos" className="scroll-mt-4 rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="font-display text-sm font-bold text-slate-900">Pedidos con match</h2>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{lista.length}</span>
          </div>
          <div className="px-1 py-3">
            <SenalesGrupos
              senales={lista}
              clase="demanda"
              vacio="Todavía no llegó ningún pedido de arriendo que calce con el inventario."
              embebido
            />
          </div>
        </div>
        <InventarioAmoblado propiedades={inventario} />
      </section>
    </div>
  );
}
```

- [ ] **Step 6: Menú.** En `crm/app/(dashboard)/layout.tsx`, después de `{ href: "/grupos", label: "Grupos" },`:

```ts
    { href: "/amoblados", label: "Amoblados" },
```

- [ ] **Step 7: Run tests and typecheck**

Run: `node --test test/crm-grupos-aislamiento.test.js && cd crm && npx tsc --noEmit`
Expected: PASS y sin errores de tipos

- [ ] **Step 8: Commit**

```bash
git add "crm/app/(dashboard)/amoblados/page.tsx" crm/components/amoblados-dashboard.tsx crm/components/inventario-amoblado.tsx "crm/app/(dashboard)/layout.tsx" test/crm-grupos-aislamiento.test.js
git commit -m "feat(crm): pagina /amoblados -- pedidos de arriendo con match, lo que salio e inventario"
```

---

### Task 5: `/grupos` deja de mostrar los pedidos de arriendo

**Files:**
- Modify: `crm/app/(dashboard)/grupos/page.tsx` (`conMatchQuery`, `demandasRes`, `conMatchTotalRes`)
- Test: `test/crm-grupos-aislamiento.test.js`

**Interfaces:** ninguna.

- [ ] **Step 1: Write the failing test.** Al final de `test/crm-grupos-aislamiento.test.js`:

```js
// Los pedidos de arriendo viven en /amoblados (spec 2026-09-12): /grupos los
// excluye en la lista con match, en la lista general y en el conteo del KPI.
// Se usa .or(... is.null ...) porque un .neq a secas en PostgREST tambien
// descarta las filas con operacion null.
test("/grupos excluye los pedidos de arriendo en sus tres lecturas de pedidos", () => {
  const exclusiones = fuente.match(/operacion\.is\.null,operacion\.neq\.arriendo/g) || [];
  assert.strictEqual(exclusiones.length, 3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/crm-grupos-aislamiento.test.js`
Expected: FAIL (`0 !== 3`)

- [ ] **Step 3: Implementar.** En `crm/app/(dashboard)/grupos/page.tsx`:

`conMatchQuery`: agregar `.or("operacion.is.null,operacion.neq.arriendo")` entre `.neq("matches", "[]")` y `.order(...)`:

```ts
  const conMatchQuery = mias(
    supabase
      .from("group_signals")
      .select("*")
      .eq("clase", "demanda")
      .neq("matches", "[]")
      .or("operacion.is.null,operacion.neq.arriendo")
      .order("created_at", { ascending: false })
      .limit(200)
  );
```

`demandasRes` (la segunda consulta del primer `Promise.all`):

```ts
    fetchSafe<Signal>(
      mias(supabase.from("group_signals").select("*").eq("clase", "demanda")
        .or("operacion.is.null,operacion.neq.arriendo")
        .order("created_at", { ascending: false }).limit(100)),
      "grupos:demandas"
    ),
```

`conMatchTotalRes` (primer `countSafe` del segundo `Promise.all`):

```ts
    countSafe(
      mias(
        supabase
          .from("group_signals")
          .select("*", { count: "exact", head: true })
          .eq("clase", "demanda")
      ).neq("matches", "[]").or("operacion.is.null,operacion.neq.arriendo"),
      "grupos:con_match_total"
    ),
```

- [ ] **Step 4: Run tests and typecheck**

Run: `node --test test/crm-grupos-aislamiento.test.js && cd crm && npx tsc --noEmit`
Expected: PASS y sin errores de tipos. Si hay TS2589, mover el `.or(...)` para que quede después de `mias(...)`, como ya se hace con `.neq`.

- [ ] **Step 5: Commit**

```bash
git add "crm/app/(dashboard)/grupos/page.tsx" test/crm-grupos-aislamiento.test.js
git commit -m "feat(crm): los pedidos de arriendo salen de /grupos y viven en /amoblados"
```

---

### Task 6: Cierre, despliegue y verificación en producción

**Files:** ninguno nuevo (quizá `CLAUDE.md` para el estado).

- [ ] **Step 1: Suite completa del bot**

Run: `npm test`
Expected: `fail 0` (1823 + 14 nuevas)

- [ ] **Step 2: Build del CRM** (Windows sin admin: se usa el binario de Next directo)

Run: `cd crm && npx tsc --noEmit && node node_modules/next/dist/bin/next build`
Expected: build OK, con `/amoblados` en la lista de rutas

- [ ] **Step 3: Merge y push**

```bash
git checkout main
git merge --no-ff panel-amoblados -m "merge: panel de amoblados (/amoblados) en el CRM"
git push origin main
```

- [ ] **Step 4: Verificar en producción**
  - En Railway, el despliegue del bot queda en SUCCESS con el commit nuevo.
  - `https://crm.diamondinmobiliaria.com/amoblados` responde una redirección a `/login` sin sesión, no un 404.
  - Con sesión (lo revisa Juan): se ven 2 pedidos con match (Ana Sanchez con aviso, Niko descartado) y las 8 propiedades con sus alertas.
  - En `/grupos` ya no aparecen esos dos pedidos de arriendo.
