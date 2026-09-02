"use client";

import { useMemo, useState } from "react";
import { fechaHora } from "@/lib/fecha";
import { formatearArea, formatearPrecio, pluralAlcobas } from "@/lib/formato";

export type Match = {
  fuente: string; // "diamond" (inventario propio) | "aliado" (red de colegas)
  ref: string | null;
  titulo?: string | null;
  zona?: string | null;
  precio?: string | null;
  operacion?: string | null;
  inmobiliaria?: string | null;
  /** Ficha en la landing de Diamond. Sólo el inventario propio la tiene. */
  link?: string | null;
  habitaciones?: number | null;
  area?: string | null;
  /** 0-100. Cuánto calza con lo pedido, no una probabilidad de venta. */
  puntaje?: number | null;
  /** Por qué calza, en palabras: "Zona: Laureles", "3 alcobas", "95 m²". */
  razones?: string[] | null;
};

export type Signal = {
  id: string;
  clase: "demanda" | "oferta";
  autor_nombre: string | null;
  autor_telefono: string | null;
  contacto: string | null;
  operacion: string | null;
  tipo: string | null;
  zona: string | null;
  precio_max: number | null;
  habitaciones: number | null;
  /* Las otras exigencias del pedido. Opcionales porque llegan con
     db/migrations/2026-08-24_group_signals_exigencias.sql: una señal anterior
     —o un entorno donde la migración todavía no corrió— simplemente no las
     trae, y el recuadro "Lo que pide" no dibuja esas filas. */
  area_min?: number | null;
  banos?: number | null;
  garajes?: number | null;
  estrato?: number | null;
  /** El pedido acepta una alcoba/baño/garaje menos ("3 alcobas o 2 con estudio"). */
  flexible_habitaciones?: boolean | null;
  texto_original: string | null;
  matches: Match[] | null;
  enviado_at: string | null;
  created_at: string;
  group_id: string;
  /** nuevo = falta mirarlo · gestionado = ya lo revisó una persona · descartado = no servía. */
  estado: "nuevo" | "gestionado" | "descartado";
  /** De qué grupo salió. Sin esto el asesor copia el borrador y no sabe dónde pegarlo. */
  grupo_nombre?: string | null;
  grupo_jid?: string | null;
  /** El último evento del recorrido, si ya se registró alguno. El historial
   *  completo vive en signal_events; acá solo se muestra en qué quedó. */
  ultimo_evento?: string | null;
  /** Si el radar en vivo ya redactó/publicó una respuesta para este pedido.
   *  "auto" = el bot la publicó en el grupo; "sombra" = la redactó pero no
   *  la publicó (prueba de humo). Ver src/groups/vivo.js#marcarRespondida. */
  respondida_at?: string | null;
  respuesta_texto?: string | null;
  respuesta_modo?: "auto" | "sombra" | null;
  /** Refs de las propiedades que quedaron DENTRO de respuesta_texto — un
   *  subconjunto de `matches`: el resto se descartó por la compuerta de
   *  calidad. Null en señales de antes del 2026-08-19. */
  respuesta_refs?: string[] | null;
};

/** El recorrido natural de una oportunidad. El orden es el del embudo, no
 *  alfabético: el asesor marca por dónde va, no elige de una lista. */
export const RECORRIDO = [
  { tipo: "CONVERSACION", etiqueta: "Le escribí", ayuda: "Contactaste al colega" },
  { tipo: "VISITA", etiqueta: "Hubo visita", ayuda: "Su cliente vio la propiedad" },
  { tipo: "NEGOCIACION", etiqueta: "En negociación", ayuda: "Están hablando de precio" },
  { tipo: "CIERRE", etiqueta: "Se cerró 🎉", ayuda: "Terminó en negocio" },
] as const;

/** Los dos finales que no son cierre. Van aparte porque preguntan el motivo:
 *  un fracaso sin motivo no enseña nada. */
export const FINALES = [
  { tipo: "SIN_RESPUESTA", etiqueta: "No contestó" },
  { tipo: "PERDIDO", etiqueta: "Se perdió" },
] as const;

const ETIQUETA_EVENTO: Record<string, string> = {
  CONVERSACION: "Le escribiste",
  VISITA: "Hubo visita",
  NEGOCIACION: "En negociación",
  CIERRE: "Cerrado 🎉",
  SIN_RESPUESTA: "No contestó",
  PERDIDO: "Se perdió",
  DESCARTADO: "Descartada",
};

/**
 * WhatsApp NO tiene forma de abrir por link un grupo del que ya sos miembro.
 * `wa.me/<número>` sirve sólo para personas; lo único que existe para grupos es
 * el link de invitación (chat.whatsapp.com/CODIGO), que hay que ser admin para
 * generar y que además es un link para ENTRAR, no para abrir el chat.
 *
 * Así que el flujo honesto es: copiar el mensaje, abrir WhatsApp Web y buscar
 * el grupo por nombre. Todo lo que podemos hacer es que ese último paso sea un
 * pegar en vez de un "¿cuál era?".
 */
const WHATSAPP_WEB = "https://web.whatsapp.com";

// Lo que puede devolver vivo.js#responderPorDmManual, traducido a algo que un
// asesor entienda sin tener que leer un log (Juan, 2026-08-24: "que muestre
// el resultado, no un silencio"). Cualquier resultado que no esté en esta
// lista cae al genérico de abajo — nunca se deja de mostrar algo.
const MENSAJE_RESULTADO_DM: Record<string, string> = {
  dm_enviado: "Listo: se le mandó el DM directo al colega.",
  sin_telefono: "No se pudo resolver el número del colega (WhatsApp lo esconde). Escribile a mano en el grupo.",
  sin_sesion: "No hay una línea de WhatsApp lista para mandar el DM.",
  sin_propiedades_publicables: "Ninguna propiedad pasa el control de calidad ahora mismo (el inventario pudo cambiar).",
  sin_texto: "No se pudo armar el mensaje.",
  limite_colega_alcanzado: "Ya se le mandó un DM a este colega hoy — no se manda un segundo.",
  limite_colega_no_verificable: "No se pudo verificar el límite de mensajes al colega; por seguridad, no se mandó nada.",
  limite_linea_alcanzado: "Se llegó al tope diario de mensajes de la línea.",
  limite_linea_no_verificable: "No se pudo verificar el tope diario de la línea; por seguridad, no se mandó nada.",
  error_envio: "El envío falló. Se puede volver a intentar.",
  ya_respondida: "Este pedido ya tiene una respuesta registrada.",
  no_es_demanda: "Esto no es un pedido (demanda).",
  no_encontrada: "No se encontró la señal.",
  grupo_no_encontrado: "No se encontró el grupo de este pedido.",
};

function mensajeResultadoDm(resultado: string): string {
  return MENSAJE_RESULTADO_DM[resultado] || `Resultado: ${resultado}`;
}

const pesos = (n: number | null) => (n && n > 0 ? `$${n.toLocaleString("es-CO")}` : null);

/**
 * WhatsApp dejó de exponer el número real de los participantes de un grupo: en
 * su lugar manda un identificador interno (LID) que NO sirve para escribirle a
 * nadie. Un número colombiano son 12 dígitos que empiezan en 57; los LID traen
 * 14 o 15 y empiezan en cualquier cosa.
 *
 * Mostrar un LID como si fuera un teléfono es peor que no mostrar nada: el
 * asesor lo marca, no existe, y pierde el negocio creyendo que el dato estaba.
 */
function telefonoUsable(v: string | null): string | null {
  if (!v) return null;
  const limpio = v.replace(/\D/g, "");
  return /^57\d{10}$/.test(limpio) ? limpio : null;
}

function Fuente({ fuente }: { fuente: string }) {
  const propio = fuente === "diamond";
  return (
    <span
      className={[
        "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        propio ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800",
      ].join(" ")}
      title={
        propio
          ? "Inventario propio de Diamond"
          : "Propiedad de otra inmobiliaria detectada en los grupos. Confirmá disponibilidad antes de ofrecerla."
      }
    >
      {propio ? "propio" : "aliado"}
    </span>
  );
}

/**
 * El borrador que el asesor le pega al colega.
 *
 * Sólo entra el inventario PROPIO: ofrecer la propiedad de un tercer colega es
 * meter a Diamond de intermediaria en un negocio ajeno. Y cada línea lleva el
 * link de la landing de Diamond, no el de Wasi — el colega abre nuestra ficha,
 * con nuestra marca.
 *
 * El link NO va acompañado de una invitación a coordinar la visita (Juan,
 * 2026-07-29): esa misma ficha es la que se comparte con el cliente final, y
 * programar la visita implica dar información de contacto — eso lo maneja el
 * asesor en persona, no un mensaje armado por Sofi. El borrador se limita a
 * mostrar qué hay disponible y los términos de comisión; el resto de la
 * conversación con el colega la lleva el asesor.
 *
 * SELECCIÓN MANUAL (Juan, 2026-08-24): el primer DM manual real mandó las 3
 * propiedades que calzaban cuando el usuario sólo quería que saliera una —
 * "no tuvo forma de elegir". Esta misma función arma también el preview de
 * lo que va a salir en el DM (ver <Ficha>): recibe ya filtrado por lo que el
 * usuario marcó, en vez de reescribir la lógica de armar el texto en un
 * segundo lugar.
 */
function borrador(s: Signal, matches: Match[]) {
  const propios = matches.filter((m) => m.fuente === "diamond");
  if (propios.length === 0) return "";

  const quien = s.autor_nombre ? `Hola ${s.autor_nombre.split(" ")[0]}, ` : "Hola, ";
  // Los valores pasan por el mismo formateo que usa el radar en vivo. Antes se
  // imprimían crudos —la columna `precio` es TEXT y trae lo que alguien tecleó
  // en Wasi— así que un "$0" o un typo salían tal cual. Este texto lo copia un
  // asesor y lo pega en un grupo de 80 competidores: es igual de público que el
  // automático y merece el mismo cuidado.
  const lineas = propios.map((m) => {
    const ficha = [
      m.zona,
      pluralAlcobas(m.habitaciones),
      formatearArea(m.area),
      formatearPrecio(m.precio),
    ]
      .filter(Boolean)
      .join(" · ");
    const encabezado = [m.ref ? `Ref ${m.ref}` : null, m.titulo || "Propiedad"].filter(Boolean).join(" · ");
    return `• ${encabezado}\n  ${ficha}${m.link ? `\n  ${m.link}` : ""}`;
  });

  return (
    `${quien}vi tu solicitud en el grupo. Tengo esto disponible que te puede servir:\n\n` +
    `${lineas.join("\n\n")}\n\n` +
    `Comisión compartida.`
  );
}

function Ficha({ s, copias, grupos }: { s: Signal; copias: number; grupos: number }) {
  // Arranca abierta (Juan, 2026-09-02): "las entradas deben traer la
  // tarjeta del pedido mas los links de las propuestas, para ver cada uno
  // de los pedidos mas facil" -- un clic extra por pedido para ver que le
  // podemos ofrecer al colega no aportaba nada.
  const [abierta, setAbierta] = useState(true);
  const [copiado, setCopiado] = useState<"mensaje" | "grupo" | null>(null);
  // Optimista: marcar es una acción de un clic y esperar el viaje al servidor
  // para pintar el check se siente roto. Si falla, se revierte y se avisa.
  const [estado, setEstado] = useState(s.estado);
  const [guardando, setGuardando] = useState(false);
  const [errorEstado, setErrorEstado] = useState<string | null>(null);

  // SELECCIÓN MANUAL para el DM (Juan, 2026-08-24): "se fueron las 3
  // propiedades y solo una servía. No tuvo forma de elegir" — caso real, el
  // primer DM manual que salió a producción. Sólo el inventario propio puede
  // terminar en el DM (la compuerta de calidad del bot ya descarta todo lo
  // que no sea "diamond"), así que sólo esas llevan casilla.
  //
  // Arranca con TODAS marcadas: el comportamiento de quien no toca nada
  // sigue siendo "mandar todo lo publicable", igual que antes de este
  // cambio.
  const propiosSeleccionables = (s.matches || []).filter((m) => m.fuente === "diamond" && m.ref);
  const [refsSeleccionadas, setRefsSeleccionadas] = useState<Set<string>>(
    () => new Set(propiosSeleccionables.map((m) => String(m.ref)))
  );

  function alternarSeleccion(ref: string) {
    setRefsSeleccionadas((previo) => {
      const siguiente = new Set(previo);
      if (siguiente.has(ref)) siguiente.delete(ref);
      else siguiente.add(ref);
      return siguiente;
    });
  }

  async function marcar(nuevo: "gestionado" | "descartado" | "nuevo") {
    const previo = estado;
    setEstado(nuevo);
    setGuardando(true);
    setErrorEstado(null);
    try {
      const res = await fetch("/api/grupos/senal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: s.id, estado: nuevo }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "No se pudo guardar");
    } catch (e) {
      setEstado(previo);
      setErrorEstado(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }
  // En qué terminó esta oportunidad. Es el último eslabón de la cadena de
  // aprendizaje y el único que no se puede reconstruir después: nadie va a
  // recordar dentro de seis meses si este pedido llegó a visita.
  //
  // Cada registro AGREGA un evento, nunca reemplaza el anterior. Por eso el
  // estado local guarda solo el último, pero el servidor conserva el recorrido.
  const [ultimoEvento, setUltimoEvento] = useState<string | null>(s.ultimo_evento ?? null);
  const [registrando, setRegistrando] = useState(false);

  async function registrarEvento(tipo: string) {
    // Un final sin motivo enseña la mitad. Se pregunta solo cuando no salió.
    let motivo: string | null = null;
    if (tipo === "PERDIDO" || tipo === "SIN_RESPUESTA") {
      motivo = prompt("¿Por qué no salió? (opcional, pero es lo que más enseña)") || null;
    }
    setRegistrando(true);
    setErrorEstado(null);
    try {
      const res = await fetch("/api/grupos/evento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signalId: s.id, tipo, motivo }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "No se pudo registrar");
      setUltimoEvento(tipo);
    } catch (e) {
      setErrorEstado(e instanceof Error ? e.message : "No se pudo registrar");
    } finally {
      setRegistrando(false);
    }
  }

  // DM manual al colega, desde el CRM (Juan, 2026-08-24): para un pedido que
  // quedó sin responder por DM -- entró cuando la org estaba en otro modo, o
  // salió de la ventana de antigüedad y se decide mandarlo igual. Ver la nota
  // de diseño grande en src/groups/vivo.js#responderPorDmManual.
  //
  // "enviando" bloquea el botón para no disparar dos veces el mismo pedido
  // mientras el viaje al servidor está en curso; "enviado" lo deja bloqueado
  // después de un éxito real, porque volver a tocarlo chocaría con el límite
  // de una vez por colega por día -- no hay nada que ganar reintentando.
  const [dmEstado, setDmEstado] = useState<"idle" | "enviando" | "enviado" | "error">("idle");
  const [dmMensaje, setDmMensaje] = useState<string | null>(null);

  async function responderPorDm() {
    // Nunca con cero seleccionadas (Juan, 2026-08-24): mandar sin decir nada
    // se leería como "todas", que es justo el comportamiento que este cambio
    // vino a corregir.
    if (refsSeleccionadas.size === 0) return;
    setDmEstado("enviando");
    setDmMensaje(null);
    try {
      const res = await fetch("/api/grupos/responder-dm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signalId: s.id, refs: Array.from(refsSeleccionadas) }),
      });
      const datos = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(datos.error || "No se pudo mandar el DM");
      // Elegir una propiedad no la exime de la compuerta de calidad del bot
      // (zona, precio, sync viejo, etc): si algo de lo elegido no pasó, el
      // resultado lo tiene que decir, no fallar en silencio.
      const descartadas = Array.isArray(datos.descartados) ? datos.descartados : [];
      const notaDescartadas = descartadas.length
        ? ` (${descartadas.length === 1 ? "una propiedad elegida no se mandó" : `${descartadas.length} propiedades elegidas no se mandaron`}: no pasan el control de calidad ahora mismo)`
        : "";
      setDmMensaje(`${mensajeResultadoDm(datos.resultado)}${notaDescartadas}`);
      setDmEstado(datos.resultado === "dm_enviado" ? "enviado" : "error");
    } catch (e) {
      setDmMensaje(e instanceof Error ? e.message : "No se pudo mandar el DM");
      setDmEstado("error");
    }
  }

  const matches = s.matches || [];
  const tel = telefonoUsable(s.autor_telefono);

  const extraido = [
    s.operacion, s.tipo, s.zona,
    s.habitaciones ? `${s.habitaciones} alc` : null,
    // Sólo los que el colega mencionó: el resumen de una línea se lee de un
    // vistazo y no puede crecer con filas vacías.
    s.area_min ? `${s.area_min} m²` : null,
    s.banos ? `${s.banos} baños` : null,
    s.garajes ? `${s.garajes} gj` : null,
    pesos(s.precio_max),
  ]
    .filter(Boolean)
    .join(" · ");

  const propios = matches.filter((m) => m.fuente === "diamond").length;
  // Lo que de verdad va a salir en el DM/mensaje: inventario propio y, si
  // tiene ref (todo lo publicable la tiene), sólo lo que quedó marcado en
  // `refsSeleccionadas`. Un match propio sin ref (no debería pasar nunca la
  // compuerta de calidad del bot) se deja tal cual antes de este cambio, en
  // vez de desaparecer sin que haya como seleccionarlo.
  const matchesSeleccionados = matches.filter(
    (m) => m.fuente === "diamond" && (!m.ref || refsSeleccionadas.has(String(m.ref)))
  );
  const texto = borrador(s, matchesSeleccionados);

  async function copiar(que: "mensaje" | "grupo") {
    const contenido = que === "mensaje" ? texto : s.grupo_nombre || "";
    if (!contenido) return;
    try {
      await navigator.clipboard.writeText(contenido);
      setCopiado(que);
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      /* sin portapapeles: el dato igual está a la vista */
    }
  }

  return (
    <li className="border-b border-slate-100 py-3 last:border-0">
      <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-500">
        <span className="font-medium text-slate-700">{s.autor_nombre || "Colega"}</span>
        {tel ? (
          <a
            href={`https://wa.me/${tel}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-emerald-700 hover:underline"
          >
            +{tel}
          </a>
        ) : (
          <span className="text-slate-400" title="WhatsApp ya no expone el número de los participantes de un grupo; manda un identificador interno que no sirve para escribir.">
            número oculto por WhatsApp
          </span>
        )}
        <span>{fechaHora(s.created_at)}</span>
        {/* El grupo, arriba y siempre visible: es el dato que decide a dónde
            va la respuesta. */}
        <span
          className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-800"
          title={s.grupo_nombre ? `Grupo: ${s.grupo_nombre}` : `Grupo sin nombre sincronizado (${s.grupo_jid || "?"})`}
        >
          {s.grupo_nombre || "grupo sin nombre"}
        </span>
        {/* Con volumen alto, sin marca de "ya lo miré" se vuelven a leer los
            mismos pedidos todos los días y los nuevos se pierden entre ellos. */}
        {estado === "gestionado" && (
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
            ✓ Validado
          </span>
        )}
        {estado === "descartado" && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
            Descartado
          </span>
        )}
        {copias > 1 && (
          <span
            className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
            title="El colega publicó el mismo aviso en varios grupos. Se muestra una sola vez."
          >
            en {grupos} grupo{grupos > 1 ? "s" : ""}
          </span>
        )}
        {s.enviado_at && (
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700" title={`Aviso enviado al asesor el ${fechaHora(s.enviado_at)}`}>
            avisado
          </span>
        )}
        {/* Distingue lo que decidió el bot solo (auto) de lo que solo se
            redactó para revisar (sombra) — sin esto, ambos se ven igual que
            un pedido nunca procesado. */}
        {s.respondida_at && s.respuesta_modo === "auto" && (
          <span
            className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800"
            title={`Publicado automáticamente por el bot el ${fechaHora(s.respondida_at)}${s.respuesta_texto ? `:\n\n${s.respuesta_texto}` : ""}`}
          >
            🤖 respondido en automático
          </span>
        )}
        {s.respondida_at && s.respuesta_modo === "sombra" && (
          <span
            className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500"
            title={`Redactado en modo sombra (no se publicó) el ${fechaHora(s.respondida_at)}${s.respuesta_texto ? `:\n\n${s.respuesta_texto}` : ""}`}
          >
            redactado (sombra)
          </span>
        )}
      </div>

      <p className="mt-0.5 text-sm text-slate-800">{s.texto_original}</p>
      {extraido && <p className="mt-1 text-xs text-slate-500">{extraido}</p>}

      {s.clase === "demanda" && (
        <div className="mt-1.5">
          {matches.length === 0 ? (
            // Distinguir "no hay nada que calce" de "el pedido no dice dónde"
            // importa: lo segundo es un pedido que vale la pena responder a
            // mano preguntándole la zona al colega.
            <span className="text-xs text-slate-400">
              {s.zona ? "sin match en inventario" : "el pedido no dice zona — no se puede cruzar"}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setAbierta((v) => !v)}
              className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
            >
              {abierta ? "▾" : "▸"} {matches.length} match{matches.length > 1 ? "es" : ""}
              {propios > 0 && ` · ${propios} de inventario propio`}
            </button>
          )}

          {abierta && matches.length > 0 && (
            <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3">
              {/* Lo pedido a la izquierda, lo que calza a la derecha: sin el
                  pedido al lado hay que acordarse de qué buscaba el colega
                  mientras se leen seis propiedades. */}
              <div className="grid gap-3 md:grid-cols-[minmax(0,13rem)_1fr]">
                <div className="rounded-md border border-slate-200 bg-white p-2.5">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Lo que pide
                  </p>
                  <dl className="space-y-0.5 text-xs">
                    {[
                      ["Operación", s.operacion],
                      ["Tipo", s.tipo],
                      ["Zona", s.zona],
                      ["Hasta", pesos(s.precio_max)],
                      /* Hasta el 2026-08-24 el recuadro terminaba en Alcobas,
                         aunque el motor puntuara con cuatro exigencias más.
                         Catherine leía un pedido recortado: en el de Edwin
                         Ramírez faltaban los 98 m², los 2 baños y los 2
                         garajes, y al lado una propiedad decía "1 garaje
                         (pediste 2)" sin que el pedido mencionara garajes. */
                      [
                        "Alcobas",
                        s.habitaciones
                          ? `${s.habitaciones}${s.flexible_habitaciones ? " (o una menos)" : ""}`
                          : null,
                      ],
                      ["Área mín.", s.area_min ? `${s.area_min} m²` : null],
                      ["Baños", s.banos ? `${s.banos}` : null],
                      ["Garajes", s.garajes ? `${s.garajes}` : null],
                      ["Estrato", s.estrato ? `${s.estrato}` : null],
                    ]
                      .filter(([, v]) => v)
                      .map(([k, v]) => (
                        <div key={k as string} className="flex justify-between gap-2">
                          <dt className="text-slate-500">{k}</dt>
                          <dd className="text-right font-medium text-slate-800">{v}</dd>
                        </div>
                      ))}
                  </dl>
                </div>

                <ul className="space-y-2">
                  {matches.map((m, i) => (
                    <li key={i} className="rounded-md border border-slate-200 bg-white p-2.5">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        {/* Sólo el inventario propio puede terminar en el DM
                            -- la compuerta de calidad del bot descarta todo
                            lo que no sea "diamond", así que ofrecer marcar un
                            aliado sería una casilla que nunca hace nada. */}
                        {m.fuente === "diamond" && m.ref && (
                          <input
                            type="checkbox"
                            checked={refsSeleccionadas.has(String(m.ref))}
                            onChange={() => alternarSeleccion(String(m.ref))}
                            className="h-3.5 w-3.5 rounded border-slate-300"
                            title="Incluir esta propiedad en el DM al colega"
                          />
                        )}
                        <Fuente fuente={m.fuente} />
                        {/* El link SIEMPRE es la ficha de la landing propia.
                            Mandar al colega a Wasi es regalarle la marca. */}
                        {m.link ? (
                          <a
                            href={m.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium text-slate-900 hover:underline"
                          >
                            {m.titulo || "Ver ficha"} ↗
                          </a>
                        ) : (
                          <span className="text-sm font-medium text-slate-900">{m.titulo || "Sin título"}</span>
                        )}
                        {m.ref && <span className="font-mono text-[11px] text-slate-400">ref {m.ref}</span>}
                        {/* Cuál de estos matches quedó de verdad dentro del mensaje que
                            se publicó — el resto se vio pero lo descartó la compuerta
                            de calidad (puntaje, precio, link roto, etc). */}
                        {m.ref && s.respuesta_refs?.includes(String(m.ref)) && (
                          <span
                            className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800"
                            title="Esta propiedad quedó dentro del mensaje que el bot respondió"
                          >
                            📤 enviado
                          </span>
                        )}
                        {typeof m.puntaje === "number" && (
                          <span
                            className={[
                              "ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold",
                              m.puntaje >= 80 ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600",
                            ].join(" ")}
                            title="Cuánto calza con lo pedido. No es probabilidad de venta."
                          >
                            {m.puntaje}%
                          </span>
                        )}
                      </div>
                      {m.inmobiliaria && (
                        <p className="mt-0.5 text-[11px] text-slate-500">de {m.inmobiliaria}</p>
                      )}
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {(m.razones || []).map((r) => (
                          <span key={r} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
                            {r}
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-2">
                {texto ? (
                  <div className="w-full">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => copiar("mensaje")}
                        className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white"
                      >
                        {copiado === "mensaje" ? "¡Copiado!" : "Copiar mensaje con los links"}
                      </button>
                      {tel && (
                        <a
                          href={`https://wa.me/${tel}?text=${encodeURIComponent(texto)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-white"
                          title="Chat privado con el colega. Para el grupo, usá el bloque de abajo."
                        >
                          Escribirle en privado
                        </a>
                      )}
                    </div>

                    {/* DM automático al colega desde el CRM (Juan, 2026-08-24):
                        para un pedido que quedó sin responder por DM -- ver la
                        nota grande en src/groups/vivo.js#responderPorDmManual.
                        Solo tiene sentido si todavía no hay respuesta. */}
                    {!s.respondida_at && (
                      <div className="mt-2 rounded-md border border-violet-200 bg-violet-50 p-2.5">
                        <p className="text-[11px] font-semibold text-violet-900">
                          Sofi puede mandarle este mismo mensaje directo al privado del colega.
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={responderPorDm}
                            disabled={dmEstado === "enviando" || dmEstado === "enviado" || refsSeleccionadas.size === 0}
                            className="rounded-md bg-violet-700 px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-40"
                          >
                            {dmEstado === "enviando"
                              ? "Enviando…"
                              : dmEstado === "enviado"
                                ? "🤖 DM enviado"
                                : "Mandar DM automático"}
                          </button>
                          {dmMensaje && (
                            <span className={`text-[11px] ${dmEstado === "error" ? "text-red-700" : "text-violet-800"}`}>
                              {dmMensaje}
                            </span>
                          )}
                        </div>
                        {/* "que no se pueda mandar con cero seleccionadas"
                            (Juan, 2026-08-24): el botón ya queda deshabilitado
                            arriba, pero sin este texto no queda claro POR QUÉ. */}
                        {refsSeleccionadas.size === 0 && (
                          <p className="mt-1 text-[11px] text-violet-700">
                            Marcá al menos una propiedad de la lista de arriba para poder mandar el DM.
                          </p>
                        )}
                      </div>
                    )}

                    {/* Responder EN EL GRUPO. WhatsApp no permite abrir por link
                        un grupo del que ya sos miembro, así que el último paso
                        es buscarlo por nombre — y para eso el nombre se copia. */}
                    <div className="mt-2 rounded-md border border-indigo-200 bg-indigo-50 p-2.5">
                      <p className="text-[11px] font-semibold text-indigo-900">
                        Para responder en el grupo:{" "}
                        <span className="font-bold">{s.grupo_nombre || "(grupo sin nombre sincronizado)"}</span>
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => copiar("grupo")}
                          disabled={!s.grupo_nombre}
                          className="rounded-md border border-indigo-300 bg-white px-2.5 py-1 text-[11px] font-medium text-indigo-800 disabled:opacity-40"
                          title="Copia el nombre para pegarlo en el buscador de WhatsApp Web"
                        >
                          {copiado === "grupo" ? "¡Nombre copiado!" : "Copiar nombre del grupo"}
                        </button>
                        <a
                          href={WHATSAPP_WEB}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-md border border-indigo-300 bg-white px-2.5 py-1 text-[11px] font-medium text-indigo-800"
                        >
                          Abrir WhatsApp Web ↗
                        </a>
                        <span className="text-[11px] text-indigo-700">
                          Buscá el grupo, pegá el mensaje y enviá vos.
                        </span>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-2">
                      {estado === "nuevo" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => marcar("gestionado")}
                            disabled={guardando}
                            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                          >
                            {guardando ? "Guardando…" : "✓ Marcar como validado"}
                          </button>
                          <button
                            type="button"
                            onClick={() => marcar("descartado")}
                            disabled={guardando}
                            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 disabled:opacity-40"
                          >
                            No sirve
                          </button>
                          <span className="text-[11px] text-slate-500">
                            Queda marcado para no volver a revisarlo. No se borra nada.
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="text-[11px] font-medium text-slate-600">
                            {estado === "gestionado" ? "Ya revisado." : "Marcado como que no sirve."}
                          </span>
                          <button
                            type="button"
                            onClick={() => marcar("nuevo")}
                            disabled={guardando}
                            className="rounded-md border border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-600 disabled:opacity-40"
                          >
                            Volver a marcarlo como pendiente
                          </button>
                        </>
                      )}
                    </div>
                    {/* En qué terminó. Solo tiene sentido en un pedido con
                        match: es el único sobre el que hay algo que hacer. */}
                    {s.clase === "demanda" && matches.length > 0 && (
                      <div className="mt-2 border-t border-slate-200 pt-2">
                        <p className="mb-1.5 text-[11px] font-medium text-slate-700">
                          ¿En qué terminó?{" "}
                          <span className="font-normal text-slate-500">
                            Marcá por dónde va. Podés marcar varias veces a medida que avanza.
                          </span>
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {RECORRIDO.map((e) => (
                            <button
                              key={e.tipo}
                              type="button"
                              title={e.ayuda}
                              onClick={() => registrarEvento(e.tipo)}
                              disabled={registrando}
                              className={`rounded-md border px-2.5 py-1 text-[11px] font-medium disabled:opacity-40 ${
                                ultimoEvento === e.tipo
                                  ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                                  : "border-slate-300 text-slate-600 hover:bg-slate-50"
                              }`}
                            >
                              {e.etiqueta}
                            </button>
                          ))}
                          <span className="mx-1 text-slate-300">|</span>
                          {FINALES.map((e) => (
                            <button
                              key={e.tipo}
                              type="button"
                              onClick={() => registrarEvento(e.tipo)}
                              disabled={registrando}
                              className={`rounded-md border px-2.5 py-1 text-[11px] font-medium disabled:opacity-40 ${
                                ultimoEvento === e.tipo
                                  ? "border-amber-500 bg-amber-50 text-amber-800"
                                  : "border-slate-300 text-slate-500 hover:bg-slate-50"
                              }`}
                            >
                              {e.etiqueta}
                            </button>
                          ))}
                        </div>
                        {ultimoEvento && (
                          <p className="mt-1.5 text-[11px] text-slate-500">
                            Última marca: <strong>{ETIQUETA_EVENTO[ultimoEvento] ?? ultimoEvento}</strong>.
                            Queda registrada con su fecha; nada se sobreescribe.
                          </p>
                        )}
                      </div>
                    )}

                    {errorEstado && (
                      <p className="mt-1.5 rounded-md bg-red-50 px-3 py-2 text-[11px] text-red-700">{errorEstado}</p>
                    )}

                    <p className="mt-1.5 text-[11px] text-slate-500">
                      Sofi nunca publica en el grupo: si resuelve el número del colega, le escribe por
                      privado (solo o cuando se lo pedís desde acá); si no lo resuelve, el mensaje sale
                      de la línea del asesor, escrito por una persona.
                    </p>
                  </div>
                ) : propios > 0 ? (
                  // Distinto del caso de abajo (Juan, 2026-08-24): acá SÍ hay
                  // inventario propio, sólo que el usuario desmarcó todas las
                  // casillas. Decir "es de la red de aliados" sería mentira.
                  <span className="text-[11px] text-amber-700">
                    Desmarcaste todas las propiedades — marcá al menos una arriba para armar el mensaje.
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-500">
                    Todo lo que calza es de la red de aliados, no inventario propio: no hay borrador
                    que mandar. Primero confirmá disponibilidad con esa inmobiliaria.
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function SenalesGrupos({
  senales,
  clase,
  vacio,
}: {
  senales: Signal[];
  clase: "demanda" | "oferta";
  vacio: string;
}) {
  // Las demandas arrancan filtradas: una demanda sin match no es accionable, y
  // ver 200 pedidos para encontrar los 4 que se pueden atender es lo mismo que
  // no tener la pantalla.
  const [soloMatch, setSoloMatch] = useState(clase === "demanda");

  // Los colegas difunden el mismo aviso a muchos grupos. El dedup nuevo lo corta
  // en la entrada, pero lo ya guardado antes de ese arreglo sigue en la tabla,
  // así que la pantalla también colapsa por (autor + texto).
  const filas = useMemo(() => {
    const porContenido = new Map<string, { s: Signal; copias: number; grupos: Set<string> }>();
    for (const s of senales) {
      const k = `${s.autor_nombre || ""}|${(s.texto_original || "").trim().toLowerCase()}`;
      const ya = porContenido.get(k);
      if (ya) {
        ya.copias++;
        ya.grupos.add(s.id);
        // Se conserva la copia con más matches: las otras son la misma cosa.
        if ((s.matches || []).length > (ya.s.matches || []).length) ya.s = s;
      } else {
        porContenido.set(k, { s, copias: 1, grupos: new Set([s.id]) });
      }
    }
    const todas = [...porContenido.values()];
    return soloMatch ? todas.filter((f) => (f.s.matches || []).length > 0) : todas;
  }, [senales, soloMatch]);

  const conMatch = useMemo(
    () => new Set(senales.filter((s) => (s.matches || []).length > 0).map((s) => s.id)).size,
    [senales]
  );

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
        <label className="flex cursor-pointer items-center gap-1.5 text-slate-600">
          <input
            type="checkbox"
            checked={soloMatch}
            onChange={(e) => setSoloMatch(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
          Sólo los que tienen match
        </label>
        <span className="text-slate-400">
          {filas.length} de {senales.length} · {conMatch} con match
        </span>
      </div>

      <ul className="rounded-lg border border-slate-200 bg-white px-4">
        {filas.length === 0 ? (
          <li className="py-4 text-sm italic text-slate-400">
            {senales.length > 0 && soloMatch
              ? "Ninguno tiene match con el inventario. Destildá el filtro para verlos todos."
              : vacio}
          </li>
        ) : (
          filas.map((f) => <Ficha key={f.s.id} s={f.s} copias={f.copias} grupos={f.grupos.size} />)
        )}
      </ul>
    </>
  );
}
