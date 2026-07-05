"use client";

import * as React from "react";
import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface WhatsAppFabProps {
  href: string;
  label?: string;
}

/**
 * Boton flotante de WhatsApp — regla del playbook: siempre alcanzable,
 * nunca tapa CTAs. Aparece tras 400px de scroll para no competir con el hero.
 */
export function WhatsAppFab({ href, label = "Escríbenos por WhatsApp" }: WhatsAppFabProps) {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      data-fab
      className={cn(
        "fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full",
        "bg-whatsapp text-whatsapp-foreground shadow-overlay",
        "transition-all duration-300 hover:scale-105 motion-reduce:transition-none motion-reduce:hover:scale-100",
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"
      )}
    >
      <MessageCircle className="size-6" aria-hidden="true" />
    </a>
  );
}
