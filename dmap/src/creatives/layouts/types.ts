import type { BrandProfile } from "../brand.js";

/**
 * Nodo minimo compatible con la API de satori (no usamos JSX/React — este
 * es el formato de arbol "hyperscript" que satori acepta directamente).
 */
export interface SatoriNode {
  type: string;
  props: {
    style?: Record<string, unknown>;
    children?: SatoriNode | SatoriNode[] | string;
    [key: string]: unknown;
  };
}

export function h(type: string, props: Record<string, unknown> = {}, children?: SatoriNode | SatoriNode[] | string): SatoriNode {
  return { type, props: { ...props, ...(children !== undefined ? { children } : {}) } };
}

export interface CreativeData {
  titulo: string;
  precio: string | null;
  operacion: string | null;
  zona: string | null;
  ciudad: string | null;
  ref: string;
  /** Foto ya recortada al ratio del tamano objetivo, como data URI (ver creatives/renderer.ts). */
  coverImageDataUri: string;
}

export interface CreativeSize {
  width: number;
  height: number;
}

export type LayoutFn = (brand: BrandProfile, data: CreativeData, size: CreativeSize) => SatoriNode;
