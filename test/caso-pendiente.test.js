const { test } = require("node:test");
const assert = require("node:assert");
const { armarCaso, refsDe } = require("../src/lib/caso-pendiente");

test("refsDe saca las refs de los mensajes de Sofi sin repetir", () => {
  assert.deepStrictEqual(refsDe(["la ref 10414675 y la 9944723", "otra vez la 10414675"]), ["10414675", "9944723"]);
});

test("el caso de un colega trae su pedido, lo ofrecido con link de Wasi y el chat", async () => {
  const mensajes = [
    { role: "user", content: "Hola Sofi, sobre mi PEDIDO (cód. U9QT): Hola", created_at: "2026-10-27T12:55:00Z" },
    { role: "assistant", content: "Te pasé la ref 10414675", created_at: "2026-10-27T12:56:00Z" },
  ];
  const caso = await armarCaso({
    org: { id: "o1" }, crmUrl: "https://crm.x",
    pendiente: { codigo: "C-0001", motivo: "no_contesto", conversation_id: "c1" },
    lead: { id: "l1", phone: "573014521622", source: "colega", nombre: null },
    mensajes,
    deps: {
      pedido: async (_o, cod) => (cod === "U9QT" ? { texto_original: "Busco casa en arriendo en El Poblado, 3 alcobas" } : null),
      ficha: async (_o, ref) => ({ ref, tipo: "Casa", zona: "El Poblado", precio: 19900000, linkWasi: `https://info.wasi.co/casa/${ref}?shared=whatsapp` }),
      nombreColega: async () => "Clara Segura",
    },
  });
  assert.strictEqual(caso.nombre, "Clara Segura");
  assert.strictEqual(caso.whatsapp, "wa.me/573014521622");
  assert.match(caso.pidio, /El Poblado, 3 alcobas/);
  assert.match(caso.ofrecido, /Ref 10414675 · Casa · El Poblado · \$19\.900\.000 · https:\/\/info\.wasi\.co\/casa\/10414675\?shared=whatsapp/);
  assert.strictEqual(caso.chatUrl, "https://crm.x/inbox/c1");
});
