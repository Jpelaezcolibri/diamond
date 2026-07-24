"use client";

import { useLanguage } from "@/components/shared/language-provider";
import { cn } from "@/lib/utils";

/** Pill ES · EN — mismo patron visual que un toggle de tema. */
export function LanguageToggle({ className }: { className?: string }) {
  const { language, setLanguage } = useLanguage();

  return (
    <div
      role="group"
      aria-label="Idioma / Language"
      className={cn("inline-flex items-center rounded-full border border-line bg-surface p-0.5 text-xs", className)}
    >
      {(["es", "en"] as const).map((lang) => (
        <button
          key={lang}
          type="button"
          onClick={() => setLanguage(lang)}
          aria-pressed={language === lang}
          className={cn(
            "rounded-full px-2.5 py-1 font-medium uppercase tracking-wide transition-colors",
            language === lang ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground"
          )}
        >
          {lang}
        </button>
      ))}
    </div>
  );
}
