"use client";

import { useEffect, useState } from "react";

type Etiqueta = { texto: string; reciente: boolean };
type Item = {
  ref: string;
  titulo: string | null;
  zona: string | null;
  operacion: string;
  area: string | null;
  habitaciones: number | null;
  precio: string | null;
  foto: string;
  etiqueta: Etiqueta;
};
type Lista = {
  fresco: boolean;
  horas: number | null;
  items: Item[];
  kpis: { compartidasSemana: number | null; clientesSemana: number | null; listas: number } | null;
};
type Post = { texto: string; fotos: string[]; linkOk: boolean };

const ZONAS = ["Envigado", "El Poblado", "Laureles", "Sabaneta", "Itagüí", "Belén"];

async function kitApi<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/kit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Error del servidor");
  return data as T;
}

async function fotosComoArchivos(ref: string, cantidad: number): Promise<File[]> {
  const archivos = await Promise.all(
    Array.from({ length: cantidad }, async (_, i) => {
      const res = await fetch(`/api/kit/foto?ref=${encodeURIComponent(ref)}&i=${i}`).catch(() => null);
      if (!res || !res.ok) return null;
      const blob = await res.blob();
      const ext = blob.type.split("/")[1] || "jpg";
      return new File([blob], `ref-${ref}-${i + 1}.${ext}`, { type: blob.type });
    })
  );
  return archivos.filter((f): f is File => f !== null);
}

export default function KitPublicacion() {
  const [operacion, setOperacion] = useState<"Venta" | "Arriendo">("Venta");
  const [zona, setZona] = useState<string | null>(null);
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elegida, setElegida] = useState<Item | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let cancelado = false; // evita que una respuesta vieja pise a una nueva
    setLista(null);
    setError(null);
    kitApi<Lista>({ action: "propiedades", operacion, zona })
      .then((l) => {
        if (!cancelado) setLista(l);
      })
      .catch((e) => {
        if (!cancelado) setError((e as Error).message);
      });
    return () => {
      cancelado = true;
    };
  }, [operacion, zona, recarga]);

  if (elegida) {
    return (
      <FichaPost
        item={elegida}
        onVolver={() => {
          setElegida(null);
          setRecarga((n) => n + 1);
        }}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-3 py-4">
      <h1 className="mb-3 text-lg font-semibold text-slate-900">Kit de publicación</h1>

      {lista?.kpis && (
        <div className="mb-3 grid grid-cols-3 gap-2">
          <Kpi color="bg-indigo-600" valor={lista.kpis.compartidasSemana} texto="compartidas esta semana" />
          <Kpi color="bg-teal-600" valor={lista.kpis.clientesSemana} texto="clientes llegaron a Sofi" />
          <Kpi color="bg-amber-600" valor={lista.kpis.listas} texto="listas para publicar" />
        </div>
      )}

      <div className="mb-2 flex rounded-lg bg-slate-200 p-1">
        {(["Venta", "Arriendo"] as const).map((op) => (
          <button
            key={op}
            onClick={() => setOperacion(op)}
            aria-pressed={operacion === op}
            className={`flex-1 rounded-md py-1.5 text-sm ${operacion === op ? "bg-white font-semibold text-slate-900 shadow-sm" : "text-slate-500"}`}
          >
            {op}
          </button>
        ))}
      </div>

      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
        <Chip activo={zona === null} onClick={() => setZona(null)}>Todas las zonas</Chip>
        {ZONAS.map((z) => (
          <Chip key={z} activo={zona === z} onClick={() => setZona(z)}>{z}</Chip>
        ))}
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!lista && !error && <p className="text-sm text-slate-500">Cargando propiedades…</p>}
      {lista && !lista.fresco && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          El inventario no está al día (último sync hace {lista.horas ?? "?"} h). No publiques hasta que se sincronice Wasi.
        </p>
      )}
      {lista?.fresco && lista.items.length === 0 && <p className="text-sm text-slate-500">No hay propiedades listas con este filtro.</p>}

      <ul className="space-y-2">
        {lista?.items.map((p) => (
          <li key={p.ref}>
            <button onClick={() => setElegida(p)} className="flex w-full gap-2.5 rounded-xl border border-slate-200 bg-white p-2 text-left">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.foto} alt="" className="h-20 w-20 shrink-0 rounded-lg object-cover" loading="lazy" />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">{p.titulo || `Ref ${p.ref}`}</div>
                <div className="text-xs text-slate-500">
                  {[p.zona, p.area, p.habitaciones ? `${p.habitaciones} alc` : null, `Ref ${p.ref}`].filter(Boolean).join(" · ")}
                </div>
                <div className="mt-1 text-sm font-bold text-slate-900">{p.precio}</div>
                <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] ${p.etiqueta.reciente ? "bg-amber-100 text-amber-800" : "bg-teal-100 text-teal-800"}`}>
                  {p.etiqueta.texto}
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Kpi({ color, valor, texto }: { color: string; valor: number | null; texto: string }) {
  return (
    <div className={`rounded-xl p-2.5 text-white ${color}`}>
      <b className="block text-xl">{valor ?? "—"}</b>
      <small className="text-[11px] leading-tight opacity-90">{texto}</small>
    </div>
  );
}

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={activo}
      className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs ${activo ? "border-[#0b1526] bg-[#0b1526] text-white" : "border-slate-200 bg-white text-slate-700"}`}
    >
      {children}
    </button>
  );
}

const AYUDA_SIN_SHARE = "Este celular no deja compartir fotos desde el navegador: usá Copiar texto y Descargar fotos.";

function FichaPost({ item, onVolver }: { item: Item; onVolver: () => void }) {
  const [comision, setComision] = useState(true);
  const [post, setPost] = useState<Post | null>(null);
  const [archivos, setArchivos] = useState<File[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [estado, setEstado] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let cancelado = false; // el interruptor puede cambiar antes de que llegue la respuesta anterior
    setPost(null);
    setArchivos(null);
    setError(null);
    kitApi<Post>({ action: "post", ref: item.ref, comision })
      .then((p) => {
        if (cancelado) return;
        setPost(p);
        // Se precargan las fotos para que navigator.share se llame sin await previo (conserva el gesto del toque).
        return fotosComoArchivos(item.ref, p.fotos.length).then((f) => {
          if (!cancelado) setArchivos(f);
        });
      })
      .catch((e) => {
        if (!cancelado) setError((e as Error).message);
      });
    return () => {
      cancelado = true;
    };
  }, [item.ref, comision]);

  const registrar = (accion: "compartir" | "copiar" | "descargar") =>
    kitApi({ action: "registrar", ref: item.ref, accion }).catch(() => undefined);

  const listo = !!post && post.linkOk && archivos !== null && !ocupado;
  const preparando = !!post && archivos === null;

  function compartir() {
    if (!post || !archivos || ocupado) return;
    const datos: ShareData = archivos.length ? { files: archivos, text: post.texto } : { text: post.texto };
    if (!navigator.canShare?.(datos)) {
      setEstado(AYUDA_SIN_SHARE);
      return;
    }
    setOcupado(true);
    setEstado(null);
    // Sin await antes de share: el navegador exige que salga del mismo toque.
    navigator
      .share(datos)
      .then(async () => {
        await registrar("compartir");
        setEstado(archivos.length < post.fotos.length ? "Compartida (algunas fotos no bajaron)." : "Compartida.");
      })
      .catch((e) => {
        // AbortError: la asesora cerró el menú. Otro (NotAllowedError...): mostrar la alternativa.
        setEstado((e as Error).name === "AbortError" ? null : AYUDA_SIN_SHARE);
      })
      .finally(() => setOcupado(false));
  }

  async function copiar() {
    if (!post || ocupado) return;
    setOcupado(true);
    try {
      await navigator.clipboard.writeText(post.texto);
      await registrar("copiar");
      setEstado("Texto copiado.");
    } catch {
      setEstado("No se pudo copiar. Mantené presionado el texto para copiarlo.");
    } finally {
      setOcupado(false);
    }
  }

  async function descargar() {
    if (!archivos || ocupado) return;
    if (archivos.length === 0) {
      setEstado("No se pudieron bajar las fotos.");
      return;
    }
    setOcupado(true);
    try {
      for (const f of archivos) {
        const url = URL.createObjectURL(f);
        const a = document.createElement("a");
        a.href = url;
        a.download = f.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        await new Promise((r) => setTimeout(r, 300));
      }
      await registrar("descargar");
      setEstado(`${archivos.length} fotos descargadas.`);
    } finally {
      // Si algo falla a medio camino, el boton no puede quedar bloqueado.
      setOcupado(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col">
      <div className="flex items-center gap-2 bg-[#0b1526] px-3 py-3 text-white">
        <button onClick={onVolver} className="text-xl text-[#c9a24b]" aria-label="Volver">‹</button>
        <b>Ref {item.ref}</b>
      </div>

      <div className="flex-1 space-y-2 bg-slate-50 p-3">
        {item.etiqueta.reciente && (
          <p className="rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
            {item.etiqueta.texto}. Si la vuelven a ver en los mismos grupos tan seguido, se quema.
          </p>
        )}
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {post && !post.linkOk && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">El link de Wasi de esta propiedad no abre. No la compartas hasta corregirla.</p>
        )}

        {post && (
          <div className="relative">
          <div className="grid h-48 grid-cols-3 grid-rows-2 gap-1 overflow-hidden rounded-xl">
            {post.fotos.slice(0, 3).map((_, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={`/api/kit/foto?ref=${encodeURIComponent(item.ref)}&i=${i}`}
                alt=""
                className={`h-full w-full object-cover ${i === 0 ? "col-span-2 row-span-2" : ""}`}
              />
            ))}
          </div>
          <span className="absolute bottom-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] text-white">{Math.min(post.fotos.length, 4)} fotos ✓</span>
          </div>
        )}

        <div className="flex justify-between px-0.5 text-xs text-slate-500">
          <span>Texto del post</span>
          <span>sin IA · $0</span>
        </div>
        <pre className="whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-white p-3 font-sans text-[13px] leading-relaxed text-slate-900">
          {post ? post.texto : "Armando el texto…"}
        </pre>

        <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
          <span>Incluir “Comparto comisión con colegas”</span>
          <input type="checkbox" checked={comision} onChange={(e) => { setComision(e.target.checked); setEstado(null); }} className="h-5 w-5 accent-teal-600" />
        </label>
        {estado && <p className="text-center text-sm text-slate-600">{estado}</p>}
      </div>

      <div className="sticky bottom-0 border-t border-slate-200 bg-white p-3">
        <button
          onClick={compartir}
          disabled={!listo}
          className="w-full rounded-xl bg-[#25d366] py-3 text-base font-semibold text-white disabled:opacity-40"
        >
          {preparando ? "Preparando fotos…" : "Compartir en WhatsApp"}
        </button>
        <div className="mt-2 flex gap-2">
          <button onClick={copiar} disabled={!post || !post.linkOk || ocupado} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm disabled:opacity-40">
            Copiar texto
          </button>
          <button onClick={descargar} disabled={!listo} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm disabled:opacity-40">
            Descargar fotos
          </button>
        </div>
      </div>
    </div>
  );
}
