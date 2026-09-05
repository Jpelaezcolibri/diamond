import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCalendarEvents, bogotaDateKey, type CalendarEvent } from "@/lib/calendar-events";
import ErrorBanner from "@/components/error-banner";
import { CancelarCitaAvisos, BotonCancelarCita } from "@/components/cancelar-cita";

export const dynamic = "force-dynamic";

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

// Paleta estable por asesor: el color sale del hash del id, asi cada asesor
// mantiene su color entre renders sin guardarlo en ningun lado.
const ADVISOR_COLORS = [
  "bg-emerald-100 text-emerald-800 border-emerald-200",
  "bg-sky-100 text-sky-800 border-sky-200",
  "bg-indigo-100 text-indigo-800 border-indigo-200",
  "bg-amber-100 text-amber-800 border-amber-200",
  "bg-rose-100 text-rose-800 border-rose-200",
  "bg-violet-100 text-violet-800 border-violet-200",
];
function colorFor(id: string | null): string {
  if (!id) return "bg-slate-100 text-slate-600 border-slate-200";
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ADVISOR_COLORS[h % ADVISOR_COLORS.length];
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Año/mes (mes 0-indexado) actuales en hora de Bogota — el default del
// selector cuando no viene ?mes= en la URL.
function bogotaYearMonth(): { year: number; month: number } {
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
  const [y, m] = key.split("-").map(Number);
  return { year: y, month: m - 1 };
}

function parseMes(mes?: string): { year: number; month: number } {
  if (mes && /^\d{4}-\d{2}$/.test(mes)) {
    const [y, m] = mes.split("-").map(Number);
    if (m >= 1 && m <= 12) return { year: y, month: m - 1 };
  }
  return bogotaYearMonth();
}

function mesParam(year: number, month: number): string {
  return `${year}-${pad2(month + 1)}`;
}

function isoFromUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// Grilla de 6 semanas x 7 dias (42 celdas), empezando en lunes, con los dias
// del mes anterior/siguiente que rellenan la primera y ultima semana.
function buildMonthGrid(year: number, month: number): { iso: string; day: number; inMonth: boolean }[] {
  const first = new Date(Date.UTC(year, month, 1));
  const firstWeekday = (first.getUTCDay() + 6) % 7; // 0=lunes .. 6=domingo
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const daysInPrevMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells: { iso: string; day: number; inMonth: boolean }[] = [];
  for (let i = 0; i < firstWeekday; i++) {
    const day = daysInPrevMonth - firstWeekday + 1 + i;
    cells.push({ iso: isoFromUTC(new Date(Date.UTC(year, month - 1, day))), day, inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ iso: isoFromUTC(new Date(Date.UTC(year, month, day))), day, inMonth: true });
  }
  let extraDay = 1;
  while (cells.length < 42) {
    cells.push({ iso: isoFromUTC(new Date(Date.UTC(year, month + 1, extraDay))), day: extraDay, inMonth: false });
    extraDay++;
  }
  return cells;
}

function horaBogota(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bogota" });
}

export default async function CalendarioPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { mes } = await searchParams;
  const { year, month } = parseMes(mes);

  const supabase = await createClient();
  const { events, hasError, message } = await getCalendarEvents(supabase);

  const porDia = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    const key = bogotaDateKey(ev.fechaHora);
    porDia.set(key, [...(porDia.get(key) || []), ev]);
  }

  const cells = buildMonthGrid(year, month);
  const hoyKey = bogotaDateKey(new Date().toISOString());
  const prev = month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 };
  const next = month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 };

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Calendario del equipo</h1>
          <p className="text-sm text-slate-500">
            Visitas, llamadas y asesorías con clientes, más los recordatorios con fecha del equipo. El color indica el asesor.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`?mes=${mesParam(prev.year, prev.month)}`}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            ← Anterior
          </Link>
          <span className="w-40 text-center text-sm font-semibold capitalize text-slate-900">
            {MESES[month]} {year}
          </span>
          <Link
            href={`?mes=${mesParam(next.year, next.month)}`}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Siguiente →
          </Link>
        </div>
      </div>

      {hasError && <ErrorBanner message={message} />}

      {/* La grilla va envuelta porque el aviso de la cancelación NO puede vivir
          dentro de la celda: al cancelar se refresca y la cita desaparece del
          calendario, y con ella se iría el mensaje (Juan, 2026-09-04). */}
      <CancelarCitaAvisos>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="grid min-w-[720px] grid-cols-7 border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {DIAS_SEMANA.map((d) => (
              <div key={d} className="px-3 py-2 text-center">
                {d}
              </div>
            ))}
          </div>
          <div className="grid min-w-[720px] grid-cols-7">
            {cells.map((cell) => {
              const dayEvents = porDia.get(cell.iso) || [];
              const esHoy = cell.iso === hoyKey;
              return (
                <div
                  key={cell.iso}
                  className={`min-h-[110px] border-b border-r border-slate-100 p-1.5 last:border-r-0 ${
                    cell.inMonth ? "bg-white" : "bg-slate-50/60"
                  }`}
                >
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                      esHoy ? "bg-[#c9a24b] text-white" : cell.inMonth ? "text-slate-700" : "text-slate-300"
                    }`}
                  >
                    {cell.day}
                  </span>
                  <div className="mt-1 space-y-1">
                    {dayEvents.slice(0, 3).map((ev) => {
                      // "que la agenda quede marcada con el link directo al
                      // chat" (Juan, 2026-08-21) — solo avance_colega lo trae.
                      // "lo marcas para yo hacerle seguimiento" (mismo dia) —
                      // 🤖 marca la que Sofi agendó sola, sin que nadie la revisara.
                      const contenido = `${ev.autoAgendada ? "🤖 " : ""}${horaBogota(ev.fechaHora)} ${ev.titulo}`;
                      const titulo = `${horaBogota(ev.fechaHora)} · ${ev.titulo}${ev.advisorNombre ? ` · ${ev.advisorNombre}` : ""}${ev.linkChat ? " · ver chat" : ""}${ev.autoAgendada ? " · agendada sola por Sofi, revisar" : ""}${ev.estado === "propuesta" ? " · propuesta, sin confirmar" : ""}`;
                      const clase = `block truncate rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${colorFor(ev.advisorId)}${ev.linkChat ? " hover:brightness-95" : ""}`;
                      const chip = ev.linkChat ? (
                        <Link href={ev.linkChat} title={titulo} className={clase}>
                          {contenido}
                        </Link>
                      ) : (
                        <div title={titulo} className={clase}>
                          {contenido}
                        </div>
                      );
                      // Una "propuesta" la pidió un colega y NADIE la confirmó
                      // todavía (Juan, 2026-09-04): ocupa la hora, pero no es un
                      // compromiso y el calendario tiene que decirlo. El rótulo
                      // va aparte del chip porque el chip ya está truncado y su
                      // color es el del asesor, no el del estado.
                      return (
                        <div key={ev.id} className="space-y-0.5">
                          {chip}
                          {ev.estado === "propuesta" && (
                            <span className="block truncate rounded-md border border-amber-200 bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                              propuesta — sin confirmar
                            </span>
                          )}
                          {/* Solo las citas de cliente se cancelan: un
                              recordatorio del equipo y un avance de un colega no
                              son citas del bot, no hay a quién avisarle y no
                              tienen leadId. */}
                          {ev.origen === "cita_cliente" && ev.leadId && (
                            <BotonCancelarCita leadId={ev.leadId} cliente={ev.clienteNombre} />
                          )}
                        </div>
                      );
                    })}
                    {dayEvents.length > 3 && (
                      <div className="px-1.5 text-[11px] font-medium text-slate-400">+{dayEvents.length - 3} más</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CancelarCitaAvisos>
    </div>
  );
}
