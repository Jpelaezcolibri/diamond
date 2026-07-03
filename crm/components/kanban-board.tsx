"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CATEGORIAS, ESTADOS, ESTADO_LABELS, ESTADO_COLUMN_THEME, scoreTemperature, type Lead } from "@/lib/types";
import Avatar from "./avatar";
import ScoreBadge from "./score-badge";

function LeadCard({ lead, convId, dragging = false }: { lead: Lead; convId?: string; dragging?: boolean }) {
  const t = scoreTemperature(lead.score);
  return (
    <div
      className={`rounded-xl border border-l-4 border-slate-200 bg-white p-3 text-sm shadow-sm transition ${t.border} ${
        dragging ? "rotate-2 shadow-xl" : "hover:shadow-md"
      }`}
    >
      <div className="flex items-center gap-2">
        <Avatar name={lead.nombre} phone={lead.phone} size={28} />
        <p className="flex-1 truncate font-semibold text-slate-900">{lead.nombre || `+${lead.phone}`}</p>
        <ScoreBadge score={lead.score} />
      </div>
      <p className="mt-1.5 truncate text-xs text-slate-500">
        {[lead.property_ref_origen, lead.forma_pago, lead.urgencia].filter(Boolean).join(" · ") ||
          lead.tipo_interes ||
          "sin datos"}
      </p>
      {convId && (
        <Link
          href={`/inbox/${convId}`}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
          onPointerDown={(e) => e.stopPropagation()}
        >
          Ver chat →
        </Link>
      )}
    </div>
  );
}

function DraggableCard({ lead, convId }: { lead: Lead; convId?: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`cursor-grab touch-none active:cursor-grabbing ${isDragging ? "opacity-30" : ""}`}
    >
      <LeadCard lead={lead} convId={convId} />
    </div>
  );
}

function Column({ estado, leads, convByLead }: { estado: string; leads: Lead[]; convByLead: Record<string, string> }) {
  const { setNodeRef, isOver } = useDroppable({ id: estado });
  const theme = ESTADO_COLUMN_THEME[estado] || ESTADO_COLUMN_THEME.nuevo;
  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-2xl border-t-4 p-2.5 transition ${theme.border} ${
        isOver ? "bg-[#c9a24b]/10 ring-2 ring-[#c9a24b]" : theme.bg
      }`}
    >
      <p className={`mb-2 flex items-center justify-between px-1 text-xs font-bold uppercase tracking-wide ${theme.header}`}>
        {ESTADO_LABELS[estado]}
        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] shadow-sm">{leads.length}</span>
      </p>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {leads.map((l) => (
          <DraggableCard key={l.id} lead={l} convId={convByLead[l.id]} />
        ))}
        {leads.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300/70 bg-white/50 p-4 text-center text-xs text-slate-400">
            Arrastra leads aquí
          </p>
        )}
      </div>
    </div>
  );
}

export default function KanbanBoard({
  initialLeads,
  convByLead,
}: {
  initialLeads: Lead[];
  convByLead: Record<string, string>;
}) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [tab, setTab] = useState<string>("compra");
  const [active, setActive] = useState<Lead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const visibles = useMemo(() => leads.filter((l) => (l.categoria || "otros") === tab), [leads, tab]);
  const byEstado = useMemo(() => {
    const map: Record<string, Lead[]> = {};
    ESTADOS.forEach((e) => (map[e] = []));
    visibles.forEach((l) => (map[l.estado] || (map[l.estado] = [])).push(l));
    return map;
  }, [visibles]);

  function onDragStart(e: DragStartEvent) {
    setActive(leads.find((l) => l.id === e.active.id) || null);
  }

  async function onDragEnd(e: DragEndEvent) {
    setActive(null);
    const leadId = e.active.id as string;
    const estado = e.over?.id as string | undefined;
    if (!estado || !ESTADOS.includes(estado as (typeof ESTADOS)[number])) return;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.estado === estado) return;

    const previo = lead.estado;
    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, estado } : l)));
    setError(null);

    const res = await fetch("/api/leads/estado", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId, estado }),
    });
    if (!res.ok) {
      setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, estado: previo } : l)));
      setError("No se pudo mover el lead");
    }
  }

  return (
    <div className="flex h-[calc(100vh-57px)] flex-col bg-slate-50 p-4">
      <div className="mb-4 flex items-center gap-2">
        {CATEGORIAS.map((c) => (
          <button
            key={c.key}
            onClick={() => setTab(c.key)}
            className={`rounded-full border border-slate-200 px-4 py-1.5 text-sm font-medium transition ${
              tab === c.key ? "bg-[#0b1526] text-[#c9a24b] shadow-sm" : "bg-white text-slate-600 hover:bg-slate-100"
            }`}
          >
            {c.label}
            <span className="ml-1 text-xs opacity-60">
              ({leads.filter((l) => (l.categoria || "otros") === c.key).length})
            </span>
          </button>
        ))}
        {error && <span className="ml-3 text-xs text-red-600">{error}</span>}
      </div>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex flex-1 gap-3 overflow-x-auto pb-2">
          {ESTADOS.map((estado) => (
            <Column key={estado} estado={estado} leads={byEstado[estado] || []} convByLead={convByLead} />
          ))}
        </div>
        <DragOverlay>{active ? <LeadCard lead={active} dragging /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}
