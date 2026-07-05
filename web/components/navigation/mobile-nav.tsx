"use client";

import * as React from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { Menu, X, MessageCircle } from "lucide-react";
import { Button } from "@/components/design-system/button";

interface MobileNavProps {
  links: { href: string; label: string }[];
  whatsappUrl: string;
  brandName: string;
}

export function MobileNav({ links, whatsappUrl, brandName }: MobileNavProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          className="flex h-10 w-10 items-center justify-center rounded-brand text-foreground md:hidden"
          aria-label="Abrir menú"
        >
          <Menu className="size-5" aria-hidden="true" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm data-[state=open]:animate-in md:hidden" />
        <Dialog.Content
          className="fixed inset-y-0 right-0 z-50 flex w-72 flex-col bg-background p-6 shadow-overlay outline-none md:hidden"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="font-heading text-lg">{brandName}</Dialog.Title>
            <Dialog.Close asChild>
              <button
                className="flex h-10 w-10 items-center justify-center rounded-brand text-muted"
                aria-label="Cerrar menú"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          <nav aria-label="Principal móvil" className="mt-8 flex flex-col gap-1">
            <Link
              href="/"
              onClick={() => setOpen(false)}
              className="rounded-brand px-3 py-3 text-base hover:bg-foreground/5"
            >
              Inicio
            </Link>
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-brand px-3 py-3 text-base hover:bg-foreground/5"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="mt-auto">
            <Button asChild variant="whatsapp" className="w-full">
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                <MessageCircle aria-hidden="true" />
                Hablemos por WhatsApp
              </a>
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
