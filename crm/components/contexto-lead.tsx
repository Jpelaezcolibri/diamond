// Contexto de una alerta de "Para atender" (Juan, 2026-11-09: "esa misma
// cantidad de detalle que se puso en el calendario necesito que lo pongamos en
// estas alertas... se tiene que tener el contexto suficiente para poder
// contactar a la persona"). Resumen a la vista y el botón que abre el mismo
// panel del calendario, con los mensajes y la caja para responder.
import Link from "next/link";
import type { DetalleCita } from "@/lib/cita-detalle";

const TZ = "America/Bogota";
const corta = (iso: string) =>
  new Intl.DateTimeFormat("es-CO", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

export default function ContextoLead({ d, detalleHref }: { d: DetalleCita; detalleHref: string }) {
  const ultimoSuyo = [...d.mensajes].reverse().find((m) => m.role === "user");
  const p = d.propiedad;
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-[14px] text-slate-700">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-900">{d.persona.nombre}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold text-white ${d.persona.esColega ? "bg-violet-600" : "bg-sky-600"}`}>
          {d.persona.esColega ? "Colega" : "Cliente"}
        </span>
        {d.persona.grupos.length > 0 && <span className="text-xs text-slate-500">· {d.persona.grupos.join(", ")}</span>}
      </div>

      {d.persona.celular ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold tracking-wide text-slate-900">📞 {d.persona.celular}</span>
          <a href={`tel:+${d.persona.whatsapp}`} className="rounded-md bg-[#0b1526] px-2.5 py-1 text-xs font-semibold text-white">
            Llamar
          </a>
          <a href={`https://wa.me/${d.persona.whatsapp}`} target="_blank" rel="noreferrer" className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white">
            WhatsApp
          </a>
        </div>
      ) : (
        <p className="rounded-md bg-amber-50 px-2 py-1 text-amber-900">
          <span className="font-semibold">Sin celular visible:</span> escríbele desde aquí y pídele un número.
        </p>
      )}

      {(p || d.refSinFicha) && (
        <p>
          🏠{" "}
          {p ? (
            <>
              <span className="font-medium text-slate-900">Ref {p.ref}</span>
              {p.tipoOperacion ? ` · ${p.tipoOperacion}` : ""}
              {p.zona ? ` · ${p.zona}` : ""}
              {p.precio ? ` · ${p.precio}` : ""}
              {p.linkWasi && (
                <a href={p.linkWasi} target="_blank" rel="noreferrer" className="ml-1 text-sky-600 hover:underline">
                  ficha ↗
                </a>
              )}
            </>
          ) : (
            <>Ref {d.refSinFicha} (sin ficha en la base)</>
          )}
        </p>
      )}

      {d.fechaHora && d.estado && (
        <p>
          📅 Visita {d.estado === "confirmada" ? "confirmada" : "por confirmar"} · {corta(d.fechaHora)}
          {d.asesora ? ` · ${d.asesora.nombre}` : ""}
        </p>
      )}

      {d.pedido && (
        <p className="line-clamp-2 text-slate-600">
          <span className="font-medium text-slate-800">Pidió:</span> “{d.pedido.texto}”
        </p>
      )}

      {ultimoSuyo && (
        <p className="line-clamp-2 text-slate-600">
          <span className="font-medium text-slate-800">Último mensaje ({corta(ultimoSuyo.createdAt)}):</span> “{ultimoSuyo.content}”
        </p>
      )}

      <Link href={detalleHref} scroll={false} className="inline-block rounded-lg bg-[#c9a24b] px-3 py-1.5 text-sm font-bold text-[#0b1526] hover:brightness-95">
        Ver todo y responder →
      </Link>
    </div>
  );
}
