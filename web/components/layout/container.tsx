import * as React from "react";
import { cn } from "@/lib/utils";

const widths = {
  /** Catalogo y contenido general. */
  default: "max-w-6xl",
  /** Hero y bandas anchas. */
  wide: "max-w-[90rem]",
  /** Texto largo. */
  prose: "max-w-2xl",
} as const;

interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: keyof typeof widths;
  as?: "div" | "section" | "header" | "footer" | "nav";
}

export function Container({ width = "default", as: Comp = "div", className, ...props }: ContainerProps) {
  return <Comp className={cn("mx-auto w-full px-5 sm:px-8", widths[width], className)} {...props} />;
}
