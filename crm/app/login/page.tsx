"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Traduce los errores mas comunes de Supabase Auth; el resto se muestra tal
// cual (en vez de un generico "credenciales incorrectas" que oculta la causa
// real cuando el problema no es la contrasena, ej. email sin confirmar).
function loginErrorMessage(message: string): string {
  if (message === "Invalid login credentials") return "Correo o contraseña incorrectos.";
  if (message === "Email not confirmed") return "Este correo no ha confirmado su cuenta.";
  return message;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(loginErrorMessage(error.message));
      setLoading(false);
      return;
    }
    router.push("/inbox");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0b1526] p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-[#c9a24b]/30 bg-[#0e1b30] p-8 shadow-xl"
      >
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Diamond Inmobiliaria" className="mx-auto w-48 rounded-xl" />
          <p className="mt-3 text-sm text-[#c9a24b]">CRM · Inbox del agente Sofi</p>
        </div>
        <input
          type="email"
          required
          placeholder="Correo"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-slate-600 bg-[#0b1526] px-3 py-2 text-sm text-white outline-none placeholder:text-slate-400 focus:border-[#c9a24b]"
        />
        <div className="relative">
          <input
            type={showPassword ? "text" : "password"}
            required
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-600 bg-[#0b1526] px-3 py-2 pr-16 text-sm text-white outline-none placeholder:text-slate-400 focus:border-[#c9a24b]"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 right-0 px-3 text-xs text-slate-400 hover:text-[#c9a24b]"
          >
            {showPassword ? "Ocultar" : "Ver"}
          </button>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-[#c9a24b] py-2 text-sm font-semibold text-[#0b1526] hover:bg-[#dbb55e] disabled:opacity-50"
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </main>
  );
}
