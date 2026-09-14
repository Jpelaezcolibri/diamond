// Que termina siendo cada mensaje que paga el clasificador (auditoria de
// costo, 2026-09-14). Sin esta mezcla no se sabe si achicar la salida del
// ruido vale la pena: es el dato que decide la proxima palanca.
const test = require("node:test");
const assert = require("node:assert");

const canal = require("../src/channels/whatsapp-group");
const vivo = require("../src/groups/vivo");
const advisors = require("../src/data/advisors");
const organizations = require("../src/data/organizations");

test("cada resultado del radar cae en la clase que lo produjo", () => {
  const c = canal._claseDelResultado;
  assert.strictEqual(c("ruido"), "ruido");
  assert.strictEqual(c("oferta_sin_match"), "oferta");
  assert.strictEqual(c("oferta_cruzada"), "oferta");
  for (const r of ["sin_candidatas", "descartada_por_sofi", "dm_enviado", "callado", "duplicado", "sin_señal", "en_cola"]) {
    assert.strictEqual(c(r), "demanda", `${r} sale del camino de demandas`);
  }
  assert.strictEqual(c("sin_clasificar"), "sin_clasificar");
  assert.strictEqual(c("radar_apagado"), null);
  assert.strictEqual(c("descartado_prefiltro"), null);
});

test("el canal cuenta en que termino cada mensaje clasificado", async (t) => {
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => null);
  t.mock.method(organizations, "modoDeRespuesta", () => "asistido");
  const salidas = ["ruido", "oferta_sin_match", "sin_candidatas", "sin_clasificar"];
  t.mock.method(vivo, "procesarMensaje", async () => ({ resultado: salidas.shift() }));

  const m = canal._metricas;
  const antes = { ...m };
  const grupo = { id: "g-mezcla", jid: "120363@g.us", nombre: "Pedidos" };
  const textos = [
    "busco apto en laureles mezcla-1",
    "vendo casa en belen mezcla-2",
    "busco local en envigado mezcla-3",
    "arriendo apto en sabaneta mezcla-4",
  ];
  for (const [i, texto] of textos.entries()) {
    await canal._procesar(
      { id: "org-1" },
      { waMessageId: `mezcla-${i}`, texto, autorNombre: "Colega", autorId: "573001112233@c.us", tsMs: Date.now(), tieneMedia: false, sesion: "S", chatId: grupo.jid },
      grupo,
      null
    );
  }
  const delta = (k) => (m[k] || 0) - (antes[k] || 0);
  assert.strictEqual(delta("clasificados_ruido"), 1);
  assert.strictEqual(delta("clasificados_oferta"), 1);
  assert.strictEqual(delta("clasificados_demanda"), 1);
  assert.strictEqual(delta("sin_clasificar"), 1);
});
