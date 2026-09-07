const { test } = require("node:test");
const assert = require("node:assert");
const carril = require("../src/groups/carril-arriendo");

test("el carril es toda demanda de arriendo, no solo la que dice amoblado", () => {
  // Nuestro inventario de arriendo es 100% amoblado (las dos propiedades que
  // hay), asi que un pedido de arriendo que no menciona muebles igual va a
  // cruzar contra un amoblado y merece el mismo tratamiento.
  assert.strictEqual(carril.esDelCarril({ operacion: "arriendo" }), true);
  assert.strictEqual(carril.esDelCarril({ operacion: "Arriendo" }), true);
  assert.strictEqual(carril.esDelCarril({ operacion: "venta" }), false, "venta no se toca");
  assert.strictEqual(carril.esDelCarril({}), false);
  assert.strictEqual(carril.esDelCarril(null), false);
});

test("solo sale solo el que calza fino", () => {
  const alto = { puntaje: 90, amoblado_sin_confirmar: false };
  const bajo = { puntaje: 79, amoblado_sin_confirmar: false };
  assert.strictEqual(carril.puedeSalirSolo([alto]), true);
  assert.strictEqual(carril.puedeSalirSolo([bajo]), false, "79 esta debajo de 85");
  assert.strictEqual(carril.puedeSalirSolo([bajo, alto]), true, "basta una que calce");
  assert.strictEqual(carril.puedeSalirSolo([]), false);
});

test("un puntaje alto NO alcanza si no confirmamos que es amoblada", () => {
  const sinConfirmar = { puntaje: 95, amoblado_sin_confirmar: true };
  assert.strictEqual(carril.puedeSalirSolo([sinConfirmar]), false);
});

test("el umbral y el interruptor se leen en cada llamada, no al cargar", () => {
  // Si se leyeran al cargar el modulo, moverlos exigiria redesplegar — y el
  // interruptor tiene que poder apagarse ya.
  const antesUmbral = process.env.RADAR_AMOBLADO_UMBRAL_DM;
  const antesActivo = process.env.RADAR_AMOBLADO_ACTIVO;
  try {
    assert.strictEqual(carril.umbralDm(), 85, "el default es 85");
    assert.strictEqual(carril.carrilActivo(), true, "prendido por defecto");

    process.env.RADAR_AMOBLADO_UMBRAL_DM = "70";
    assert.strictEqual(carril.umbralDm(), 70);

    process.env.RADAR_AMOBLADO_ACTIVO = "false";
    assert.strictEqual(carril.carrilActivo(), false);
  } finally {
    if (antesUmbral === undefined) delete process.env.RADAR_AMOBLADO_UMBRAL_DM;
    else process.env.RADAR_AMOBLADO_UMBRAL_DM = antesUmbral;
    if (antesActivo === undefined) delete process.env.RADAR_AMOBLADO_ACTIVO;
    else process.env.RADAR_AMOBLADO_ACTIVO = antesActivo;
  }
});

// (Important 5 del review de 400c0c8): la comparacion original exigia el
// string EXACTO "false" -- "False"/"FALSE"/"false " (con espacio, pegado a
// mano en Railway) dejaban el carril PRENDIDO mientras el operador creia
// haberlo apagado.
function conCarrilActivo(valor, fn) {
  const antes = process.env.RADAR_AMOBLADO_ACTIVO;
  if (valor === undefined) delete process.env.RADAR_AMOBLADO_ACTIVO;
  else process.env.RADAR_AMOBLADO_ACTIVO = valor;
  try {
    fn();
  } finally {
    if (antes === undefined) delete process.env.RADAR_AMOBLADO_ACTIVO;
    else process.env.RADAR_AMOBLADO_ACTIVO = antes;
  }
}

test("el interruptor se apaga sin importar mayusculas ni espacios", () => {
  for (const valor of ["false", "False", "FALSE", " false ", "false\t"]) {
    conCarrilActivo(valor, () => {
      assert.strictEqual(carril.carrilActivo(), false, `"${valor}" deberia apagar el carril`);
    });
  }
});

test("el interruptor tambien se apaga con \"0\" y \"no\" -- las formas comunes de decir apagado", () => {
  for (const valor of ["0", "No", " no ", "NO"]) {
    conCarrilActivo(valor, () => {
      assert.strictEqual(carril.carrilActivo(), false, `"${valor}" deberia apagar el carril`);
    });
  }
});

test("valores que NO se interpretan como apagado dejan el carril prendido", () => {
  // Deliberado: "off"/"disabled"/"n" no estan en la lista de apagado (no hay
  // evidencia de que alguien los vaya a escribir aca, y sumar mas formas es
  // mas superficie para acertar mal sin querer). "true"/vacio/sin la env var
  // tambien tienen que seguir prendidos, que es el default documentado.
  for (const valor of ["off", "disabled", "n", "true", "", undefined]) {
    conCarrilActivo(valor, () => {
      assert.strictEqual(carril.carrilActivo(), true, `"${valor}" NO deberia apagar el carril`);
    });
  }
});

test("apagado, ninguna demanda de arriendo puede salir sola", () => {
  // La guardia vive en el modulo del carril y no en quien lo llama: si cada
  // puerta la implementara por su cuenta, apagar el carril dejaria alguna
  // hablando — que es exactamente lo que paso con `mandatos_activos`.
  const antes = process.env.RADAR_AMOBLADO_ACTIVO;
  try {
    process.env.RADAR_AMOBLADO_ACTIVO = "false";
    assert.strictEqual(carril.puedeSalirSolo([{ puntaje: 100, amoblado_sin_confirmar: false }]), false);
  } finally {
    if (antes === undefined) delete process.env.RADAR_AMOBLADO_ACTIVO;
    else process.env.RADAR_AMOBLADO_ACTIVO = antes;
  }
});

const groupSignals = require("../src/data/group-signals");
const whatsappGroups = require("../src/data/whatsapp-groups");
const verificarLink = require("../src/groups/verificar-link");
const vivo = require("../src/groups/vivo");

// Una demanda de arriendo real, no respondida, con un match que pasaria todo:
// si la funcion saliera antes por falta de datos, el test seria una mentira.
//
// CORRECCION (Critical 2 del review de 400c0c8): este fixture tenia
// `operacion: "arriendo"` cuando el select real de obtenerPorId (antes del
// fix de Critical 1) NO traia esa columna -- la consulta real jamas podia
// devolver este objeto. Las puertas 3 y 4 pasaban en verde sobre un
// interruptor que en produccion estaba ciego. Ahora el fixture trae
// EXACTAMENTE las columnas del select de group-signals.js#obtenerPorId (post
// fix), ni una mas ni una menos -- si esa lista cambia, este objeto se tiene
// que actualizar a mano, y el test de mas abajo ("el select de obtenerPorId
// no puede volver a perder...") es el que falla solo si alguien olvida
// sumar `operacion` de nuevo.
function señalDeArriendo() {
  return {
    id: "sig-1", group_id: "g-1", clase: "demanda", operacion: "arriendo",
    matches: [{
      fuente: "diamond", ref: "10319436", puntaje: 95,
      titulo: "Apartamento Amoblado en Arriendo en El Poblado - Los Gonzáles",
      zona: "Los Gonzáles", precio: "$7.900.000", area: "90m2", operacion: "Arriendo",
      ubicacion: "exacta", amoblado: true, amoblado_sin_confirmar: false,
      periodo_no_soportado: false,
      link: "https://diamondinmobiliaria.com/propiedades/apto-10319436",
      linkWasi: "https://info.wasi.co/apartamento-alquiler-los-gonzales-medellin/10319436",
    }],
    autor_nombre: "Gustavo Arango", autor_telefono: null, texto_original: "Busco arriendo amoblado en El Poblado",
    respondida_at: null, wa_message_id: "vivo:wamid.GUSTAVO", revalidacion: null,
  };
}

// GUARDIA DE REGRESION (Critical 2): sin esto, alguien podria borrar
// "operacion" del select de obtenerPorId de nuevo -- exactamente el bug de
// Critical 1 -- y los 8 tests de arriba de este archivo seguirian en verde,
// porque ninguno pasa por la consulta real. Este SI lee la funcion real y
// falla si el select deja de traer lo que esDelCarril necesita.
test("el select de obtenerPorId no puede volver a perder los campos que el carril lee", () => {
  const fuente = groupSignals.obtenerPorId.toString();
  const match = fuente.match(/\.select\(\s*"([^"]+)"/);
  assert.ok(match, "no se encontro el .select(...) de obtenerPorId en group-signals.js");
  const columnas = match[1].split(",").map((c) => c.trim());
  // esDelCarril (carril-arriendo.js) lee `clasificado.operacion` DIRECTO del
  // signal -- puedeSalirSolo lee puntaje/amoblado_sin_confirmar, pero esos
  // viven DENTRO de `matches` (ya cubierto por esa columna), no aparte.
  for (const campo of ["operacion"]) {
    assert.ok(
      columnas.includes(campo),
      `el select de obtenerPorId no trae "${campo}", que carril-arriendo.js#esDelCarril necesita para no quedar ciego (Critical 1, commit 400c0c8)`
    );
  }
});

function conCarril(valor, fn) {
  const antes = process.env.RADAR_AMOBLADO_ACTIVO;
  process.env.RADAR_AMOBLADO_ACTIVO = valor;
  return Promise.resolve(fn()).finally(() => {
    if (antes === undefined) delete process.env.RADAR_AMOBLADO_ACTIVO;
    else process.env.RADAR_AMOBLADO_ACTIVO = antes;
  });
}

test("puerta 3: aprobar a mano no manda nada con el carril apagado", async (t) => {
  t.mock.method(groupSignals, "obtenerPorId", async () => señalDeArriendo());
  t.mock.method(whatsappGroups, "obtenerGrupo", async () => ({ id: "g-1", modo: "sombra", jid: "1@g.us" }));
  // Sin esto, el control positivo (carril prendido) sigue de largo hasta
  // verificarLink.verificar, que hace un GET real contra la landing con un
  // timeout de 6s -- no aporta nada a lo que este test verifica (que la
  // guarda del carril no frene) y solo alarga la corrida. No debilita el
  // control: lo que se prueba sigue siendo que `prendido.resultado` no sea
  // "carril_apagado", y eso se decide ANTES de llegar aca.
  t.mock.method(verificarLink, "verificar", async (ms) => ({ verificadas: ms, rotas: [] }));

  const apagado = await conCarril("false", () => vivo.aprobarManual({ id: "org-1" }, "sig-1"));
  assert.strictEqual(apagado.resultado, "carril_apagado");

  // CONTROL POSITIVO: con el carril prendido, los MISMOS datos pasan la
  // guarda y la funcion sigue adelante (fallara mas alla, por sesion o por
  // inventario, y eso esta bien: lo que se prueba es que no freno ACA).
  const prendido = await conCarril("true", () => vivo.aprobarManual({ id: "org-1" }, "sig-1"));
  assert.notStrictEqual(prendido.resultado, "carril_apagado", "los datos no llegaban a la guarda");
});

test("puerta 4: el DM manual tampoco sale con el carril apagado", async (t) => {
  t.mock.method(groupSignals, "obtenerPorId", async () => señalDeArriendo());
  t.mock.method(whatsappGroups, "obtenerGrupo", async () => ({ id: "g-1", modo: "sombra", jid: "1@g.us" }));
  t.mock.method(verificarLink, "verificar", async (ms) => ({ verificadas: ms, rotas: [] }));

  const apagado = await conCarril("false", () => vivo.responderPorDmManual({ id: "org-1" }, "sig-1"));
  assert.strictEqual(apagado.resultado, "carril_apagado");

  const prendido = await conCarril("true", () => vivo.responderPorDmManual({ id: "org-1" }, "sig-1"));
  assert.notStrictEqual(prendido.resultado, "carril_apagado", "los datos no llegaban a la guarda");
});

test("una demanda de VENTA nunca ve el carril, ni apagado", async (t) => {
  t.mock.method(groupSignals, "obtenerPorId", async () => ({ ...señalDeArriendo(), operacion: "venta" }));
  t.mock.method(whatsappGroups, "obtenerGrupo", async () => ({ id: "g-1", modo: "sombra", jid: "1@g.us" }));
  t.mock.method(verificarLink, "verificar", async (ms) => ({ verificadas: ms, rotas: [] }));

  const r = await conCarril("false", () => vivo.aprobarManual({ id: "org-1" }, "sig-1"));
  assert.notStrictEqual(r.resultado, "carril_apagado", "venta no se toca");
});
