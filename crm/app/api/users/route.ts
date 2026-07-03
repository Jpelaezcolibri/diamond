import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/auth";

async function requireSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  if (!isSuperAdmin(user)) {
    return { error: NextResponse.json({ error: "Solo el super admin gestiona usuarios" }, { status: 403 }) };
  }
  return { user };
}

// Listar usuarios del equipo
export async function GET() {
  const auth = await requireSuperAdmin();
  if (auth.error) return auth.error;

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const users = data.users.map((u) => ({
    id: u.id,
    email: u.email,
    role: (u.app_metadata as { role?: string })?.role || "asesor",
    created_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at,
  }));
  return NextResponse.json({ users });
}

// Crear usuario del equipo (asesor o super_admin)
export async function POST(request: Request) {
  const auth = await requireSuperAdmin();
  if (auth.error) return auth.error;

  const { email, password, role } = await request.json();
  if (!email || !password || password.length < 6) {
    return NextResponse.json({ error: "Email y contraseña (mínimo 6 caracteres) son obligatorios" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: role === "super_admin" ? "super_admin" : "asesor" },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.user?.id });
}

// Eliminar usuario del equipo (no puede eliminarse a si mismo)
export async function DELETE(request: Request) {
  const auth = await requireSuperAdmin();
  if (auth.error) return auth.error;

  const { userId } = await request.json();
  if (!userId) return NextResponse.json({ error: "Falta userId" }, { status: 400 });
  if (userId === auth.user!.id) {
    return NextResponse.json({ error: "No puedes eliminar tu propio usuario" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
