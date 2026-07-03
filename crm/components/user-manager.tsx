"use client";

import { useEffect, useState } from "react";

type TeamUser = {
  id: string;
  email: string;
  role: string;
  created_at: string;
  last_sign_in_at: string | null;
};

export default function UserManager({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("asesor");
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
      body: JSON.stringify({ email, password, role }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg(`Usuario ${email} creado ✓`);
      setEmail("");
      setPassword("");
      setRole("asesor");
      void load();
    } else {
      setMsg(body.error || "No se pudo crear");
    }
    setBusy(false);
  }

  async function handleDelete(u: TeamUser) {
    if (!confirm(`¿Eliminar el usuario ${u.email}? Perderá el acceso al CRM.`)) return;
    const res = await fetch("/api/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: u.id }),
    });
    if (res.ok) void load();
    else {
      const body = await res.json().catch(() => ({}));
      alert(body.error || "No se pudo eliminar");
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleCreate} className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="mb-3 text-sm font-semibold">Crear usuario del equipo</p>
        <div className="flex flex-wrap items-center gap-2">
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
            <option value="asesor">Asesor</option>
            <option value="super_admin">Super admin</option>
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
          Entrega el correo y la contraseña al asesor; podrá cambiarla después. Los asesores ven todo el CRM pero no pueden borrar leads ni gestionar usuarios.
        </p>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
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
                  {u.email}
                  {u.id === currentUserId && <span className="ml-2 text-xs text-slate-400">(tú)</span>}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      u.role === "super_admin" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {u.role === "super_admin" ? "Super admin" : "Asesor"}
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
