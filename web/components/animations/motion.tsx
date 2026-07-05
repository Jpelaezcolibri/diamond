"use client";

// Tokens de movimiento REF: sutil, estilo Apple. Nunca distraer.
export const EASE = [0.22, 1, 0.36, 1] as const;

export const DURATION = {
  fast: 0.2,
  base: 0.5,
  slow: 0.7,
} as const;

export const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE } },
};

export const fade = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: DURATION.slow, ease: EASE } },
};

export const staggerContainer = (stagger = 0.08) => ({
  hidden: {},
  visible: { transition: { staggerChildren: stagger } },
});

/** Reveal de imagen: entra con un zoom que se asienta. */
export const imageReveal = {
  hidden: { opacity: 0, scale: 1.06 },
  visible: { opacity: 1, scale: 1, transition: { duration: DURATION.slow, ease: EASE } },
};
