import { describe, expect, it } from "vitest";
import {
  buildImageUrls,
  extractImageKeys,
  isSuspiciousVentaPrice,
  parseWasiPage
} from "../../src/sync/wasi-public.source.js";

function fakeImageUrl(key: string): string {
  const payload = { bucket: "staticw", key, edits: { resize: { width: 156 } } };
  return `https://image.wasi.co/${Buffer.from(JSON.stringify(payload)).toString("base64")}`;
}

describe("extractImageKeys", () => {
  it("extrae solo las keys que empiezan por inmuebles/, en orden y sin duplicados", () => {
    const html = `
      <img src="${fakeImageUrl("inmuebles/foto1.jpg")}">
      <img src="${fakeImageUrl("static/logo-wasi.png")}">
      <img src="${fakeImageUrl("inmuebles/foto2.jpg")}">
      <img src="${fakeImageUrl("inmuebles/foto1.jpg")}">
    `;
    expect(extractImageKeys(html)).toEqual(["inmuebles/foto1.jpg", "inmuebles/foto2.jpg"]);
  });

  it("ignora payloads base64 corruptos sin lanzar", () => {
    const html = `<img src="https://image.wasi.co/no-es-json-valido===">`;
    expect(extractImageKeys(html)).toEqual([]);
  });

  it("devuelve vacio si no hay imagenes", () => {
    expect(extractImageKeys("<html><body>sin fotos</body></html>")).toEqual([]);
  });
});

describe("buildImageUrls", () => {
  it("re-encodea las keys a 1600px por defecto", () => {
    const [url] = buildImageUrls(["inmuebles/foto1.jpg"]);
    const b64 = url!.replace("https://image.wasi.co/", "");
    const decoded = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    expect(decoded.key).toBe("inmuebles/foto1.jpg");
    expect(decoded.edits.resize.width).toBe(1600);
  });

  it("respeta un ancho custom", () => {
    const [url] = buildImageUrls(["inmuebles/foto1.jpg"], 800);
    const b64 = url!.replace("https://image.wasi.co/", "");
    const decoded = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    expect(decoded.edits.resize.width).toBe(800);
  });
});

describe("parseWasiPage", () => {
  it("parsea precio de venta y titulo", () => {
    const html = `<title>Apartamento en Sabaneta</title>Precio venta <p class="pr1">$460.000.000</p>`;
    const result = parseWasiPage(html);
    expect(result).toEqual({
      operacion: "Venta",
      precio: "$460.000.000",
      titulo: "Apartamento en Sabaneta",
      precioRegexOk: true
    });
  });

  it("parsea precio de renta como Arriendo", () => {
    const html = `<title>Apto en arriendo</title>Precio renta <p class="pr1">$2.200.000</p>`;
    const result = parseWasiPage(html);
    expect(result.operacion).toBe("Arriendo");
    expect(result.precio).toBe("$2.200.000");
  });

  it("marca precioRegexOk=false si Wasi cambio el HTML", () => {
    const html = `<title>Propiedad</title>El precio esta en otro formato ahora`;
    const result = parseWasiPage(html);
    expect(result.precioRegexOk).toBe(false);
    expect(result.precio).toBeNull();
    expect(result.titulo).toBe("Propiedad");
  });
});

describe("isSuspiciousVentaPrice", () => {
  it("marca como sospechoso una venta por menos de 50 millones", () => {
    expect(isSuspiciousVentaPrice("Venta", "$1.550.000")).toBe(true);
  });

  it("no marca una venta normal", () => {
    expect(isSuspiciousVentaPrice("Venta", "$460.000.000")).toBe(false);
  });

  it("no aplica el guardian a arriendos", () => {
    expect(isSuspiciousVentaPrice("Arriendo", "$1.550.000")).toBe(false);
  });

  it("no aplica sin precio", () => {
    expect(isSuspiciousVentaPrice("Venta", null)).toBe(false);
  });
});
