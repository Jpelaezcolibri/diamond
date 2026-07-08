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
  /**
   * Halo de contraste independiente del degradado — hallazgo real: con el
   * panel bottom_strip en degradado (ver designerLayout), el headline/precio
   * caen justo en la zona MAS transparente (arriba del todo), asi que su
   * legibilidad depende de que colores tenga la foto ahi (ej. texto dorado
   * sobre cesped claro = casi ilegible, reportado por el critico). Esto
   * garantiza contraste pase lo que pase debajo, sin depender de que el
   * degradado ya haya oscurecido/aclarado lo suficiente en ese punto.
   */
  textShadow: string;
}

function panelColors(panel: DesignSpec["panel"]): PanelColors {
  return panel === "graphite"
    ? {
        bg: GRAPHITE,
        heading: WHITE,
        body: "rgba(255,255,255,0.92)",
        muted: "rgba(255,255,255,0.65)",
        textShadow: "0 2px 16px rgba(0,0,0,0.6), 0 1px 4px rgba(0,0,0,0.7)"
      }
    : {
        bg: WHITE,
        heading: GRAPHITE,
        body: "rgba(26,31,43,0.92)",
        muted: "rgba(26,31,43,0.55)",
        textShadow: "0 2px 16px rgba(255,255,255,0.7), 0 1px 4px rgba(255,255,255,0.8)"
      };
}

/** Fila precio (dorado, una vez) + specs — o solo specs si no hay precio. */
function priceSpecsRow(brand: BrandProfile, spec: DesignSpec, colors: PanelColors, priceSize: number, metaSize: number): SatoriNode {
  const children: SatoriNode[] = [];
  if (spec.price_text) {
    children.push(
      h(
        "div",
        { style: { display: "flex", fontFamily: brand.fonts.body, fontWeight: 700, fontSize: priceSize, color: GOLD, textShadow: colors.textShadow } },
        spec.price_text
      )
    );
  }
  for (const s of spec.specs) {
    children.push(
      h(
        "div",
        { style: { display: "flex", fontFamily: brand.fonts.body, fontWeight: 400, fontSize: metaSize, color: colors.body, textShadow: colors.textShadow } },
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

/**
 * Contenido del panel de texto: SOLO headline + precio/specs. Ubicacion, REF
 * y un boton de CTA dibujado encima de la foto se sacaron del render (hasta
 * 2026-07-08 vivian aca) — hallazgo real revisando como publican Compass,
 * Sotheby's y The Agency: sus piezas dejan la foto casi a pantalla completa,
 * con texto minimo superpuesto; ubicacion/REF/CTA viven en el copy del post
 * (que DMAP ya genera aparte, ver copywriter.ts), no encima de la imagen.
 * Menos contenido = panel mas bajo = menos foto tapada, sin tocar el copy.
 */
function panelContent(brand: BrandProfile, spec: DesignSpec, colors: PanelColors, base: number): SatoriNode[] {
  const headingSize = Math.round(base * 1.0);
  const priceSize = Math.round(base * 0.62);
  const metaSize = Math.round(base * 0.42);
  return [
    h(
      "div",
      {
        style: {
          display: "flex",
          // Sin flexWrap, satori (a diferencia de un navegador) NO envuelve
          // el texto a una segunda linea: lo extiende como una sola linea
          // mas alla del ancho del panel, y termina renderizado fuera del
          // canvas de la pieza (bug real: headlines de 5-6 palabras
          // aparecian cortados en ambos bordes de la imagen). width:100%
          // ancla el wrap al ancho del panel en vez de al contenido.
          flexWrap: "wrap",
          width: "100%",
          fontFamily: brand.fonts.heading,
          fontWeight: 700,
          fontSize: headingSize,
          color: colors.heading,
          textShadow: colors.textShadow,
          lineHeight: 1.12
        }
      },
      spec.headline
    ),
    h("div", { style: { display: "flex", marginTop: Math.round(base * 0.45) } }, [
      priceSpecsRow(brand, spec, colors, priceSize, metaSize)
    ])
  ];
}

export function designerLayout(brand: BrandProfile, spec: DesignSpec, coverImageDataUri: string, size: CreativeSize): SatoriNode {
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
          panelContent(brand, spec, colors, Math.round(base * 0.82))
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
              // Degradado (transparente arriba -> solido abajo) en vez de un
              // bloque opaco: con solo headline+precio/specs (ver
              // panelContent) el panel ya es mucho mas bajo, y el degradado
              // deja ver la foto incluso en la franja de texto — hallazgo
              // real: un panel solido de 1/3 de la pieza "tapaba toda la
              // foto" segun el cliente, aunque el contenido fuera correcto.
              backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0) 0%, ${colors.bg} 55%)`
            }
          },
          panelContent(brand, spec, colors, base)
        );

  return h(
    "div",
    { style: { display: "flex", position: "relative", width: size.width, height: size.height, backgroundColor: GRAPHITE } },
    [photo, zone]
  );
}
