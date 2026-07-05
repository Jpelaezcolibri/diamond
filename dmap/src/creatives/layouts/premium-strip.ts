import { h, type CreativeData, type CreativeSize, type LayoutFn } from "./types.js";
import type { BrandProfile } from "../brand.js";

/**
 * Layout "premium_strip" (Fase 1, Creative Generator Lite — ver
 * dmap/ARCHITECTURE.md #6): foto a pantalla completa + franja inferior con
 * degradado en el color primario de marca, logo, titulo, precio/operacion,
 * zona y REF. Es una funcion pura (brand, data, size) => arbol satori: el
 * futuro Brand Studio (F2) solo cambia el `brand` que entra aqui.
 */
export const premiumStripLayout: LayoutFn = (brand: BrandProfile, data: CreativeData, size: CreativeSize) => {
  // minHeight (no height fija): si el titulo envuelve a 2+ lineas la franja
  // crece hacia arriba en vez de desbordar el borde inferior del lienzo —
  // clave para que el mismo layout funcione en formatos anchos-bajos
  // (fb_post) y angostos-altos (ig_story) sin recortar texto.
  const stripMinHeight = Math.round(size.height * 0.28);
  // Tipografia escalada respecto al espacio disponible de la franja, no al
  // ancho del lienzo: eso es lo que evita que el texto se vea desproporcionado
  // en formatos anchos-bajos como fb_post. El tope por ancho evita el efecto
  // contrario en formatos angostos-altos (ig_story), donde stripMinHeight es
  // grande y el titulo se veria enorme respecto al ancho disponible.
  const headingSize = Math.min(Math.round(stripMinHeight * 0.21), Math.round(size.width * 0.075));
  const priceSize = Math.min(Math.round(stripMinHeight * 0.13), Math.round(size.width * 0.045));
  const metaSize = Math.min(Math.round(stripMinHeight * 0.095), Math.round(size.width * 0.032));
  const refSize = Math.min(Math.round(stripMinHeight * 0.085), Math.round(size.width * 0.028));

  return h(
    "div",
    {
      style: {
        display: "flex",
        position: "relative",
        width: size.width,
        height: size.height,
        backgroundColor: brand.colors.primary
      }
    },
    [
      h("img", {
        src: data.coverImageDataUri,
        style: {
          position: "absolute",
          top: 0,
          left: 0,
          width: size.width,
          height: size.height,
          objectFit: "cover"
        }
      }),
      h(
        "div",
        {
          style: {
            position: "absolute",
            left: 0,
            bottom: 0,
            width: size.width,
            minHeight: stripMinHeight,
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            padding: `${Math.round(stripMinHeight * 0.12)}px ${Math.round(size.width * 0.05)}px`,
            backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0) 0%, ${brand.colors.primary} 60%)`
          }
        },
        [
          h(
            "div",
            {
              style: {
                display: "flex",
                fontFamily: brand.fonts.heading,
                fontWeight: 700,
                fontSize: headingSize,
                color: brand.colors.accent,
                lineHeight: 1.15
              }
            },
            data.titulo
          ),
          h(
            "div",
            {
              style: {
                display: "flex",
                marginTop: Math.round(stripMinHeight * 0.06),
                fontFamily: brand.fonts.body,
                fontWeight: 400,
                fontSize: priceSize,
                color: brand.colors.text
              }
            },
            [data.precio, data.operacion].filter(Boolean).join(" — ") || "Consultar precio"
          ),
          h(
            "div",
            {
              style: {
                display: "flex",
                marginTop: Math.round(stripMinHeight * 0.035),
                fontFamily: brand.fonts.body,
                fontWeight: 400,
                fontSize: metaSize,
                color: brand.colors.text,
                opacity: 0.85
              }
            },
            [data.zona, data.ciudad].filter(Boolean).join(", ")
          ),
          h(
            "div",
            {
              style: {
                display: "flex",
                marginTop: Math.round(stripMinHeight * 0.035),
                fontFamily: brand.fonts.body,
                fontWeight: 700,
                fontSize: refSize,
                color: brand.colors.text,
                letterSpacing: 1
              }
            },
            `REF: ${data.ref}`
          )
        ]
      )
    ]
  );
};
