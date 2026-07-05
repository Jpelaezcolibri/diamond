import type { PropertyRow } from "@/types/database";

// ---------------------------------------------------------------------------
// Inventario DEMO — mismo seed que db/schema.sql. Se usa cuando la web corre
// sin Supabase (TENANT_ID=demo o entorno sin credenciales). Nunca se muestra
// junto a inventario real.
// ---------------------------------------------------------------------------

const now = "2026-07-01T12:00:00.000Z";

const demo = (row: Omit<PropertyRow, "id" | "org_id" | "images" | "created_at" | "disponible"> & { disponible?: boolean; images?: string[] }, i: number): PropertyRow => ({
  id: `demo-${i + 1}`,
  org_id: "demo-org",
  images: [],
  created_at: now,
  disponible: true,
  ...row,
});

export const demoProperties: PropertyRow[] = [
  {
    ref: "AP001",
    titulo: "Apartamento Moderno en Sabaneta - Iluminado con Vista Verde",
    tipo: "Apartamento",
    operacion: "Venta",
    precio: "$460.000.000",
    area: "65m2",
    habitaciones: 2,
    banos: 2,
    garaje: 1,
    estrato: 4,
    administracion: "$290.000",
    zona: "El Carmelo, Sabaneta",
    ciudad: "Antioquia",
    descripcion:
      "Apartamento muy iluminado con vista a zona verde, ubicado cerca del parque principal de Sabaneta, con facil acceso a transporte publico y centros comerciales.",
    caracteristicas: "Porteria 24 horas, gimnasio, piscina, zona humeda, parque infantil",
    link: "https://info.wasi.co/apartamento-venta-el-carmelo-sabaneta/9755676",
    images: ["https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?q=80&w=1600&auto=format&fit=crop"],
  },
  {
    ref: "AP002",
    titulo: "Apartamento con Balcon en Envigado - Loma del Esmeraldal",
    tipo: "Apartamento",
    operacion: "Venta",
    precio: "$520.000.000",
    area: "82m2",
    habitaciones: 3,
    banos: 2,
    garaje: 1,
    estrato: 5,
    administracion: "$380.000",
    zona: "Loma del Esmeraldal, Envigado",
    ciudad: "Antioquia",
    descripcion:
      "Apartamento con balcon y vista panoramica al valle, cocina integral y espacios amplios, a minutos de la Via Las Palmas y centros comerciales de Envigado.",
    caracteristicas: "Porteria 24 horas, piscina, turco, salon social, sendero ecologico",
    link: "https://info.wasi.co/apartamento-venta-esmeraldal-envigado/9761234",
    images: ["https://images.unsplash.com/photo-1600585154340-be6161a56a0c?q=80&w=1600&auto=format&fit=crop"],
  },
  {
    ref: "AP003",
    titulo: "Apartamento en Arriendo Sabaneta - Cerca al Parque",
    tipo: "Apartamento",
    operacion: "Arriendo",
    precio: "$2.200.000",
    area: "70m2",
    habitaciones: 3,
    banos: 2,
    garaje: 1,
    estrato: 4,
    administracion: "$310.000 (incluida en el canon)",
    zona: "Calle del Banco, Sabaneta",
    ciudad: "Antioquia",
    descripcion:
      "Apartamento comodo y bien distribuido a tres cuadras del parque principal de Sabaneta, rodeado de restaurantes, comercio y transporte publico.",
    caracteristicas: "Porteria 24 horas, gimnasio, salon social, juegos infantiles",
    link: "https://info.wasi.co/apartamento-arriendo-sabaneta/9748821",
    images: ["https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?q=80&w=1600&auto=format&fit=crop"],
  },
  {
    ref: "AE001",
    titulo: "Apartaestudio Amoblado en Laureles - Ideal Ejecutivos",
    tipo: "Apartaestudio",
    operacion: "Arriendo",
    precio: "$1.850.000",
    area: "45m2",
    habitaciones: 1,
    banos: 1,
    garaje: 0,
    estrato: 4,
    administracion: "$220.000",
    zona: "Laureles, Medellin",
    ciudad: "Antioquia",
    descripcion:
      "Apartaestudio totalmente amoblado en el corazon de Laureles, a pasos de la Segunda Avenida, con internet incluido y listo para estrenar.",
    caracteristicas: "Amoblado, internet incluido, porteria 24 horas, lavanderia comunal",
    link: "https://info.wasi.co/apartaestudio-arriendo-laureles-medellin/9752210",
    images: ["https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?q=80&w=1600&auto=format&fit=crop"],
  },
  {
    ref: "CA001",
    titulo: "Casa Campestre en La Estrella - Sector Suramerica",
    tipo: "Casa",
    operacion: "Venta",
    precio: "$780.000.000",
    area: "210m2",
    habitaciones: 4,
    banos: 3,
    garaje: 2,
    estrato: 5,
    administracion: "$450.000",
    zona: "Suramerica, La Estrella",
    ciudad: "Antioquia",
    descripcion:
      "Casa campestre en unidad cerrada con jardin privado, chimenea y vista a las montanas, a 10 minutos de la estacion La Estrella del metro.",
    caracteristicas: "Unidad cerrada, jardin privado, chimenea, BBQ, cuarto de servicio",
    link: "https://info.wasi.co/casa-venta-la-estrella-antioquia/9739987",
    images: ["https://images.unsplash.com/photo-1564013799919-ab600027ffc6?q=80&w=1600&auto=format&fit=crop"],
  },
].map((row, i) => demo(row, i));
