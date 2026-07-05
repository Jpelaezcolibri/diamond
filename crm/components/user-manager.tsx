"use client";

import { useEffect, useState } from "react";
import { ROLES } from "@/lib/auth";

type TeamUser = {
  id: string;
  email: string;
  nombre: string;
  role: string;
  roleLabel: string;
  phone: string;
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

export default function UserManager({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [nombre, setNombre] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("asesor_ventas");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, nombre, phone, role }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg(body.warning ? `Usuario ${nombre} creado ⚠️ — ${body.warning}` : `Usuario ${nombre} creado ✓ — ya quedó en su cola de asesor`);
      setEmail("");
      setPassword("");
      setNombre("");
      setPhone("");
      setRole("asesor_ventas");
      void load();
    } else {
      setMsg(body.error || "No se pudo crear");
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
      <form onSubmit={handleCreate} className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="mb-3 text-sm font-semibold">Crear usuario del equipo</p>
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
          <input
            type="email"
            required
            placeholder="correo@diamond.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          <input
            type="text"
            required
            minLength={6}
            placeholder="Contraseña (mín. 6)"
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
            {busy ? "Creando..." : "Crear"}
          </button>
        </div>
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
