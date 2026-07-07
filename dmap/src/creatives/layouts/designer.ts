import { h, type CreativeSize, type SatoriNode } from "./types.js";
import type { BrandProfile } from "../brand.js";
import type { DesignSpec } from "../../ai/creative-designer.js";

/**
 * Layout parametrico de los motores "designer" e "hybrid": renderiza el
 * design spec que decide Claude (creative-designer.ts) sobre la foto real
 * (o la foto mejorada por Gemini en modo hibrido). El texto lo dibuja
 * satori — deterministico, jamas sale mal escrito.
 *
 * Identidad Diamond fija (no negociable por el spec): dorado #D4AF37 solo
 * para precio y CTA, panel claro blanco o grafito #1A1F2B, tipografia
 * Playfair (headline) + Inter (datos). El spec decide textos, panel y zona.
 */

const GOLD = "#D4AF37";
const GRAPHITE = "#1A1F2B";
const WHITE = "#FFFFFF";

interface PanelColors {
  bg: string;
  heading: string;
  body: string;
  muted: string;
}

function panelColors(panel: DesignSpec["panel"]): PanelColors {
  return panel === "graphite"
    ? { bg: GRAPHITE, heading: WHITE, body: "rgba(255,255,255,0.92)", muted: "rgba(255,255,255,0.65)" }
    : { bg: WHITE, heading: GRAPHITE, body: "rgba(26,31,43,0.92)", muted: "rgba(26,31,43,0.55)" };
}

/** Fila precio (dorado, una vez) + specs — o solo specs si no hay precio. */
function priceSpecsRow(brand: BrandProfile, spec: DesignSpec, colors: PanelColors, priceSize: number, metaSize: number): SatoriNode {
  const children: SatoriNode[] = [];
  if (spec.price_text) {
    children.push(
      h(
        "div",
        { style: { display: "flex", fontFamily: brand.fonts.body, fontWeight: 700, fontSize: priceSize, color: GOLD } },
        spec.price_text
      )
    );
  }
  for (const s of spec.specs) {
    children.push(
      h(
        "div",
        { style: { display: "flex", fontFamily: brand.fonts.body, fontWeight: 400, fontSize: metaSize, color: colors.body } },
        s
      )
    );
  }
  return h(
    "div",
    { style: { display: "flex", alignItems: "baseline", gap: Math.round(priceSize * 0.9), flexWrap: "wrap" } },
    children
  );
}

/** Fila inferior: ubicacion + REF a la izquierda, CTA pill dorado a la derecha. */
function footerRow(brand: BrandProfile, spec: DesignSpec, ref: string, colors: PanelColors, metaSize: number, ctaSize: number): SatoriNode {
  const left = h(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: Math.round(metaSize * 0.35) } },
    [
      ...(spec.location_text
        ? [h("div", { style: { display: "flex", fontFamily: brand.fonts.body, fontWeight: 400, fontSize: metaSize, color: colors.muted } }, spec.location_text)]
        : []),
      h(
        "div",
        { style: { display: "flex", fontFamily: brand.fonts.body, fontWeight: 700, fontSize: Math.round(metaSize * 0.85), color: colors.muted, letterSpacing: 1 } },
        `REF: ${ref}`
      )
    ]
  );
  const cta = h(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        backgroundColor: GOLD,
        color: GRAPHITE,
        fontFamily: brand.fonts.body,
        fontWeight: 700,
        fontSize: ctaSize,
        padding: `${Math.round(ctaSize * 0.55)}px ${Math.round(ctaSize * 1.1)}px`,
        borderRadius: 999
      }
    },
    spec.cta_text
  );
  return h(
    "div",
    { style: { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" } },
    [left, cta]
  );
}

/** Contenido comun del panel de texto (headline -> precio/specs -> footer). */
function panelContent(brand: BrandProfile, spec: DesignSpec, ref: string, colors: PanelColors, base: number): SatoriNode[] {
  const headingSize = Math.round(base * 1.0);
  const priceSize = Math.round(base * 0.62);
  const metaSize = Math.round(base * 0.42);
  const ctaSize = Math.round(base * 0.42);
  return [
    h(
      "div",
      {
        style: {
          display: "flex",
          fontFamily: brand.fonts.heading,
          fontWeight: 700,
          fontSize: headingSize,
          color: colors.heading,
          lineHeight: 1.12
        }
      },
      spec.headline
    ),
    h("div", { style: { display: "flex", marginTop: Math.round(base * 0.45) } }, [
      priceSpecsRow(brand, spec, colors, priceSize, metaSize)
    ]),
    h("div", { style: { display: "flex", marginTop: Math.round(base * 0.5) } }, [
      footerRow(brand, spec, ref, colors, metaSize, ctaSize)
    ])
  ];
}

export function designerLayout(brand: BrandProfile, spec: DesignSpec, ref: string, coverImageDataUri: string, size: CreativeSize): SatoriNode {
  const colors = panelColors(spec.panel);
  // Escala tipografica anclada al ancho: consistente entre feed (1080x1080)
  // y story (1080x1920) — en story el panel es proporcionalmente mas bajo,
  // que es exactamente el look editorial buscado (foto >= 65%).
  const base = Math.round(size.width * 0.055);

  // El disenador decide que mitad de la foto conservar al recortar (ver
  // creative-designer.v1.ts) — es su unica palanca real contra una foto
  // donde lo que vende la propiedad queda relegado a una esquina.
  const objectPosition = spec.photo_focus === "top" ? "center top" : spec.photo_focus === "bottom" ? "center bottom" : "center center";
  const photo = h("img", {
    src: coverImageDataUri,
    style: { position: "absolute", top: 0, left: 0, width: size.width, height: size.height, objectFit: "cover", objectPosition }
  });

  const zone =
    spec.text_zone === "bottom_card"
      ? h(
          "div",
          {
            style: {
              position: "absolute",
              left: Math.round(size.width * 0.05),
              bottom: Math.round(size.width * 0.05),
              width: Math.round(size.width * 0.72),
              display: "flex",
              flexDirection: "column",
              padding: Math.round(size.width * 0.045),
              backgroundColor: colors.bg,
              borderRadius: Math.round(size.width * 0.022),
              // Filo dorado sutil: firma visual Diamond sin invadir la foto.
              borderLeft: `${Math.max(4, Math.round(size.width * 0.006))}px solid ${GOLD}`
            }
          },
          panelContent(brand, spec, ref, colors, Math.round(base * 0.82))
        )
      : h(
          "div",
          {
            style: {
              position: "absolute",
              left: 0,
              bottom: 0,
              width: size.width,
              display: "flex",
              flexDirection: "column",
              padding: `${Math.round(size.width * 0.045)}px ${Math.round(size.width * 0.055)}px`,
              backgroundColor: colors.bg
            }
          },
          panelContent(brand, spec, ref, colors, base)
        );

  return h(
    "div",
    { style: { display: "flex", position: "relative", width: size.width, height: size.height, backgroundColor: GRAPHITE } },
    [photo, zone]
  );
}
