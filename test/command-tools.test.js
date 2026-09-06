const { test } = require("node:test");
const assert = require("node:assert");
const { executeCommandTool, COMMAND_TOOL_DEFINITIONS } = require("../src/agent/sofi-comando-tools");
const { buildCommandSystemPrompt } = require("../src/agent/sofi-comando-prompts");
const command = require("../src/data/command");
const properties = require("../src/data/properties");
const allyProperties = require("../src/data/ally-properties");
const radarTrazabilidad = require("../src/data/radar-trazabilidad");
const groupSignals = require("../src/data/group-signals");
const vivo = require("../src/groups/vivo");

function adminScope() {
  return Object.freeze({ orgId: "org-1", viewerUid: "admin-1", role: "admin", isAdmin: true });
}

function asesorScope() {
  return Object.freeze({ orgId: "org-1", viewerUid: "asesor-1", role: "asesor_ventas", isAdmin: false });
}

test("consultar_seguimientos: usa el scope del ctx, ignora cualquier alcance del input", async (t) => {
  let received = null;
  t.mock.method(command, "seguimientos", async (scope, opts) => {
    received = { scope, opts };
    return { total: 0, items: [] };
  });

  const scope = asesorScope();
  // El input trae basura que intenta ampliar el alcance: debe ignorarse.
  await executeCommandTool(
    "consultar_seguimientos",
    { dias: 5, viewerUid: "otro-asesor", is_admin: true },
    { scope, session: null }
  );

  assert.strictEqual(received.scope.viewerUid, "asesor-1");
  assert.strictEqual(received.scope.isAdmin, false);
  assert.strictEqual(received.opts.dias, 5);
});

test("metricas_leads: pasa el scope del ctx al data layer", async (t) => {
  let received = null;
  t.mock.method(command, "metricasLeads", async (scope) => {
    received = scope;
    return { nuevos: 3, por_estado: {}, por_fuente: {} };
  });

  const scope = asesorScope();
  const out = await executeCommandTool("metricas_leads", {}, { scope, session: null });

  assert.strictEqual(received.viewerUid, "asesor-1");
  assert.match(out, /"nuevos":3/);
});

test("sugerir_siguiente_accion: devuelve el foco activo de la sesion", async () => {
  const session = { active_context: { propiedad_ref: "9205982" } };
  const out = await executeCommandTool("sugerir_siguiente_accion", {}, { scope: asesorScope(), session });
  assert.match(out, /9205982/);
});

test("sugerir_siguiente_accion: sin foco devuelve 'sin foco activo'", async () => {
  const out = await executeCommandTool("sugerir_siguiente_accion", {}, { scope: asesorScope(), session: null });
  assert.match(out, /sin foco activo/);
});

test("buscar_inventario: usa el orgId del scope, nunca el del input", async (t) => {
  let received = null;
  t.mock.method(properties, "search", async (orgId, filters, limit) => {
    received = { orgId, filters, limit };
    return [{ ref: "9776475", titulo: "Apartaloft cerca a Laureles", precio: "$346.000.000", disponible: true }];
  });

  const out = await executeCommandTool(
    "buscar_inventario",
    { zona: "Laureles", precio_max: 1300000000, org_id: "org-ajena" },
    { scope: asesorScope(), session: null }
  );

  assert.strictEqual(received.orgId, "org-1");
  assert.strictEqual(received.filters.zona, "Laureles");
  assert.strictEqual(received.filters.precio_max, 1300000000);
  assert.match(out, /9776475/);
});

test("buscar_inventario: con ref busca por referencia exacta (incluye no disponibles)", async (t) => {
  let received = null;
  t.mock.method(properties, "findByRef", async (orgId, ref) => {
    received = { orgId, ref };
    return { ref: "9921388", titulo: "Casa", disponible: false };
  });

  const out = await executeCommandTool("buscar_inventario", { ref: "9921388" }, { scope: asesorScope(), session: null });

  assert.strictEqual(received.orgId, "org-1");
  assert.strictEqual(received.ref, "9921388");
  assert.match(out, /9921388/);
});

test("buscar_inventario: limita el numero de resultados a 10 como maximo", async (t) => {
  let received = null;
  t.mock.method(properties, "search", async (orgId, filters, limit) => {
    received = limit;
    return [];
  });

  const out = await executeCommandTool("buscar_inventario", { limite: 50 }, { scope: asesorScope(), session: null });

  assert.strictEqual(received, 10);
  assert.match(out, /Sin resultados/);
  // Sugiere el camino alterno cuando no hay inventario propio.
  assert.match(out, /buscar_red_aliados/);
});

test("buscar_red_aliados: pasa scope y filtros, y advierte que hay que confirmar con el colega", async (t) => {
  let received = null;
  t.mock.method(allyProperties, "search", async (orgId, filters, limit) => {
    received = { orgId, filters, limit };
    return [
      {
        ref: "10128030",
        zona: "Guatape",
        precio: "$800.000.000",
        contacto_nombre: "Carlos",
        contacto_telefono: "573001112233",
        inmobiliaria_origen: "Su Casa YA",
      },
    ];
  });

  const out = await executeCommandTool(
    "buscar_red_aliados",
    { zona: "Guatape", operacion: "Venta", precio_max: 900000000 },
    { scope: asesorScope(), session: null }
  );

  assert.strictEqual(received.orgId, "org-1");
  assert.strictEqual(received.filters.operacion, "Venta");
  assert.strictEqual(received.filters.precioMax, 900000000);
  // Al asesor SI se le muestra el contacto del colega (a diferencia de Sofi-Cliente).
  assert.match(out, /Carlos/);
  assert.match(out, /confirmar disponibilidad/);
});

test("buscar_red_aliados: sin coincidencias lo dice sin inventar", async (t) => {
  t.mock.method(allyProperties, "search", async () => []);
  const out = await executeCommandTool("buscar_red_aliados", { zona: "Marte" }, { scope: asesorScope(), session: null });
  assert.match(out, /No hay propiedades de aliados/);
});

test("las tools nuevas estan definidas para el modelo y el prompt las explica", () => {
  const names = COMMAND_TOOL_DEFINITIONS.map((t) => t.name);
  assert.ok(names.includes("buscar_inventario"));
  assert.ok(names.includes("buscar_red_aliados"));

  const scope = asesorScope();
  const system = buildCommandSystemPrompt({ scope, userName: "KT", now: { legible: "viernes" } });
  const stable = system[0].text;
  assert.match(stable, /buscar_inventario/);
  assert.match(stable, /buscar_red_aliados/);
  // La geografia compartida viaja en el bloque estable (cacheado).
  assert.match(stable, /GEOGRAFIA DE MEDELLIN/);
  assert.match(stable, /Envigado NO es El Poblado/);
});

test("toda tool registrada aparece nombrada en el prompt — si no, Sofi no sabe que existe", () => {
  // Bug real 2026-08-18: trazabilidad_radar se registro en
  // COMMAND_TOOL_DEFINITIONS pero nunca se agrego al bloque HERRAMIENTAS del
  // prompt. La tool "existia" (el modelo la podia ver en el parametro tools),
  // pero sin ninguna instruccion de cuando usarla, Juan le preguntaba por el
  // radar y Sofi nunca la llamaba. Este test evita que se repita con la
  // proxima tool que alguien agregue.
  const scope = asesorScope();
  const system = buildCommandSystemPrompt({ scope, userName: "KT", now: { legible: "viernes" } });
  const stable = system[0].text;
  for (const t of COMMAND_TOOL_DEFINITIONS) {
    assert.ok(stable.includes(t.name), `${t.name} esta registrada pero el prompt no la menciona`);
  }
});

// Bug real 2026-08-19: el default de "cuantas señales traer" era 20, y no
// habia forma de pedir mas. Con un grupo activo, una rafaga de pedidos SIN
// match empujaba fuera de la ventana un pedido puntual mas viejo que si tenia
// match y respuesta — Sofi decia "no lo encuentro" de un dato que existia,
// solo estaba mas alla de la fila 20.
test("trazabilidad_radar: sin limite en el input, no se fuerza ningun tope — usa el default de trazabilidad()", async (t) => {
  let opts = null;
  t.mock.method(radarTrazabilidad, "trazabilidad", async (scope, o) => { opts = o; return { disponible: true, señales: [] }; });

  await executeCommandTool("trazabilidad_radar", {}, { scope: asesorScope(), session: null });

  assert.strictEqual(opts.limite, undefined);
});

test("trazabilidad_radar: un limite explicito se respeta hasta el tope de 40", async (t) => {
  let opts = null;
  t.mock.method(radarTrazabilidad, "trazabilidad", async (scope, o) => { opts = o; return { disponible: true, señales: [] }; });

  await executeCommandTool("trazabilidad_radar", { limite: 30 }, { scope: asesorScope(), session: null });
  assert.strictEqual(opts.limite, 30);

  await executeCommandTool("trazabilidad_radar", { limite: 999 }, { scope: asesorScope(), session: null });
  assert.strictEqual(opts.limite, 40, "no se puede pedir mas del tope real de la consulta");
});

// aprobar_pedido_radar (Juan, 2026-08-20): "que yo pueda aprobarlo de manera
// manual dentro del chat de Sofi y que una vez aprobado se responda de
// manera automatica".
test("aprobar_pedido_radar: sin 'cual' pide que se especifique", async () => {
  const out = await executeCommandTool("aprobar_pedido_radar", {}, { scope: adminScope(), session: null });
  assert.match(out, /Decime cual/);
});

test("aprobar_pedido_radar: sin candidatos callados lo dice sin inventar", async (t) => {
  t.mock.method(groupSignals, "calladosPendientes", async () => []);
  const out = await executeCommandTool("aprobar_pedido_radar", { cual: "Camilo" }, { scope: adminScope(), session: null });
  assert.match(out, /No hay ningun pedido callado/);
});

test("aprobar_pedido_radar: varios candidatos que coinciden piden desambiguar, no aprueban al azar", async (t) => {
  t.mock.method(groupSignals, "calladosPendientes", async () => [
    { id: "s1", autor_nombre: "Camilo Loaiza", texto_original: "busco en Envigado" },
    { id: "s2", autor_nombre: "Camilo Perez", texto_original: "busco en Sabaneta" },
  ]);
  let llamado = false;
  t.mock.method(vivo, "aprobarManual", async () => { llamado = true; return { resultado: "publicado" }; });

  const out = await executeCommandTool("aprobar_pedido_radar", { cual: "Camilo" }, { scope: adminScope(), session: null });
  assert.match(out, /Hay 2 pedidos callados/);
  assert.strictEqual(llamado, false, "no puede aprobar ninguno hasta que se desambigue");
});

test("aprobar_pedido_radar: un solo match aprueba y publica de verdad, no lo simula", async (t) => {
  t.mock.method(groupSignals, "calladosPendientes", async () => [
    { id: "sig-99", autor_nombre: "Camilo Loaiza", texto_original: "busco en Envigado" },
  ]);
  let recibido = null;
  t.mock.method(vivo, "aprobarManual", async (org, signalId) => {
    recibido = { org, signalId };
    return { resultado: "publicado", texto: "Hola Camilo...", grupo: "Pedidos Poblado/Envigado" };
  });

  const out = await executeCommandTool("aprobar_pedido_radar", { cual: "camilo loaiza" }, { scope: adminScope(), session: null });
  assert.strictEqual(recibido.org.id, "org-1");
  assert.strictEqual(recibido.signalId, "sig-99");
  assert.match(out, /Pedidos Poblado\/Envigado/);
  assert.match(out, /Hola Camilo/);
});

test("aprobar_pedido_radar: si ya no pasa la compuerta de calidad, dice por que en vez de fingir que salio", async (t) => {
  t.mock.method(groupSignals, "calladosPendientes", async () => [
    { id: "sig-99", autor_nombre: "Camilo", texto_original: "busco en Envigado" },
  ]);
  t.mock.method(vivo, "aprobarManual", async () => ({
    resultado: "sin_propiedades_publicables",
    descartados: [{ ref: "AP1", motivos: ["precio_fuera_de_rango"] }],
  }));

  const out = await executeCommandTool("aprobar_pedido_radar", { cual: "Camilo" }, { scope: adminScope(), session: null });
  assert.match(out, /Ninguna de las candidatas pasa la compuerta de calidad/);
  // El motivo sale EN CASTELLANO, no como identificador (2026-09-06). Un
  // "precio_fuera_de_rango" no le dice nada a quien lo lee, y un motivo que no
  // se entiende es un motivo que se reemplaza por una explicacion inventada:
  // fue exactamente lo que paso cuando Sofi atribuyo a un telefono faltante
  // una ref que en realidad estaba apartada por dato malo en Wasi.
  assert.match(out, /precio esta fuera de rango/);
  assert.doesNotMatch(out, /precio_fuera_de_rango/);
});
