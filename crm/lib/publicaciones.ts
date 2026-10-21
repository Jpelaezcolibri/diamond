// Logica pura de la pestaña Publicaciones del CRM (spec
// 2026-10-20-publicaciones-y-respuestas §6, mockup aprobado).
// Hoja: sin imports "@/" para que la suite del bot (node --test) la importe
// directo, igual que crm/lib/amoblados.ts.

export type Via = "sofi" | "linea" | "grupo";

export type Post = {
  id: string;
  property_ref: string;
  group_id?: string | null;
  group_jid?: string | null;
  estado?: string | null;
  origen?: string | null;
  created_at: string;
};

export type Respuesta = {
  id: string;
  property_ref: string;
  publicacion_id?: string | null;
  group_id?: string | null;
  via: Via;
  colega_lid?: string | null;
  colega_telefono?: string | null;
  colega_nombre?: string | null;
  colega_clave: string;
  primer_texto?: string | null;
  primer_at: string;
  ultimo_entrante_at?: string | null;
  mensajes?: number | null;
  atendida_at?: string | null;
  atendida_por?: string | null;
  recordatorio_at?: string | null;
  puente_at?: string | null;
  seguimiento_at?: string | null;
  lead_id?: string | null;
};

export type Cita = { estado?: string | null; origen?: string | null; ref?: string | null; creada_at?: string | null } | null;
export type LeadConCita = { id: string; phone?: string | null; cita: Cita };

export type Propiedad = {
  ref: string;
  titulo?: string | null;
  tipo?: string | null;
  operacion?: string | null;
  precio?: string | null;
  images?: unknown;
};

export type Estado = "atendida" | "visita" | "seguimiento" | "link_sofi" | "recordatorio" | "sin_atender" | "nueva";
export type Categoria = "amoblado" | "venta" | "finca" | "otro";

const SIN_ATENDER_MS = 2 * 3600e3;

const enviado = (p: Post) => !p.estado || p.estado === "enviado";
const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);

// Una cita cancelada no es visita (mismo criterio que src/data/citas.js).
const citaViva = (c: Cita) => Boolean(c) && c!.estado !== "cancelada";

// Lo mas avanzado que paso con la respuesta. "visita" la calcula quien llama
// (visitasPorRespuesta): necesita los leads, que no estan en la fila.
// "nueva" = todavia dentro de las 2 h, sin nada hecho: no es alarma.
export function estadoDe(r: Respuesta, ahora: Date | number = Date.now(), conVisita = false): Estado {
  if (r.atendida_at) return "atendida";
  if (conVisita) return "visita";
  if (r.seguimiento_at) return "seguimiento";
  if (r.puente_at) return "link_sofi";
  if (r.recordatorio_at) return "recordatorio";
  const t = typeof ahora === "number" ? ahora : ahora.getTime();
  if (t - ms(r.primer_at) > SIN_ATENDER_MS) return "sin_atender";
  return "nueva";
}

// Sin atender = escribio por la linea o en el grupo (Sofi siempre contesta),
// nadie la marco atendida y ya pasaron 2 h.
export function sinAtender(r: Respuesta, ahora: Date | number = Date.now()): boolean {
  const t = typeof ahora === "number" ? ahora : ahora.getTime();
  return (r.via === "linea" || r.via === "grupo") && !r.atendida_at && t - ms(r.primer_at) > SIN_ATENDER_MS;
}

// Una visita cuenta si es de la linea (origen linea_dm) o si su ref es una
// de las publicadas. Opcional: solo las creadas desde `desde`.
export function esVisitaDePublicacion(l: LeadConCita, refs: Set<string>, desde?: Date | null): boolean {
  const c = l.cita;
  if (!citaViva(c)) return false;
  if (!(c!.origen === "linea_dm" || (c!.ref != null && refs.has(String(c!.ref))))) return false;
  if (desde && c!.creada_at && ms(c!.creada_at) < desde.getTime()) return false;
  return true;
}

const digitos = (s: string | null | undefined) => (s ? String(s).replace(/\D/g, "") : "");

// Que respuestas terminaron en visita: el lead ligado (lead_id) o el lead del
// mismo colega (telefono o lid; visita-linea.js crea el lead con
// telefono || lid) con una cita viva por esa ref o sin ref.
export function visitasPorRespuesta(respuestas: Respuesta[], leads: LeadConCita[]): Set<string> {
  const vivos = leads.filter((l) => citaViva(l.cita));
  const porId = new Map(vivos.map((l) => [l.id, l]));
  const porTel = new Map<string, LeadConCita[]>();
  for (const l of vivos) {
    const d = digitos(l.phone);
    if (!d) continue;
    porTel.set(d, [...(porTel.get(d) || []), l]);
  }
  const sirve = (l: LeadConCita, ref: string) => !l.cita!.ref || String(l.cita!.ref) === ref;
  const out = new Set<string>();
  for (const r of respuestas) {
    const ref = String(r.property_ref);
    const candidatos: LeadConCita[] = [];
    if (r.lead_id && porId.has(r.lead_id)) candidatos.push(porId.get(r.lead_id)!);
    for (const k of [digitos(r.colega_telefono), digitos(r.colega_lid)]) if (k) candidatos.push(...(porTel.get(k) || []));
    if (candidatos.some((l) => sirve(l, ref))) out.add(r.id);
  }
  return out;
}

export function resumen(
  posts: Post[],
  respuestas: Respuesta[],
  citas: LeadConCita[] = [],
  { ahora = Date.now(), desde = null }: { ahora?: Date | number; desde?: Date | null } = {}
) {
  const env = posts.filter(enviado);
  const refsPublicadas = new Set(env.map((p) => String(p.property_ref)));
  const refsConRespuesta = new Set(respuestas.map((r) => String(r.property_ref)).filter((r) => refsPublicadas.has(r)));
  const porVia = { sofi: 0, linea: 0, grupo: 0 };
  for (const r of respuestas) if (r.via in porVia) porVia[r.via]++;
  return {
    posts: env.length,
    grupos: new Set(env.map((p) => p.group_id || p.group_jid).filter(Boolean)).size,
    fichas: refsPublicadas.size,
    fichasConRespuesta: refsConRespuesta.size,
    respuestas: respuestas.length,
    colegas: new Set(respuestas.map((r) => r.colega_clave)).size,
    visitas: citas.filter((l) => esVisitaDePublicacion(l, refsPublicadas, desde)).length,
    pctConRespuesta: refsPublicadas.size ? Math.round((refsConRespuesta.size / refsPublicadas.size) * 100) : 0,
    porVia,
    sinAtender: respuestas.filter((r) => sinAtender(r, ahora)).length,
  };
}

export function fotoDe(p: Propiedad | undefined): string | null {
  const imgs = p && Array.isArray(p.images) ? (p.images as unknown[]) : [];
  for (const i of imgs) {
    if (typeof i === "string" && i) return i;
    if (i && typeof i === "object" && typeof (i as { url?: unknown }).url === "string") return (i as { url: string }).url;
  }
  return null;
}

// Las tres familias que publica el publicador: amoblados (arriendo), venta y
// fincas. Una finca gana sobre la operacion.
export function categoriaDe(p: Propiedad | undefined): Categoria {
  if (!p) return "otro";
  if (/finca/i.test(`${p.tipo || ""} ${p.titulo || ""}`)) return "finca";
  const op = (p.operacion || "").toLowerCase();
  if (op.startsWith("venta")) return "venta";
  if (op.startsWith("arriendo") || op.startsWith("alquiler")) return "amoblado";
  return "otro";
}

export type Ficha = {
  ref: string;
  titulo: string | null;
  tipo: string | null;
  precio: string | null;
  foto: string | null;
  categoria: Categoria;
  grupos: string[];
  posts: number;
  /** null: la respuesta llego en el periodo por un post de antes. */
  primera: string | null;
  ultima: string | null;
  origen: "auto" | "manual" | "mixto" | null;
  respuestas: Respuesta[];
};

// Una fila por ref: los grupos donde salio, primera y ultima hora, si fue
// automatico o a mano, y sus respuestas (la mas reciente primero). Una
// respuesta cuyo post es de antes del periodo igual aparece (con su ref).
export function agrupar(
  posts: Post[],
  respuestas: Respuesta[],
  propiedades: Propiedad[] = [],
  nombreGrupo: Record<string, string | null | undefined> = {}
): Ficha[] {
  const props = new Map(propiedades.map((p) => [String(p.ref), p]));
  const fichas = new Map<string, Ficha>();
  const fichaDe = (ref: string): Ficha => {
    let f = fichas.get(ref);
    if (!f) {
      const p = props.get(ref);
      f = {
        ref,
        titulo: p?.titulo ?? null,
        tipo: p?.tipo ?? null,
        precio: p?.precio ?? null,
        foto: fotoDe(p),
        categoria: categoriaDe(p),
        grupos: [],
        posts: 0,
        primera: null,
        ultima: null,
        origen: null,
        respuestas: [],
      };
      fichas.set(ref, f);
    }
    return f;
  };
  for (const p of posts.filter(enviado)) {
    const f = fichaDe(String(p.property_ref));
    f.posts++;
    const g = (p.group_id && nombreGrupo[p.group_id]) || p.group_jid || p.group_id || "Grupo sin nombre";
    if (!f.grupos.includes(g)) f.grupos.push(g);
    if (!f.primera || ms(p.created_at) < ms(f.primera)) f.primera = p.created_at;
    if (!f.ultima || ms(p.created_at) > ms(f.ultima)) f.ultima = p.created_at;
    const o = p.origen === "manual" ? "manual" : "auto";
    f.origen = f.origen === null ? o : f.origen === o ? o : "mixto";
  }
  for (const r of respuestas) fichaDe(String(r.property_ref)).respuestas.push(r);
  for (const f of fichas.values()) f.respuestas.sort((a, b) => ms(b.primer_at) - ms(a.primer_at));
  const orden = (f: Ficha) => Math.max(ms(f.ultima) || 0, ...f.respuestas.map((r) => ms(r.primer_at) || 0));
  return [...fichas.values()].sort((a, b) => orden(b) - orden(a));
}

// Para el lateral: cuantas respuestas trajo cada grupo (por group_id de la
// respuesta), de mayor a menor. Los grupos con posts y sin respuestas salen
// aparte en `sinRespuesta`.
export function gruposQueResponden(
  posts: Post[],
  respuestas: Respuesta[],
  nombreGrupo: Record<string, string | null | undefined> = {}
): { top: { nombre: string; n: number }[]; sinRespuesta: string[] } {
  const nombre = (id: string) => nombreGrupo[id] || id;
  const n = new Map<string, number>();
  for (const r of respuestas) if (r.group_id) n.set(r.group_id, (n.get(r.group_id) || 0) + 1);
  const conPost = new Set(posts.filter(enviado).map((p) => p.group_id).filter(Boolean) as string[]);
  return {
    top: [...n.entries()].map(([id, k]) => ({ nombre: nombre(id), n: k })).sort((a, b) => b.n - a.n),
    sinRespuesta: [...conPost].filter((id) => !n.has(id)).map(nombre),
  };
}
