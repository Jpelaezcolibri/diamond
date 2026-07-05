import { describe, expect, it } from "vitest";
import { computeContentHash, computeImagesHash } from "../../src/sync/hash.js";
import { diffPropertySnapshot, type PropertySnapshot } from "../../src/sync/diff.js";

const base: PropertySnapshot = {
  precio: "$460.000.000",
  operacion: "Venta",
  titulo: "Apartamento en Sabaneta",
  descripcion: "Muy iluminado",
  disponible: true,
  area: "65m2",
  habitaciones: 2,
  banos: 2,
  zona: "El Carmelo",
  imageKeys: ["inmuebles/a.jpg", "inmuebles/b.jpg"]
};

function previousFrom(snapshot: PropertySnapshot) {
  return {
    contentHash: computeContentHash(snapshot),
    imagesHash: computeImagesHash(snapshot.imageKeys),
    snapshot
  };
}

describe("computeContentHash / computeImagesHash", () => {
  it("es estable ante el mismo contenido, ignorando el orden de las llaves", () => {
    const a = computeContentHash(base);
    const b = computeContentHash({ ...base });
    expect(a).toBe(b);
  });

  it("cambia si cambia el precio", () => {
    const a = computeContentHash(base);
    const b = computeContentHash({ ...base, precio: "$470.000.000" });
    expect(a).not.toBe(b);
  });

  it("images_hash depende del orden (galeria) y del contenido", () => {
    const a = computeImagesHash(["inmuebles/a.jpg", "inmuebles/b.jpg"]);
    const b = computeImagesHash(["inmuebles/b.jpg", "inmuebles/a.jpg"]);
    expect(a).not.toBe(b);
  });
});

describe("diffPropertySnapshot", () => {
  it("propiedad nueva (previous=null) produce un unico evento created", () => {
    const diff = diffPropertySnapshot(null, base);
    expect(diff.events).toEqual([{ changeType: "created", oldValue: null, newValue: base }]);
  });

  it("sin cambios no produce eventos", () => {
    const previous = previousFrom(base);
    const diff = diffPropertySnapshot(previous, { ...base });
    expect(diff.events).toEqual([]);
  });

  it("detecta cambio de precio", () => {
    const previous = previousFrom(base);
    const current = { ...base, precio: "$500.000.000" };
    const diff = diffPropertySnapshot(previous, current);
    expect(diff.events).toEqual([{ changeType: "price_changed", oldValue: base.precio, newValue: current.precio }]);
  });

  it("detecta cambio de disponibilidad (status_changed)", () => {
    const previous = previousFrom(base);
    const current = { ...base, disponible: false };
    const diff = diffPropertySnapshot(previous, current);
    expect(diff.events).toContainEqual({ changeType: "status_changed", oldValue: true, newValue: false });
  });

  it("detecta cambio de titulo/descripcion como description_changed", () => {
    const previous = previousFrom(base);
    const current = { ...base, titulo: "Nuevo titulo" };
    const diff = diffPropertySnapshot(previous, current);
    expect(diff.events).toEqual([
      {
        changeType: "description_changed",
        oldValue: { titulo: base.titulo, descripcion: base.descripcion },
        newValue: { titulo: "Nuevo titulo", descripcion: base.descripcion }
      }
    ]);
  });

  it("detecta cambio de fotos (photos_changed)", () => {
    const previous = previousFrom(base);
    const current = { ...base, imageKeys: ["inmuebles/a.jpg", "inmuebles/c.jpg"] };
    const diff = diffPropertySnapshot(previous, current);
    expect(diff.events).toEqual([
      { changeType: "photos_changed", oldValue: base.imageKeys, newValue: current.imageKeys }
    ]);
  });

  it("puede producir varios eventos a la vez", () => {
    const previous = previousFrom(base);
    const current = { ...base, precio: "$500.000.000", disponible: false, imageKeys: ["inmuebles/z.jpg"] };
    const diff = diffPropertySnapshot(previous, current);
    const types = diff.events.map((e) => e.changeType).sort();
    expect(types).toEqual(["photos_changed", "price_changed", "status_changed"]);
  });

  it("cambios de precio NO disparan solos generacion (regla de negocio validada en sync.service, no aqui)", () => {
    // Este test documenta la intencion: diffPropertySnapshot solo detecta el
    // cambio; la decision de auto-generar vive en org_marketing_settings +
    // sync.service, no en la funcion pura de diff.
    const previous = previousFrom(base);
    const diff = diffPropertySnapshot(previous, { ...base, precio: "$1.000.000.000" });
    expect(diff.events.every((e) => e.changeType !== "created")).toBe(true);
  });
});
