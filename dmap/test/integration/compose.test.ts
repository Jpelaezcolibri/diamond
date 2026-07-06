import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { prepareCarouselPhoto, prepareSourceForEdit, composeLogoAndResize } from "../../src/creatives/compose.js";

/**
 * Pipeline real de sharp con buffers sinteticos (sin red): recorte al ratio
 * GPT, resize a tamanos Meta y composicion del logo real — las piezas que
 * el motor IA aplica DESPUES de gpt-image-1 (el logo nunca lo renderiza GPT).
 */

async function syntheticJpeg(width: number, height: number, background = { r: 80, g: 100, b: 120 }): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background } }).jpeg().toBuffer();
}

describe("prepareSourceForEdit", () => {
  it("recorta la foto real al ratio cuadrado de gpt-image-1 (1024x1024)", async () => {
    const source = await syntheticJpeg(2000, 1500);
    const out = await prepareSourceForEdit(source, "1024x1024");
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(1024);
    expect(meta.height).toBe(1024);
    expect(meta.format).toBe("jpeg");
  });

  it("recorta al ratio vertical de story (1024x1536)", async () => {
    const source = await syntheticJpeg(2000, 1500);
    const out = await prepareSourceForEdit(source, "1024x1536");
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(1024);
    expect(meta.height).toBe(1536);
  });

  it("rechaza un tamano invalido", async () => {
    const source = await syntheticJpeg(100, 100);
    await expect(prepareSourceForEdit(source, "invalido")).rejects.toThrow(/Tamano GPT invalido/);
  });
});

describe("prepareCarouselPhoto", () => {
  it("recorta cualquier foto al cuadrado 1080x1080 del carrusel (mismo ratio que el cover IA)", async () => {
    const horizontal = await syntheticJpeg(2400, 1600);
    const vertical = await syntheticJpeg(900, 1600);
    for (const source of [horizontal, vertical]) {
      const result = await prepareCarouselPhoto(source);
      expect(result.width).toBe(1080);
      expect(result.height).toBe(1080);
      expect(result.format).toBe("jpeg");
      const meta = await sharp(result.buffer).metadata();
      expect(meta.width).toBe(1080);
      expect(meta.height).toBe(1080);
    }
  });
});

describe("composeLogoAndResize", () => {
  it("sin logo: solo reescala al tamano Meta ig_feed (1080x1080)", async () => {
    const generated = await syntheticJpeg(1024, 1024);
    const result = await composeLogoAndResize(generated, null, "ig_feed");
    expect(result.width).toBe(1080);
    expect(result.height).toBe(1080);
    expect(result.format).toBe("jpeg");
    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1080);
  });

  it("story: 1024x1536 generado -> 1080x1920 final", async () => {
    const generated = await syntheticJpeg(1024, 1536);
    const result = await composeLogoAndResize(generated, null, "ig_story");
    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1920);
  });

  it("con logo: la esquina superior izquierda cambia respecto al fondo (logo compuesto ~8% del ancho)", async () => {
    // Fondo azul oscuro uniforme + logo blanco puro: el pixel dentro del area
    // del logo debe ser claramente mas claro que el fondo.
    const generated = await syntheticJpeg(1024, 1024, { r: 10, g: 20, b: 40 });
    const logo = await sharp({ create: { width: 400, height: 400, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
      .png()
      .toBuffer();

    const result = await composeLogoAndResize(generated, logo, "ig_feed");

    // margen 4% de 1080 = ~43px; logo 8% = ~86px de ancho. Pixel (60,60) cae dentro del logo.
    const raw = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => {
      const idx = (y * raw.info.width + x) * raw.info.channels;
      return { r: raw.data[idx]!, g: raw.data[idx + 1]!, b: raw.data[idx + 2]! };
    };
    const inLogo = px(60, 60);
    const inBackground = px(540, 540);
    expect(inLogo.r).toBeGreaterThan(200);
    expect(inBackground.r).toBeLessThan(60);
  });
});
