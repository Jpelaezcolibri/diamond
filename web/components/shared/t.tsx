"use client";

import { useLanguage } from "./language-provider";
import type { TranslationKey } from "@/config/i18n";

/**
 * Nodo de texto traducible minimo — permite sembrar traducciones dentro de
 * componentes SERVER (paginas de propiedad, catalogo, 404) sin convertirlos
 * enteros a cliente: solo este nodo hoja se hidrata, el resto de la pagina
 * (fetch de datos, ISR) sigue siendo server-rendered.
 */
export function T({ k, vars }: { k: TranslationKey; vars?: Record<string, string | number> }) {
  const { t } = useLanguage();
  return <>{t(k, vars)}</>;
}
