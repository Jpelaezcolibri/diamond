"use client";

import { useLanguage } from "./language-provider";
import { localizeText, type LocalizedText } from "@/config/i18n";

/**
 * Nodo hoja para texto de la CONFIG DEL TENANT (string plano o { es, en }).
 * Hermano de <T> (que traduce claves del diccionario de UI): este resuelve
 * copy de marketing por tenant sin convertir la seccion server a cliente.
 */
export function LT({ v }: { v: LocalizedText | null | undefined }) {
  const { language } = useLanguage();
  if (v == null) return null;
  return <>{localizeText(v, language)}</>;
}
