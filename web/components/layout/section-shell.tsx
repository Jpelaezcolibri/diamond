import * as React from "react";
import { cn } from "@/lib/utils";
import { Container } from "./container";

interface SectionShellProps extends React.HTMLAttributes<HTMLElement> {
  /** Banda invertida (fondo ink) para separar audiencias — ej. captacion. */
  inverted?: boolean;
  width?: React.ComponentProps<typeof Container>["width"];
  containerClassName?: string;
}

/** Envoltorio de seccion: ritmo vertical editorial consistente en todo REF. */
export function SectionShell({
  inverted = false,
  width = "default",
  className,
  containerClassName,
  children,
  ...props
}: SectionShellProps) {
  return (
    <section
      className={cn(
        "py-section",
        inverted && "dark bg-background text-foreground",
        className
      )}
      {...props}
    >
      <Container width={width} className={containerClassName}>
        {children}
      </Container>
    </section>
  );
}
