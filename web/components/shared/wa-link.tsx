"use client";

import * as React from "react";
import { useLanguage } from "./language-provider";
import { localizeText, type LocalizedText } from "@/config/i18n";
import { waUrl } from "@/lib/whatsapp";

interface WaLinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  number: string;
  message: LocalizedText;
  /** Reemplaza {ref} en el mensaje (CTA de una propiedad). */
  refValue?: string;
}

/**
 * Anchor a wa.me con el mensaje prellenado en el IDIOMA ACTIVO del visitante.
 * Es la pieza que le avisa a Sofi que el cliente viene de la pagina en ingles:
 * el prellenado EN dispara la deteccion de idioma del bot (leads.idioma).
 * Server components la usan pasando number + mensaje bilingue por props.
 */
export const WaLink = React.forwardRef<HTMLAnchorElement, WaLinkProps>(function WaLink(
  { number, message, refValue, children, ...rest },
  ref
) {
  const { language } = useLanguage();
  let text = localizeText(message, language);
  if (refValue) text = text.replace("{ref}", refValue);
  return (
    <a ref={ref} href={waUrl(number, text)} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  );
});
