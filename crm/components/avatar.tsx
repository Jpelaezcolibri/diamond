const COLORS = ["#0b1526", "#7c3aed", "#0891b2", "#b8862f", "#dc2626", "#059669", "#4338ca", "#be185d"];

function hashCode(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export default function Avatar({ name, phone, size = 40 }: { name?: string | null; phone: string; size?: number }) {
  const label = name || phone;
  const initials = name
    ? name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()
    : phone.slice(-2);
  const color = COLORS[hashCode(label) % COLORS.length];
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: color, fontSize: size * 0.4 }}
    >
      {initials}
    </div>
  );
}
