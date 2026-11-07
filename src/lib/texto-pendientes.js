// El texto que acompana al Excel de pendientes (Juan, 2026-11-07, captura de
// Catherine: "Catherine, tienes 1 personas por contactar" no dice ni quien ni
// por que). Dice cuantas personas y por que, en tuteo y con singular y plural
// bien. Puro.

// Por que esta pendiente, en singular y en plural, para contar.
const MOTIVO = {
  pide_asesor: ["pidió hablar con un asesor", "pidieron hablar con un asesor"],
  nota_de_voz: ["mandó una nota de voz que Sofi no puede escuchar", "mandaron notas de voz que Sofi no puede escuchar"],
  no_contesto: ["no le contestó a Sofi", "no le contestaron a Sofi"],
  sin_seguimiento: ["no le contestó a Sofi y ella ya no alcanza a escribirle", "no le contestaron a Sofi y ella ya no alcanza a escribirles"],
};
const OTRO = ["quedó por contactar", "quedaron por contactar"];

const cuantas = (n) => `${n} ${n === 1 ? "persona" : "personas"}`;

// "2 no le contestaron a Sofi, 1 pidió hablar con un asesor y 1 mandó una nota de voz…"
function resumenMotivos(casos) {
  const conteo = new Map();
  for (const c of casos) {
    const k = MOTIVO[c.motivo] ? c.motivo : "otro";
    conteo.set(k, (conteo.get(k) || 0) + 1);
  }
  const partes = [...conteo.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${(MOTIVO[k] || OTRO)[n === 1 ? 0 : 1]}`);
  if (partes.length <= 1) return partes[0] || "";
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

function quienEs(c) {
  const tipo = c.tipo === "colega" ? "colega" : "cliente";
  const nombre = String(c.nombre || "").trim();
  if (!nombre || nombre === "(sin nombre)") return `${tipo === "colega" ? "un colega" : "un cliente"} sin nombre`;
  return `${nombre} (${tipo})`;
}

function textoExcel(nombreAsesora, casos) {
  const n = casos.length;
  let cabeza;
  if (n === 1) {
    const c = casos[0];
    cabeza = `${nombreAsesora}, tienes 1 persona por contactar: ${quienEs(c)}, que ${(MOTIVO[c.motivo] || OTRO)[0]}. Comunícate con esa persona`;
  } else {
    cabeza = `${nombreAsesora}, tienes ${cuantas(n)} por contactar: ${resumenMotivos(casos)}. Comunícate con cada una`;
  }
  return `${cabeza} (celular y WhatsApp en el Excel), llena la columna Resultado (y fecha, hora y ref si agendaste visita) y devuélveme el Excel por este chat.`;
}

module.exports = { textoExcel, resumenMotivos, cuantas, MOTIVO };
