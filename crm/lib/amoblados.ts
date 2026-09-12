// Logica pura del panel de amoblados (spec 2026-09-12-panel-amoblados).
// Archivo HOJA a proposito: sin imports "@/", para que test/crm-amoblados.test.js
// lo importe directo con Node.

export type SalidaPedido = "dm" | "aviso" | "descartado" | "sin_dueno";

export type SenalSalida = {
  respondida_at?: string | null;
  respuesta_modo?: string | null;
  aviso_advisor_id?: string | null;
  aviso_wamid?: string | null;
  revalidacion?: { sirve_alguna?: boolean | null } | null;
};

// Que salio para un pedido con match. Precedencia: DM > aviso > descarte.
// "sombra" no cuenta como DM: se redacto pero no salio.
export function salidaDelPedido(s: SenalSalida): SalidaPedido {
  if (s.respondida_at && s.respuesta_modo === "auto") return "dm";
  if (s.aviso_advisor_id || s.aviso_wamid) return "aviso";
  if (s.revalidacion && s.revalidacion.sirve_alguna === false) return "descartado";
  return "sin_dueno";
}

export function resumenSalidas(senales: SenalSalida[]): Record<SalidaPedido, number> {
  const r: Record<SalidaPedido, number> = { dm: 0, aviso: 0, descartado: 0, sin_dueno: 0 };
  for (const s of senales) r[salidaDelPedido(s)]++;
  return r;
}

// ESPEJO de src/groups/amoblado.js#esAmoblada: se duplica a proposito (el CRM
// no importa codigo del bot). test/crm-amoblados.test.js compara los dos
// veredictos caso por caso, asi que si uno cambia sin el otro, la suite falla.
const PATRON_SI = /\bamoblad|\bamueblad/i;
const PATRON_NO = /\bsin\s+amoblar|\bsin\s+amueblar|\bsin\s+muebles|\bno\s+amoblad|\bno\s+amueblad/i;

export function esAmoblada(p: { titulo?: string | null; caracteristicas?: string | null }): boolean | null {
  const texto = [p.titulo, p.caracteristicas].filter(Boolean).join(" ");
  if (!texto.trim()) return null;
  if (PATRON_NO.test(texto)) return false;
  if (PATRON_SI.test(texto)) return true;
  return null;
}

export type Periodo = "mensual" | "noche" | "sin_periodo";

// Si el precio de un arriendo es por mes o por noche, leido del texto de
// Wasi (la descripcion llega con HTML). El sistema trata todo arriendo como
// mensual: "noche" y "sin_periodo" son alertas para corregir en Wasi.
// Si dice las dos cosas gana "noche": hay que revisarla igual.
const NOCHE = /\bnoches?\b|\bpor\s+d[ií]as?\b|\bdiari[oa]\b/i;
const MES = /\bmes(es)?\b|\bmensual\b|\bcanon\b/i;

export function periodoDePropiedad(p: { titulo?: string | null; descripcion?: string | null }): Periodo {
  const texto = [p.titulo, p.descripcion]
    .filter(Boolean)
    .join(" ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ");
  if (NOCHE.test(texto)) return "noche";
  if (MES.test(texto)) return "mensual";
  return "sin_periodo";
}

// Cuantos pedidos con match trajeron cada propiedad (una vez por pedido).
export function pedidosPorRef(senales: { matches?: { ref?: string | null }[] | null }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of senales) {
    const refs = new Set((s.matches || []).map((x) => x.ref).filter(Boolean) as string[]);
    for (const ref of refs) m.set(ref, (m.get(ref) ?? 0) + 1);
  }
  return m;
}
