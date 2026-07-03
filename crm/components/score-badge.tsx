import { scoreTemperature } from "@/lib/types";

export default function ScoreBadge({ score }: { score: number }) {
  const t = scoreTemperature(score);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${t.bg} ${t.color}`}>
      <span>{t.emoji}</span>
      {score}
    </span>
  );
}
