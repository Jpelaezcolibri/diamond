const { test } = require("node:test");
const assert = require("node:assert");
const { parseExport, rangoDeFechas } = require("../scripts/group-mining/parse-export");

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
