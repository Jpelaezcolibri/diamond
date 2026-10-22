#!/usr/bin/env node
// Prueba EN SECO de Sofi en la linea del radar (spec 2026-10-21-sofi-en-linea-radar).
// Usa la IA y las fichas reales; NO envia, NO guarda y NO avisa a nadie.
//
//   railway run --service diamond node scripts/sofi-linea-en-seco.js
//
// Repite el hilo real de Luz Amparo (Projency, pedido cod. 7S63) y un colega
// que pregunta la administracion, y un cuarto mensaje para ver el tope.

process.env.RADAR_SOFI_LINEA = "true";
const sofiLinea = require("../src/groups/sofi-linea");
const organizations = require("../src/data/organizations");
const properties = require("../src/data/properties");

const SEÑAL = {
  id: "d2bc1469-8762-4b1e-a5ae-092e2b98c7d5", autor_nombre: "Projency Inmobiliaria", codigo_colega: "7S63",
  respuesta_refs: ["9944723", "10113016"],
  texto_original: "*Solicito Apartamento* Entre Laureles y El Estadio. *Área alrededor de 120 M2* Sirve hasta piso 3 sin ascensor 3 alcobas, garaje *Presupuesto $800*",
};
const CASOS = [
  ["Projency Inmobiliaria", ["Cordial saludo, soy Luz Amparo Restrepo de Projency Inmobiliaria\nCuál es tu nombre", "Me respondes por favor para saber con quién estoy hablando", "Mucho gusto", "¿Y la de Laureles tiene parqueadero cubierto?"]],
  ["Isabel Restrepo", ["Hola, cuánto es la administración de la 9944723? y se puede ver el sábado?"]],
];

(async () => {
  const org = await organizations.getDefault();
  for (const [nombre, mensajes] of CASOS) {
    console.log(`\n══════ ${nombre} ══════`);
    const hilo = [];
    let respuestasSofi = 0;
    for (const texto of mensajes) {
      hilo.push({ direccion: "entrada", texto });
      console.log(`\nCOLEGA: ${texto.replace(/\n/g, " ")}`);
      let enviado = null;
      const deps = {
        estado: async () => ({ faltaAutor: false, humano: false, respuestasSofi, hilo: hilo.slice(-10) }),
        esColega: async () => null,
        asignarCodigo: async () => SEÑAL.codigo_colega,
        fichas: async (o, refs) => (await Promise.all(refs.slice(0, 3).map((r) => properties.findByRef(o, String(r)).catch(() => null)))).filter(Boolean),
        enviar: async (args) => { enviado = args.mensajes[0].texto; return { ok: true, wamid: "seco" }; },
        guardarSalida: async () => ({}),
        asesor: async () => null,
        notificar: async () => ({}),
        marcarPuente: async () => 0,
        dormir: async () => {},
        rand: () => 0,
      };
      deps.redactar = sofiLinea.redactarConIA;
      const r = await sofiLinea.responder(org, { mensaje: { sesion: "seco", remitenteNombre: nombre, texto }, señal: SEÑAL, identidad: { lid: "seco@lid" } }, deps);
      console.log(`→ [${r.resultado}] ${enviado || "(no contesta)"}`);
      if (enviado) { hilo.push({ direccion: "salida", texto: enviado }); respuestasSofi += 1; }
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
