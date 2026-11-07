// La fila del Excel de pendientes. Juan, 2026-11-07 (caso Andrea Strauch):
// cada fila trae TODO para comunicarse: celular y link, lo que pidió (literal),
// lo que se le ofreció con link de Wasi, peticiones especiales, por qué y
// desde cuándo.
const { test } = require("node:test");
const assert = require("node:assert");
const { armarCaso, refsDe, COLUMNAS_CASO } = require("../src/lib/caso-pendiente");

const PEDIDO_ANDREA = "*REQUERIMIENTO GUILLERMO G.*\n\n* Cesión de derechos en Itagüí parte baja (le gusta Oliva en Ciudad Coltejer o Nuevo Poblado en las Chimeneas)\n\n* Hasta $500 millones\n\nAndrea Strauch \nHabitar Propiedad Raíz";
const depsBase = (over = {}) => ({
  pedido: async () => null,
  pedidosDelColega: async () => [],
  ficha: async (_o, ref) => ({ ref, tipo: "Apartamento", zona: "Itagüí", precio: "$390.000.000", linkWasi: `https://info.wasi.co/apartamento-venta-itagui-medellin/${ref}?shared=whatsapp` }),
  colega: async () => null,
  soloLlamada: async () => false,
  ...over,
});

test("refsDe saca las refs de los mensajes de Sofi sin repetir", () => {
  assert.deepStrictEqual(refsDe(["la ref 10414675 y la 9944723", "otra vez la 10414675"]), ["10414675", "9944723"]);
});

test("el caso de un colega trae su pedido por el código, lo ofrecido con link de Wasi y el chat", async () => {
  const mensajes = [
    { role: "user", content: "Hola Sofi, sobre mi PEDIDO (cód. U9QT): Hola", created_at: "2026-10-27T12:55:00Z" },
    { role: "assistant", content: "Te pasé la ref 10414675", created_at: "2026-10-27T12:56:00Z" },
  ];
  const caso = await armarCaso({
    org: { id: "o1" }, crmUrl: "https://crm.x",
    pendiente: { codigo: "C-0001", motivo: "no_contesto", conversation_id: "c1", created_at: "2026-10-28T13:02:00Z" },
    lead: { id: "l1", phone: "573014521622", source: "colega", nombre: null },
    mensajes,
    deps: depsBase({
      pedido: async (_o, cod) => (cod === "U9QT" ? { texto_original: "Busco casa en arriendo en El Poblado, 3 alcobas", respuesta_refs: ["10414675"], created_at: "2026-10-27T12:00:00Z" } : null),
      ficha: async (_o, ref) => ({ ref, tipo: "Casa", zona: "El Poblado", precio: 19900000, linkWasi: `https://info.wasi.co/casa/${ref}?shared=whatsapp` }),
      colega: async () => ({ nombre: "Clara Segura", lid: "1", telefono: "573014521622" }),
    }),
  });
  assert.strictEqual(caso.nombre, "Clara Segura");
  assert.strictEqual(caso.celular, "+57 301 452 1622");
  assert.strictEqual(caso.whatsapp, "wa.me/573014521622");
  assert.match(caso.pidio, /El Poblado, 3 alcobas/);
  assert.match(caso.ofrecido, /Ref 10414675 · Casa · El Poblado · \$19\.900\.000 · https:\/\/info\.wasi\.co\/casa\/10414675\?shared=whatsapp/);
  assert.strictEqual(caso.chatUrl, "https://crm.x/inbox/c1");
  assert.strictEqual(caso.motivo, "no_contesto");
});

test("Andrea Strauch: sin código en el chat, el pedido sale de los grupos (por su teléfono) y lo ofrecido junta el chat y el DM", async () => {
  const mensajes = [
    { role: "user", content: "Hola, requiero que revisen si cumplen con el requerimiento que envie", created_at: "2026-11-04T23:46:40Z" },
    { role: "assistant", content: "Revisé la ref 10012722 contra tu requerimiento. Link: https://info.wasi.co/apartamento-venta-itagui-medellin/10012722?shared=whatsapp", created_at: "2026-11-04T23:46:49Z" },
    { role: "user", content: "Hola, gracias, debe ser cesión de derechos obligatorio", created_at: "2026-11-05T13:22:20Z" },
    { role: "assistant", content: "Hoy no tenemos cesiones de derechos en Itagüí. ¿Quieres que le deje el pedido a nuestra asesora?", created_at: "2026-11-05T13:22:26Z" },
  ];
  const caso = await armarCaso({
    org: { id: "o1" }, crmUrl: "https://crm.x",
    pendiente: { codigo: "C-0011", motivo: "sin_seguimiento", conversation_id: "c1", created_at: "2026-11-06T13:02:18Z" },
    lead: { id: "l1", phone: "573137884474", source: "colega", nombre: null },
    mensajes,
    deps: depsBase({
      colega: async () => ({ nombre: "Andrea Strauch", lid: "164248206495750", telefono: "573137884474" }),
      pedidosDelColega: async () => [
        { texto_original: PEDIDO_ANDREA, zona: "Itagüí", tipo: "apartamento", operacion: "venta", respuesta_refs: ["10012722", "10077219"], created_at: "2026-11-04T16:02:35Z" },
      ],
    }),
  });
  assert.strictEqual(caso.nombre, "Andrea Strauch");
  assert.strictEqual(caso.tipo, "colega");
  assert.match(caso.pidio, /^Pedido del 4 nov \(apartamento · venta · Itagüí\):\n\*REQUERIMIENTO GUILLERMO G\.\*/);
  assert.match(caso.pidio, /Cesión de derechos en Itagüí/);
  assert.match(caso.pidio, /\n\* Hasta \$500 millones/); // literal: conserva los saltos de linea
  // Primero lo del chat (10012722) y despues lo del DM que no estaba en el chat (10077219), cada una con su link.
  const lineas = caso.ofrecido.split("\n");
  assert.match(lineas[0], /^Ref 10012722 · Apartamento · Itagüí · \$390\.000\.000 · https:\/\/info\.wasi\.co\/.*10012722\?shared=whatsapp$/);
  assert.match(lineas[1], /^Ref 10077219 .*10077219\?shared=whatsapp$/);
  assert.strictEqual(lineas.length, 2);
  assert.strictEqual(caso.ultimoSuyo, "5 nov, 8:22 a. m.: Hola, gracias, debe ser cesión de derechos obligatorio");
  assert.match(caso.ultimoSofi, /^5 nov, 8:22 a\. m\.: Hoy no tenemos cesiones/);
  assert.strictEqual(caso.porQue, "no le contestó a Sofi y ella ya no alcanza a escribirle (ventana de 24 h)");
  assert.strictEqual(caso.desde, "Pendiente desde el 6 nov, 8:02 a. m. · Su último mensaje: 5 nov, 8:22 a. m.");
  assert.strictEqual(caso.especial, "");
});

test("peticiones especiales: solo llamada, presupuesto, zona, visita pedida e inmueble que ofrece", async () => {
  const caso = await armarCaso({
    org: { id: "o1" },
    pendiente: { codigo: "C-0002", motivo: "pide_asesor", conversation_id: "c2", created_at: "2026-11-06T22:32:19Z" },
    lead: {
      id: "l2", phone: "573104047682", source: "whatsapp", nombre: "Sara Gaviria", presupuesto: "$650.000.000", zona_interes: "Laureles", tipo_interes: "apartamento", urgencia: "este mes",
      cita: { fecha_hora: "2026-11-10T15:00:00Z", ref: "9944723", estado: "solicitada" },
      inmueble_ofrecido: { tipo: "casa", zona: "Envigado", precio: "$2.500.000", operacion: "arriendo" },
    },
    mensajes: [{ role: "user", content: "Espero me contacte el asesor", created_at: "2026-11-06T20:20:57Z" }],
    deps: depsBase({ soloLlamada: async () => true }),
  });
  assert.strictEqual(caso.tipo, "cliente");
  assert.strictEqual(caso.celular, "+57 310 404 7682");
  assert.deepStrictEqual(caso.especial.split("\n"), [
    "Prefiere LLAMADA, no WhatsApp",
    "Presupuesto: $650.000.000",
    "Zona: Laureles",
    "Busca: apartamento",
    "Urgencia: este mes",
    "Visita pedida: 10 nov, 10:00 a. m. · ref 9944723 (solicitada)",
    "Ofrece un inmueble: casa · Envigado · $2.500.000 · arriendo",
  ]);
  // Sin pedido de grupo ni codigo, "que pidio" son sus mensajes literales con fecha.
  assert.strictEqual(caso.pidio, "6 nov, 3:20 p. m.: Espero me contacte el asesor");
  assert.strictEqual(caso.ofrecido, "");
});

test("un número de 7 cifras que no es ficha no sale como ref; una ref del DM que ya no está, se dice", async () => {
  const caso = await armarCaso({
    org: { id: "o1" }, pendiente: { codigo: "C-4", motivo: "no_contesto", created_at: "2026-11-06T13:00:00Z" },
    lead: { id: "l4", phone: "573192077362", source: "colega" },
    mensajes: [{ role: "assistant", content: "La ref 10013413 cuesta 950000000; la 1022037 no existe", created_at: "2026-11-05T13:00:00Z" }],
    deps: depsBase({
      ficha: async (_o, ref) => (ref === "10013413" ? { ref, tipo: "Dúplex", zona: "Sabaneta", precio: "$950.000.000", linkWasi: `https://info.wasi.co/d/${ref}?shared=whatsapp` } : null),
      pedidosDelColega: async () => [{ texto_original: "Busco apto", respuesta_refs: ["10013413", "9999999"], created_at: "2026-11-04T16:02:35Z" }],
    }),
  });
  assert.deepStrictEqual(caso.ofrecido.split("\n"), [
    "Ref 10013413 · Dúplex · Sabaneta · $950.000.000 · https://info.wasi.co/d/10013413?shared=whatsapp",
    "Ref 9999999 (ya no está en el inventario)",
  ]);
});

test("sin número (usuario BSUID) lo dice en vez de armar un link roto", async () => {
  const caso = await armarCaso({ org: { id: "o1" }, pendiente: { codigo: "C-3", motivo: "no_contesto", created_at: "2026-11-06T13:00:00Z" }, lead: { id: "l3", phone: "CO.3468246810013101", source: "whatsapp" }, mensajes: [], deps: depsBase() });
  assert.strictEqual(caso.celular, "sin número");
  assert.strictEqual(caso.whatsapp, "escríbele desde el chat del CRM");
  assert.strictEqual(caso.nombre, "(sin nombre)");
});

test("las columnas del Excel cubren todo lo que la asesora necesita, en este orden", () => {
  assert.deepStrictEqual(COLUMNAS_CASO.map(([h]) => h), [
    "Código", "Nombre", "Celular", "WhatsApp", "Colega / cliente", "Por qué", "Desde cuándo",
    "Qué pidió", "Qué se le ofreció", "Peticiones especiales", "Lo último que dijo", "Lo último de Sofi", "Chat CRM",
  ]);
});
