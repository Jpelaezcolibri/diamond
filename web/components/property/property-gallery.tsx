"use client";

import * as React from "react";
import Image from "next/image";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X, Images } from "lucide-react";
import type { Property } from "@/types/property";
import { cn } from "@/lib/utils";

interface PropertyGalleryProps {
  property: Property;
  /** Fallback server-rendered cuando no hay fotos (PropertyImage placeholder). */
  placeholder: React.ReactNode;
}

/**
 * Galeria editorial: 1 imagen grande + hasta 4 secundarias, lightbox con
 * teclado (←/→/Esc). Con 0 fotos muestra el placeholder de marca.
 */
export function PropertyGallery({ property, placeholder }: PropertyGalleryProps) {
  const images = property.images;
  const [open, setOpen] = React.useState(false);
  const [index, setIndex] = React.useState(0);

  const show = (i: number) => {
    setIndex(i);
    setOpen(true);
  };
  const prev = React.useCallback(() => setIndex((i) => (i - 1 + images.length) % images.length), [images.length]);
  const next = React.useCallback(() => setIndex((i) => (i + 1) % images.length), [images.length]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, prev, next]);

  if (!images.length) {
    return <div className="relative aspect-[3/2] overflow-hidden rounded-brand-lg md:aspect-[21/9]">{placeholder}</div>;
  }

  const secondary = images.slice(1, 5);
  const alt = (i: number) => `${property.titulo} — foto ${i + 1} de ${images.length}`;

  return (
    <>
      <div className={cn("grid gap-2", secondary.length > 0 && "md:grid-cols-[2fr_1fr]")}>
        <button
          onClick={() => show(0)}
          className="group relative aspect-[3/2] overflow-hidden rounded-brand-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          aria-label="Ampliar foto principal"
        >
          <Image
            src={images[0]}
            alt={alt(0)}
            fill
            priority
            unoptimized
            sizes="(max-width: 768px) 100vw, 66vw"
            className="object-cover transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.02] motion-reduce:transition-none"
          />
          {images.length > 1 ? (
            <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white backdrop-blur-sm">
              <Images className="size-3.5" aria-hidden="true" />
              {images.length} fotos
            </span>
          ) : null}
        </button>

        {secondary.length > 0 ? (
          <div className={cn("grid gap-2", secondary.length > 2 ? "grid-cols-2" : "grid-cols-1")}>
            {secondary.map((src, i) => (
              <button
                key={src}
                onClick={() => show(i + 1)}
                className="relative hidden aspect-[3/2] overflow-hidden rounded-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:block"
                aria-label={`Ampliar foto ${i + 2}`}
              >
                <Image src={src} alt={alt(i + 1)} fill unoptimized sizes="17vw" className="object-cover" />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm" />
          <Dialog.Content
            className="fixed inset-0 z-50 flex items-center justify-center p-4 outline-none md:p-10"
            aria-describedby={undefined}
          >
            <Dialog.Title className="sr-only">Galería de {property.titulo}</Dialog.Title>
            <div className="relative h-full w-full max-w-5xl">
              <Image
                src={images[index]}
                alt={alt(index)}
                fill
                unoptimized
                sizes="100vw"
                className="object-contain"
              />
            </div>

            <Dialog.Close asChild>
              <button
                className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                aria-label="Cerrar galería"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </Dialog.Close>

            {images.length > 1 ? (
              <>
                <button
                  onClick={prev}
                  className="absolute left-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                  aria-label="Foto anterior"
                >
                  <ChevronLeft className="size-5" aria-hidden="true" />
                </button>
                <button
                  onClick={next}
                  className="absolute right-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                  aria-label="Foto siguiente"
                >
                  <ChevronRight className="size-5" aria-hidden="true" />
                </button>
                <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-white/80 tabular-nums">
                  {index + 1} / {images.length}
                </p>
              </>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
