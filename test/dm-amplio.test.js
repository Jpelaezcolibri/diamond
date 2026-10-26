// DM amplio (Juan, 2026-10-26): "necesito que hagamos todas las respuestas
// automaticas". Tres aperturas, cada una detras de su interruptor:
//   · RADAR_DM_ZONA_CERCANA: la zona vecina (y el barrio que la ficha nombra
//     distinto al pedido) sale con aclaracion SOLO si no hay ninguna exacta.
//   · Dentro de RADAR_DM_CON_ACLARACION: el precio por confirmar sale si el
//     precio de Wasi cabe aunque el de la descripcion no.
//   · RADAR_DM_DUDOSAS: las dudosas de Sofi pasan por la misma compuerta (ver
//     test/group-asistido.test.js).

const { test } = require("node:test");
require("./helpers/interruptores-dm").apagadosEnCadaTest();
const assert = require("node:assert");
const publicable = require("../src/groups/publicable");
const redactar = require("../src/groups/redactar");
const { evaluarCandidata } = require("../src/groups/match");

function ficha(extra = {}) {
  return {
    fuente: "diamond", ref: "AP1", titulo: "Apartamento en Venta Envigado",
    zona: "Envigado", precio: "$450.000.000", operacion: "Venta",
    link: "https://diamondinmobiliaria.com/propiedades/ap1",
    linkWasi: "https://info.wasi.co/apartamento-venta-envigado/10416693",
    habitaciones: 3, area: "90m2", puntaje: 85, ubicacion: "exacta", ...extra,
  };
}

const ON = { umbral: 0, conAclaracion: true, zonaCercana: true };
const VOSEO = /necesitás|confirmame|decime|querés|podés|tenés|mirá|decidí|\bvos\b/i;

// ── Interruptores ──────────────────────────────────────────────────────────
test("los dos interruptores nuevos estan apagados por defecto y solo 'true' los enciende", () => {
  for (const [fn, nombre] of [
    [publicable.dmZonaCercanaActivo, "RADAR_DM_ZONA_CERCANA"],
    [publicable.dmDudosasActivo, "RADAR_DM_DUDOSAS"],
  ]) {
    assert.strictEqual(fn({}), false, nombre);
    assert.strictEqual(fn({ [nombre]: "1" }), false, nombre);
    assert.strictEqual(fn({ [nombre]: "false" }), false, nombre);
    assert.strictEqual(fn({ [nombre]: " TRUE " }), true, nombre);
  }
});

// ── Zona cercana ───────────────────────────────────────────────────────────
test("zona cercana: una vecina sale con aclaracion si no hay ninguna exacta", () => {
  const r = publicable.filtrar([ficha({ ref: "VEC", ubicacion: "vecina", zona: "Itagüí" })], ON);
  assert.deepStrictEqual(r.publicables.map((m) => m.ref), ["VEC"]);
  assert.deepStrictEqual(r.descartados, []);
  assert.strictEqual(r.aclaraciones.length, 1);
  assert.strictEqual(r.aclaraciones[0].ref, "VEC");
  assert.strictEqual(r.aclaraciones[0].zonaCercana, true);
  assert.deepStrictEqual(r.aclaraciones[0].motivos, ["zona_vecina"]);
});

test("zona cercana: con una exacta, la vecina NO sale", () => {
  const r = publicable.filtrar([ficha({ ref: "VEC", ubicacion: "vecina", puntaje: 99 }), ficha({ ref: "EXA", puntaje: 70 })], ON);
  assert.deepStrictEqual(r.publicables.map((m) => m.ref), ["EXA"]);
  assert.deepStrictEqual(r.aclaraciones, []);
  assert.deepStrictEqual(r.descartados, [{ ref: "VEC", motivos: ["zona_vecina"] }]);
});

test("zona cercana: una aclarable de dato no cuenta como exacta; orden exactas, dato, cercanas", () => {
  const r = publicable.filtrar(
    [ficha({ ref: "VEC", ubicacion: "vecina", puntaje: 99 }), ficha({ ref: "PISO", piso_sin_confirmar: true, puntaje: 60 })],
    ON
  );
  assert.deepStrictEqual(r.publicables.map((m) => m.ref), ["PISO", "VEC"]);
  assert.deepStrictEqual(r.aclaraciones.map((a) => a.ref), ["PISO", "VEC"]);
});

test("zona cercana: vecina con un dato aclarable sale con las dos aclaraciones; con otro motivo no", () => {
  const ok = publicable.filtrar([ficha({ ubicacion: "vecina", piso_sin_confirmar: true })], ON);
  assert.strictEqual(ok.publicables.length, 1);
  assert.deepStrictEqual(ok.aclaraciones[0].motivos.sort(), ["piso_sin_confirmar", "zona_vecina"]);
  assert.match(ok.aclaraciones[0].detalle, /piso/);

  for (const extra of [{ amoblado_sin_confirmar: true }, { varios_pedidos: true }, { precio: "$0" }, { linkWasi: "" }, { fuente: "aliado" }]) {
    const r = publicable.filtrar([ficha({ ubicacion: "vecina", ...extra })], ON);
    assert.deepStrictEqual(r.publicables, [], JSON.stringify(extra));
  }
  // Sin la aclaracion de dato encendida, la vecina solo sale limpia.
  const sinDato = publicable.filtrar([ficha({ ubicacion: "vecina", piso_sin_confirmar: true })], { umbral: 0, zonaCercana: true });
  assert.deepStrictEqual(sinDato.publicables, []);
  const limpia = publicable.filtrar([ficha({ ubicacion: "vecina" })], { umbral: 0, zonaCercana: true });
  assert.strictEqual(limpia.publicables.length, 1);
});

test("zona cercana: una zona lejana nunca sale", () => {
  for (const ubicacion of ["otra_zona", "ciudad"]) {
    const r = publicable.filtrar([ficha({ ubicacion })], ON);
    assert.deepStrictEqual(r.publicables, [], ubicacion);
    assert.ok(r.descartados[0].motivos.includes("zona_no_publicable"));
  }
});

test("zona cercana apagada: la vecina sigue sin salir, como hoy", () => {
  const r = publicable.filtrar([ficha({ ubicacion: "vecina" })], { umbral: 0, conAclaracion: true });
  assert.deepStrictEqual(r.publicables, []);
  assert.deepStrictEqual(r.aclaraciones, []);
  assert.deepStrictEqual(r.descartados, [{ ref: "AP1", motivos: ["zona_vecina"] }]);
});

test("zona cercana: la ficha lleva 'No es en ...: queda en ..., cerca' por delante, en tuteo, y la salvedad no la contradice", () => {
  const { publicables, aclaraciones } = publicable.filtrar([ficha({ ubicacion: "vecina", zona: "Itagüí", piso_sin_confirmar: true })], ON);
  const notas = publicable.notasParaDm({ sinConfirmar: ["barrio exacto", "terraza"], leFalta: [] }, aclaraciones, publicables);
  const armado = redactar.mensajesAlColega({ autor_nombre: "Ana" }, publicables, {
    ...notas,
    pedido: { zonas: ["Envigado"], zona: "Envigado" },
  });
  const textoFicha = armado.mensajes[1].texto;
  assert.match(textoFicha, /Aclaración: No es en Envigado: queda en Itagüí, cerca · no tengo registrado en qué piso está/);
  assert.doesNotMatch(textoFicha, /vecina de/);
  assert.doesNotMatch(textoFicha, VOSEO);
  assert.doesNotMatch(armado.mensajes[0].texto, /barrio/, "la salvedad no habla de zona/barrio");
  assert.match(armado.mensajes[0].texto, /terraza/);
});

test("zona cercana: sin la marca, la vecina se describe como siempre (aviso a la asesora, grupo)", () => {
  const d = redactar.desvios(ficha({ ubicacion: "vecina", zona: "Itagüí" }), { zonas: ["Envigado"] });
  assert.deepStrictEqual(d, ["queda en Itagüí, vecina de Envigado"]);
});

test("zona cercana: el match original no se modifica (filtrar devuelve una copia marcada)", () => {
  const m = ficha({ ubicacion: "vecina" });
  const r = publicable.filtrar([m], ON);
  assert.notStrictEqual(r.publicables[0], m);
  assert.strictEqual(m.zona_cercana, undefined);
  assert.ok(r.publicables[0].zona_cercana);
});

// ── Barrio que la ficha nombra (sector_sin_confirmar + barrio_en_ficha) ────
test("barrio en la ficha: sale como zona cercana con el barrio nombrado, solo sin exactas", () => {
  const m = ficha({ ref: "10031500", ubicacion: "zona_general", titulo: "Vendo Apartamento Sector Campestre Via las Antillas Envigado", barrio_en_ficha: ["antillas"] });
  const r = publicable.filtrar([m], ON);
  assert.deepStrictEqual(r.publicables.map((x) => x.ref), ["10031500"]);
  assert.strictEqual(r.aclaraciones[0].zonaCercana, true);

  const notas = publicable.notasParaDm({ sinConfirmar: ["barrio exacto"], leFalta: [] }, r.aclaraciones, r.publicables);
  const armado = redactar.mensajesAlColega({ autor_nombre: "Ana" }, r.publicables, {
    ...notas,
    pedido: { zonas: ["Dorado", "La Paz"], zona: "Dorado" },
  });
  const t = armado.mensajes[1].texto;
  assert.match(t, /Aclaración: queda en Antillas, Envigado/);
  assert.doesNotMatch(t, /barrio exacto no lo tengo registrado/, "seria falso: la ficha nombra el barrio");
  assert.doesNotMatch(armado.mensajes[0].texto, /barrio/);

  const conExacta = publicable.filtrar([m, ficha({ ref: "EXA" })], ON);
  assert.deepStrictEqual(conExacta.publicables.map((x) => x.ref), ["EXA"]);
});

test("barrio en la ficha: sin zona cercana sigue bloqueada (regla del rescate)", () => {
  const m = ficha({ ubicacion: "zona_general", barrio_en_ficha: ["antillas"] });
  const r = publicable.filtrar([m], { umbral: 0, conAclaracion: true });
  assert.deepStrictEqual(r.publicables, []);
});

test("barrio desconocido (sin barrio_en_ficha) sigue siendo aclaracion de dato, no zona cercana", () => {
  const r = publicable.filtrar([ficha({ ubicacion: "zona_general" }), ficha({ ref: "EXA" })], ON);
  assert.deepStrictEqual(r.publicables.map((x) => x.ref), ["EXA", "AP1"]);
  assert.ok(!r.aclaraciones[0].zonaCercana);
});

// ── Precio: basta con que el de Wasi quepa ─────────────────────────────────
const pedidoPrecio = (extra = {}) => ({
  operacion: "venta", tipo: "apartamento", zona: "Envigado",
  precio_min: 0, precio_max: 450000000, habitaciones: 3,
  area_min: 0, banos: 0, garajes: 0, estrato: 0, ...extra,
});
const aptoPrecio = (precio, descripcion) => ({
  ref: "P1", titulo: "Apartamento en Envigado", tipo: "Apartamento",
  operacion: "Venta", precio, zona: "Envigado", ciudad: "Envigado",
  habitaciones: 3, banos: 2, garaje: 1, estrato: 5, area: "95 m²", descripcion,
  link: "https://diamondinmobiliaria.com/propiedades/p1",
  linkWasi: "https://info.wasi.co/apartamento-venta-envigado/10416693",
});

test("precio: Wasi en margen y descripcion fuera: sale con 'te confirmo el precio final'", () => {
  const m = evaluarCandidata(aptoPrecio("$450.000.000", "Precio de venta: $650.000.000"), pedidoPrecio(), "diamond");
  assert.strictEqual(m.precio_sin_confirmar, true);
  assert.strictEqual(m.precio_texto_en_margen, false);
  assert.strictEqual(m.precio_wasi_en_margen, true);
  const r = publicable.filtrar([m], { umbral: 0, conAclaracion: true });
  assert.strictEqual(r.publicables.length, 1);
  assert.match(r.aclaraciones[0].detalle, /te confirmo el precio final/);
});

test("precio: Wasi fuera del presupuesto: el motor la descarta, nunca sale", () => {
  assert.strictEqual(evaluarCandidata(aptoPrecio("$650.000.000", "Precio de venta: $450.000.000"), pedidoPrecio(), "diamond"), null);
  // Un match que dice que Wasi no cabe nunca sale, aunque quepa el del texto.
  const r = publicable.filtrar([ficha({ precio_sin_confirmar: true, precio_texto_en_margen: true, precio_wasi_en_margen: false })], { umbral: 0, conAclaracion: true });
  assert.deepStrictEqual(r.publicables, []);
  // Un match guardado antes de la marca (sin el campo) decide como antes.
  const viejo = publicable.filtrar([ficha({ precio_sin_confirmar: true, precio_texto_en_margen: true })], { umbral: 0, conAclaracion: true });
  assert.strictEqual(viejo.publicables.length, 1);
  const ninguno = publicable.filtrar([ficha({ precio_sin_confirmar: true, precio_texto_en_margen: false, precio_wasi_en_margen: false })], { umbral: 0, conAclaracion: true });
  assert.deepStrictEqual(ninguno.publicables, []);
});

test("precio: sin presupuesto en el pedido sigue bloqueada", () => {
  const m = evaluarCandidata(aptoPrecio("$450.000.000", "Precio de venta: $480.000.000"), pedidoPrecio({ precio_max: 0 }), "diamond");
  assert.strictEqual(m.precio_wasi_en_margen, false);
  const r = publicable.filtrar([m], { umbral: 0, conAclaracion: true });
  assert.deepStrictEqual(r.publicables, []);
});

// ── Dudosas: el texto de la aclaracion ────────────────────────────────────
test("dudosas: la razon de Sofi va como aclaracion de la ficha, en tuteo y sin datos del equipo", () => {
  const matches = [
    ficha({ ref: "D1", razones: ["Zona: Envigado", "2 alcobas (pediste 3)", "$470M — 4% sobre $450M, dentro del margen"] }),
    ficha({ ref: "D2", razones: ["Zona: Envigado"] }),
    ficha({ ref: "D3", ubicacion: "vecina", zona: "Sabaneta" }),
  ];
  const veredicto = {
    refs_utiles: [], refs_dudosas: ["D1", "D2", "D3", "NOESTA"],
    dudosas_motivo: [
      { ref: "D1", motivo: "dos_o_mas_incumplimientos_conocidos" },
      { ref: "D2", motivo: "de_fondo_dudoso" },
      { ref: "D3", motivo: "zona_vecina_y_colega_tajante" },
    ],
    le_falta: [{ ref: "D2", detalle: "es un dúplex y pediste apartamento" }],
    por_que: "Decidí vos: Daiana sabe si sirve, llamala al 3001234567",
  };
  const r = publicable.dudosasParaDm(veredicto, matches);
  // D3: el colega escribio "solo" esa zona y la ficha es vecina. Es un
  // requisito CONOCIDO que no cumple: no sale (el caso del 18-sep).
  assert.deepStrictEqual(r.matches.map((m) => m.ref), ["D1", "D2"]);
  const porRef = Object.fromEntries(r.leFalta.map((f) => [f.ref, f.detalle]));
  assert.match(porRef.D1, /2 alcobas y pediste 3/);
  // I3: el precio se dice como en la ficha, sin la jerga del motor.
  assert.match(porRef.D1, /cuesta \$470M y pediste hasta \$450M/);
  assert.doesNotMatch(porRef.D1, /dentro del margen|% sobre/);
  assert.match(porRef.D2, /es un dúplex y pediste apartamento/, "lo que Sofi escribio para esa ref va primero");
  assert.strictEqual(porRef.D3, undefined);
  for (const t of Object.values(porRef)) {
    assert.doesNotMatch(t, VOSEO);
    assert.doesNotMatch(t, /Daiana|Claudia|Catherine|\d{10}/, "el por_que de la asesora no se filtra al colega");
  }
});

test("dudosas: sin dato concreto la ficha no lleva nota; el aviso va para el colega", () => {
  const r = publicable.dudosasParaDm({ refs_dudosas: ["D1"] }, [ficha({ ref: "D1" })]);
  assert.deepStrictEqual(r.leFalta, []);
  assert.match(r.avisoColega, /Revisa la aclaración de cada ficha antes de pasársela a tu cliente/);
  assert.doesNotMatch(r.avisoColega, VOSEO);
});

// ── I3: la ficha de una dudosa se reenvia al cliente final ─────────────────
// Nada dirigido al colega ("revísala antes de pasarla", "no estoy seguro") ni
// jerga del motor ("4% sobre $450M, dentro del margen") dentro de la ficha.
// La salvedad para el colega va en el primer mensaje.
const PROHIBIDO_EN_FICHA = /rev[ií]sal|antes de pasar|no estoy seguro|no calza en todo|dentro del margen|% sobre|Daiana|Claudia|Catherine|asesora/i;

test("I3: la ficha de la dudosa no lleva texto para el colega ni jerga; el primer mensaje si avisa", () => {
  const matches = [
    ficha({ ref: "D1", habitaciones: 2, precio: "$470.000.000", razones: ["Zona: Envigado", "2 alcobas (pediste 3)", "$470M — 4% sobre $450M, dentro del margen"] }),
    ficha({ ref: "D2", razones: ["Zona: Envigado"] }),
  ];
  const veredicto = {
    refs_utiles: [], refs_dudosas: ["D1", "D2"],
    dudosas_motivo: [{ ref: "D1", motivo: "dos_o_mas_incumplimientos_conocidos" }, { ref: "D2", motivo: "de_fondo_dudoso" }],
  };
  const dud = publicable.dudosasParaDm(veredicto, matches);
  for (const f of dud.leFalta) assert.doesNotMatch(f.detalle, PROHIBIDO_EN_FICHA, f.detalle);
  const r = publicable.filtrar(dud.matches, ON);
  const notas = publicable.notasParaDm({ sinConfirmar: [], leFalta: dud.leFalta }, r.aclaraciones, r.publicables);
  const armado = redactar.mensajesAlColega({ autor_nombre: "Ana" }, r.publicables, {
    ...notas, avisoAlColega: dud.avisoColega,
    pedido: { zonas: ["Envigado"], zona: "Envigado", habitaciones: 3, precio_max: 450000000 },
  });
  const [primero, ...fichas] = armado.mensajes.map((x) => x.texto);
  for (const t of fichas) {
    assert.doesNotMatch(t, PROHIBIDO_EN_FICHA, t);
    assert.doesNotMatch(t, VOSEO, t);
  }
  assert.match(fichas[0], /2 alcobas y pediste 3/);
  assert.match(fichas[0], /cuesta \$470M y pediste hasta \$450M/);
  assert.match(primero, /Revisa la aclaración de cada ficha antes de pasársela a tu cliente/);
  assert.doesNotMatch(primero, VOSEO);
});

test("I3: sin aviso, el primer mensaje queda igual que siempre", () => {
  const props = [ficha()];
  const a = redactar.mensajesAlColega({ autor_nombre: "Ana" }, props, { pedido: { zonas: ["Envigado"] } });
  const b = redactar.mensajesAlColega({ autor_nombre: "Ana" }, props, { pedido: { zonas: ["Envigado"] }, avisoAlColega: null });
  assert.strictEqual(a.mensajes[0].texto, b.mensajes[0].texto);
  assert.doesNotMatch(a.mensajes[0].texto, /Revisa la aclaración/);
});

test("dudosas: sin dudosas no devuelve nada", () => {
  assert.deepStrictEqual(publicable.dudosasParaDm({ refs_dudosas: [] }, [ficha()]), { matches: [], leFalta: [], avisoColega: null });
  assert.deepStrictEqual(publicable.dudosasParaDm(null, [ficha()]), { matches: [], leFalta: [], avisoColega: null });
});

// ── C1 (revision 2026-10-26): la zona que CONTIENE al barrio pedido no es "cerca" ──
// Pedir el barrio y tener la ficha registrada solo con su zona madre (Zuniga
// contra "Envigado", Balsos/San Lucas contra "El Poblado") NO es zona cercana:
// la ficha puede estar justo en el barrio pedido. Es sector_sin_confirmar y
// sus reglas de siempre aplican. "No es en Zuniga: queda en Envigado, cerca"
// era falso.
const pedidoZona = (zonas, extra = {}) => ({
  operacion: "venta", tipo: "apartamento", zonas, zona: zonas[0],
  precio_min: 0, precio_max: 500000000, habitaciones: 0,
  area_min: 0, banos: 0, garajes: 0, estrato: 0, ...extra,
});
const aptoZona = (zona, extra = {}) => ({
  ref: "Z1", titulo: "Apartamento en venta", tipo: "Apartamento", operacion: "Venta",
  precio: "$450.000.000", zona, ciudad: "Medellín", habitaciones: 3, banos: 2, garaje: 1,
  estrato: 5, area: "95 m²", descripcion: "",
  link: "https://diamondinmobiliaria.com/propiedades/z1",
  linkWasi: "https://info.wasi.co/apartamento-venta/10416693", ...extra,
});
function fichaAlColega(zonasPedidas, zonaFicha, opciones = ON, pedidoExtra = {}) {
  const ped = pedidoZona(zonasPedidas, pedidoExtra);
  const m = evaluarCandidata(aptoZona(zonaFicha), ped, "diamond");
  const r = publicable.filtrar(m ? [m] : [], opciones);
  if (!r.publicables.length) return { m, r, texto: null };
  const notas = publicable.notasParaDm({ sinConfirmar: [], leFalta: [] }, r.aclaraciones, r.publicables);
  const armado = redactar.mensajesAlColega({ autor_nombre: "Ana" }, r.publicables, { ...notas, pedido: ped });
  return { m, r, texto: armado.mensajes.slice(1).map((x) => x.texto).join("\n") };
}

test("C1: pedido Zúñiga, ficha 'Envigado': no es zona cercana, es barrio sin confirmar", () => {
  const { m, r, texto } = fichaAlColega(["Zúñiga"], "Envigado");
  assert.strictEqual(m.ubicacion, "zona_general");
  assert.ok(!r.aclaraciones.some((a) => a.zonaCercana));
  assert.match(texto, /queda en Envigado; el barrio exacto no lo tengo registrado/);
  assert.doesNotMatch(texto, /No es en/);
});

test("C1: pedido Balsos y San Lucas (con o sin Alto de las Palmas), ficha 'El Poblado': nunca 'No es en'", () => {
  for (const zonas of [["Balsos", "San Lucas"], ["Alto de las Palmas", "Balsos", "Patio Bonito", "San Lucas"]]) {
    const { m, texto } = fichaAlColega(zonas, "El Poblado");
    assert.strictEqual(m.ubicacion, "zona_general", JSON.stringify(zonas));
    assert.match(texto, /queda en El Poblado; el barrio exacto no lo tengo registrado/, JSON.stringify(zonas));
    assert.doesNotMatch(texto, /No es en/, JSON.stringify(zonas));
  }
});

test("C1: varios barrios de Envigado (uno conocido) contra 'Envigado': tampoco es 'cerca'", () => {
  const { m, texto } = fichaAlColega(["La Frontera", "Santa María de los Ángeles", "Zúñiga", "Villa Grande"], "Envigado");
  assert.strictEqual(m.ubicacion, "zona_general");
  assert.doesNotMatch(texto, /No es en/);
});

test("C1: San Joaquín contra 'Laureles' y La Mota contra 'Belén': la zona madre no es vecina", () => {
  for (const [pedida, fichaZona] of [["San Joaquín", "Laureles"], ["La Mota", "Belén"]]) {
    const m = evaluarCandidata(aptoZona(fichaZona), pedidoZona([pedida]), "diamond");
    assert.strictEqual(m.ubicacion, "zona_general", pedida);
  }
});

test("C1: un vecino de verdad sigue saliendo: pedido Envigado, ficha Itagüí", () => {
  const { m, r, texto } = fichaAlColega(["Envigado"], "Itagüí");
  assert.strictEqual(m.ubicacion, "vecina");
  assert.strictEqual(r.aclaraciones[0].zonaCercana, true);
  assert.match(texto, /Aclaración: No es en Envigado: queda en Itagüí, cerca/);
});

test("C1: la nota de zona cercana nunca nombra la zona de la propia ficha entre las 'no es en'", () => {
  // El clasificador repitio el municipio en `zonas` y el pedido guardado no
  // trae zona_madre: la ficha vieja dice 'vecina' y vive en Envigado.
  const m = { ...ficha({ ubicacion: "vecina", zona: "Envigado" }), zona_cercana: { tipo: "vecina" } };
  const d = redactar.desvios(m, { zonas: ["Envigado", "Zúñiga"] });
  assert.ok(!d.some((x) => /No es en[^:]*Envigado/.test(x)), JSON.stringify(d));
});

test("C1: pedidoDe pasa zona_madre, para que la nota no liste el municipio que contiene lo pedido", () => {
  const vivo = require("../src/groups/vivo");
  const p = vivo.pedidoDe({ zonas: ["Envigado", "Zúñiga"], zona: "Envigado", zona_madre: "Envigado" });
  assert.strictEqual(p.zona_madre, "Envigado");
  const m = { ...ficha({ ubicacion: "vecina", zona: "Sabaneta" }), zona_cercana: { tipo: "vecina" } };
  const d = redactar.desvios(m, p);
  assert.deepStrictEqual(d.filter((x) => /No es en/.test(x)), ["No es en Zúñiga: queda en Sabaneta, cerca"]);
});

test("C1: la marca de zona cercana solo escribe 'No es en' sobre una vecina", () => {
  const m = { ...ficha({ ubicacion: "zona_general", zona: "Envigado" }), zona_cercana: { tipo: "vecina" } };
  const d = redactar.desvios(m, { zonas: ["Zúñiga"] });
  assert.ok(!d.some((x) => /No es en/.test(x)), JSON.stringify(d));
});

// ── C2: la salvedad pierde solo la ubicacion, no "zona verde" ni "zonas comunes" ──
test("C2: con una zona cercana, la salvedad conserva zona verde, zonas comunes, sector tranquilo y cerca al metro", () => {
  const { publicables, aclaraciones } = publicable.filtrar([ficha({ ubicacion: "vecina", zona: "Itagüí" })], ON);
  const pedidos = ["zona verde", "zonas comunes", "sector tranquilo", "cerca al metro", "barrio exacto", "ubicación exacta", "ascensor"];
  const notas = publicable.notasParaDm({ sinConfirmar: pedidos, leFalta: [] }, aclaraciones, publicables);
  assert.deepStrictEqual(notas.sinConfirmar, ["zona verde", "zonas comunes", "sector tranquilo", "cerca al metro", "ascensor"]);
});

// ── I1: el colega tajante no recibe zona cercana ────────────────────────────
// Caso Alberto Posada (ca3ae1cd, 2026-10): "No enviar inmuebles que no
// cumplan". Ya se quejo en septiembre; la zona cercana no le sale.
const ALBERTO = "Quien con apto el laureles Conquistadores Belén rosales San Joaquín Del 5 piso hacia arriba Ascensor al piso Valor Máximo 600.000.000 Dos alcobas Garaje Útil Cliente comprando ya mismo No enviar inmuebles que no cumplan";

test("I1: colegaTajante reconoce 'no enviar que no cumplan', 'solo en X', 'únicamente X' y la marca de Sofi", () => {
  for (const texto of [ALBERTO, "Apto en Envigado, solo en Envigado, hasta 400M", "Únicamente El Poblado", "Casa en Sabaneta, no otras zonas", "No me manden opciones que no cumplan"]) {
    assert.strictEqual(publicable.colegaTajante({ texto }), true, texto);
  }
  for (const texto of ["Busco apto en Laureles 2 alcobas No en unidad cerrada", "Apto en Envigado hasta 400M, solo contado", "", null]) {
    assert.strictEqual(publicable.colegaTajante({ texto }), false, String(texto));
  }
  const veredicto = { refs_dudosas: ["X"], dudosas_motivo: [{ ref: "X", motivo: "zona_vecina_y_colega_tajante" }] };
  assert.strictEqual(publicable.colegaTajante({ texto: "Apto en Envigado", veredicto }), true);
});

test("I1: zonaCercanaPara apaga la zona cercana para el colega tajante, aunque el interruptor este encendido", () => {
  const env = { RADAR_DM_ZONA_CERCANA: "true" };
  assert.strictEqual(publicable.zonaCercanaPara({ texto: ALBERTO }, env), false);
  assert.strictEqual(publicable.zonaCercanaPara({ texto: "Busco apto en Laureles" }, env), true);
  assert.strictEqual(publicable.zonaCercanaPara({ texto: "Busco apto en Laureles" }, { RADAR_DM_ZONA_CERCANA: "false" }), false);
});

// ── I2: el grado de zona guardado en una señal vieja se recalcula ──────────
// fdf36fe9/ef35207f: la 10012896 (La Mota) se guardo 'vecina' antes del
// arreglo de Belen (c70dc38). Con el grado congelado, los caminos manuales
// decian "No es en Belén: queda en La Mota, cerca". Con `pedido`, filtrar
// recalcula el grado con las zonas de hoy: si ya no es vecina, no sale como
// zona cercana.
test("I2: filtrar con `pedido` no saca como zona cercana una vecina guardada que hoy ya no lo es", () => {
  const vieja = ficha({ ref: "10012896", ubicacion: "vecina", zona: "La Mota", titulo: "Casa en venta en Belén cerca Arkadia" });
  const r = publicable.filtrar([vieja], { ...ON, pedido: { zonas: ["Belén", "Envigado"], zona: "Belén" } });
  assert.deepStrictEqual(r.publicables, []);
  assert.deepStrictEqual(r.descartados, [{ ref: "10012896", motivos: ["zona_vecina"] }]);
});

test("I2: la vecina de verdad sigue saliendo con `pedido` (Envigado -> Itagüí)", () => {
  const r = publicable.filtrar([ficha({ ubicacion: "vecina", zona: "Itagüí" })], { ...ON, pedido: { zonas: ["Envigado"], zona: "Envigado" } });
  assert.strictEqual(r.publicables.length, 1);
  assert.strictEqual(r.aclaraciones[0].zonaCercana, true);
});

test("I2: una vecina guardada por la vecindad de la zona madre (Zúñiga -> Envigado) tampoco sale", () => {
  const r = publicable.filtrar([ficha({ ubicacion: "vecina", zona: "Envigado" })], { ...ON, pedido: { zonas: ["Zúñiga"], zona: "Zúñiga" } });
  assert.deepStrictEqual(r.publicables, []);
});

// ── N2: el colega tajante lo es en TODOS sus pedidos ───────────────────────
// Alberto Posada escribio "No enviar inmuebles que no cumplan con todo" en
// ca3ae1cd (21-oct). Tres dias despues publico be41c4a8 sin esa frase y la
// zona cercana le habria mandado 3 fichas de Guayabal y Los Colores. Textos
// reales de group_signals (SELECT, 2026-10-26).
const ALBERTO_CA3AE1CD = "Quien con apto el laureles \nConquistadores \nBelén rosales \nSan Joaquín \n\nDel 5 piso hacia arriba \nAscensor al piso \nValor \nMáximo \n600.000.000\nDos alcobas \nGaraje \nÚtil \n\nCliente comprando ya mismo \nNo enviar inmuebles que no cumplan con todo \nGracias\nAlberto posada \n3113345468 \n\nNo calle de ruido";
const ALBERTO_BE41C4A8 = "Busco apto \nDos alcobas \nParqueadero \nAscensor al piso \nBalcón necesario \nPiso 5 hacia arriba \nNo en unidad cerrada \n\nValor máximo \n600.000.000\nLaureles \nCastellana \nConquistadores\nSan Joaquín \nBelén alameda \nBelén Malibú \nBelén rosales \nNo último piso \n\nCliente directo comprando ya efectivo \nAlberto posada \n3113345468 \n\nCódigo cliente \n21899";

test("N2: zonaCercanaPara mira el historial del colega: be41c4a8 no es tajante, pero su ca3ae1cd si", () => {
  const env = { RADAR_DM_ZONA_CERCANA: "true" };
  assert.strictEqual(publicable.colegaTajante({ texto: ALBERTO_BE41C4A8 }), false, "el pedido solo no lo dice");
  assert.strictEqual(publicable.zonaCercanaPara({ texto: ALBERTO_BE41C4A8, historial: [] }, env), true);
  assert.strictEqual(publicable.zonaCercanaPara({ texto: ALBERTO_BE41C4A8, historial: [ALBERTO_BE41C4A8, ALBERTO_CA3AE1CD] }, env), false);
});

test("N2: si el historial no se pudo leer (null), la zona cercana se apaga (falla cerrado)", () => {
  const env = { RADAR_DM_ZONA_CERCANA: "true" };
  assert.strictEqual(publicable.zonaCercanaPara({ texto: "Busco apto en Laureles", historial: null }, env), false);
});

// La 10311038 de be41c4a8: Sofi escribio en le_falta "está registrada como
// urbanización cerrada y pediste que no sea unidad cerrada". Es un
// incumplimiento CONOCIDO: como zona cercana no sale.
const VECINA_10311038 = () => ficha({ ref: "10311038", ubicacion: "vecina", zona: "Los Colores", habitaciones: 2, razones: ["Los Colores (vecina de lo pedido)", "$450M dentro de $600M", "2 alcobas", "piso 5"] });
const LE_FALTA_BE41C4A8 = [{ ref: "10311038", detalle: "está registrada como urbanización cerrada y pediste que no sea unidad cerrada" }];

test("N2: una zona cercana con un incumplimiento conocido de Sofi (le_falta) no sale", () => {
  const r = publicable.filtrar([VECINA_10311038()], { ...ON, leFalta: LE_FALTA_BE41C4A8 });
  assert.deepStrictEqual(r.publicables, []);
  assert.deepStrictEqual(r.descartados, [{ ref: "10311038", motivos: ["zona_vecina"] }]);
});

test("N2: lo que Sofi dice que NO sabe no es un incumplimiento; el le_falta de otra ref no cuenta", () => {
  for (const leFalta of [
    [{ ref: "10311038", detalle: "no tengo confirmado si tiene ascensor" }],
    [{ ref: "10311038", detalle: "el piso no está registrado en la ficha" }],
    [{ ref: "OTRA", detalle: "pediste que no sea unidad cerrada" }],
    [],
  ]) {
    const r = publicable.filtrar([VECINA_10311038()], { ...ON, leFalta });
    assert.strictEqual(r.publicables.length, 1, JSON.stringify(leFalta));
  }
});

test("N2: una zona cercana con un corto conocido del motor (alcobas, area, precio sobre el tope) no sale", () => {
  for (const razones of [["Itagüí (vecina de lo pedido)", "2 alcobas (pediste 3)"], ["$470M — 4% sobre $450M, dentro del margen"]]) {
    const r = publicable.filtrar([ficha({ ubicacion: "vecina", zona: "Itagüí", razones })], ON);
    assert.deepStrictEqual(r.publicables, [], razones.join(" | "));
  }
  const pedido = { zonas: ["Envigado"], zona: "Envigado", habitaciones: 3 };
  const r = publicable.filtrar([ficha({ ubicacion: "vecina", zona: "Itagüí", habitaciones: 2 })], { ...ON, pedido });
  assert.deepStrictEqual(r.publicables, [], "2 alcobas contra 3 pedidas, aunque la razon no lo diga");
});

test("N2: el incumplimiento conocido solo frena la zona cercana, no a una exacta ni a una aclarable de dato", () => {
  const r = publicable.filtrar([ficha({ ref: "10311038" })], { ...ON, leFalta: LE_FALTA_BE41C4A8 });
  assert.deepStrictEqual(r.publicables.map((m) => m.ref), ["10311038"]);
});
