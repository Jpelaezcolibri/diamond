const { test } = require("node:test");
const assert = require("node:assert");
const { parseExport, rangoDeFechas } = require("../src/groups/parse-export");

// Fixtures inline: nada de I/O de archivos, para que los tests sean
// determinísticos y no dependan de un export real (que ademas tiene datos de
// terceros y no puede vivir en el repo).

const ANDROID = [
  "5/07/2026, 10:30 a. m. - Los mensajes y las llamadas están cifrados de extremo a extremo.",
  "5/07/2026, 10:32 a. m. - Andrea Gómez: Buenos días a todos",
  "5/07/2026, 10:35 a. m. - Carlos Ruiz: Tengo cliente para apto 3 alcobas en Laureles",
  "hasta 400 millones, urgente",
  "5/07/2026, 10:36 a. m. - Andrea Gómez: <Multimedia omitido>",
  "6/07/2026, 9:00 a. m. - Carlos Ruiz añadió a María Lopez",
].join("\n");

const IOS = [
  "[5/07/2026, 10:32:15 a. m.] Andrea Gómez: Buenos días",
  "[5/07/2026, 10:33:02 a. m.] Carlos Ruiz: ‎<adjunto: IMG-001.jpg>",
].join("\n");

test("parsea el formato Android con autor y texto", () => {
  const msgs = parseExport(ANDROID, { grupo: "test" });
  const andrea = msgs.find((m) => m.texto === "Buenos días a todos");
  assert.strictEqual(andrea.autor, "Andrea Gómez");
  assert.strictEqual(andrea.esSistema, false);
  assert.strictEqual(andrea.fechaIso, "2026-07-05");
});

test("un mensaje multilínea absorbe las líneas sin timestamp", () => {
  const msgs = parseExport(ANDROID, { grupo: "test" });
  const carlos = msgs.find((m) => m.autor === "Carlos Ruiz" && m.texto.includes("Laureles"));
  assert.match(carlos.texto, /400 millones, urgente$/);
});

test("el aviso de cifrado y el 'añadió a' se marcan como sistema", () => {
  const msgs = parseExport(ANDROID, { grupo: "test" });
  const sistema = msgs.filter((m) => m.esSistema);
  assert.strictEqual(sistema.length, 2);
  assert.strictEqual(sistema.every((m) => m.autor === null), true);
});

test("los adjuntos se marcan como multimedia", () => {
  const android = parseExport(ANDROID, { grupo: "test" });
  assert.strictEqual(android.find((m) => m.texto === "<Multimedia omitido>").esMultimedia, true);

  const ios = parseExport(IOS, { grupo: "test" });
  assert.strictEqual(ios.find((m) => m.texto.includes("adjunto")).esMultimedia, true);
});

test("parsea el formato iOS con corchetes y segundos", () => {
  const msgs = parseExport(IOS, { grupo: "test" });
  assert.strictEqual(msgs.length, 2);
  assert.strictEqual(msgs[0].autor, "Andrea Gómez");
  assert.strictEqual(msgs[0].texto, "Buenos días");
});

test("las marcas de dirección invisibles no rompen el parseo", () => {
  // WhatsApp mete U+200E al inicio de las lineas de adjunto.
  const conMarca = "‎[5/07/2026, 10:32:15 a. m.] Andrea Gómez: hola";
  const msgs = parseExport(conMarca, { grupo: "test" });
  assert.strictEqual(msgs[0].autor, "Andrea Gómez");
});

test("el narrow nbsp antes de 'a. m.' no rompe el parseo", () => {
  // Exports recientes usan U+202F en vez de espacio normal.
  const conNbsp = "5/07/2026, 10:32 a. m. - Andrea Gómez: hola";
  const msgs = parseExport(conNbsp, { grupo: "test" });
  assert.strictEqual(msgs.length, 1);
  assert.strictEqual(msgs[0].autor, "Andrea Gómez");
});

test("BUG: un mensaje de sistema con dos puntos no se parsea como autor", () => {
  // "cambió el asunto del grupo a: X" tiene dos puntos; sin el marcador de
  // sistema, el autor seria la frase entera.
  const linea = "5/07/2026, 11:00 a. m. - Carlos Ruiz cambió el asunto del grupo a: Ventas Medellín";
  const msgs = parseExport(linea, { grupo: "test" });
  assert.strictEqual(msgs[0].esSistema, true);
  assert.strictEqual(msgs[0].autor, null);
});

test("rangoDeFechas cuenta días transcurridos, no días con actividad", () => {
  const msgs = parseExport(ANDROID, { grupo: "test" });
  const rango = rangoDeFechas(msgs);
  assert.strictEqual(rango.desde, "2026-07-05");
  assert.strictEqual(rango.hasta, "2026-07-06");
  assert.strictEqual(rango.dias, 2);
});

test("rangoDeFechas nunca devuelve 0 días (evita división por cero al normalizar)", () => {
  const unSoloDia = parseExport("5/07/2026, 10:32 a. m. - A: hola", { grupo: "test" });
  assert.strictEqual(rangoDeFechas(unSoloDia).dias, 1);
  assert.strictEqual(rangoDeFechas([]).dias, 0);
});

test("cada mensaje lleva un id estable para poder rastrearlo en el reporte", () => {
  const msgs = parseExport(ANDROID, { grupo: "laureles" });
  assert.strictEqual(msgs[0].id, "laureles#0");
  assert.strictEqual(new Set(msgs.map((m) => m.id)).size, msgs.length);
});

// ── Hora e instante ──────────────────────────────────────────────────────
//
// El import incremental compara mensajes del mismo día entre sí: sin hora, la
// marca de agua de la mañana se come lo que llegue al mediodía.

const { parseHora, parseInstante } = require("../src/groups/parse-export");

test("la hora de 12 horas se convierte bien, incluidos los dos bordes", () => {
  assert.deepStrictEqual(parseHora("8:12 a. m."), { h: 8, min: 12, seg: 0 });
  assert.deepStrictEqual(parseHora("12:40 p. m."), { h: 12, min: 40, seg: 0 }, "12 p.m. es mediodía, no 24");
  assert.deepStrictEqual(parseHora("12:05 a. m."), { h: 0, min: 5, seg: 0 }, "12 a.m. es medianoche");
  assert.deepStrictEqual(parseHora("3:30 p.m."), { h: 15, min: 30, seg: 0 });
  assert.deepStrictEqual(parseHora("10:32:15 a. m."), { h: 10, min: 32, seg: 15 }, "iOS trae segundos");
});

test("la hora de 24 horas pasa sin tocarse", () => {
  assert.deepStrictEqual(parseHora("17:45"), { h: 17, min: 45, seg: 0 });
  assert.deepStrictEqual(parseHora("00:05"), { h: 0, min: 5, seg: 0 });
});

test("una hora ilegible no rompe: devuelve null", () => {
  assert.strictEqual(parseHora("no es una hora"), null);
  assert.strictEqual(parseHora(""), null);
  assert.strictEqual(parseHora("25:00"), null);
});

test("el instante ordena los mensajes de un mismo día", () => {
  const manana = parseInstante("1/8/2026", "08:12 a. m.");
  const mediodia = parseInstante("1/8/2026", "12:40 p. m.");
  const tarde = parseInstante("1/8/2026", "6:05 p. m.");
  assert.ok(manana < mediodia && mediodia < tarde);
});

test("sin hora legible el instante cae al arranque del día, no a null", () => {
  // Perder el mensaje sería peor que ubicarlo al principio del día.
  const i = parseInstante("1/8/2026", "???");
  assert.strictEqual(i.toISOString(), "2026-08-01T00:00:00.000Z");
});

test("cada mensaje parseado lleva su instante con hora", () => {
  const msgs = parseExport([
    "1/8/2026, 8:12 a. m. - Andrés: primero",
    "1/8/2026, 12:40 p. m. - Marcela: segundo",
  ].join("\n"), { grupo: "G" });

  assert.strictEqual(msgs[0].fechaIso, "2026-08-01", "fechaIso sigue siendo el día");
  assert.strictEqual(msgs[0].instanteIso, "2026-08-01T08:12:00.000Z");
  assert.strictEqual(msgs[1].instanteIso, "2026-08-01T12:40:00.000Z");
});
