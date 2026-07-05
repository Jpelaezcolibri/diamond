"use client";

import { m, LazyMotion, domAnimation, useReducedMotion } from "framer-motion";
import { fadeUp, fade, staggerContainer } from "./motion";

interface FadeInProps {
  children: React.ReactNode;
  className?: string;
  /** Retraso en segundos (para composiciones manuales). */
  delay?: number;
  variant?: "up" | "fade";
}

/** Scroll-reveal sutil. Con prefers-reduced-motion el contenido aparece sin animar. */
export function FadeIn({ children, className, delay = 0, variant = "up" }: FadeInProps) {
  const reduced = useReducedMotion();
  const variants = variant === "up" ? fadeUp : fade;

  if (reduced) return <div className={className}>{children}</div>;

  return (
    <LazyMotion features={domAnimation} strict>
      <m.div
        className={className}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-80px" }}
        variants={variants}
        transition={delay ? { delay } : undefined}
      >
        {children}
      </m.div>
    </LazyMotion>
  );
}

interface StaggerProps {
  children: React.ReactNode;
  className?: string;
  /** Clase aplicada a cada hijo animado. */
  itemClassName?: string;
  stagger?: number;
}

/** Grid/lista con entrada escalonada de sus hijos directos. */
export function Stagger({ children, className, itemClassName, stagger = 0.08 }: StaggerProps) {
  const reduced = useReducedMotion();

  if (reduced) {
    return (
      <div className={className}>
        {Array.isArray(children)
          ? children.map((child, i) => (
              <div key={i} className={itemClassName}>
                {child}
              </div>
            ))
          : children}
      </div>
    );
  }

  return (
    <LazyMotion features={domAnimation} strict>
      <m.div
        className={className}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-80px" }}
        variants={staggerContainer(stagger)}
      >
        {Array.isArray(children)
          ? children.map((child, i) => (
              <m.div key={i} className={itemClassName} variants={fadeUp}>
                {child}
              </m.div>
            ))
          : children}
      </m.div>
    </LazyMotion>
  );
}
