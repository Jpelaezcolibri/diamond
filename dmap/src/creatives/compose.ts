import sharp from "sharp";
import { CREATIVE_SIZES, IMAGE_ANALYSIS_MAX_DIMENSION, LOGO_WIDTH_RATIO, type CreativeSizeKey } from "../config/constants.js";
import type { RenderedCreative } from "./renderer.js";

/**
 * Composicion post-GPT del motor IA de creativos.
 *
 * El logo NUNCA lo renderiza GPT (lo deformaria — regla de marca: nunca
 * deformar, nunca cambiar colores): se compone aqui el PNG real encima de
 * la imagen generada. Igual el resize final: gpt-image-1 solo produce
 * 1024x1024/1024x1536, los tamanos Meta (1080x1080/1080x1920) salen de sharp.
 * Solo buffers puros — testeable sin red (la descarga de foto/logo vive en
 * el orquestador ai-engine.ts).
 */

/** Margen del logo relativo al ancho del creative. */
const LOGO_MARGIN_RATIO = 0.04;

/**
 * Recorta la foto real al ratio del tamano GPT destino (fit cover con
 * atencion, mismo criterio que renderer.cropToDataUri) — fija el encuadre
 * antes de mandarla a /images/edits y reduce el payload.
 */
export async function prepareSourceForEdit(sourceBuffer: Buffer, gptSize: string): Promise<Buffer> {
  const [width, height] = gptSize.split("x").map(Number);
  if (!width || !height) throw new Error(`Tamano GPT invalido: ${gptSize}`);
  return sharp(sourceBuffer)
    .resize({ width, height, fit: "cover", position: "attention" })
    .jpeg({ quality: 90 })
    .toBuffer();
}

/** Pieza final -> base64 reducido para el critico (Claude vision). Compartido por ai-engine y designer-engine. */
export async function toCriticBase64(buffer: Buffer): Promise<string> {
  const resized = await sharp(buffer)
    .resize({ width: IMAGE_ANALYSIS_MAX_DIMENSION, height: IMAGE_ANALYSIS_MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  return resized.toString("base64");
}

/**
 * Foto real -> slide de carrusel: recorte cuadrado 1080x1080 (mismo ratio
 * que el cover IA, que va de slide 1 — IG recorta todos los hijos de un
 * carrusel al ratio del primero, mantenerlos iguales evita sorpresas) sin
 * texto ni logo: las fotos limpias son el contenido del carrusel.
 */
export async function prepareCarouselPhoto(sourceBuffer: Buffer): Promise<RenderedCreative> {
  const size = CREATIVE_SIZES.ig_feed;
  const buffer = await sharp(sourceBuffer)
    .resize({ width: size.width, height: size.height, fit: "cover", position: "attention" })
    .jpeg({ quality: 90 })
    .toBuffer();
  return { buffer, width: size.width, height: size.height, format: "jpeg" };
}

/**
 * Logo real arriba-izquierda (~8% del ancho, margen 4%) + resize al tamano
 * Meta final. logoBuffer null -> solo resize (el motor sigue sin logo y lo
 * anota, no aborta).
 */
export async function composeLogoAndResize(
  generatedBuffer: Buffer,
  logoBuffer: Buffer | null,
  sizeKey: CreativeSizeKey
): Promise<RenderedCreative> {
  const size = CREATIVE_SIZES[sizeKey];

  let pipeline = sharp(generatedBuffer).resize({ width: size.width, height: size.height, fit: "cover" });

  if (logoBuffer) {
    const logoWidth = Math.round(size.width * LOGO_WIDTH_RATIO);
    const margin = Math.round(size.width * LOGO_MARGIN_RATIO);
    const logo = await sharp(logoBuffer).resize({ width: logoWidth }).png().toBuffer();
    // El resize del canvas debe materializarse ANTES del composite (sharp
    // aplica composite sobre el input original si se encadenan en el mismo
    // pipeline y el logo puede quedar fuera de posicion en el canvas final).
    const resized = await pipeline.toBuffer();
    pipeline = sharp(resized).composite([{ input: logo, top: margin, left: margin }]);
  }

  const buffer = await pipeline.jpeg({ quality: 90 }).toBuffer();
  return { buffer, width: size.width, height: size.height, format: "jpeg" };
}
