import { cn } from "@/lib/utils";

interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  align?: "left" | "center";
  className?: string;
}

/** Encabezado editorial de seccion: eyebrow dorado + titulo serif + subtitulo. */
export function SectionHeading({ eyebrow, title, subtitle, align = "left", className }: SectionHeadingProps) {
  return (
    <div className={cn("mb-12 max-w-2xl md:mb-16", align === "center" && "mx-auto text-center", className)}>
      {eyebrow ? (
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-accent-strong">{eyebrow}</p>
      ) : null}
      <h2 className="text-3xl leading-tight md:text-4xl">{title}</h2>
      {subtitle ? <p className="mt-4 text-base leading-relaxed text-muted md:text-lg">{subtitle}</p> : null}
    </div>
  );
}
