import { describe, expect, it } from "vitest";
import { designerLayout } from "../../src/creatives/layouts/designer.js";
import type { BrandProfile } from "../../src/creatives/brand.js";
import type { DesignSpec } from "../../src/ai/creative-designer.js";
import type { SatoriNode } from "../../src/creatives/layouts/types.js";

const brand: BrandProfile = {
  id: null,
  name: "Diamond",
  logoUrl: null,
  colors: { primary: "#0b1526", accent: "#c9a24b", text: "#ffffff" },
  fonts: { heading: "Playfair Display", body: "Inter" },
  layoutStyle: "designer"
};

const spec: DesignSpec = {
  headline: "Inversión Privilegiada Frente a Provenza",
  price_text: "$895.000.000",
  specs: ["Estudio", "2 baños", "117 m²"],
  location_text: "El Poblado, Medellín",
  cta_text: "Agenda tu visita privada",
  panel: "light",
  text_zone: "bottom_strip",
  photo_focus: "center",
  photo_prompt: "mejora la luz",
  rationale: "test"
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

describe("designerLayout", () => {
  const size = { width: 1080, height: 1080 };

  it("el nodo del headline envuelve en varias lineas (flexWrap) en vez de desbordar el canvas", () => {
    // Bug real: sin flexWrap, satori (a diferencia de un navegador) no envuelve
    // texto dentro de un div flex — un headline de 5-6 palabras se renderizaba
    // como una sola linea que se salia del ancho del panel y quedaba cortado
    // en ambos bordes de la pieza final.
    const tree = designerLayout(brand, spec, "data:image/jpeg;base64,AAAA", size);
    const headlineNode = findAll(tree, (n) => n.props.children === spec.headline);
    expect(headlineNode).toHaveLength(1);
    expect(headlineNode[0]!.props.style?.flexWrap).toBe("wrap");
  });

  it("funciona igual en text_zone bottom_card", () => {
    const tree = designerLayout(brand, { ...spec, text_zone: "bottom_card" }, "data:image/jpeg;base64,AAAA", size);
    const headlineNode = findAll(tree, (n) => n.props.children === spec.headline);
    expect(headlineNode[0]!.props.style?.flexWrap).toBe("wrap");
  });

  it("ya no dibuja ubicacion/REF/boton CTA encima de la foto (viven en el copy del post, no en la imagen)", () => {
    // Hallazgo real: el panel completo (headline+precio+specs+footer) tapaba
    // ~1/3 de la pieza. location/REF/CTA ya estan en el copy del post, asi
    // que sacarlos de la imagen reduce el panel sin perder informacion real.
    const tree = designerLayout(brand, spec, "data:image/jpeg;base64,AAAA", size);
    const text = JSON.stringify(tree);
    expect(text).not.toContain("El Poblado");
    expect(text).not.toContain("REF:");
    expect(text).not.toContain("Agenda tu visita privada");
  });

  it("bottom_strip usa un degradado (no un bloque solido) para dejar ver la foto detras del texto", () => {
    const tree = designerLayout(brand, spec, "data:image/jpeg;base64,AAAA", size);
    const panel = findAll(tree, (n) => typeof n.props.style?.backgroundImage === "string");
    expect(panel).toHaveLength(1);
    expect(panel[0]!.props.style?.backgroundImage).toContain("linear-gradient");
    expect(panel[0]!.props.style?.backgroundColor).toBeUndefined();
  });

  it("bottom_card sigue con fondo solido (es una tarjeta flotante, no una franja)", () => {
    const tree = designerLayout(brand, { ...spec, text_zone: "bottom_card" }, "data:image/jpeg;base64,AAAA", size);
    const card = findAll(tree, (n) => n.props.style?.backgroundColor === "#FFFFFF");
    expect(card.length).toBeGreaterThan(0);
  });
});
