"use client";

import { useState } from "react";

interface CreativeImageProps {
  src: string | null | undefined;
  alt: string;
  className?: string;
  /** Etiqueta corta del placeholder cuando la imagen no carga (ej. "Portada", "Foto 2"). */
  label?: string;
  /** Oculta el botón "Reintentar" — necesario cuando el <img> va dentro de un
   *  <button> (un botón anidado es HTML inválido), ej. el selector de fotos. */
  showRetry?: boolean;
}

/**
 * <img> blindado para creativos/fotos (Supabase Storage o Wasi). Si la URL no
 * carga —blip de red/CDN, foto no disponible— muestra un placeholder de marca
 * en vez del icono de imagen rota, con un botón para reintentar (cache-bust).
 * Es solo preview: nunca bloquea la página ni la publicación (el publish real
 * lo resuelve DMAP del lado servidor con su propia URL).
 */
export function CreativeImage({ src, alt, className, label, showRetry = true }: CreativeImageProps) {
  const [failed, setFailed] = useState(false);
  const [bust, setBust] = useState(0);

  if (!src || failed) {
    return (
      <div
        role="img"
        aria-label={`${alt} — imagen no disponible`}
        className={`flex min-h-[7rem] flex-col items-center justify-center gap-1 bg-slate-100 text-slate-400 ${className ?? ""}`}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-4.5-4.5L5 21" />
        </svg>
        <span className="px-1 text-center text-[10px] leading-tight">{label ?? "Imagen no disponible"}</span>
        {src && showRetry && (
          <button
            type="button"
            onClick={() => {
              setFailed(false);
              setBust(Date.now());
            }}
            className="text-[10px] font-medium text-[#c9a24b] hover:underline"
          >
            Reintentar
          </button>
        )}
      </div>
    );
  }

  const finalSrc = bust ? `${src}${src.includes("?") ? "&" : "?"}v=${bust}` : src;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={finalSrc} alt={alt} className={className} loading="lazy" onError={() => setFailed(true)} />
  );
}
