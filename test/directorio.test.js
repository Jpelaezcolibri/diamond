// Resolver el telefono real del colega que publico un pedido.
//
// La medicion del 2026-08-22 dejo dos cosas claras y las dos estan fijadas aca:
// la Lids API de WAHA no sirve (0 de 45), y el telefono sale de la lista de
// participantes del grupo (30 de 45 = 67%). El 33% que no resuelve NO es un
// error: es el caso normal que despues atiende una persona.
//
// Y una regla de costo: refrescar un grupo son cientos de participantes por
// HTTP. Si un lid no aparece, no se vuelve a preguntar por el mismo grupo en
// un rato — un lid sin `pn` ahora tampoco lo va a tener en cinco minutos.

const { test } = require("node:test");
const assert = require("node:assert");
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

const ORG = "org-directorio-test";
const SESION = "RADA-TEST";
const JID = "123@g.us";

const participantesReal = waha.participantesDeGrupo;
const telefonoDelIdReal = waha.telefonoDeLid;

function conParticipantes(lista, contador = { n: 0 }) {
  waha.participantesDeGrupo = async () => {
    contador.n += 1;
    return lista;
  };
  // Mocka telefonoDeLid para evitar requests reales contra WAHA de producción.
  // En esta máquina no hay credenciales configuradas, pero en otra que las tuviera
  // este test haría GETs reales contra /api/{sesion}/lids/{lid} con LIDs inventados
  // (111, 999, 888, etc). Por eso se mocka también aquí.
  waha.telefonoDeLid = async () => null;
  return contador;
}

function preparar() {
  memory.colegasGrupos.length = 0;
  directorio._resetCache();
  // El mapa guardado tambien es estado de proceso: sin limpiarlo, un test
  // resuelve un lid que otro sembro y el fallo aparece a kilometros de acá.
  require("../src/data/directorio-lids")._reset();
}

test("resuelve el telefono desde la lista de participantes", async () => {
  preparar();
  conParticipantes([
    { id: "198161251463188@lid", esLid: true, telefono: "573001234567", rol: "participant" },
    { id: "999@lid", esLid: true, telefono: null, rol: "participant" },
  ]);
  try {
    const tel = await directorio.telefonoDe(ORG, "198161251463188", { sesion: SESION, jid: JID });
    assert.strictEqual(tel, "573001234567");
  } finally {
    waha.participantesDeGrupo = participantesReal;
    waha.telefonoDeLid = telefonoDelIdReal;
  }
});

test("si lo que llega ya es un telefono marcable (@c.us, no LID), lo devuelve directo sin tocar WAHA", async () => {
  // Revision 2026-08-24: WhatsApp casi siempre manda un LID oculto, pero
  // alguna vez entrega el participante como @c.us -numero visible-. Tratarlo
  // igual que un LID sin resolver perdia un numero que ya se tenia a mano.
  preparar();
  const contador = conParticipantes([]);
  try {
    const tel = await directorio.telefonoDe(ORG, "573009998877", { sesion: SESION, jid: JID });
    assert.strictEqual(tel, "573009998877");
    assert.strictEqual(contador.n, 0, "un telefono marcable no necesita refrescar el grupo ni preguntarle a WAHA");
  } finally {
    waha.participantesDeGrupo = participantesReal;
    waha.telefonoDeLid = telefonoDelIdReal;
  }
});

test("un participante sin telefono devuelve null, no una excepcion", async () => {
  preparar();
  conParticipantes([{ id: "999@lid", esLid: true, telefono: null, rol: "participant" }]);
  try {
    assert.strictEqual(await directorio.telefonoDe(ORG, "999", { sesion: SESION, jid: JID }), null);
  } finally {
    waha.participantesDeGrupo = participantesReal;
    waha.telefonoDeLid = telefonoDelIdReal;
  }
});

test("el segundo pedido del mismo lid NO vuelve a pedir los participantes", async () => {
  preparar();
  const contador = conParticipantes([
    { id: "111@lid", esLid: true, telefono: "573001111111", rol: "participant" },
  ]);
  try {
    await directorio.telefonoDe(ORG, "111", { sesion: SESION, jid: JID });
    await directorio.telefonoDe(ORG, "111", { sesion: SESION, jid: JID });
    assert.strictEqual(contador.n, 1, "el indice tiene que servir el segundo");
  } finally {
    waha.participantesDeGrupo = participantesReal;
    waha.telefonoDeLid = telefonoDelIdReal;
  }
});

test("un lid que no aparece tampoco se vuelve a preguntar enseguida", async () => {
  preparar();
  const contador = conParticipantes([
    { id: "otro@lid", esLid: true, telefono: "573002222222", rol: "participant" },
  ]);
  try {
    await directorio.telefonoDe(ORG, "no-esta-1", { sesion: SESION, jid: JID });
    await directorio.telefonoDe(ORG, "no-esta-2", { sesion: SESION, jid: JID });
    assert.strictEqual(contador.n, 1, "refrescar el mismo grupo dos veces seguidas es caro y no cambia nada");
  } finally {
    waha.participantesDeGrupo = participantesReal;
    waha.telefonoDeLid = telefonoDelIdReal;
  }
});

test("sin jid no se refresca nada: solo mira el indice", async () => {
  preparar();
  const contador = conParticipantes([]);
  try {
    assert.strictEqual(await directorio.telefonoDe(ORG, "111", { sesion: SESION }), null);
    assert.strictEqual(contador.n, 0);
  } finally {
    waha.participantesDeGrupo = participantesReal;
    waha.telefonoDeLid = telefonoDelIdReal;
  }
});

test("registrar guarda al colega y devuelve su telefono", async () => {
  preparar();
  conParticipantes([
    { id: "777@lid", esLid: true, telefono: "573007777777", rol: "participant" },
  ]);
  try {
    const tel = await directorio.registrar(ORG, {
      lid: "777", nombre: "Colega Siete", grupo: "SOLO POBLADO", sesion: SESION, jid: JID,
    });
    assert.strictEqual(tel, "573007777777");
    assert.strictEqual(memory.colegasGrupos.length, 1);
    assert.strictEqual(memory.colegasGrupos[0].telefono, "573007777777");
    assert.strictEqual(memory.colegasGrupos[0].nombre, "Colega Siete");
  } finally {
    waha.participantesDeGrupo = participantesReal;
    waha.telefonoDeLid = telefonoDelIdReal;
  }
});

test("registrar guarda al colega aunque NO se resuelva el telefono", async () => {
  // El 33% sin telefono tiene que quedar registrado igual: es la lista de a
  // quienes hay que responderle a mano.
  preparar();
  conParticipantes([]);
  try {
    const tel = await directorio.registrar(ORG, {
      lid: "888", nombre: "Sin Numero", grupo: "SOLO BELEN", sesion: SESION, jid: JID,
    });
    assert.strictEqual(tel, null);
    assert.strictEqual(memory.colegasGrupos.length, 1);
    assert.strictEqual(memory.colegasGrupos[0].telefono, null);
  } finally {
    waha.participantesDeGrupo = participantesReal;
    waha.telefonoDeLid = telefonoDelIdReal;
  }
});

test("registrar NO devuelve el telefono si el guardado en si mismo fallo (Juan, 2026-08-24)", async () => {
  // Antes, colegas.upsert tragaba el error en un catch generico y devolvia
  // undefined igual que en exito; registrar devolvia el telefono como si la
  // constancia hubiera quedado escrita aunque nunca se guardara nada. Este
  // test fija el contrato nuevo: si upsert dice que no se guardo, registrar
  // no puede prometer una constancia que no existe.
  preparar();
  conParticipantes([
    { id: "999@lid", esLid: true, telefono: "573009999999", rol: "participant" },
  ]);
  const upsertReal = colegas.upsert;
  colegas.upsert = async () => false;
  try {
    const tel = await directorio.registrar(ORG, {
      lid: "999", nombre: "Colega Nueve", grupo: "SOLO POBLADO", sesion: SESION, jid: JID,
    });
    assert.strictEqual(tel, null, "sin guardado real, registrar no puede devolver el telefono como si hubiera quedado constancia");
  } finally {
    colegas.upsert = upsertReal;
    waha.participantesDeGrupo = participantesReal;
    waha.telefonoDeLid = telefonoDelIdReal;
  }
});

test("esColega reconoce a quien ya esta en el respaldo", async () => {
  preparar();
  conParticipantes([
    { id: "999@lid", esLid: true, telefono: "573009999999", rol: "participant" },
  ]);
  try {
    await directorio.registrar(ORG, { lid: "999", nombre: "Ana", grupo: "G1", sesion: SESION, jid: JID });
    const colega = await directorio.esColega(ORG, "573009999999");
    assert.ok(colega, "deberia reconocerlo");
    assert.strictEqual(colega.nombre, "Ana");
    assert.strictEqual(await directorio.esColega(ORG, "573000000000"), null);
  } finally {
    waha.participantesDeGrupo = participantesReal;
    waha.telefonoDeLid = telefonoDelIdReal;
  }
});

test("si WAHA revienta, telefonoDe devuelve null y no propaga", async () => {
  preparar();
  waha.participantesDeGrupo = async () => {
    throw new Error("WAHA caido");
  };
  waha.telefonoDeLid = async () => {
    throw new Error("WAHA caido");
  };
  try {
    assert.strictEqual(await directorio.telefonoDe(ORG, "111", { sesion: SESION, jid: JID }), null);
  } finally {
    waha.participantesDeGrupo = participantesReal;
    waha.telefonoDeLid = telefonoDelIdReal;
  }
});

test("dos organizaciones con el mismo LID no se pisan", async () => {
  preparar();
  const ORG2 = "org-directorio-test-2";

  // Org1: registra LID 555000111 con telefono
  conParticipantes([
    { id: "555000111@lid", esLid: true, telefono: "573005555555", rol: "participant" },
  ]);
  try {
    await directorio.registrar(ORG, {
      lid: "555000111", nombre: "Colega Org1", grupo: "G1", sesion: SESION, jid: JID,
    });

    // Org2: intenta resolver el mismo LID pero la lista de participantes viene vacia
    waha.participantesDeGrupo = async () => [];
    waha.telefonoDeLid = async () => null;

    const telOrgDos = await directorio.telefonoDe(ORG2, "555000111", { sesion: SESION, jid: JID });

    // Org2 debe obtener null, NO el telefono que Org1 registro
    assert.strictEqual(telOrgDos, null, "org2 no debe ver el telefono que org1 registro");
  } finally {
    waha.participantesDeGrupo = participantesReal;
    waha.telefonoDeLid = telefonoDelIdReal;
  }
});

// ── Auditoria 2026-09-02: el directorio en vivo llevaba 0 telefonos guardados
// en una semana mientras la misma lista resolvia el 80% en frio. Tres causas
// probables y las tres quedan fijadas aca: el refresco en vuelo que la segunda
// pregunta se saltaba, el fallo que compraba 10 min de silencio, y el indice
// vacio despues de cada despliegue (calentar + rellenar).

test("dos preguntas simultaneas por el mismo grupo comparten UN solo refresco y las dos resuelven", async () => {
  preparar();
  let resolver;
  const contador = { n: 0 };
  waha.participantesDeGrupo = async () => {
    contador.n += 1;
    await new Promise((r) => { resolver = r; });
    return [{ id: "198161251463188@lid", esLid: true, telefono: "573001234567", rol: "participant" }];
  };
  waha.telefonoDeLid = async () => null;

  // Lo que hace vivo.js: registrar sin await y, enseguida, telefonoDe otra vez.
  const primera = directorio.telefonoDe(ORG, "198161251463188", { sesion: SESION, jid: JID });
  const segunda = directorio.telefonoDe(ORG, "198161251463188", { sesion: SESION, jid: JID });
  await new Promise((r) => setTimeout(r, 5));
  resolver();

  assert.deepStrictEqual(await Promise.all([primera, segunda]), ["573001234567", "573001234567"]);
  assert.strictEqual(contador.n, 1, "la segunda pregunta espera el refresco en vuelo, no lo duplica ni lo salta");
});

test("si WAHA falla, el grupo se vuelve a poder consultar a los 30 s, no a los 10 min", async () => {
  preparar();
  let falla = true;
  const contador = { n: 0 };
  waha.participantesDeGrupo = async () => {
    contador.n += 1;
    if (falla) throw new Error("timeout");
    return [{ id: "198161251463188@lid", esLid: true, telefono: "573001234567", rol: "participant" }];
  };
  waha.telefonoDeLid = async () => null;

  assert.strictEqual(await directorio.telefonoDe(ORG, "198161251463188", { sesion: SESION, jid: JID }), null);
  assert.strictEqual(contador.n, 1);

  // Enseguida sigue bloqueado (30 s), igual que antes.
  assert.strictEqual(await directorio.telefonoDe(ORG, "198161251463188", { sesion: SESION, jid: JID }), null);
  assert.strictEqual(contador.n, 1, "dentro de los 30 s no se martilla a WAHA");

  // Pasados los 30 s (simulados adelantando el reloj del throttle), reintenta.
  const realNow = Date.now;
  Date.now = () => realNow() + directorio.MS_REINTENTO_TRAS_FALLO + 1000;
  try {
    falla = false;
    assert.strictEqual(await directorio.telefonoDe(ORG, "198161251463188", { sesion: SESION, jid: JID }), "573001234567");
    assert.strictEqual(contador.n, 2, "a los 30 s vuelve a preguntar; antes eran 10 min de ceguera");
  } finally {
    Date.now = realNow;
  }
});

test("calentar recorre todos los grupos saltando el throttle, y rellenar completa a los colegas sin telefono", async () => {
  preparar();
  const contador = conParticipantes([
    { id: "198161251463188@lid", esLid: true, telefono: "573001234567", rol: "participant" },
    { id: "777@lid", esLid: true, telefono: "573009998877", rol: "participant" },
  ]);

  // Un colega registrado antes, sin telefono (el caso real: 79 de 85).
  await colegas.upsert(ORG, { lid: "777", telefono: null, nombre: "Colega Sin Tel" });
  // Un refresco reciente del mismo grupo: calentar lo ignora (forzar).
  await directorio.telefonoDe(ORG, "555", { sesion: SESION, jid: JID });
  assert.strictEqual(contador.n, 1);

  const r = await directorio.calentar(ORG, SESION, [JID, "456@g.us"]);
  assert.strictEqual(contador.n, 3, "calentar refresca los dos grupos aunque uno se haya consultado recien");
  assert.strictEqual(r.grupos, 2);
  assert.strictEqual(r.refrescados, 2);
  assert.strictEqual(r.indice, 2, "dos lids distintos con telefono en el indice de esta org");

  const completados = await directorio.rellenarColegas(ORG);
  assert.strictEqual(completados, 1);
  const fila = memory.colegasGrupos.find((c) => c.org_id === ORG && c.lid === "777");
  assert.strictEqual(fila.telefono, "573009998877");

  waha.participantesDeGrupo = participantesReal;
  waha.telefonoDeLid = telefonoDelIdReal;
});

// ── PISTA: el numero que a veces viaja en el propio mensaje del grupo
// (whatsapp-group.js#telefonoVisible). Es la fuente mas barata que hay y la
// unica que sirve para un colega que la lista de participantes no expone.

test("con una pista valida resuelve sin tocar WAHA, y deja el numero en el indice", async () => {
  preparar();
  const contador = conParticipantes([]);

  const tel = await directorio.telefonoDe(ORG, "198161251463188", {
    sesion: SESION, jid: JID, pista: "573001234567",
  });
  assert.strictEqual(tel, "573001234567");
  assert.strictEqual(contador.n, 0, "una pista valida ahorra la lista de participantes entera");

  // Queda sembrado: el siguiente pedido del mismo colega ya no necesita pista.
  assert.strictEqual(await directorio.telefonoDe(ORG, "198161251463188", {}), "573001234567");
});

test("una pista que NO es un celular colombiano se ignora — un lid disfrazado nunca entra", async () => {
  preparar();
  conParticipantes([]);

  for (const basura of ["198161251463188", "12345", "5712345678", ""]) {
    assert.strictEqual(
      await directorio.telefonoDe(ORG, "777", { sesion: SESION, jid: JID, pista: basura }),
      null,
      `la pista ${basura} no puede pasar por telefono`
    );
  }

  waha.participantesDeGrupo = participantesReal;
  waha.telefonoDeLid = telefonoDelIdReal;
});

// ── EL MAPA GUARDADO (Juan, 2026-09-02): "los numeros que ya se pueden ver en
// todos los grupos como base de datos para que no tenga que ir a waha a
// revisar en cada respuesta, si no que se crucen con el id del colega".
//
// El caso que lo motivo: ese dia WAHA alternaba entre devolver 735
// participantes y devolver CERO, sin error. Cuando devolvia cero, el pedido se
// desviaba al camino manual aunque el numero fuera visible diez minutos antes.

const lidsGuardados = require("../src/data/directorio-lids");

test("una pasada de participantes queda GUARDADA, no solo en memoria", async () => {
  preparar();
  lidsGuardados._reset();
  conParticipantes([
    { id: "198161251463188@lid", esLid: true, telefono: "573001234567", rol: "participant" },
    { id: "111222333444555@lid", esLid: true, telefono: "573009998877", rol: "participant" },
    { id: "999@lid", esLid: true, telefono: null, rol: "participant" },
  ]);

  await directorio.telefonoDe(ORG, "198161251463188", { sesion: SESION, jid: JID });

  const guardados = await lidsGuardados.listar(ORG);
  assert.strictEqual(guardados.length, 2, "los dos con telefono visible, el tercero no");
  assert.ok(guardados.some((p) => p.lid === "111222333444555"), "se guarda TODA la pasada, no solo el que se buscaba");
});

test("tras un reinicio resuelve desde la base, SIN tocar WAHA", async () => {
  preparar();
  lidsGuardados._reset();
  conParticipantes([{ id: "198161251463188@lid", esLid: true, telefono: "573001234567", rol: "participant" }]);
  await directorio.telefonoDe(ORG, "198161251463188", { sesion: SESION, jid: JID });

  // Simula el reinicio: el indice en memoria se pierde, la base queda.
  directorio._resetCache();
  const contador = conParticipantes([]); // WAHA ahora devuelve vacio, como paso de verdad

  const tel = await directorio.telefonoDe(ORG, "198161251463188", {});
  assert.strictEqual(tel, "573001234567", "el numero sobrevive al reinicio");
  assert.strictEqual(contador.n, 0, "y no hizo falta preguntarle a WAHA");

  waha.participantesDeGrupo = participantesReal;
  waha.telefonoDeLid = telefonoDelIdReal;
});

test("un `pn` con basura NUNCA entra a la cache: de ahi sale a que numero se escribe", async () => {
  preparar();
  lidsGuardados._reset();
  conParticipantes([
    { id: "111@lid", esLid: true, telefono: "12345", rol: "participant" },
    { id: "222@lid", esLid: true, telefono: "198161251463188", rol: "participant" }, // un lid disfrazado
    { id: "333@lid", esLid: true, telefono: "573001234567", rol: "participant" },
  ]);
  await directorio.telefonoDe(ORG, "333", { sesion: SESION, jid: JID });

  const guardados = await lidsGuardados.listar(ORG);
  assert.deepStrictEqual(guardados.map((p) => p.lid), ["333"]);

  waha.participantesDeGrupo = participantesReal;
  waha.telefonoDeLid = telefonoDelIdReal;
});
