"use client";

import { useMemo, useState } from "react";
import { fechaHora } from "@/lib/fecha";

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
  texto_original: string | null;
  matches: Match[] | null;
  enviado_at: string | null;
  created_at: string;
  group_id: string;
  /** De qué grupo salió. Sin esto el asesor copia el borrador y no sabe dónde pegarlo. */
  grupo_nombre?: string | null;
  grupo_jid?: string | null;
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
 */
function borrador(s: Signal, matches: Match[]) {
  const propios = matches.filter((m) => m.fuente === "diamond");
  if (propios.length === 0) return "";

  const quien = s.autor_nombre ? `Hola ${s.autor_nombre.split(" ")[0]}, ` : "Hola, ";
  const lineas = propios.map((m) => {
    const ficha = [m.zona, m.habitaciones ? `${m.habitaciones} alcobas` : null, m.area, m.precio]
      .filter(Boolean)
      .join(" · ");
    return `• ${m.titulo || "Propiedad"}\n  ${ficha}${m.link ? `\n  ${m.link}` : ""}`;
  });

  return (
    `${quien}vi tu solicitud en el grupo. Tengo esto disponible que te puede servir:\n\n` +
    `${lineas.join("\n\n")}\n\n` +
    `Si te sirve alguno coordinamos la visita. Comisión compartida 50/50.`
  );
}

function Ficha({ s, copias, grupos }: { s: Signal; copias: number; grupos: number }) {
  const [abierta, setAbierta] = useState(false);
  const [copiado, setCopiado] = useState<"mensaje" | "grupo" | null>(null);
  const matches = s.matches || [];
  const tel = telefonoUsable(s.autor_telefono);

  const extraido = [s.operacion, s.tipo, s.zona, s.habitaciones ? `${s.habitaciones} alc` : null, pesos(s.precio_max)]
    .filter(Boolean)
    .join(" · ");

  const propios = matches.filter((m) => m.fuente === "diamond").length;
  const texto = borrador(s, matches);

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
                      ["Alcobas", s.habitaciones ? `${s.habitaciones}` : null],
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

                    <p className="mt-1.5 text-[11px] text-slate-500">
                      Sofi nunca publica en el grupo: el mensaje sale de la línea del asesor, escrito
                      por una persona.
                    </p>
                  </div>
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
