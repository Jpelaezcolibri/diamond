"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

interface Props {
  children: React.ReactNode;
  /** Modo del tenant: system permite toggle; *-only fuerza un modo. */
  mode: "system" | "light-only" | "dark-only";
}

export function ThemeProvider({ children, mode }: Props) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme={mode === "dark-only" ? "dark" : mode === "light-only" ? "light" : "system"}
      forcedTheme={mode === "light-only" ? "light" : mode === "dark-only" ? "dark" : undefined}
      enableSystem={mode === "system"}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
