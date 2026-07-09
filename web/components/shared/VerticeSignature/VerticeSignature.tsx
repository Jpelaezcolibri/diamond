"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./VerticeSignature.module.css";

export type VerticeSignaturePosition = "bottom-right" | "bottom-left" | "footer" | "custom";

export interface VerticeSignatureProps {
  /** Destino al hacer click. Por defecto, el sitio de Vértice Studio. */
  href?: string;
  /** Diámetro del badge en px. 48–56 para flotante; footer/custom admiten más. */
  size?: number;
  /** Texto del tooltip al hacer hover/focus. */
  tooltip?: string;
  /**
   * Cómo se posiciona el badge:
   * - "bottom-right" / "bottom-left": fixed, flotante, listo para usar.
   * - "footer": sin position fijo, pensado para insertarse dentro de un footer.
   * - "custom": sin estilos de posición; el contenedor padre controla el layout.
   */
  position?: VerticeSignaturePosition;
  /** Ruta del video del anillo (cópialo a /public en cada proyecto). */
  videoSrc?: string;
  /** Clases adicionales para el contenedor exterior. */
  className?: string;
  /** Hook para analítica (PostHog, GA, etc). No bloquea la navegación. */
  onClick?: () => void;
}

const DEFAULT_HREF = "https://vertice-studio-mu.vercel.app/";
const DEFAULT_TOOLTIP = "Built by Vértice Studio";
const DEFAULT_VIDEO_SRC = "/vertice-signature.mp4";

export function VerticeSignature({
  href = DEFAULT_HREF,
  size = 52,
  tooltip = DEFAULT_TOOLTIP,
  position = "bottom-right",
  videoSrc = DEFAULT_VIDEO_SRC,
  className,
  onClick,
}: VerticeSignatureProps) {
  const linkRef = useRef<HTMLAnchorElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isActive, setIsActive] = useState(false);

  // Reproduce el video solo en cliente; respeta prefers-reduced-motion.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      video.pause();
      return;
    }
    video.play().catch(() => {
      // autoplay bloqueado por el navegador: no es crítico, el badge sigue siendo funcional.
    });
  }, []);

  const handleClick = () => {
    onClick?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLAnchorElement>) => {
    if (e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      linkRef.current?.click();
    }
  };

  const clampedSize = Math.min(120, Math.max(32, size));

  return (
    <a
      ref={linkRef}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={tooltip}
      title={tooltip}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setIsActive(true)}
      onMouseLeave={() => setIsActive(false)}
      onFocus={() => setIsActive(true)}
      onBlur={() => setIsActive(false)}
      className={[
        styles.badge,
        styles[`pos-${position}`],
        className ?? "",
      ].join(" ").trim()}
      style={{ width: clampedSize, height: clampedSize }}
    >
      <span className={styles.ring} aria-hidden="true">
        <video
          ref={videoRef}
          className={styles.video}
          src={videoSrc}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
        />
      </span>
      <span
        className={styles.tooltip}
        data-visible={isActive || undefined}
        role="tooltip"
      >
        {tooltip}
      </span>
    </a>
  );
}

export default VerticeSignature;
