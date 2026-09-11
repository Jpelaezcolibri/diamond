// La bandeja de salida: un solo mensaje por asesora, agrupando lo pendiente.
//
// POR QUE EXISTE (Juan, 2026-09-02): "no quiero que seas tan insistente", "si
// un solo cliente envia 10 solicitudes que se agrupen". Medido ese dia en
// menos de tres horas: 23 mensajes a Natalia (18 de un solo mandato) y 14 a
// Catherine, cero respuestas, y cuatro rechazados por WhatsApp con
// `(#131056) pair rate limit hit`.
//
// Lo que este archivo protege es la linea que NO se cruza: agrupar es para el
// ASESOR. El DM al colega sigue siendo uno por uno y no pasa por aca.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const digest = require("../src/groups/digest-avisos");
const ritmo = require("../src/lib/ritmo-avisos");

beforeEach(() => ritmo._reset());

// ── El freno de ritmo ────────────────────────────────────────────────────

test("el PRIMER aviso a una asesora siempre pasa: la agrupacion es para la rafaga", () => {
  assert.strictEqual(ritmo.puedeEnviar("adv-1"), true);
});

test("el segundo dentro de la ventana NO pasa; pasada la ventana, si", () => {
  const t0 = Date.parse("2026-09-02T13:00:00Z");
  ritmo.registrarEnvio("adv-1", t0);

  assert.strictEqual(ritmo.puedeEnviar("adv-1", t0 + 60 * 1000), false, "un minuto despues, no");
  assert.strictEqual(
    ritmo.puedeEnviar("adv-1", t0 + (ritmo.VENTANA_MIN * 60 - 1) * 1000),
    false,
    "un segundo antes de la ventana, tampoco"
  );
  assert.strictEqual(
    ritmo.puedeEnviar("adv-1", t0 + ritmo.VENTANA_MIN * 60 * 1000),
    true,
    "cumplida la ventana, vuelve a salir"
  );
});

test("el freno es POR asesora: escribirle a una no calla a la otra", () => {
  const t0 = Date.parse("2026-09-02T13:00:00Z");
  ritmo.registrarEnvio("natalia", t0);
  assert.strictEqual(ritmo.puedeEnviar("natalia", t0 + 1000), false);
  assert.strictEqual(ritmo.puedeEnviar("catherine", t0 + 1000), true);
});

test("sin asesora identificada no se frena nada — nunca se pierde un aviso por esto", () => {
  assert.strictEqual(ritmo.puedeEnviar(null), true);
  assert.strictEqual(ritmo.puedeEnviar(undefined), true);
});

// ── El digest ────────────────────────────────────────────────────────────

const pedido = (colega, extra = {}) => ({
  colega, operacion: "compra", tipo: "apartamento", zona: "Envigado",
  precioMax: 500000000, utiles: 2, dudosas: 0, ...extra,
});

const oferta = (extra = {}) => ({
  mandato: "Cliente de Daiana Zea", zona: "Sabaneta", precio: "$490.000.000",
  habitaciones: 3, reparos: [], cumpleTodo: true, ...extra,
});

test("sin nada pendiente no hay mensaje", () => {
  assert.strictEqual(digest.construir("Natalia", [], []), null);
});

test("DIEZ pedidos del MISMO colega salen como UNA entrada, no como diez", () => {
  // Es literalmente el caso que Juan nombro: "si un solo cliente envia 10
  // solicitudes que se agrupen".
  const diez = Array.from({ length: 10 }, (_, i) => pedido("Camilo Puerta", { zona: `Zona ${i}` }));
  const texto = digest.construir("Natalia", diez, []);

  assert.match(texto, /Camilo Puerta — 10 pedidos distintos/);
  assert.strictEqual((texto.match(/Camilo Puerta/g) || []).length, 1, "el nombre del colega aparece UNA vez");
  assert.match(texto, /y 6 más/, "muestra los primeros y resume el resto");
});

test("pedidos de colegas distintos van en lineas distintas", () => {
  const texto = digest.construir("Natalia", [pedido("Lu Vallejo"), pedido("Jaime")], []);
  assert.match(texto, /1\. Lu Vallejo/);
  assert.match(texto, /2\. Jaime/);
});

test("las ofertas se agrupan por mandato y separan lo que cumple de lo que no", () => {
  const texto = digest.construir("Natalia", [], [
    oferta({ zona: "Envigado", cumpleTodo: true }),
    oferta({ zona: "Sabaneta", cumpleTodo: false, reparos: ["La zona es Sabaneta"] }),
    oferta({ zona: "Itagüí", cumpleTodo: false, reparos: ["Se pasa $30.000.000 del tope"] }),
  ]);

  assert.match(texto, /OFERTAS PARA CLIENTE DE DAIANA ZEA \(3\)/);
  assert.match(texto, /Cumplen todo:/);
  assert.match(texto, /Para revisar:/);
  assert.match(texto, /La zona es Sabaneta/);
  assert.ok(texto.indexOf("Cumplen todo:") < texto.indexOf("Para revisar:"), "primero lo que sirve");
});

test("dos mandatos distintos no se mezclan en la misma lista", () => {
  const texto = digest.construir("Natalia", [], [
    oferta({ mandato: "Cliente A" }),
    oferta({ mandato: "Cliente B" }),
  ]);
  assert.match(texto, /OFERTAS PARA CLIENTE A/);
  assert.match(texto, /OFERTAS PARA CLIENTE B/);
});

test("el total del encabezado cuenta pedidos y ofertas juntos", () => {
  const texto = digest.construir("Natalia", [pedido("Lu"), pedido("Jaime")], [oferta(), oferta()]);
  assert.match(texto, /Natalia, tenés 4 cosas nuevas/);
});

test("cierra diciendo como pedir el detalle: el digest no reemplaza la ficha, la difiere", () => {
  const texto = digest.construir("Natalia", [pedido("Lu"), pedido("Jaime")], []);
  assert.match(texto, /Respondé con el número/);
});

test("un digest de 12 ofertas sigue entrando en el tope de WhatsApp", () => {
  const muchas = Array.from({ length: 12 }, (_, i) =>
    oferta({ zona: `Sabaneta ${i}`, cumpleTodo: false, reparos: ["Se pasa $60.000.000 del tope", "La zona es Sabaneta"] })
  );
  const texto = digest.construir("Natalia", [], muchas);
  assert.ok(texto.length < 4000, `el digest mide ${texto.length}, tiene que caber en los 4096 de Meta`);
});

// ── El respaldo entre asesoras (Juan, 2026-09-02): "si la ventana de una esta
// cerrada enviar a la ventana de la otra, esto con el fin de que nunca se
// pierda ninguna posibilidad de hacer negocios".
//
// El caso real: Catherine no le escribia a Sofi desde el 25 de agosto. Su
// ventana llevaba SIETE DIAS cerrada y los 45 mensajes que se le mandaron el
// 1 de septiembre se aceptaban en la API sin llegar a su telefono.

const advisors = require("../src/data/advisors");
const mensajeAsesor = require("../src/lib/mensaje-asesor");
const { entregarConRespaldo } = require("../src/lib/entrega-asesor");

const CATHE = { id: "adv-cathe", name: "Catherine Uribe", phone: "573001116489" };
const NATA = { id: "adv-nata", name: "Natalia Velez", phone: "573001878024" };
const ORG = { id: "org-1", name: "Diamond" };
const CERRADA = "(#131047) Message failed to send because more than 24 hours have passed";

function conEnvios(resultadoPorTelefono) {
  const enviados = [];
  const real = mensajeAsesor.enviarYRegistrar;
  mensajeAsesor.enviarYRegistrar = async (org, tel, texto) => {
    enviados.push({ tel, texto });
    const r = resultadoPorTelefono[tel];
    return r || { ok: true, wamid: `wm-${tel}` };
  };
  const realList = advisors.listElegibles;
  advisors.listElegibles = async () => [CATHE, NATA];
  // Sin respaldo configurado por defecto: cada test que lo quiera lo pone.
  const previoEscalado = process.env.RADAR_ESCALADO_PHONE;
  delete process.env.RADAR_ESCALADO_PHONE;
  return {
    enviados,
    restaurar: () => {
      mensajeAsesor.enviarYRegistrar = real;
      advisors.listElegibles = realList;
      if (previoEscalado === undefined) delete process.env.RADAR_ESCALADO_PHONE;
      else process.env.RADAR_ESCALADO_PHONE = previoEscalado;
    },
  };
}

test("ventana cerrada: el aviso se entrega a la otra asesora, no se pierde", async () => {
  const m = conEnvios({ "573001116489": { ok: false, error: CERRADA } });
  try {
    const r = await entregarConRespaldo(ORG, CATHE, "🎯 Oportunidad");
    assert.strictEqual(r.ok, true, "el negocio no se pierde");
    assert.strictEqual(r.advisor.name, "Natalia Velez", "lo recibe la suplente");
    assert.strictEqual(r.suplente, true);
    assert.strictEqual(m.enviados.length, 2, "se intento con la titular antes de pasarlo");
    assert.match(m.enviados[1].texto, /Esto era para Catherine Uribe/, "la suplente sabe de quien era");
    assert.match(m.enviados[1].texto, /le escriba cualquier cosa a Sofi/, "y como reabrirle el canal");
    assert.match(m.enviados[1].texto, /🎯 Oportunidad/, "el aviso original va completo");
  } finally {
    m.restaurar();
  }
});

test("con la ventana abierta no se molesta a nadie mas", async () => {
  const m = conEnvios({});
  try {
    const r = await entregarConRespaldo(ORG, CATHE, "🎯 Oportunidad");
    assert.strictEqual(r.suplente, false);
    assert.strictEqual(r.advisor.name, "Catherine Uribe");
    assert.strictEqual(m.enviados.length, 1);
  } finally {
    m.restaurar();
  }
});

test("un fallo que NO es de ventana cerrada no se reintenta con otra persona", async () => {
  // Un numero invalido o un error de credenciales no se arregla cambiando de
  // destinatario: seria gastar dos envios para el mismo fallo.
  const m = conEnvios({ "573001116489": { ok: false, error: "(#131026) Message undeliverable" } });
  try {
    const r = await entregarConRespaldo(ORG, CATHE, "🎯 Oportunidad");
    assert.strictEqual(r.ok, false);
    assert.strictEqual(m.enviados.length, 1, "no se molesta a la otra asesora");
  } finally {
    m.restaurar();
  }
});

test("si NINGUNA puede recibir, lo dice — el pendiente se reintenta despues", async () => {
  const m = conEnvios({
    "573001116489": { ok: false, error: CERRADA },
    "573001878024": { ok: false, error: CERRADA },
  });
  try {
    const r = await entregarConRespaldo(ORG, CATHE, "🎯 Oportunidad");
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /sin suplente con ventana abierta/);
  } finally {
    m.restaurar();
  }
});

// REGLA DE JUAN (2026-09-11): "el principal es el que tenemos con la
// automatizacion de la ventana abierta y luego al otro numero". El respaldo es
// RADAR_ESCALADO_PHONE (la segunda linea de quien coordina) y va ANTES que el
// resto del equipo.
test("con RADAR_ESCALADO_PHONE, el respaldo es ese numero antes que el resto del equipo", async () => {
  const DAIANA = { id: "adv-daiana", name: "Daiana Zea", phone: "573011880668" };
  const LINEA2 = { id: "adv-daiana-2", name: "Daiana Zea (línea 2)", phone: "573009998024", activo: true };
  const m = conEnvios({ "573011880668": { ok: false, error: CERRADA } });
  const realFind = advisors.findByPhone;
  advisors.findByPhone = async (orgId, tel) => (tel === LINEA2.phone ? LINEA2 : null);
  process.env.RADAR_ESCALADO_PHONE = LINEA2.phone;
  try {
    const r = await entregarConRespaldo(ORG, DAIANA, "📅 Nueva cita");
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.suplente, true);
    assert.strictEqual(m.enviados.length, 2, "un solo intento de respaldo cuando el primero entrega");
    assert.strictEqual(m.enviados[1].tel, LINEA2.phone, "el respaldo configurado va antes que la rotacion");
    assert.strictEqual(r.advisor.id, "adv-daiana-2", "quien lo recibio queda identificado");
  } finally {
    m.restaurar();
    advisors.findByPhone = realFind;
  }
});

// ── El digest dice POR QUE le toca a la asesora (Juan, 2026-09-02): "esta
// propiedad se debio contestar inmediatamente al colega por dm, otra cosa es
// que no tenga el telefono publico... el mensaje debe llevar esa informacion".
//
// Verificado sobre el pedido real de Katalina Patino: entro a las 09:08:50, se
// proceso 4 segundos despues, con una propiedad aprobada y la linea usando 1
// de sus 150 mensajes del dia. `politica_traza` era exactamente
// ["NO:sin_telefono"]. Lo UNICO que falto fue su numero.

test("cada pedido dice por que no lo resolvio el bot", () => {
  const texto = digest.construir("Natalia", [
    pedido("Katalina Patiño", { motivo: "sin_telefono" }),
    pedido("Jaime", { motivo: "pedido_vencido" }),
  ], []);
  assert.match(texto, /el bot le respondía solo, faltó su número/);
  assert.match(texto, /el pedido ya tiene más de media hora/);
});

test("si TODO se freno por el mismo motivo, se dice una vez al cierre", () => {
  const texto = digest.construir("Natalia", [
    pedido("Katalina Patiño", { motivo: "sin_telefono" }),
    pedido("Camila Uribe", { motivo: "sin_telefono" }),
  ], []);
  assert.match(texto, /lo único que faltó fue el número de cada colega/);
  assert.match(texto, /Si le escribís vos, el resultado es el mismo/);
});

test("con motivos mezclados NO se generaliza al cierre", () => {
  const texto = digest.construir("Natalia", [
    pedido("Katalina Patiño", { motivo: "sin_telefono" }),
    pedido("Jaime", { motivo: "limite_colega_alcanzado" }),
  ], []);
  assert.ok(!/lo único que faltó fue el número/.test(texto), "seria falso: no todos fueron por eso");
  assert.match(texto, /Respondé con el número/);
});

test("un motivo desconocido no inventa explicacion", () => {
  const texto = digest.construir("Natalia", [pedido("Lu", { motivo: "algo_nuevo" }), pedido("Jaime")], []);
  assert.match(texto, /1\. Lu — compra/);
  assert.ok(!texto.includes("undefined"));
});

test("los pedidos agrupados de un mismo colega tambien llevan su motivo", () => {
  const texto = digest.construir("Natalia", [
    pedido("Jaime", { zona: "Poblado", motivo: "pedido_vencido" }),
    pedido("Jaime", { zona: "Laureles", motivo: "limite_colega_alcanzado" }),
  ], []);
  assert.match(texto, /Poblado.*— el pedido ya tiene más de media hora/);
  assert.match(texto, /Laureles.*— ya le escribimos 2 veces hoy/);
});

// ── IMPORTANT 1 del review de fin de rama (2026-09-07): el encabezado
// 🛋️ AMOBLADOS se perdia en el camino REAL de esta bandeja ──────────────
//
// avisos-salida.js#textoDePedido reconstruye el mismo aviso que vivo.js#asistir
// arma en linea, pero antes de este fix pasaba `{ link }` solo -- nunca
// `carrilAmoblados` -- a alertaAsesor.construir. Cualquier pedido que caiga
// en el freno de ritmo (exactamente la rafaga, el motivo de ser de este
// archivo) llegaba disfrazado de aviso de venta. test/alerta-amoblados.test.js
// no lo detectaba porque le pasa la opcion a mano, sin pasar por un llamador
// real -- esta prueba ejercita el llamador real.
const avisosSalida = require("../src/scheduler/avisos-salida");
const directorio = require("../src/groups/directorio");
const groupSignalsData = require("../src/data/group-signals");

function pedidoAmoblado(extra = {}) {
  return {
    id: "sig-amob-1",
    group_id: "g1",
    autor_nombre: "Gustavo Arango",
    autor_telefono: "141746805670125",
    texto_original: "Buscamos apartamento Amoblado en el poblado, hasta $8.000.000",
    operacion: "arriendo",
    tipo: "apartamento",
    zona: "El Poblado",
    precio_max: 8000000,
    revalidacion: {
      refs_utiles: ["10319436"],
      refs_dudosas: [],
      por_que: "Calza en zona y presupuesto.",
    },
    matches: [
      {
        fuente: "diamond", ref: "10319436", titulo: "Apartamento Amoblado en Arriendo en El Poblado",
        zona: "El Poblado", precio: "$7.900.000", operacion: "Arriendo", area: "90m2",
        habitaciones: 3, puntaje: 79, ubicacion: "exacta", amoblado: true,
        // `link` (la landing propia) y `linkWasi`: los dos, como los trae una
        // fila real. Sin `link`, publicable.js marca `sin_link` y el aviso
        // saldria con una salvedad que no corresponde a este caso.
        link: "https://diamondinmobiliaria.com/propiedades/10319436",
        linkWasi: "https://info.wasi.co/apartamento-amoblado-10319436",
      },
    ],
    politica_motivo: "sin_telefono",
    ...extra,
  };
}

test("textoDePedido: el encabezado de AMOBLADOS SI llega por el camino real de la bandeja de salida", async () => {
  const telRestaurar = directorio.telefonoDe;
  const tokenRestaurar = groupSignalsData.asegurarToken;
  directorio.telefonoDe = async () => null;
  groupSignalsData.asegurarToken = async () => null;
  try {
    const texto = await avisosSalida.textoDePedido({ id: "org-1" }, pedidoAmoblado(), new Map(), null);
    assert.ok(texto, "tiene que producir un aviso");
    assert.match(texto, /AMOBLADOS/, "el encabezado se perdia en este camino antes del fix");
  } finally {
    directorio.telefonoDe = telRestaurar;
    groupSignalsData.asegurarToken = tokenRestaurar;
  }
});

test("textoDePedido: un pedido de venta no lleva el encabezado de amoblados", async () => {
  const telRestaurar = directorio.telefonoDe;
  const tokenRestaurar = groupSignalsData.asegurarToken;
  directorio.telefonoDe = async () => null;
  groupSignalsData.asegurarToken = async () => null;
  try {
    const senalVenta = pedidoAmoblado({ operacion: "venta" });
    const texto = await avisosSalida.textoDePedido({ id: "org-1" }, senalVenta, new Map(), null);
    assert.ok(texto);
    assert.doesNotMatch(texto, /AMOBLADOS/, "un aviso de venta no se marca");
  } finally {
    directorio.telefonoDe = telRestaurar;
    groupSignalsData.asegurarToken = tokenRestaurar;
  }
});

// ── EL RESIDUO: la bandeja de salida reconstruia el aviso SIN la compuerta ──
//
// Este camino se toma en la RAFAGA -- cuando a la asesora se le escribio hace
// menos de VENTANA_MIN -- que es exactamente el motivo de ser de este archivo.
// Antes de este fix, textoDePedido armaba el aviso con `refs_utiles` crudo:
// decia el motivo por el que la propiedad se freno (politica_motivo viene de
// la fila, ya corregido por vivo.js) y en el mismo mensaje se la entregaba
// para reenviar, como si estuviera limpia. Los dos caminos --el de vivo.js en
// linea y este-- tienen que producir lo mismo.
//
// La fila trae todo lo que hace falta: `select("*")` devuelve `matches` con
// sus banderas y `revalidacion` con lo que Sofi aprobo.

function conStubsDeBandeja(fn) {
  return async () => {
    const telRestaurar = directorio.telefonoDe;
    const tokenRestaurar = groupSignalsData.asegurarToken;
    directorio.telefonoDe = async () => null;
    groupSignalsData.asegurarToken = async () => null;
    try {
      await fn();
    } finally {
      directorio.telefonoDe = telRestaurar;
      groupSignalsData.asegurarToken = tokenRestaurar;
    }
  };
}

test(
  "textoDePedido: un plazo que no soportamos se explica Y viaja adentro del borrador, nunca como propiedad limpia",
  conStubsDeBandeja(async () => {
    const senal = pedidoAmoblado({
      politica_motivo: "periodo_no_soportado",
      matches: [
        {
          fuente: "diamond", ref: "10319436", titulo: "Apartamento Amoblado en Arriendo en El Poblado",
          zona: "El Poblado", ciudad: "Medellín", precio: "$7.900.000", operacion: "Arriendo", area: "90m2",
          habitaciones: 3, puntaje: 79, ubicacion: "exacta", amoblado: true,
          periodo_no_soportado: true,
          link: "https://diamondinmobiliaria.com/propiedades/10319436",
          linkWasi: "https://info.wasi.co/apartamento-amoblado-10319436",
        },
      ],
    });
    const texto = await avisosSalida.textoDePedido({ id: "org-1" }, senal, new Map(), null);

    assert.ok(texto, "tiene que producir un aviso");
    assert.match(texto, /▸ Ref 10319436/, "la asesora sigue viendo la propiedad: ella decide");
    assert.match(texto, /⚠️ .*cotizado por mes/i, "con la razon pegada a la ficha");
    const borrador = texto.slice(texto.indexOf("mandale ESTO YA"));
    assert.match(
      borrador,
      /Aclaración:.*cotizada por mes, no por días ni semanas/,
      "antes del fix el borrador la entregaba sin una palabra del plazo"
    );
  })
);

test(
  "textoDePedido: una ref bloqueada a mano SI se aparta por este camino, igual que en linea",
  conStubsDeBandeja(async () => {
    // 9921388 esta en GRUPOS_REFS_BLOQUEADAS por el precio mal cargado en Wasi.
    const senal = pedidoAmoblado({
      revalidacion: { refs_utiles: ["9921388"], refs_dudosas: [], por_que: "Calza en zona y presupuesto." },
      matches: [
        {
          fuente: "diamond", ref: "9921388", titulo: "Apartamento Loma de los Balsos",
          zona: "El Poblado", precio: "$1.550.000.000", operacion: "Venta", area: "180m2",
          habitaciones: 3, puntaje: 90, ubicacion: "exacta",
          link: "https://diamondinmobiliaria.com/propiedades/9921388",
          linkWasi: "https://info.wasi.co/apartamento-9921388",
        },
      ],
    });
    const texto = await avisosSalida.textoDePedido({ id: "org-1" }, senal, new Map(), null);

    assert.ok(texto);
    assert.match(texto, /⛔ Ref 9921388/, "el dato mal cargado no se ofrece ni por mano de la asesora");
    assert.doesNotMatch(texto, /mandale ESTO YA/i, "y no hay nada que reenviar");
  })
);

test(
  "textoDePedido: sin ningun freno, el aviso sale exactamente como antes -- sin salvedades inventadas",
  conStubsDeBandeja(async () => {
    const texto = await avisosSalida.textoDePedido({ id: "org-1" }, pedidoAmoblado(), new Map(), null);
    assert.ok(texto);
    assert.match(texto, /▸ Ref 10319436/);
    assert.ok(!texto.includes("⚠️"), `salvedad inventada:\n${texto}`);
    assert.ok(!texto.includes("⛔"), `apartada sin motivo:\n${texto}`);
  })
);

// El conteo del digest (Juan, 2026-09-07): "1 para ofrecer" sobre un pedido
// cuya unica ref esta apartada es una mentira que la asesora descubre al
// abrir la ficha.
test("digest: sin nada ofrecible y sin dudosas, no se anuncia '0 para revisar' -- se dice que mire la ficha", () => {
  const texto = digest.construir("Natalia", [
    pedido("Gustavo Arango", { utiles: 0, dudosas: 0, motivo: "sin_telefono" }),
    pedido("Jaime", { utiles: 2, dudosas: 0 }),
  ], []);
  assert.match(texto, /nada para ofrecer todavía — abrí la ficha para ver por qué/);
  assert.match(texto, /2 para ofrecer/, "el que si tiene algo se sigue contando igual");
  assert.ok(!texto.includes("0 para revisar"));
});
