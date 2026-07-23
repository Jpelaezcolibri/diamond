"use client";

import { useEffect, useState } from "react";
import { ROLES } from "@/lib/auth";

type Horario = { dias: number[]; desde: string; hasta: string };

type TeamUser = {
  id: string;
  email: string;
  nombre: string;
  role: string;
  roleLabel: string;
  phone: string;
  horario: Horario | null;
  created_at: string;
  last_sign_in_at: string | null;
};

const ROLE_BADGE: Record<string, string> = {
  admin: "bg-amber-100 text-amber-800",
  asesor_ventas: "bg-emerald-100 text-emerald-700",
  asesor_arrendamientos: "bg-sky-100 text-sky-700",
  asesor_vehiculos: "bg-indigo-100 text-indigo-700",
  asesor_otros: "bg-slate-100 text-slate-700",
};

// Etiqueta corta por dia (0=domingo). Horario laboral por defecto: L-V 8-18.
const DAY_LABELS = ["D", "L", "M", "M", "J", "V", "S"];
const DEFAULT_HORARIO: Horario = { dias: [1, 2, 3, 4, 5], desde: "08:00", hasta: "18:00" };

export default function UserManager({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingEmail, setEditingEmail] = useState("");
  const [nombre, setNombre] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("asesor_ventas");
  const [horario, setHorario] = useState<Horario>(DEFAULT_HORARIO);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function toggleDia(d: number) {
    setHorario((h) => ({
      ...h,
      dias: h.dias.includes(d) ? h.dias.filter((x) => x !== d) : [...h.dias, d].sort(),
    }));
  }

  async function load() {
    const res = await fetch("/api/users");
    if (res.ok) {
      const body = await res.json();
      setUsers(body.users || []);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function resetForm() {
    setEditingId(null);
    setEditingEmail("");
    setEmail("");
    setPassword("");
    setNombre("");
    setPhone("");
    setRole("asesor_ventas");
    setHorario(DEFAULT_HORARIO);
  }

  function startEdit(u: TeamUser) {
    setEditingId(u.id);
    setEditingEmail(u.email);
    setNombre(u.nombre);
    setPhone(u.phone);
    setRole(u.role);
    setPassword("");
    setHorario(u.horario || DEFAULT_HORARIO);
    setMsg(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const isEditing = Boolean(editingId);
    const res = await fetch("/api/users", {
      method: isEditing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        isEditing
          ? { userId: editingId, nombre, phone, role, password: password || undefined, horario: horario.dias.length ? horario : null }
          : { email, password, nombre, phone, role }
      ),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg(
        body.warning
          ? `Usuario ${nombre} ${isEditing ? "actualizado" : "creado"} ⚠️ — ${body.warning}`
          : `Usuario ${nombre} ${isEditing ? "actualizado ✓" : "creado ✓ — ya quedó en su cola de asesor"}`
      );
      resetForm();
      void load();
    } else {
      setMsg(body.error || `No se pudo ${isEditing ? "actualizar" : "crear"}`);
    }
    setBusy(false);
  }

  async function handleDelete(u: TeamUser) {
    if (!confirm(`¿Eliminar el usuario ${u.nombre || u.email}? Perderá el acceso al CRM y se liberarán sus leads.`)) return;
    const res = await fetch("/api/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: u.id }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      if (body.warning) setMsg(`⚠️ ${body.warning}`);
      void load();
    } else {
      alert(body.error || "No se pudo eliminar");
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="mb-3 text-sm font-semibold">
          {editingId ? `Editar usuario — ${editingEmail}` : "Crear usuario del equipo"}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            required
            placeholder="Nombre completo"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          <input
            type="tel"
            required
            placeholder="Celular (ej. 3016981200)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          {!editingId && (
            <input
              type="email"
              required
              placeholder="correo@diamond.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
          )}
          <input
            type="text"
            required={!editingId}
            minLength={6}
            placeholder={editingId ? "Nueva contraseña (opcional)" : "Contraseña (mín. 6)"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none"
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {busy ? "Guardando..." : editingId ? "Guardar cambios" : "Crear"}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:text-slate-800"
            >
              Cancelar
            </button>
          )}
        </div>

        {editingId && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3">
            <span className="text-xs font-medium text-slate-600">Horario de atención (para agendar visitas):</span>
            <div className="flex gap-1">
              {DAY_LABELS.map((label, d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDia(d)}
                  className={`h-7 w-7 rounded-full text-xs font-medium ${
                    horario.dias.includes(d) ? "bg-slate-900 text-white" : "bg-white text-slate-500 border border-slate-300"
                  }`}
                  title={["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"][d]}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1 text-xs text-slate-600">
              de
              <input
                type="time"
                value={horario.desde}
                onChange={(e) => setHorario((h) => ({ ...h, desde: e.target.value }))}
                className="rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-slate-500"
              />
              a
              <input
                type="time"
                value={horario.hasta}
                onChange={(e) => setHorario((h) => ({ ...h, hasta: e.target.value }))}
                className="rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-slate-500"
              />
            </label>
          </div>
        )}

        {msg && <p className="mt-2 text-xs text-slate-600">{msg}</p>}
        <p className="mt-2 text-xs text-slate-400">
          El celular ubica al asesor en su cola de venta/arriendo/otros para las alertas de WhatsApp del bot. Todos ven
          todos los leads; solo pueden editar los que tienen bajo su cargo.
        </p>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Nombre</th>
              <th className="px-4 py-3">Celular</th>
              <th className="px-4 py-3">Correo</th>
              <th className="px-4 py-3">Rol</th>
              <th className="px-4 py-3">Último ingreso</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3 font-medium">
                  {u.nombre || "—"}
                  {u.id === currentUserId && <span className="ml-2 text-xs text-slate-400">(tú)</span>}
                </td>
                <td className="px-4 py-3 text-slate-500">{u.phone || "—"}</td>
                <td className="px-4 py-3 text-slate-500">{u.email}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${ROLE_BADGE[u.role] || "bg-slate-100 text-slate-700"}`}>
                    {u.roleLabel}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString("es-CO") : "Nunca"}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => startEdit(u)}
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    title="Editar usuario"
                  >
                    ✏️
                  </button>
                  {u.id !== currentUserId && (
                    <button
                      onClick={() => handleDelete(u)}
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      title="Eliminar usuario"
                    >
                      🗑
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
