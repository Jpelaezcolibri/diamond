// Un asesor nunca ve las señales de otro.
//
// La pantalla de Grupos dejó de ser solo de admin: cada asesor entra y ve lo
// que él observó. El aislamiento vive en el filtro `advisor_id` que se aplica a
// las consultas de `group_signals`, y el modo de romperlo es trivial y
// silencioso — alguien agrega una cuarta consulta y se olvida de filtrarla.
// Nada falla, nadie se entera, y un asesor empieza a ver los pedidos de su
// compañera.
//
// Es una página de servidor de Next: no se puede instanciar desde acá. Así que
// se revisa el FUENTE, con la misma técnica que test/prefilter-puro.test.js usa
// para el cierre de requires del EPE. Protege lo que importa: que ninguna
// consulta quede sin el filtro.

const { test } = require("node:test");
const assert = require("node:assert");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const PAGINA = path.join(__dirname, "../crm/app/(dashboard)/grupos/page.tsx");
const fuente = readFileSync(PAGINA, "utf8");

test("toda consulta a group_signals pasa por el filtro por asesor", () => {
  const sinFiltro = [];
  // Se ancla en `supabase.from("group_signals")` y se exige que lo que viene
  // INMEDIATAMENTE antes —saltando espacios y saltos de línea— sea `mias(`.
  //
  // Una ventana de contexto mas amplia no sirve: las consultas estan pegadas
  // una a la otra, y el `mias(` de la vecina daba por buena a la que no lo
  // tenia. Este test empezo laxo y lo dejaba pasar.
  const re = /supabase\s*\.from\(\s*["']group_signals["']\s*\)/g;

  for (const m of fuente.matchAll(re)) {
    const previo = fuente.slice(0, m.index).replace(/\s+$/, "");
    if (!previo.endsWith("mias(")) {
      sinFiltro.push(fuente.slice(Math.max(0, m.index - 60), m.index + 45).replace(/\s+/g, " "));
    }
  }

  assert.deepStrictEqual(
    sinFiltro, [],
    "Hay consultas a group_signals sin envolver en mias():\n  " + sinFiltro.join("\n  ") +
    "\n\nSin el filtro, un asesor ve los pedidos de otro."
  );
});

test("hay al menos una consulta filtrada — el test no pasa por vacío", () => {
  // Sin esto, borrar todas las consultas dejaría el test en verde y la
  // protección sería decorativa.
  const consultas = [...fuente.matchAll(/from\(\s*["']group_signals["']\s*\)/g)].length;
  assert.ok(consultas >= 3, `Se esperaban 3+ consultas a group_signals, hay ${consultas}`);
  assert.ok(fuente.includes("mias("), "No existe el helper de filtrado");
});

test("el filtro se resuelve contra la sesión, nunca contra la URL", () => {
  // Si el advisor_id viniera de un parámetro, cualquiera podría pedir el de
  // otro. Tiene que salir de auth_user_id del usuario logueado.
  assert.match(
    fuente,
    /eq\(\s*["']auth_user_id["']\s*,\s*user\.id\s*\)/,
    "El asesor debe resolverse desde la sesión (auth_user_id = user.id)"
  );
  assert.ok(
    !/searchParams[\s\S]{0,120}advisor/i.test(fuente),
    "El advisor_id nunca puede venir de la URL"
  );
});

test("entrar ya no exige ser admin, pero sí estar logueado", () => {
  assert.ok(
    !/!isAdmin\(user\)\)\s*redirect/.test(fuente),
    "El guard de admin volvió: la pantalla es del equipo, no solo del dueño"
  );
  assert.match(fuente, /if\s*\(!user\)\s*redirect/, "Un anónimo no puede entrar");
});

test("un admin sí ve todo — el filtro no puede aplicarse a ciegas", () => {
  // Si `mias` filtrara siempre, el admin dejaría de ver las señales sin autor
  // (las de reenvío y las históricas) y parecerían borradas.
  assert.match(fuente, /admin\s*\|\|\s*!miAdvisorId\s*\?\s*q\s*:/,
    "El helper debe devolver la consulta intacta para un admin");
});

// La ruta de subida: mismo aislamiento, del otro lado.

test("el export se atribuye a quien lo sube, tomado de la sesión", () => {
  const ruta = readFileSync(
    path.join(__dirname, "../crm/app/api/grupos/export/route.ts"), "utf8"
  );
  assert.match(ruta, /advisorDe\(user\.id\)/, "El asesor sale de la sesión");
  assert.match(ruta, /forward\.append\(\s*["']advisorId["']/, "Y viaja al bot");
  assert.ok(
    !/form\.get\(\s*["']advisorId["']/.test(ruta),
    "El advisorId NUNCA puede venir del formulario: sería suplantable"
  );
});
