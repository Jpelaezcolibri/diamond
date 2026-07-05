import { describe, expect, it } from "vitest";
import { premiumStripLayout } from "../../src/creatives/layouts/premium-strip.js";
import type { BrandProfile } from "../../src/creatives/brand.js";
import type { SatoriNode } from "../../src/creatives/layouts/types.js";

const brand: BrandProfile = {
  name: "Diamond",
  logoUrl: null,
  colors: { primary: "#0b1526", accent: "#c9a24b", text: "#ffffff" },
  fonts: { heading: "Playfair Display", body: "Inter" },
  layoutStyle: "premium_strip"
};

const data = {
  titulo: "Apartamento en Sabaneta",
  precio: "$460.000.000",
  operacion: "Venta",
  zona: "El Carmelo",
  ciudad: "Sabaneta",
  ref: "AP001",
  coverImageDataUri: "data:image/jpeg;base64,AAAA"
};

function findAll(node: SatoriNode, predicate: (n: SatoriNode) => boolean, out: SatoriNode[] = []): SatoriNode[] {
  if (predicate(node)) out.push(node);
  const children = node.props.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      if (child && typeof child === "object" && "type" in child) findAll(child as SatoriNode, predicate, out);
    }
  } else if (children && typeof children === "object" && "type" in children) {
    findAll(children as SatoriNode, predicate, out);
  }
  return out;
}

function allText(node: SatoriNode): string {
  const children = node.props.children;
  if (typeof children === "string") return children;
  if (Array.isArray(children)) {
    return children
      .map((c) => (c && typeof c === "object" && "type" in c ? allText(c as SatoriNode) : ""))
      .join(" ");
  }
  if (children && typeof children === "object" && "type" in children) return allText(children as SatoriNode);
  return "";
}

describe("premiumStripLayout", () => {
  const size = { width: 1200, height: 630 };
  const tree = premiumStripLayout(brand, data, size);

  it("produce un div raiz del tamano exacto pedido", () => {
    expect(tree.type).toBe("div");
    expect(tree.props.style?.width).toBe(1200);
    expect(tree.props.style?.height).toBe(630);
  });

  it("incluye la foto de portada como <img> a pantalla completa", () => {
    const images = findAll(tree, (n) => n.type === "img");
    expect(images).toHaveLength(1);
    expect(images[0]!.props.src).toBe(data.coverImageDataUri);
    expect(images[0]!.props.style?.width).toBe(1200);
    expect(images[0]!.props.style?.height).toBe(630);
  });

  it("incluye titulo, precio+operacion, zona/ciudad y REF en el texto", () => {
    const text = allText(tree);
    expect(text).toContain("Apartamento en Sabaneta");
    expect(text).toContain("$460.000.000");
    expect(text).toContain("Venta");
    expect(text).toContain("El Carmelo, Sabaneta");
    expect(text).toContain("REF: AP001");
  });

  it("usa los colores y tipografias de la marca, no valores fijos", () => {
    const otherBrand: BrandProfile = {
      ...brand,
      name: "Otra Inmobiliaria",
      colors: { primary: "#101010", accent: "#00ff00", text: "#eeeeee" },
      fonts: { heading: "Otra Heading", body: "Otra Body" }
    };
    const otherTree = premiumStripLayout(otherBrand, data, size);
    expect(otherTree.props.style?.backgroundColor).toBe("#101010");

    const headingNode = findAll(otherTree, (n) => n.props.style?.fontFamily === "Otra Heading");
    expect(headingNode.length).toBeGreaterThan(0);
  });

  it("cuando falta precio y operacion, cae a 'Consultar precio'", () => {
    const withoutPrice = premiumStripLayout(brand, { ...data, precio: null, operacion: null }, size);
    expect(allText(withoutPrice)).toContain("Consultar precio");
  });
});
