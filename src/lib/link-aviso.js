// La URL que abre la asesora desde el aviso (Juan, 2026-09-02, opcion D).
//
// Una sola env var: CRM_PUBLIC_URL (ej. https://crm.diamondinmobiliaria.com).
// Sin ella no hay link y el aviso sale como hoy — se dice en el informe de
// arranque (src/lib/arranque.js), no se inventa un dominio: este repo no
// hardcodea datos de Diamond donde deberian resolverse por configuracion.
function urlDeAviso(token) {
  const base = String(process.env.CRM_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  if (!base || !token) return null;
  return `${base}/aviso/${encodeURIComponent(token)}`;
}

module.exports = { urlDeAviso };
