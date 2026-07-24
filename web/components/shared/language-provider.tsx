"use client";

import * as React from "react";
import { dictionary, translate, type Language, type TranslationKey } from "@/config/i18n";

const STORAGE_KEY = "ref-language";

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const LanguageContext = React.createContext<LanguageContextValue | null>(null);

/**
 * Provider de idioma de la interfaz — mismo patron que ThemeProvider
 * (next-themes): Context + localStorage, sin ruteo ni SSR consciente del
 * idioma (decision del diseno: primera carga siempre en espanol, el toggle
 * es para el visitante humano, no para SEO bilingue).
 */
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = React.useState<Language>("es");

  React.useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "es" || stored === "en") setLanguageState(stored);
  }, []);

  React.useEffect(() => {
    document.documentElement.lang = language === "en" ? "en" : "es-CO";
  }, [language]);

  const setLanguage = React.useCallback((lang: Language) => {
    setLanguageState(lang);
    window.localStorage.setItem(STORAGE_KEY, lang);
  }, []);

  const t = React.useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => translate(language, key, vars),
    [language]
  );

  const value = React.useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = React.useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage debe usarse dentro de <LanguageProvider>");
  return ctx;
}

// Solo para tests/debug: lista de idiomas soportados.
export const SUPPORTED_LANGUAGES = Object.keys(dictionary) as Language[];
