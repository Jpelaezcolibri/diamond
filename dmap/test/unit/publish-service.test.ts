import { describe, expect, it } from "vitest";
import { buildCaption, buildContactBlock, selectAssetsForPublish } from "../../src/services/publish.service.js";
import type { PublicationRow, PublicationAssetRow } from "../../src/repositories/types.js";

const PROPERTY = { ref: "10012722", titulo: "Apartamento Exclusivo Piso 19 – Alicante, Itagüí" };

function makePublication(partial: Partial<PublicationRow> = {}): PublicationRow {
  return {
    id: "pub-1",
    org_id: "org-1",
    property_id: "prop-1",
    kind: "single_image",
    status: "publishing",
    style_variant: "lujo",
    copy_facebook: "Copy largo para Facebook.",
    copy_instagram: "Copy corto IG 🏠",
    titulo_comercial: "Titulo",
    descripcion_comercial: "Descripcion",
    meta_title: "Meta title",
    meta_description: "Meta description",
    hashtags: ["#Sabaneta", "#ApartamentoEnVenta"],
    cta: "Escribenos por WhatsApp",
    scheduled_at: null,
    timezone: "America/Bogota",
    template_id: null,
    brand_profile_id: null,
    created_by: null,
    approved_by: null,
    approved_at: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...partial
  };
}

function makeAsset(partial: Partial<PublicationAssetRow>): PublicationAssetRow {
  return {
    id: "asset-1",
    publication_id: "pub-1",
    role: "cover",
    position: 0,
    source_image_url: "https://image.wasi.co/original",
    storage_path: "org-1/pub-1/cover-0.jpg",
    public_url: "https://storage.example.com/org-1/pub-1/cover-0.jpg",
    width: 1080,
    height: 1080,
    format: "jpeg",
    alt_text: "Foto de la fachada",
    selected_by: "ai",
    ...partial
  };
}

describe("buildCaption", () => {
  it("usa copy_facebook para facebook y copy_instagram para instagram", () => {
    const publication = makePublication();
    expect(buildCaption(publication, "facebook")).toContain("Copy largo para Facebook.");
    expect(buildCaption(publication, "instagram")).toContain("Copy corto IG");
  });

  it("agrega el CTA y los hashtags al final", () => {
    const publication = makePublication();
    const caption = buildCaption(publication, "facebook");
    expect(caption).toContain("Escribenos por WhatsApp");
    expect(caption).toContain("#Sabaneta #ApartamentoEnVenta");
  });

  it("no revienta si faltan hashtags o cta", () => {
    const publication = makePublication({ hashtags: null, cta: null });
    expect(() => buildCaption(publication, "facebook")).not.toThrow();
    expect(buildCaption(publication, "facebook")).toBe("Copy largo para Facebook.");
  });

  it("normaliza hashtags guardados sin # (publicaciones viejas)", () => {
    const publication = makePublication({ hashtags: ["Sabaneta", "#ApartamentoEnVenta"] });
    const caption = buildCaption(publication, "instagram");
    expect(caption).toContain("#Sabaneta #ApartamentoEnVenta");
  });

  it("incluye el bloque de contacto (landing + WhatsApp de Sofi con la ref) antes de los hashtags", () => {
    const publication = makePublication();
    const caption = buildCaption(publication, "facebook", PROPERTY);
    expect(caption).toContain("https://diamondinmobiliaria.com/propiedades/apartamento-exclusivo-piso-19-alicante-itagui-10012722");
    expect(caption).toContain("https://wa.me/573044653609?text=");
    expect(caption).toContain(encodeURIComponent("Hola Sofi, me interesa la propiedad 10012722"));
    expect(caption.indexOf("wa.me")).toBeLessThan(caption.indexOf("#Sabaneta"));
  });

  it("sin propiedad, el caption queda igual que antes (sin bloque de contacto)", () => {
    const publication = makePublication();
    expect(buildCaption(publication, "facebook", null)).toBe(buildCaption(publication, "facebook"));
  });
});

describe("buildContactBlock", () => {
  it("arma el slug igual que la landing (sin tildes, ref al final)", () => {
    const block = buildContactBlock(PROPERTY);
    expect(block).toContain("/propiedades/apartamento-exclusivo-piso-19-alicante-itagui-10012722");
  });

  it("la ref queda visible en texto plano y pre-llenada en el mensaje de WhatsApp", () => {
    const block = buildContactBlock(PROPERTY);
    expect(block).toContain("Ref 10012722");
    expect(block).toContain(`?text=${encodeURIComponent("Hola Sofi, me interesa la propiedad 10012722")}`);
  });

  it("devuelve null sin propiedad", () => {
    expect(buildContactBlock(null)).toBeNull();
  });
});

describe("selectAssetsForPublish", () => {
  it("single_image usa el asset 'cover'", () => {
    const assets = [makeAsset({ role: "cover" }), makeAsset({ id: "a2", role: "thumbnail" })];
    const result = selectAssetsForPublish("single_image", assets);
    expect(result.imageUrls).toEqual(["https://storage.example.com/org-1/pub-1/cover-0.jpg"]);
  });

  it("story usa el asset 'story'", () => {
    const assets = [
      makeAsset({ role: "cover" }),
      makeAsset({ id: "a2", role: "story", public_url: "https://storage.example.com/story.jpg" })
    ];
    const result = selectAssetsForPublish("story", assets);
    expect(result.imageUrls).toEqual(["https://storage.example.com/story.jpg"]);
  });

  it("carousel usa todos los assets 'carousel' ordenados por posicion", () => {
    const assets = [
      makeAsset({ id: "a3", role: "carousel", position: 2, public_url: "https://s/c2.jpg" }),
      makeAsset({ id: "a1", role: "carousel", position: 0, public_url: "https://s/c0.jpg" }),
      makeAsset({ id: "a2", role: "carousel", position: 1, public_url: "https://s/c1.jpg" })
    ];
    const result = selectAssetsForPublish("carousel", assets);
    expect(result.imageUrls).toEqual(["https://s/c0.jpg", "https://s/c1.jpg", "https://s/c2.jpg"]);
  });

  it("lanza si falta el asset requerido para el kind pedido", () => {
    expect(() => selectAssetsForPublish("story", [makeAsset({ role: "cover" })])).toThrow(/story/);
    expect(() => selectAssetsForPublish("carousel", [makeAsset({ role: "cover" })])).toThrow(/carousel/);
  });
});
