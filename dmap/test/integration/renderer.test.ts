import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { renderCreativeFromBuffer } from "../../src/creatives/renderer.js";
import type { BrandProfile } from "../../src/creatives/brand.js";

const brand: BrandProfile = {
  name: "Diamond",
  logoUrl: null,
  colors: { primary: "#0b1526", accent: "#c9a24b", text: "#ffffff" },
  fonts: { heading: "Playfair Display", body: "Inter" },
  layoutStyle: "premium_strip"
};

const input = {
  titulo: "Apartamento en Sabaneta",
  precio: "$460.000.000",
  operacion: "Venta",
  zona: "El Carmelo",
  ciudad: "Sabaneta",
  ref: "AP001",
  sourceImageUrl: "unused-in-this-test"
};

/**
 * Estos tests ejercitan el pipeline REAL (sharp -> satori -> resvg -> sharp)
 * con las fuentes de marca embebidas en dmap/assets/fonts, usando una imagen
 * sintetica generada en memoria en vez de descargar de la red. Confirma que
 * las fuentes son parseables por satori (las variable fonts originales de
 * Google Fonts NO lo son — ver dmap/ARCHITECTURE.md #E) y que el render
 * produce JPEGs validos del tamano exacto pedido para cada plataforma.
 */
describe("renderCreativeFromBuffer (pipeline real)", () => {
  it("renderiza un JPEG valido del tamano FB post (1200x630)", async () => {
    const source = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: { r: 80, g: 100, b: 120 } } })
      .jpeg()
      .toBuffer();

    const result = await renderCreativeFromBuffer(brand, input, "fb_post", source);

    expect(result.format).toBe("jpeg");
    expect(result.width).toBe(1200);
    expect(result.height).toBe(630);

    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(630);
  });

  it("renderiza el tamano IG feed (1080x1080, cuadrado)", async () => {
    const source = await sharp({ create: { width: 1600, height: 900, channels: 3, background: { r: 200, g: 200, b: 200 } } })
      .jpeg()
      .toBuffer();

    const result = await renderCreativeFromBuffer(brand, input, "ig_feed", source);

    expect(result.width).toBe(1080);
    expect(result.height).toBe(1080);
    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1080);
  });

  it("renderiza el tamano IG story (1080x1920, vertical)", async () => {
    const source = await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 50, g: 50, b: 50 } } })
      .jpeg()
      .toBuffer();

    const result = await renderCreativeFromBuffer(brand, input, "ig_story", source);

    expect(result.width).toBe(1080);
    expect(result.height).toBe(1920);
  });

  it("produce un archivo con contenido real (no vacio) y peso razonable", async () => {
    const source = await sharp({ create: { width: 1200, height: 630, channels: 3, background: { r: 10, g: 10, b: 10 } } })
      .jpeg()
      .toBuffer();

    const result = await renderCreativeFromBuffer(brand, input, "fb_post", source);

    expect(result.buffer.length).toBeGreaterThan(5000);
  });
});
