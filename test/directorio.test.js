// A quien podemos escribirle: el mapeo entre el LID con el que WhatsApp
// presenta a un colega en un grupo y su telefono real.
//
// EL DIRECTORIO ES 100% LOCAL (Juan, 2026-09-04). Literal: "armas la base de
// datos con los lids mas los telefonos en un tabla y cada vez que querramos
// generar una respuesta consultamos esa tabla, directamente desde el lid que
// es lo que esta visible y si necesitamos el telefono lo buscamos desde la
// tabla". Ese dia WhatsApp empezo a responder rate-overlimit (429) a la lista
// de participantes -- el calentamiento termino "31/31 grupos, 0 pares" -- y la
// linea del radar ya fue baneada una vez (2026-07-30). Preguntar mas fuerte no
// era una opcion.
//
// Por eso `telefonoDe` NUNCA sale a la red: resuelve con la pista que viene en
// el propio mensaje y con el indice sembrado desde `directorio_lids` (2.261
// pares ya guardados). Si el lid no esta, devuelve null y el pedido se
// responde igual, por `<lid>@lid` (ver src/groups/politica.js#decidirDm).
//
// `calentar` / `refrescarGrupo` SI hablan con WAHA y siguen aca a proposito:
// la decision se puede revertir si WhatsApp afloja, y hasta entonces el
// scheduler que los usaba arranca apagado
// (src/scheduler/radar-directorio.js). Los tests de mas abajo que los ejercen
// son los que mantienen vivo ese camino.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const memory = require("../src/data/memory");
const waha = require("../src/lib/waha");

// Fuerza el store en memoria ANTES de cargar directorio/colegas: config usa
// dotenv con override, asi que si hay un .env con credenciales reales de
// Supabase (como en esta maquina de desarrollo), colegas.js elige la rama de
// Supabase real en vez de memoria. Sin este mock, el orgId de prueba de este
// archivo ("org-directorio-test") no es un UUID valido, Postgres lo rechaza,
// y las aserciones que miran memory.colegasGrupos fallan aunque el modulo
// este bien — visto en produccion el 2026-08-22 al correr este mismo test.
const supabasePath = require.resolve("../src/data/supabase");
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: null };

const directorio = require("../src/groups/directorio");
const colegas = require("../src/data/colegas");
const lidsGuardados = require("../src/data/directorio-lids");

const ORG = "org-directorio-test";
const SESION = "RADA-TEST";
const JID = "123@g.us";

const participantesReal = waha.participantesDeGrupo;
const telefonoDelIdReal = waha.telefonoDeLid;

// Cuenta TODA salida a WAHA, no solo la lista de participantes: la regla
// nueva es que `telefonoDe` no haga ninguna, y una cuenta partida en dos
// dejaria pasar la que se olvide de mirar.
function mockWaha(lista) {
  const llamadas = { participantes: 0, lids: 0, get total() { return this.participantes + this.lids; } };
  waha.participantesDeGrupo = async () => {
    llamadas.participantes += 1;
    return lista;
  };
  // La Lids API no resolvia nada (0 de 45 el 2026-08-22) y ya no se usa; se
  // mockea igual para que, si alguien la vuelve a enganchar, este archivo lo
  // cuente en vez de hacer un GET real contra la WAHA de produccion.
  waha.telefonoDeLid = async () => {
    llamadas.lids += 1;
    return null;
  };
  return llamadas;
}

function restaurarWaha() {
  waha.participantesDeGrupo = participantesReal;
  waha.telefonoDeLid = telefonoDelIdReal;
}

function preparar() {
  memory.colegasGrupos.length = 0;
  directorio._resetCache();
  // El mapa guardado tambien es estado de proceso: sin limpiarlo, un test
  // resuelve un lid que otro sembro y el fallo aparece a kilometros de acá.
  lidsGuardados._reset();
}

// ── telefonoDe: SIN RED, siempre ─────────────────────────────────────────

test("un lid que no esta en el indice devuelve null y NO le pregunta nada a WAHA", async () => {
  // El corazon de la decision del 2026-09-04. Antes, este mismo caso
  // disparaba refrescarGrupo (cientos de participantes por HTTP) y, si eso
  // fallaba, un intento por la Lids API. Hoy es una consulta local que falla
  // en null -- y el pedido igual se responde, por <lid>@lid.
  preparar();
  const llamadas = mockWaha([
    { id: "198161251463188@lid", esLid: true, telefono: "573001234567", rol: "participant" },
  ]);
  try {
    // Se le pasan sesion y jid A PROPOSITO: aunque quien llama los tenga a
    // mano (vivo.js los pasa), ya no habilitan ninguna salida a la red.
    const tel = await directorio.telefonoDe(ORG, "198161251463188", { sesion: SESION, jid: JID });
    assert.strictEqual(tel, null, "el lid no esta sembrado: no hay nada local que devolver");
    assert.strictEqual(llamadas.total, 0, "telefonoDe no puede tocar WAHA ni con sesion y jid en la mano");
  } finally {
    restaurarWaha();
  }
});

test("con el indice sembrado, resuelve en local y sin red", async () => {
  preparar();
  await lidsGuardados.guardar(ORG, [{ lid: "198161251463188", telefono: "573001234567" }]);
  const llamadas = mockWaha([]);
  try {
    assert.strictEqual(await directorio.telefonoDe(ORG, "198161251463188", { sesion: SESION, jid: JID }), "573001234567");
    assert.strictEqual(llamadas.total, 0);
  } finally {
    restaurarWaha();
  }
});

test("si lo que llega ya es un telefono marcable (@c.us, no LID), lo devuelve directo sin tocar WAHA", async () => {
  // Revision 2026-08-24: WhatsApp casi siempre manda un LID oculto, pero
  // alguna vez entrega el participante como @c.us -numero visible-. Tratarlo
  // igual que un LID sin resolver perdia un numero que ya se tenia a mano.
  preparar();
  const llamadas = mockWaha([]);
  try {
    const tel = await directorio.telefonoDe(ORG, "573009998877", { sesion: SESION, jid: JID });
    assert.strictEqual(tel, "573009998877");
    assert.strictEqual(llamadas.total, 0, "un telefono marcable no necesita preguntarle nada a nadie");
  } finally {
    restaurarWaha();
  }
});

test("aunque WAHA este caido, telefonoDe ni lo intenta: devuelve null y no propaga", async () => {
  preparar();
  waha.participantesDeGrupo = async () => {
    throw new Error("WAHA caido");
  };
  waha.telefonoDeLid = async () => {
    throw new Error("WAHA caido");
  };
  try {
    assert.strictEqual(await directorio.telefonoDe(ORG, "111222333444555", { sesion: SESION, jid: JID }), null);
  } finally {
    restaurarWaha();
  }
});

test("el codigo de telefonoDe no menciona a waha: la regla se vigila en el fuente, no solo en un mock", () => {
  // Un mock solo prueba el camino que el test recorre. Esta asercion es la
  // que impide que vuelva a entrar una llamada a la red por una rama que
  // ningun test toque (Juan, 2026-09-04).
  const fuente = fs.readFileSync(path.join(__dirname, "..", "src", "groups", "directorio.js"), "utf8");
  const desde = fuente.indexOf("async function telefonoDe(");
  const hasta = fuente.indexOf("async function registrar(");
  assert.ok(desde > -1 && hasta > desde, "no se encontro el cuerpo de telefonoDe");
  assert.doesNotMatch(
    fuente.slice(desde, hasta),
    /waha\./,
    "telefonoDe tiene que resolver 100% local: pista + indice sembrado desde directorio_lids"
  );
});

// ── PISTA: el numero que a veces viaja en el propio mensaje del grupo
// (whatsapp-group.js#telefonoVisible). Es la fuente mas barata que hay y, con
// el descubrimiento apagado, la unica que puede agregar un par nuevo en vivo.

test("con una pista valida resuelve sin tocar WAHA, y deja el numero en el indice", async () => {
  preparar();
  const llamadas = mockWaha([]);
  try {
    const tel = await directorio.telefonoDe(ORG, "198161251463188", {
      sesion: SESION, jid: JID, pista: "573001234567",
    });
    assert.strictEqual(tel, "573001234567");
    assert.strictEqual(llamadas.total, 0, "una pista valida ahorra la lista de participantes entera");

    // Queda sembrado: el siguiente pedido del mismo colega ya no necesita pista.
    assert.strictEqual(await directorio.telefonoDe(ORG, "198161251463188", {}), "573001234567");
  } finally {
    restaurarWaha();
  }
});

test("una pista que NO es un celular colombiano se ignora — un lid disfrazado nunca entra", async () => {
  preparar();
  mockWaha([]);
  try {
    for (const basura of ["198161251463188", "12345", "5712345678", ""]) {
      assert.strictEqual(
        await directorio.telefonoDe(ORG, "777888999000111", { sesion: SESION, jid: JID, pista: basura }),
        null,
        `la pista ${basura} no puede pasar por telefono`
      );
    }
  } finally {
    restaurarWaha();
  }
});

// ── registrar: deja constancia del colega, con telefono o sin el ─────────

test("registrar guarda al colega y devuelve su telefono", async () => {
  preparar();
  const llamadas = mockWaha([]);
  try {
    const tel = await directorio.registrar(ORG, {
      lid: "777888999000111", nombre: "Colega Siete", grupo: "SOLO POBLADO",
      sesion: SESION, jid: JID, pista: "573007777777",
    });
    assert.strictEqual(tel, "573007777777");
    assert.strictEqual(llamadas.total, 0, "registrar tampoco puede salir a la red por un telefono");
    assert.strictEqual(memory.colegasGrupos.length, 1);
    assert.strictEqual(memory.colegasGrupos[0].telefono, "573007777777");
    assert.strictEqual(memory.colegasGrupos[0].nombre, "Colega Siete");
  } finally {
    restaurarWaha();
  }
});

test("registrar guarda al colega aunque NO se resuelva el telefono", async () => {
  // El colega sin numero tiene que quedar registrado igual: hoy es la mayoria
  // (9 de cada 10 no exponen telefono) y es a quien se le responde por lid.
  preparar();
  const llamadas = mockWaha([]);
  try {
    const tel = await directorio.registrar(ORG, {
      lid: "888999000111222", nombre: "Sin Numero", grupo: "SOLO BELEN", sesion: SESION, jid: JID,
    });
    assert.strictEqual(tel, null);
    assert.strictEqual(llamadas.total, 0);
    assert.strictEqual(memory.colegasGrupos.length, 1);
    assert.strictEqual(memory.colegasGrupos[0].telefono, null);
  } finally {
    restaurarWaha();
  }
});

test("registrar NO devuelve el telefono si el guardado en si mismo fallo (Juan, 2026-08-24)", async () => {
  // Antes, colegas.upsert tragaba el error en un catch generico y devolvia
  // undefined igual que en exito; registrar devolvia el telefono como si la
  // constancia hubiera quedado escrita aunque nunca se guardara nada. Este
  // test fija el contrato: si upsert dice que no se guardo, registrar no
  // puede prometer una constancia que no existe.
  preparar();
  mockWaha([]);
  const upsertReal = colegas.upsert;
  colegas.upsert = async () => false;
  try {
    const tel = await directorio.registrar(ORG, {
      lid: "999000111222333", nombre: "Colega Nueve", grupo: "SOLO POBLADO",
      sesion: SESION, jid: JID, pista: "573009999999",
    });
    assert.strictEqual(tel, null, "sin guardado real, registrar no puede devolver el telefono como si hubiera quedado constancia");
  } finally {
    colegas.upsert = upsertReal;
    restaurarWaha();
  }
});

test("esColega reconoce a quien ya esta en el respaldo", async () => {
  preparar();
  mockWaha([]);
  try {
    await directorio.registrar(ORG, {
      lid: "999000111222333", nombre: "Ana", grupo: "G1", pista: "573009999999",
    });
    const colega = await directorio.esColega(ORG, "573009999999");
    assert.ok(colega, "deberia reconocerlo");
    assert.strictEqual(colega.nombre, "Ana");
    assert.strictEqual(await directorio.esColega(ORG, "573000000000"), null);
  } finally {
    restaurarWaha();
  }
});

test("dos organizaciones con el mismo LID no se pisan", async () => {
  preparar();
  const ORG2 = "org-directorio-test-2";
  mockWaha([]);
  try {
    await directorio.registrar(ORG, {
      lid: "555000111222333", nombre: "Colega Org1", grupo: "G1", pista: "573005555555",
    });
    const telOrgDos = await directorio.telefonoDe(ORG2, "555000111222333", { sesion: SESION, jid: JID });
    assert.strictEqual(telOrgDos, null, "org2 no debe ver el telefono que org1 registro");
  } finally {
    restaurarWaha();
  }
});

// ── calentar / refrescarGrupo: el camino que SI habla con WAHA ───────────
//
// Queda vivo aunque su scheduler arranque apagado (Juan, 2026-09-04: "no
// quiero nada que genere riesgo", pero "la decision se puede revertir"). Los
// tests de abajo son lo que evita que se pudra mientras espera.

test("calentar siembra el indice y despues telefonoDe resuelve en local", async () => {
  preparar();
  const llamadas = mockWaha([
    { id: "198161251463188@lid", esLid: true, telefono: "573001234567", rol: "participant" },
    { id: "999000111222333@lid", esLid: true, telefono: null, rol: "participant" },
  ]);
  try {
    await directorio.calentar(ORG, SESION, [JID], { pausaMs: 0 });
    assert.strictEqual(llamadas.participantes, 1);

    const antes = llamadas.total;
    assert.strictEqual(await directorio.telefonoDe(ORG, "198161251463188", { sesion: SESION, jid: JID }), "573001234567");
    assert.strictEqual(await directorio.telefonoDe(ORG, "999000111222333", { sesion: SESION, jid: JID }), null);
    assert.strictEqual(llamadas.total, antes, "resolver no agrega ni una peticion");
  } finally {
    restaurarWaha();
  }
});

test("sin forzar, el mismo grupo no se refresca dos veces seguidas", async () => {
  // Refrescar un grupo son cientos de participantes por HTTP (el mas grande
  // tiene 878) y un participante sin `pn` ahora tampoco lo va a tener en
  // cinco minutos.
  preparar();
  const llamadas = mockWaha([{ id: "111222333444555@lid", esLid: true, telefono: "573001111111", rol: "participant" }]);
  try {
    await directorio.calentar(ORG, SESION, [JID], { forzar: false, pausaMs: 0 });
    await directorio.calentar(ORG, SESION, [JID], { forzar: false, pausaMs: 0 });
    assert.strictEqual(llamadas.participantes, 1, "el throttle tiene que frenar el segundo");
  } finally {
    restaurarWaha();
  }
});

test("dos calentamientos simultaneos del mismo grupo comparten UN solo refresco", async () => {
  preparar();
  let resolver;
  let n = 0;
  waha.participantesDeGrupo = async () => {
    n += 1;
    await new Promise((r) => { resolver = r; });
    return [{ id: "198161251463188@lid", esLid: true, telefono: "573001234567", rol: "participant" }];
  };
  waha.telefonoDeLid = async () => null;
  try {
    const primera = directorio.calentar(ORG, SESION, [JID], { pausaMs: 0 });
    const segunda = directorio.calentar(ORG, SESION, [JID], { pausaMs: 0 });
    await new Promise((r) => setTimeout(r, 5));
    resolver();
    await Promise.all([primera, segunda]);

    assert.strictEqual(n, 1, "el segundo espera el refresco en vuelo, no lo duplica");
    assert.strictEqual(await directorio.telefonoDe(ORG, "198161251463188", {}), "573001234567");
  } finally {
    restaurarWaha();
  }
});

test("si WAHA falla, el grupo se vuelve a poder consultar a los 30 s, no a los 10 min", async () => {
  // Medido el 2026-09-02: un fallo convertia el throttle en 10 minutos de
  // ceguera para todo el grupo.
  preparar();
  let falla = true;
  let n = 0;
  waha.participantesDeGrupo = async () => {
    n += 1;
    if (falla) throw new Error("timeout");
    return [{ id: "198161251463188@lid", esLid: true, telefono: "573001234567", rol: "participant" }];
  };
  waha.telefonoDeLid = async () => null;
  try {
    await directorio.calentar(ORG, SESION, [JID], { forzar: false, pausaMs: 0 });
    assert.strictEqual(n, 1);

    await directorio.calentar(ORG, SESION, [JID], { forzar: false, pausaMs: 0 });
    assert.strictEqual(n, 1, "dentro de los 30 s no se martilla a WAHA");

    const realNow = Date.now;
    Date.now = () => realNow() + directorio.MS_REINTENTO_TRAS_FALLO + 1000;
    try {
      falla = false;
      await directorio.calentar(ORG, SESION, [JID], { forzar: false, pausaMs: 0 });
      assert.strictEqual(n, 2, "a los 30 s vuelve a preguntar; antes eran 10 min de ceguera");
      assert.strictEqual(await directorio.telefonoDe(ORG, "198161251463188", {}), "573001234567");
    } finally {
      Date.now = realNow;
    }
  } finally {
    restaurarWaha();
  }
});

test("calentar recorre todos los grupos saltando el throttle, y rellenar completa a los colegas sin telefono", async () => {
  preparar();
  const llamadas = mockWaha([
    { id: "198161251463188@lid", esLid: true, telefono: "573001234567", rol: "participant" },
    { id: "777888999000111@lid", esLid: true, telefono: "573009998877", rol: "participant" },
  ]);
  try {
    // Un colega registrado antes, sin telefono (el caso real: 79 de 85).
    await colegas.upsert(ORG, { lid: "777888999000111", telefono: null, nombre: "Colega Sin Tel" });
    // Un refresco reciente del mismo grupo: calentar lo ignora (forzar).
    await directorio.calentar(ORG, SESION, [JID], { forzar: false, pausaMs: 0 });
    assert.strictEqual(llamadas.participantes, 1);

    const r = await directorio.calentar(ORG, SESION, [JID, "456@g.us"], { pausaMs: 0 });
    assert.strictEqual(llamadas.participantes, 3, "calentar refresca los dos grupos aunque uno se haya consultado recien");
    assert.strictEqual(r.grupos, 2);
    assert.strictEqual(r.refrescados, 2);
    assert.strictEqual(r.indice, 2, "dos lids distintos con telefono en el indice de esta org");

    const completados = await directorio.rellenarColegas(ORG);
    assert.strictEqual(completados, 1);
    const fila = memory.colegasGrupos.find((c) => c.org_id === ORG && c.lid === "777888999000111");
    assert.strictEqual(fila.telefono, "573009998877");
  } finally {
    restaurarWaha();
  }
});

// ── EL MAPA GUARDADO (Juan, 2026-09-02): "los numeros que ya se pueden ver en
// todos los grupos como base de datos para que no tenga que ir a waha a
// revisar en cada respuesta, si no que se crucen con el id del colega".
//
// Desde el 2026-09-04 no es una cache: es LA fuente. El indice se siembra de
// ahi y no hay ningun otro camino de resolucion en vivo.

test("una pasada de participantes queda GUARDADA, no solo en memoria", async () => {
  preparar();
  mockWaha([
    { id: "198161251463188@lid", esLid: true, telefono: "573001234567", rol: "participant" },
    { id: "111222333444555@lid", esLid: true, telefono: "573009998877", rol: "participant" },
    { id: "999000111222333@lid", esLid: true, telefono: null, rol: "participant" },
  ]);
  try {
    await directorio.calentar(ORG, SESION, [JID], { pausaMs: 0 });

    const guardados = await lidsGuardados.listar(ORG);
    assert.strictEqual(guardados.length, 2, "los dos con telefono visible, el tercero no");
    assert.ok(guardados.some((p) => p.lid === "111222333444555"), "se guarda TODA la pasada, no solo el que se buscaba");
  } finally {
    restaurarWaha();
  }
});

test("tras un reinicio resuelve desde la base, SIN tocar WAHA", async () => {
  preparar();
  mockWaha([{ id: "198161251463188@lid", esLid: true, telefono: "573001234567", rol: "participant" }]);
  try {
    await directorio.calentar(ORG, SESION, [JID], { pausaMs: 0 });

    // Simula el reinicio: el indice en memoria se pierde, la base queda.
    directorio._resetCache();
    const llamadas = mockWaha([]); // WAHA ahora devuelve vacio, como paso de verdad

    const tel = await directorio.telefonoDe(ORG, "198161251463188", {});
    assert.strictEqual(tel, "573001234567", "el numero sobrevive al reinicio");
    assert.strictEqual(llamadas.total, 0, "y no hizo falta preguntarle a WAHA");
  } finally {
    restaurarWaha();
  }
});

test("un `pn` con basura NUNCA entra a la cache: de ahi sale a que numero se escribe", async () => {
  preparar();
  mockWaha([
    { id: "111222333444555@lid", esLid: true, telefono: "12345", rol: "participant" },
    { id: "222333444555666@lid", esLid: true, telefono: "198161251463188", rol: "participant" }, // un lid disfrazado
    { id: "333444555666777@lid", esLid: true, telefono: "573001234567", rol: "participant" },
  ]);
  try {
    await directorio.calentar(ORG, SESION, [JID], { pausaMs: 0 });

    const guardados = await lidsGuardados.listar(ORG);
    assert.deepStrictEqual(guardados.map((p) => p.lid), ["333444555666777"]);
  } finally {
    restaurarWaha();
  }
});

// PAUSA ENTRE GRUPOS (Juan, 2026-09-04): sin esto el calentamiento pedia los
// 31 grupos de corrido y WhatsApp respondia rate-overlimit (429) a todas. La
// pausa no alcanzo -- el mismo dia se apago el calentamiento entero -- pero
// sigue siendo la conducta correcta si algun dia se vuelve a encender.
test("calentar espera entre grupos y no encadena las peticiones", async () => {
  const t0 = Date.now();
  await directorio.calentar("org-pausa", "S", ["a@g.us", "b@g.us", "c@g.us"], { pausaMs: 40 });
  const ms = Date.now() - t0;
  // 3 grupos = 2 pausas. Se compara contra un piso holgado para no depender
  // de la precision del reloj.
  assert.ok(ms >= 60, `tres grupos con pausa de 40 ms tienen que tardar >= 60 ms, tardaron ${ms}`);
});

test("calentar con pausa en 0 no espera nada (para los tests y el arranque)", async () => {
  const t0 = Date.now();
  await directorio.calentar("org-sin-pausa", "S", ["a@g.us", "b@g.us"], { pausaMs: 0 });
  assert.ok(Date.now() - t0 < 40);
});
