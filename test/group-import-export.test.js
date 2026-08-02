// Import de exports .txt — la vía segura para leer los grupos.
//
// Los data modules crean un cliente Supabase REAL si SUPABASE_URL está en el
// .env (así está este repo, apuntando a producción), así que acá se mockean
// las funciones que tocan la base. Lo único simulado además es la llamada a
// Claude: el resto del embudo —parser, corte, dedup, prefiltro, cruce— corre
// de verdad.

const { test } = require("node:test");
const assert = require("node:assert");

const { _setClientForTests } = require("../src/lib/anthropic");
const {
  importar, idDeMensaje, huella, aplicarCorte, nombreDeArchivo, MAX_MENSAJES,
} = require("../src/groups/importar-export");
const groupSignals = require("../src/data/group-signals");
const whatsappGroups = require("../src/data/whatsapp-groups");
const allyProperties = require("../src/data/ally-properties");
const properties = require("../src/data/properties");

const ORG = { id: "org-1", name: "Diamond" };

function exportCon(lineas) {
  return lineas.join("\n");
}

// Fecha en el formato es-CO que produce WhatsApp en Android.
function fecha(diasAtras) {
  const d = new Date(Date.now() - diasAtras * 86400000);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

// Reemplaza todo lo que toca Supabase y devuelve los almacenes para inspección.
function mockDatos(t, { propiedades = [] } = {}) {
  const señales = [];
  const aliadas = [];
  const grupos = new Map();

  t.mock.method(whatsappGroups, "asegurarGrupoVirtual", async (orgId, { prefijo, nombre }) => {
    const jid = `${prefijo}:${whatsappGroups.slug(nombre)}`;
    if (!grupos.has(jid)) grupos.set(jid, { id: `grp-${grupos.size + 1}`, jid, nombre, org_id: orgId });
    return grupos.get(jid);
  });

  t.mock.method(groupSignals, "create", async (orgId, fields) => {
    // Reproduce el índice único (org_id, group_id, wa_message_id) que es lo
    // que hace idempotente la re-subida del mismo export.
    const clave = `${orgId}|${fields.group_id}|${fields.wa_message_id}`;
    if (señales.some((s) => s._clave === clave)) return { signal: null, duplicado: true };
    const signal = { _clave: clave, id: `sig-${señales.length + 1}`, created_at: new Date().toISOString(), ...fields };
    señales.push(signal);
    return { signal, duplicado: false };
  });

  t.mock.method(allyProperties, "create", async (orgId, fields) => {
    const creada = { id: `ally-${aliadas.length + 1}`, org_id: orgId, ...fields };
    aliadas.push(creada);
    return creada;
  });

  // La marca de agua del import: se calcula sobre las señales ya guardadas,
  // igual que la real.
  t.mock.method(groupSignals, "ultimaFechaImportada", async (orgId, groupId) => {
    const fechas = señales
      .filter((s) => s.group_id === groupId && s.fecha_mensaje)
      .map((s) => s.fecha_mensaje);
    return fechas.length ? fechas.sort().at(-1) : null;
  });

  // cruzar() consulta el inventario propio y la red de aliados.
  t.mock.method(properties, "search", async () => propiedades);
  t.mock.method(allyProperties, "search", async () => []);

  return { señales, aliadas, grupos };
}

// Clasificador falso: decide por el texto para que los tests se lean solos.
function mockClasificador(clasePorTexto) {
  _setClientForTests({
    messages: {
      create: async (params) => {
        const entradas = [...params.messages[0].content.matchAll(/\[([^\]]+)\] \(([^)]*)\): (.*)/g)];
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              mensajes: entradas.map(([, id, , texto]) => ({
                id,
                clase: clasePorTexto
                  ? clasePorTexto(texto)
                  : /busco|necesito|tengo cliente/i.test(texto) ? "demanda"
                    : /vende|arriendo|disponible/i.test(texto) ? "oferta" : "ruido",
                confianza: 0.9,
                operacion: "venta",
                tipo: "apartamento",
                zona: "Laureles",
                ciudad: "Medellín",
                precio_min: 0,
                precio_max: 400000000,
                habitaciones: 3,
                area_min: 0, banos: 0, garajes: 0, estrato: 0,
                contacto: "", notas: texto.slice(0, 40),
              })),
            }),
          }],
          usage: { input_tokens: 1000, output_tokens: 400 },
        };
      },
    },
  });
}

// ══ Piezas puras ═════════════════════════════════════════════════════════

test("el nombre del grupo sale del nombre del archivo que genera WhatsApp", () => {
  assert.strictEqual(nombreDeArchivo("Chat de WhatsApp con Inmobiliarias Medellín.txt"), "Inmobiliarias Medellín");
  assert.strictEqual(nombreDeArchivo("WhatsApp Chat with Brokers.txt"), "Brokers");
  assert.strictEqual(nombreDeArchivo("mi-grupo.txt"), "mi-grupo");
  assert.strictEqual(nombreDeArchivo(""), "Grupo sin nombre");
});

// Estas tres son `async` desde que el hash pasó a WebCrypto (epe/core/hash.js):
// `crypto.subtle` es asíncrono, y ese fue el precio de que el núcleo corra
// igual en Node y en el navegador. El comportamiento no cambió — los vectores
// fijos de test/epe-hash.test.js prueban que los hashes son los mismos.

test("el id del mensaje es determinista: re-subir el mismo export no duplica", async () => {
  const m = { grupo: "G", fechaIso: "2026-07-30T10:00:00.000Z", autor: "Andrés", texto: "busco apto" };
  assert.strictEqual(await idDeMensaje(m), await idDeMensaje({ ...m }));
  assert.match(await idDeMensaje(m), /^export:[a-f0-9]{40}$/);
});

test("el id cambia si cambia el contenido, el autor o el grupo", async () => {
  const base = { grupo: "G", fechaIso: "2026-07-30T10:00:00.000Z", autor: "Andrés", texto: "busco apto" };
  const id = await idDeMensaje(base);
  assert.notStrictEqual(id, await idDeMensaje({ ...base, texto: "busco casa" }));
  assert.notStrictEqual(id, await idDeMensaje({ ...base, autor: "Marcela" }));
  assert.notStrictEqual(id, await idDeMensaje({ ...base, grupo: "Otro" }));
});

test("la huella ignora el grupo — el mismo aviso difundido en diez grupos se paga una vez", async () => {
  const a = { grupo: "Grupo A", autor: "Andrés", texto: "Se vende apto en Laureles" };
  const b = { grupo: "Grupo B", autor: "Andrés", texto: "SE VENDE APTO EN LAURELES" };
  assert.strictEqual(await huella(a), await huella(b));
});


test("el corte temporal descarta lo viejo y lo que no se puede fechar", () => {
  const { dentro, fuera } = aplicarCorte(
    [
      { instanteIso: new Date().toISOString() },
      { instanteIso: new Date(Date.now() - 60 * 86400000).toISOString() },
      { instanteIso: null },
    ],
    30
  );
  assert.strictEqual(dentro.length, 1);
  assert.strictEqual(fuera, 2);
});

test("sin días de corte pasa todo", () => {
  const { dentro, fuera } = aplicarCorte([{ instanteIso: null }, { instanteIso: "2020-01-01T00:00:00Z" }], null);
  assert.strictEqual(dentro.length, 2);
  assert.strictEqual(fuera, 0);
});

// ══ Dedup de colegas sin teléfono ════════════════════════════════════════
//
// El dedup de origen 'grupo' iba por contacto_telefono, que en un export es
// SIEMPRE null: sin el fallback por nombre, dos colegas distintos con un
// apartamento parecido colapsaban en una sola fila.

test("la clave del colega cae al nombre cuando no hay teléfono", () => {
  assert.strictEqual(allyProperties.claveColega({ contacto_telefono: "573001112233" }), "tel:573001112233");
  assert.strictEqual(allyProperties.claveColega({ contacto_nombre: "Carlos Ruiz" }), "nom:carlos ruiz");
  // El teléfono manda si está: es la clave fuerte.
  assert.strictEqual(
    allyProperties.claveColega({ contacto_telefono: "573001112233", contacto_nombre: "Carlos" }),
    "tel:573001112233"
  );
});

test("dos colegas distintos sin teléfono NO son la misma propiedad", () => {
  const base = { origen: "grupo", tipo: "apartamento", zona: "Laureles", precio: "$380.000.000" };
  assert.strictEqual(
    allyProperties.mismaPropiedadDeGrupo(
      { ...base, contacto_nombre: "Andrés Gómez" },
      { ...base, contacto_nombre: "Carlos Ruiz" }
    ),
    false
  );
});

test("el mismo colega republicando la misma propiedad SÍ es la misma", () => {
  const base = { origen: "grupo", tipo: "apartamento", zona: "Laureles", precio: "$380.000.000" };
  assert.strictEqual(
    allyProperties.mismaPropiedadDeGrupo(
      { ...base, contacto_nombre: "Carlos Ruiz" },
      { ...base, contacto_nombre: "carlos ruiz" }
    ),
    true
  );
});

// ══ Pipeline completo ════════════════════════════════════════════════════

test("un export real se convierte en señales", async (t) => {
  const { señales } = mockDatos(t);
  mockClasificador();
  const hoy = fecha(1);
  const contenido = exportCon([
    `${hoy}, 10:30 a. m. - Andrés Gómez: Tengo cliente para apto 3 alcobas en Laureles hasta 400 millones`,
    `${hoy}, 10:31 a. m. - Marcela: Buenos días a todos`,
    `${hoy}, 10:32 a. m. - Carlos Ruiz: Se vende apartamento en Laureles, 380 millones, 3 alcobas`,
  ]);

  const stats = await importar(ORG, [{ nombre: "Chat de WhatsApp con Gremio.txt", contenido }], { dias: 30 });

  assert.strictEqual(stats.crudos, 3);
  assert.strictEqual(stats.demandas, 1);
  assert.strictEqual(stats.ofertas, 1);
  assert.strictEqual(señales.length, 2);
  assert.ok(stats.costoUsd > 0, "el costo se mide, no se estima");
  _setClientForTests(null);
});

test("las señales quedan marcadas con origen 'export' y la fecha REAL del mensaje", async (t) => {
  const { señales } = mockDatos(t);
  mockClasificador();
  const contenido = exportCon([`${fecha(5)}, 09:00 a. m. - Andrés: Tengo cliente para apto en Laureles`]);

  await importar(ORG, [{ nombre: "Chat de WhatsApp con Gremio.txt", contenido }], { dias: 30 });

  assert.strictEqual(señales[0].origen, "export");
  // created_at es hoy; fecha_mensaje es de hace 5 días. Sin distinguirlas, una
  // demanda vieja se leería como de hoy.
  assert.ok(señales[0].fecha_mensaje < señales[0].created_at);
  _setClientForTests(null);
});

test("un .txt no trae teléfono: el contacto se resuelve por nombre", async (t) => {
  const { señales } = mockDatos(t);
  mockClasificador();
  const contenido = exportCon([`${fecha(1)}, 09:00 a. m. - Andrés Gómez: Tengo cliente para apto en Laureles`]);

  await importar(ORG, [{ nombre: "Chat de WhatsApp con Gremio.txt", contenido }], { dias: 30 });

  assert.strictEqual(señales[0].autor_nombre, "Andrés Gómez");
  assert.strictEqual(señales[0].autor_telefono, null);
  _setClientForTests(null);
});

test("re-subir el mismo export no crea señales nuevas ni cuesta IA", async (t) => {
  const { señales } = mockDatos(t);
  mockClasificador();
  const contenido = exportCon([`${fecha(2)}, 10:30 a. m. - Andrés: Tengo cliente para apto en Laureles`]);
  const archivo = [{ nombre: "Chat de WhatsApp con Gremio.txt", contenido }];

  const primera = await importar(ORG, archivo, { dias: 30 });
  const segunda = await importar(ORG, archivo, { dias: 30 });

  assert.strictEqual(primera.señales, 1);
  // La marca de agua lo corta ANTES de clasificar: ni siquiera llega al dedup
  // de la base, que era lo que antes lo atajaba —pero recién después de pagar.
  assert.strictEqual(segunda.aClasificar, 0);
  assert.strictEqual(segunda.costoUsd, 0);
  assert.strictEqual(segunda.señales, 0);
  assert.strictEqual(señales.length, 1);
  _setClientForTests(null);
});

test("el dedup de la base sigue atajando lo que la marca de agua no ve", async (t) => {
  // Con incremental:false no hay marca de agua, así que el mensaje repetido
  // llega hasta la persistencia. Es la segunda red de seguridad.
  const { señales } = mockDatos(t);
  mockClasificador();
  const contenido = exportCon([`${fecha(2)}, 10:30 a. m. - Andrés: Tengo cliente para apto en Laureles`]);
  const archivo = [{ nombre: "Chat de WhatsApp con Gremio.txt", contenido }];

  await importar(ORG, archivo, { dias: 30, incremental: false });
  const segunda = await importar(ORG, archivo, { dias: 30, incremental: false });

  assert.strictEqual(segunda.aClasificar, 1, "sin marca de agua sí se reclasifica");
  assert.strictEqual(segunda.señales, 0);
  assert.strictEqual(segunda.duplicadas, 1);
  assert.strictEqual(señales.length, 1);
  _setClientForTests(null);
});

test("el mismo aviso en dos grupos distintos se clasifica una sola vez", async (t) => {
  mockDatos(t);
  mockClasificador();
  const linea = `${fecha(1)}, 11:00 a. m. - Carlos: Se vende apartamento en Laureles 380 millones`;

  const stats = await importar(ORG, [
    { nombre: "Chat de WhatsApp con Grupo A.txt", contenido: exportCon([linea]) },
    { nombre: "Chat de WhatsApp con Grupo B.txt", contenido: exportCon([linea]) },
  ], { dias: 30 });

  assert.strictEqual(stats.crudos, 2);
  assert.strictEqual(stats.repetidos, 1);
  assert.strictEqual(stats.aClasificar, 1);
  _setClientForTests(null);
});

test("cada archivo crea su grupo virtual, y reimportar reusa el mismo", async (t) => {
  const { grupos } = mockDatos(t);
  mockClasificador();
  const contenido = exportCon([`${fecha(1)}, 10:00 a. m. - Andrés: Tengo cliente para apto en Laureles`]);
  const archivo = [{ nombre: "Chat de WhatsApp con Gremio Sur.txt", contenido }];

  await importar(ORG, archivo, { dias: 30 });
  await importar(ORG, archivo, { dias: 30 });

  assert.strictEqual(grupos.size, 1);
  assert.ok(grupos.has("export:gremio-sur"), `jid inesperado: ${[...grupos.keys()]}`);
  assert.strictEqual(grupos.get("export:gremio-sur").nombre, "Gremio Sur");
  _setClientForTests(null);
});

test("una oferta utilizable entra a la red de aliados con la fecha del mensaje, no la de hoy", async (t) => {
  const { aliadas } = mockDatos(t);
  mockClasificador();
  // Oferta de hace 5 días: si entrara con now(), se recomendaría como fresca
  // por otros 7 días — el daño de reputación que la caducidad existe para evitar.
  const contenido = exportCon([
    `${fecha(5)}, 10:00 a. m. - Carlos Ruiz: Se vende apartamento en Laureles, 380 millones`,
  ]);

  const stats = await importar(ORG, [{ nombre: "Chat de WhatsApp con Gremio.txt", contenido }], { dias: 30 });

  assert.strictEqual(stats.ofertasArchivadas, 1);
  assert.strictEqual(aliadas[0].origen, "grupo");
  assert.strictEqual(aliadas[0].contacto_nombre, "Carlos Ruiz");
  assert.strictEqual(aliadas[0].contacto_telefono, null, "un .txt nunca trae teléfono");
  const antiguedadDias = (Date.now() - new Date(aliadas[0].visto_en_grupo_at)) / 86400000;
  assert.ok(antiguedadDias > 4, `debe conservar su antigüedad real, dio ${antiguedadDias.toFixed(1)} días`);
  _setClientForTests(null);
});

test("una oferta sin datos utilizables queda como señal pero NO ensucia la red de aliados", async (t) => {
  const { señales, aliadas } = mockDatos(t);
  _setClientForTests({
    messages: {
      create: async (params) => {
        const id = [...params.messages[0].content.matchAll(/\[([^\]]+)\]/g)][0][1];
        return {
          content: [{ type: "text", text: JSON.stringify({ mensajes: [{
            id, clase: "oferta", confianza: 0.8, operacion: "venta",
            tipo: "", zona: "", ciudad: "", precio_min: 0, precio_max: 0,
            habitaciones: 0, area_min: 0, banos: 0, garajes: 0, estrato: 0,
            contacto: "", notas: "sin datos",
          }] }) }],
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      },
    },
  });
  const contenido = exportCon([`${fecha(1)}, 10:00 a. m. - Alguien: se vende algo por ahí barato`]);

  const stats = await importar(ORG, [{ nombre: "Chat de WhatsApp con G.txt", contenido }], { dias: 30 });

  assert.strictEqual(stats.ofertas, 1);
  assert.strictEqual(señales.length, 1, "la señal se registra igual");
  assert.strictEqual(stats.ofertasArchivadas, 0);
  assert.strictEqual(aliadas.length, 0);
  _setClientForTests(null);
});

test("el corte temporal evita pagar IA por el historial viejo del grupo", async (t) => {
  mockDatos(t);
  mockClasificador();
  const contenido = exportCon([
    `${fecha(200)}, 10:00 a. m. - Andrés: Tengo cliente para apto en Laureles`,
    `${fecha(1)}, 10:00 a. m. - Marcela: Tengo cliente para casa en Envigado`,
  ]);

  const stats = await importar(ORG, [{ nombre: "Chat de WhatsApp con G.txt", contenido }], { dias: 30 });

  assert.strictEqual(stats.crudos, 2);
  assert.strictEqual(stats.fueraDeCorte, 1);
  assert.strictEqual(stats.aClasificar, 1);
  _setClientForTests(null);
});

test("un export por encima del tope se rechaza con un mensaje accionable", async (t) => {
  mockDatos(t);
  const hoy = fecha(0);
  const lineas = Array.from({ length: MAX_MENSAJES + 5 }, (_, i) =>
    `${hoy}, 10:00 a. m. - Colega ${i}: Tengo cliente para apto ${i} en Laureles`);

  await assert.rejects(
    () => importar(ORG, [{ nombre: "Chat de WhatsApp con Enorme.txt", contenido: exportCon(lineas) }], { dias: 30 }),
    (e) => {
      assert.strictEqual(e.code, "DEMASIADOS_MENSAJES");
      assert.match(e.message, /Acortá el rango/);
      return true;
    }
  );
});

test("el progreso reporta las fases en orden para que la barra no se congele", async (t) => {
  mockDatos(t);
  mockClasificador();
  const fases = [];
  const contenido = exportCon([`${fecha(1)}, 10:00 a. m. - Andrés: Tengo cliente para apto en Laureles`]);

  await importar(ORG, [{ nombre: "Chat de WhatsApp con G.txt", contenido }], {
    dias: 30,
    onProgreso: ({ fase }) => { if (fases[fases.length - 1] !== fase) fases.push(fase); },
  });

  assert.deepStrictEqual(fases, ["leyendo", "filtrando", "clasificando", "cruzando", "guardando"]);
  _setClientForTests(null);
});

test("un export sin nada inmobiliario no llama a la IA", async (t) => {
  mockDatos(t);
  const llamadas = [];
  _setClientForTests({ messages: { create: async (p) => { llamadas.push(p); throw new Error("no debería llamarse"); } } });
  const contenido = exportCon([
    `${fecha(1)}, 10:00 a. m. - Andrés: Buenos días`,
    `${fecha(1)}, 10:01 a. m. - Marcela: Feliz cumpleaños!`,
  ]);

  const stats = await importar(ORG, [{ nombre: "Chat de WhatsApp con G.txt", contenido }], { dias: 30 });

  assert.strictEqual(stats.aClasificar, 0);
  assert.strictEqual(stats.costoUsd, 0);
  assert.strictEqual(llamadas.length, 0);
  _setClientForTests(null);
});

test("las stats llevan el CONTEO de ruido, nunca los mensajes", async (t) => {
  // `cruzar` devuelve los mensajes de ruido enteros y estas stats viajan al
  // CRM por HTTP: mandar el array metería el texto crudo de mensajes privados
  // de terceros en la respuesta. El ruido muere en memoria.
  mockDatos(t);
  mockClasificador();
  const contenido = exportCon([
    `${fecha(1)}, 10:00 a. m. - Andrés: Tengo cliente para apto en Laureles`,
    `${fecha(1)}, 10:01 a. m. - Marcela: precio de la cuota de administración por favor`,
  ]);

  const stats = await importar(ORG, [{ nombre: "Chat de WhatsApp con G.txt", contenido }], { dias: 30 });

  assert.strictEqual(typeof stats.ruido, "number");
  assert.strictEqual(JSON.stringify(stats).includes("administración"), false);
  _setClientForTests(null);
});

// ══ Import incremental ═══════════════════════════════════════════════════
//
// Es lo que vuelve viable exportar dos veces al día. El dedup de señales evita
// la fila repetida, pero recién DESPUÉS de clasificar: sin marca de agua, cada
// carga vuelve a pagarle a la IA por todo el rango elegido.

test("el corte respeta la marca de agua además de la ventana de días", () => {
  const ayer = new Date(Date.now() - 1 * 86400000).toISOString();
  const hace3 = new Date(Date.now() - 3 * 86400000).toISOString();
  const hace10 = new Date(Date.now() - 10 * 86400000).toISOString();

  // Ventana de 30 días, pero el grupo ya se leyó hasta hace 3: manda el más
  // reciente de los dos.
  const { dentro } = aplicarCorte([{ instanteIso: ayer }, { instanteIso: hace10 }], 30, hace3);
  assert.strictEqual(dentro.length, 1);
  assert.strictEqual(dentro[0].instanteIso, ayer);
});

test("el mensaje que marca la frontera no se reprocesa", () => {
  const borde = new Date(Date.now() - 86400000).toISOString();
  const { dentro } = aplicarCorte([{ instanteIso: borde }], null, borde);
  assert.strictEqual(dentro.length, 0, "el límite es exclusivo: ese mensaje ya se procesó");
});

test("dentro de un mismo día, la hora decide qué es nuevo", () => {
  // Sin esto, exportar a las 7am dejaba la marca de agua en el día entero y
  // la carga del mediodía no veía nada. Es el caso que habilita el flujo.
  const { parseInstante } = require("../src/groups/parse-export");
  const manana = parseInstante("1/8/2026", "08:12 a. m.").toISOString();
  const mediodia = parseInstante("1/8/2026", "12:40 p. m.").toISOString();

  assert.ok(mediodia > manana, "el mediodía tiene que ser posterior a la mañana");
  const { dentro } = aplicarCorte(
    [{ instanteIso: manana }, { instanteIso: mediodia }],
    null,
    manana
  );
  assert.strictEqual(dentro.length, 1);
  assert.strictEqual(dentro[0].instanteIso, mediodia);
});

test("la segunda carga del mismo día NO vuelve a pagar la IA", async (t) => {
  // El caso real: exportar a las 7am y otra vez a la 1pm. El export del
  // mediodía contiene todo lo de la mañana.
  const { señales } = mockDatos(t);
  let llamadasIA = 0;
  const contarIA = () => { llamadasIA++; };

  const manana = `${fecha(1)}, 08:00 a. m. - Andrés: Tengo cliente para apto en Laureles`;
  const mediodia = `${fecha(0)}, 12:30 p. m. - Marcela: Tengo cliente para casa en Envigado`;
  const archivo = (lineas) => [{ nombre: "Chat de WhatsApp con Gremio.txt", contenido: exportCon(lineas) }];

  mockClasificador();
  const original = require("../src/lib/anthropic").getClient();
  require("../src/lib/anthropic")._setClientForTests({
    messages: { create: async (p) => { contarIA(); return original.messages.create(p); } },
  });

  await importar(ORG, archivo([manana]), { dias: 30 });
  const trasPrimera = llamadasIA;

  // Segunda carga: el mismo mensaje de la mañana + uno nuevo.
  const segunda = await importar(ORG, archivo([manana, mediodia]), { dias: 30 });

  assert.strictEqual(segunda.crudos, 2, "el archivo trae los dos mensajes");
  assert.strictEqual(segunda.fueraDeCorte, 1, "el de la mañana queda fuera por la marca de agua");
  assert.strictEqual(segunda.aClasificar, 1, "solo se clasifica el nuevo");
  assert.strictEqual(llamadasIA, trasPrimera + 1, "una sola llamada más, no dos");
  assert.strictEqual(señales.length, 2);
  _setClientForTests(null);
});

test("cada grupo lleva su propia marca de agua", async (t) => {
  // Uno leído hasta ayer y otro que se sube por primera vez no pueden
  // compartir corte.
  mockDatos(t);
  mockClasificador();
  const llamadas = [];
  t.mock.method(groupSignals, "ultimaFechaImportada", async (orgId, groupId) => {
    llamadas.push(groupId);
    return groupId === "grp-1" ? new Date(Date.now() - 2 * 86400000).toISOString() : null;
  });

  const viejo = `${fecha(5)}, 10:00 a. m. - Andrés: Tengo cliente para apto en Laureles`;
  const stats = await importar(ORG, [
    { nombre: "Chat de WhatsApp con Ya Leido.txt", contenido: exportCon([viejo]) },
    { nombre: "Chat de WhatsApp con Nuevo.txt", contenido: exportCon([viejo]) },
  ], { dias: 30 });

  assert.strictEqual(llamadas.length, 2, "se consulta la marca de cada grupo");
  // El mensaje es de hace 5 días: fuera para el leído-hasta-hace-2, dentro
  // para el que nunca se subió.
  assert.strictEqual(stats.fueraDeCorte, 1);
  assert.strictEqual(stats.aClasificar, 1);
  _setClientForTests(null);
});

test("incremental:false reprocesa todo — para rehacer un grupo a mano", async (t) => {
  mockDatos(t);
  mockClasificador();
  t.mock.method(groupSignals, "ultimaFechaImportada", async () => new Date().toISOString());

  const stats = await importar(
    ORG,
    [{ nombre: "Chat de WhatsApp con G.txt", contenido: exportCon([`${fecha(2)}, 10:00 a. m. - Andrés: Tengo cliente para apto en Laureles`]) }],
    { dias: 30, incremental: false }
  );

  assert.strictEqual(stats.aClasificar, 1, "sin incremental, la marca de agua se ignora");
  _setClientForTests(null);
});

test("si la marca de agua falla se procesa igual, no se pierde la carga", async (t) => {
  mockDatos(t);
  mockClasificador();
  t.mock.method(groupSignals, "ultimaFechaImportada", async () => { throw new Error("sin columna"); });

  const stats = await importar(
    ORG,
    [{ nombre: "Chat de WhatsApp con G.txt", contenido: exportCon([`${fecha(1)}, 10:00 a. m. - Andrés: Tengo cliente para apto en Laureles`]) }],
    { dias: 30 }
  );

  assert.strictEqual(stats.aClasificar, 1);
  _setClientForTests(null);
});
