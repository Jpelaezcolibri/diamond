import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin, userRole, roleLabel, roleEspecialidad, ROLES, type Role } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";
import { TEAM_ROSTER_TAG } from "@/lib/team";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  if (!isAdmin(user)) {
    return { error: NextResponse.json({ error: "Solo un admin gestiona usuarios" }, { status: 403 }) };
  }
  return { user };
}

// Valida y normaliza el horario laboral del asesor
// ({ dias:[0-6], desde:"HH:MM", hasta:"HH:MM" }). Devuelve null si es
// invalido o vacio (el bot cae a su DEFAULT_HORARIO cuando es null).
function normalizeHorario(raw: unknown): { dias: number[]; desde: string; hasta: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const h = raw as { dias?: unknown; desde?: unknown; hasta?: unknown };
  const dias = Array.isArray(h.dias) ? h.dias.filter((d): d is number => typeof d === "number" && d >= 0 && d <= 6) : [];
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (dias.length === 0) return null;
  if (typeof h.desde !== "string" || !hhmm.test(h.desde)) return null;
  if (typeof h.hasta !== "string" || !hhmm.test(h.hasta)) return null;
  if (h.desde >= h.hasta) return null;
  return { dias: [...new Set(dias)].sort(), desde: h.desde, hasta: h.hasta };
}

// El CRM asume una sola organizacion por ahora (igual que el resto de paginas,
// que tampoco filtran por org_id) — se toma la primera existente.
async function currentOrgId(admin: ReturnType<typeof createAdminClient>) {
  const { data } = await admin.from("organizations").select("id").order("created_at").limit(1).maybeSingle();
  return data?.id as string | undefined;
}

// Listar usuarios del equipo (con celular tomado de advisors)
export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const admin = createAdminClient();
  // La columna advisors.horario es de una migracion nueva; si aun no corrio,
  // se reintenta sin ella para que la gestion de usuarios no se caiga.
  async function fetchAdvisors() {
    const withHorario = await admin
      .from("advisors")
      .select("auth_user_id, phone, especialidad, activo, horario")
      .not("auth_user_id", "is", null);
    if (!withHorario.error) return withHorario.data;
    const fallback = await admin
      .from("advisors")
      .select("auth_user_id, phone, especialidad, activo")
      .not("auth_user_id", "is", null);
    return fallback.data;
  }
  const [{ data: userList, error }, advisorRows] = await Promise.all([
    admin.auth.admin.listUsers({ page: 1, perPage: 200 }),
    fetchAdvisors(),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byAuthId = new Map(
    (advisorRows || []).map((a) => [a.auth_user_id as string, a as { phone?: string; horario?: unknown }])
  );

  const users = userList!.users.map((u) => {
    const role = userRole(u);
    return {
      id: u.id,
      email: u.email,
      nombre: (u.app_metadata as { nombre?: string })?.nombre || "",
      role,
      roleLabel: roleLabel(role),
      phone: byAuthId.get(u.id)?.phone || "",
      horario: byAuthId.get(u.id)?.horario || null,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
    };
  });
  return NextResponse.json({ users });
}

// Crear usuario del equipo. Siempre pide celular: define su cola de asesor en
// la tabla advisors (usada por el bot para wa.me y notificaciones).
export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { email, password, nombre, phone, role } = await request.json();
  if (!email || !password || password.length < 6) {
    return NextResponse.json({ error: "Email y contraseña (mínimo 6 caracteres) son obligatorios" }, { status: 400 });
  }
  if (!nombre?.trim()) {
    return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });
  }
  const normalizedPhone = normalizePhone(phone || "");
  if (!normalizedPhone) {
    return NextResponse.json({ error: "El celular es obligatorio y debe ser válido (ej. 3016981200)" }, { status: 400 });
  }

  const validRole: Role = ROLES.some((r) => r.value === role) ? (role as Role) : "asesor_otros";

  const admin = createAdminClient();
  const especialidad = roleEspecialidad(validRole);

  // Resolver el vinculo con advisors ANTES de crear el usuario: si el celular
  // ya esta ligado a otra cuenta del equipo, se rechaza sin dejar un usuario
  // Auth huerfano ni robarle la cola de asesor a quien ya la tenia.
  let orgId: string | undefined;
  let existingAdvisor: { id: string; especialidad: string } | null = null;
  if (especialidad) {
    orgId = await currentOrgId(admin);
    if (orgId) {
      const { data: existing } = await admin
        .from("advisors")
        .select("id, especialidad, auth_user_id")
        .eq("org_id", orgId)
        .eq("phone", normalizedPhone)
        .maybeSingle();
      if (existing?.auth_user_id) {
        return NextResponse.json(
          { error: "Ese celular ya está vinculado a otro usuario del equipo" },
          { status: 409 }
        );
      }
      existingAdvisor = existing;
    }
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: validRole, nombre: nombre.trim() },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let warning: string | undefined;
  if (especialidad && orgId) {
    const sync = existingAdvisor
      ? await admin
          .from("advisors")
          .update({ name: nombre.trim(), especialidad, activo: true, auth_user_id: data.user!.id })
          .eq("id", existingAdvisor.id)
      : await admin.from("advisors").insert({
          org_id: orgId,
          name: nombre.trim(),
          phone: normalizedPhone,
          especialidad,
          activo: true,
          auth_user_id: data.user!.id,
        });
    if (sync.error) {
      warning = `Usuario creado, pero no quedó en su cola de asesor: ${sync.error.message}`;
    } else if (existingAdvisor && existingAdvisor.especialidad !== especialidad) {
      warning = `Este celular ya estaba en la cola de "${existingAdvisor.especialidad}"; se cambió a "${especialidad}".`;
    }
  }

  revalidateTag(TEAM_ROSTER_TAG);
  return NextResponse.json({ ok: true, id: data.user?.id, warning });
}

// Editar usuario del equipo: nombre, celular, rol y (opcional) resetear
// contrasena. El correo NO se puede cambiar aca (login sigue siendo el mismo).
export async function PATCH(request: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { userId, nombre, phone, role, password, horario } = await request.json();
  if (!userId) return NextResponse.json({ error: "Falta userId" }, { status: 400 });
  if (!nombre?.trim()) {
    return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });
  }
  const normalizedPhone = normalizePhone(phone || "");
  if (!normalizedPhone) {
    return NextResponse.json({ error: "El celular es obligatorio y debe ser válido (ej. 3016981200)" }, { status: 400 });
  }
  if (password && password.length < 6) {
    return NextResponse.json({ error: "La contraseña nueva debe tener al menos 6 caracteres" }, { status: 400 });
  }
  const normalizedHorario = normalizeHorario(horario);
  if (horario && !normalizedHorario) {
    return NextResponse.json({ error: "Horario inválido (días 0-6, formato de hora HH:MM, desde < hasta)" }, { status: 400 });
  }

  const validRole: Role = ROLES.some((r) => r.value === role) ? (role as Role) : "asesor_otros";
  const admin = createAdminClient();
  const especialidad = roleEspecialidad(validRole);

  // Mismo candado anti-choque que el POST: el celular no puede quedar
  // vinculado a otro usuario, pero aca se excluye al propio usuario editado.
  let orgId: string | undefined;
  if (especialidad) {
    orgId = await currentOrgId(admin);
    if (orgId) {
      const { data: existing } = await admin
        .from("advisors")
        .select("id, auth_user_id")
        .eq("org_id", orgId)
        .eq("phone", normalizedPhone)
        .maybeSingle();
      if (existing?.auth_user_id && existing.auth_user_id !== userId) {
        return NextResponse.json(
          { error: "Ese celular ya está vinculado a otro usuario del equipo" },
          { status: 409 }
        );
      }
    }
  }

  const updatePayload: { app_metadata: { role: Role; nombre: string }; password?: string } = {
    app_metadata: { role: validRole, nombre: nombre.trim() },
  };
  if (password) updatePayload.password = password;

  const { error } = await admin.auth.admin.updateUserById(userId, updatePayload);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let warning: string | undefined;
  if (orgId) {
    const { data: linkedAdvisor } = await admin
      .from("advisors")
      .select("id")
      .eq("org_id", orgId)
      .eq("auth_user_id", userId)
      .maybeSingle();
    const horarioPatch = normalizedHorario ? { horario: normalizedHorario } : {};
    const sync = linkedAdvisor
      ? await admin
          .from("advisors")
          .update({ name: nombre.trim(), phone: normalizedPhone, ...(especialidad ? { especialidad } : {}), ...horarioPatch })
          .eq("id", linkedAdvisor.id)
      : especialidad
        ? await admin
            .from("advisors")
            .insert({ org_id: orgId, name: nombre.trim(), phone: normalizedPhone, especialidad, activo: true, auth_user_id: userId, ...horarioPatch })
        : { error: null };
    if (sync.error) {
      warning = `Usuario actualizado, pero no quedó sincronizada su cola de asesor: ${sync.error.message}`;
    }
  }

  revalidateTag(TEAM_ROSTER_TAG);
  return NextResponse.json({ ok: true, warning });
}

// Eliminar usuario del equipo (no puede eliminarse a si mismo)
export async function DELETE(request: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { userId } = await request.json();
  if (!userId) return NextResponse.json({ error: "Falta userId" }, { status: 400 });
  if (userId === auth.user!.id) {
    return NextResponse.json({ error: "No puedes eliminar tu propio usuario" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Revocar el acceso es la accion principal: si falla, no tocar nada mas.
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Libera los leads que tenia bajo su owner. Desvincula (NO desactiva) su
  // fila de advisors: puede seguir atendiendo por WhatsApp sin login CRM,
  // igual que un asesor que nunca tuvo cuenta.
  const [{ error: leadsError }, { error: advisorError }] = await Promise.all([
    admin.from("leads").update({ owner_id: null, owner_assigned_at: null }).eq("owner_id", userId),
    admin.from("advisors").update({ auth_user_id: null }).eq("auth_user_id", userId),
  ]);
  const warning = [
    leadsError && `No se pudieron liberar sus leads: ${leadsError.message}`,
    advisorError && `No se pudo desvincular su cola de asesor: ${advisorError.message}`,
  ]
    .filter(Boolean)
    .join(" ");

  revalidateTag(TEAM_ROSTER_TAG);
  return NextResponse.json({ ok: true, warning: warning || undefined });
}
