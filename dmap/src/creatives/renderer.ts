import satori from "satori";
import type { ReactNode } from "react";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { getBrandFonts } from "./fonts.js";
import { resolveLayout } from "./layouts/index.js";
import type { BrandProfile } from "./brand.js";
import type { CreativeData } from "./layouts/types.js";
import { CREATIVE_SIZES, type CreativeSizeKey } from "../config/constants.js";
import { fetchImageBuffer } from "../lib/fetch-image.js";

export interface RenderedCreative {
  buffer: Buffer;
  width: number;
  height: number;
  format: "jpeg";
}

export type CreativeInput = Omit<CreativeData, "coverImageDataUri"> & { sourceImageUrl: string };

export async function cropToDataUri(sourceBuffer: Buffer, width: number, height: number): Promise<string> {
  const cropped = await sharp(sourceBuffer)
    .resize({ width, height, fit: "cover", position: "attention" })
    .jpeg({ quality: 90 })
    .toBuffer();
  return `data:image/jpeg;base64,${cropped.toString("base64")}`;
}

/**
 * Arbol satori -> JPEG final (satori -> resvg -> sharp). Compartido entre la
 * plantilla clasica y el motor designer/hybrid (designer-engine.ts).
 */
export async function renderSatoriTree(tree: unknown, size: { width: number; height: number }): Promise<RenderedCreative> {
  const svg = await satori(tree as ReactNode, {
    width: size.width,
    height: size.height,
    fonts: getBrandFonts()
  });

  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: size.width } });
  const png = resvg.render().asPng();
  const jpeg = await sharp(png).jpeg({ quality: 85 }).toBuffer();

  return { buffer: jpeg, width: size.width, height: size.height, format: "jpeg" };
}

/** Descarga con reintentos: es el piso del fallback de creatives (template),
 *  no puede caerse por un blip transitorio de Wasi. */
async function downloadImage(imageUrl: string): Promise<Buffer> {
  return fetchImageBuffer(imageUrl);
}

/**
 * Nucleo del pipeline, sin red: sharp (recorte al ratio exacto) -> satori
 * (arbol -> SVG) -> resvg (SVG -> PNG) -> sharp (PNG -> JPEG final).
 * Recibe la foto ya en memoria — separado de renderCreative() para poder
 * testear el render real (satori+resvg) sin depender de la red.
 *
 * satori acepta un arbol de objetos plano (no requiere React en runtime);
 * el cast es porque sus tipos de TS solo declaran ReactNode.
 */
export async function renderCreativeFromBuffer(
  brand: BrandProfile,
  input: CreativeInput,
  sizeKey: CreativeSizeKey,
  sourceImageBuffer: Buffer
): Promise<RenderedCreative> {
  const size = CREATIVE_SIZES[sizeKey];
  const coverImageDataUri = await cropToDataUri(sourceImageBuffer, size.width, size.height);

  const layout = resolveLayout(brand.layoutStyle);
  const tree = layout(brand, { ...input, coverImageDataUri }, size);

  return renderSatoriTree(tree, size);
}

/** Pipeline completo de un creative (ver dmap/ARCHITECTURE.md #6/#E) — descarga la foto de origen y delega en renderCreativeFromBuffer. */
export async function renderCreative(brand: BrandProfile, input: CreativeInput, sizeKey: CreativeSizeKey): Promise<RenderedCreative> {
  const sourceImageBuffer = await downloadImage(input.sourceImageUrl);
  return renderCreativeFromBuffer(brand, input, sizeKey, sourceImageBuffer);
}
