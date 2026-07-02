// Almacen en memoria para modo demo (sin SUPABASE_URL configurado).
// Implementa los mismos datos que db/schema.sql con la org y propiedades seed.

let seq = 0;
const uid = () => `mem_${++seq}`;

const demoOrg = {
  id: uid(),
  name: "Paraiso Inmobiliario",
  whatsapp_phone_id: "DEMO_PHONE_ID",
  whatsapp_token: null,
  verify_token: null,
  advisor_phone: "573028536489",
  advisor_name: "Asesor Paraiso",
  status: "active",
};

const properties = [
  { ref: "AP001", titulo: "Apartamento Moderno en Sabaneta - Iluminado con Vista Verde", tipo: "Apartamento", operacion: "Venta", precio: "$460.000.000", area: "65m2", habitaciones: 2, banos: 2, garaje: 1, estrato: 4, administracion: "$290.000", zona: "El Carmelo, Sabaneta", ciudad: "Antioquia", descripcion: "Apartamento muy iluminado con vista a zona verde, ubicado cerca del parque principal de Sabaneta, con facil acceso a transporte publico y centros comerciales.", caracteristicas: "Porteria 24 horas, gimnasio, piscina, zona humeda, parque infantil", link: "https://info.wasi.co/apartamento-venta-el-carmelo-sabaneta/9755676", disponible: true },
  { ref: "AP002", titulo: "Apartamento con Balcon en Envigado - Loma del Esmeraldal", tipo: "Apartamento", operacion: "Venta", precio: "$520.000.000", area: "82m2", habitaciones: 3, banos: 2, garaje: 1, estrato: 5, administracion: "$380.000", zona: "Loma del Esmeraldal, Envigado", ciudad: "Antioquia", descripcion: "Apartamento con balcon y vista panoramica al valle, cocina integral y espacios amplios, a minutos de la Via Las Palmas y centros comerciales de Envigado.", caracteristicas: "Porteria 24 horas, piscina, turco, salon social, sendero ecologico", link: "https://info.wasi.co/apartamento-venta-esmeraldal-envigado/9761234", disponible: true },
  { ref: "AP003", titulo: "Apartamento en Arriendo Sabaneta - Cerca al Parque", tipo: "Apartamento", operacion: "Arriendo", precio: "$2.200.000", area: "70m2", habitaciones: 3, banos: 2, garaje: 1, estrato: 4, administracion: "$310.000 (incluida en el canon)", zona: "Calle del Banco, Sabaneta", ciudad: "Antioquia", descripcion: "Apartamento comodo y bien distribuido a tres cuadras del parque principal de Sabaneta, rodeado de restaurantes, comercio y transporte publico.", caracteristicas: "Porteria 24 horas, gimnasio, salon social, juegos infantiles", link: "https://info.wasi.co/apartamento-arriendo-sabaneta/9748821", disponible: true },
  { ref: "AE001", titulo: "Apartaestudio Amoblado en Laureles - Ideal Ejecutivos", tipo: "Apartaestudio", operacion: "Arriendo", precio: "$1.850.000", area: "45m2", habitaciones: 1, banos: 1, garaje: 0, estrato: 4, administracion: "$220.000", zona: "Laureles, Medellin", ciudad: "Antioquia", descripcion: "Apartaestudio totalmente amoblado en el corazon de Laureles, a pasos de la Segunda Avenida, con internet incluido y listo para estrenar.", caracteristicas: "Amoblado, internet incluido, porteria 24 horas, lavanderia comunal", link: "https://info.wasi.co/apartaestudio-arriendo-laureles-medellin/9752210", disponible: true },
  { ref: "CA001", titulo: "Casa Campestre en La Estrella - Sector Suramerica", tipo: "Casa", operacion: "Venta", precio: "$780.000.000", area: "210m2", habitaciones: 4, banos: 3, garaje: 2, estrato: 5, administracion: "$450.000", zona: "Suramerica, La Estrella", ciudad: "Antioquia", descripcion: "Casa campestre en unidad cerrada con jardin privado, chimenea y vista a las montanas, a 10 minutos de la estacion La Estrella del metro.", caracteristicas: "Unidad cerrada, jardin privado, chimenea, BBQ, cuarto de servicio", link: "https://info.wasi.co/casa-venta-la-estrella-antioquia/9739987", disponible: true },
  { ref: "AP004", titulo: "Apartamento en Venta Envigado - Cerca al Metro", tipo: "Apartamento", operacion: "Venta", precio: "$395.000.000", area: "62m2", habitaciones: 2, banos: 2, garaje: 1, estrato: 4, administracion: "$265.000", zona: "Centro, Envigado", ciudad: "Antioquia", descripcion: "Apartamento bien ubicado a 5 minutos de la estacion Envigado del metro, sector tradicional con todo el comercio a la mano.", caracteristicas: "Parqueadero cubierto, porteria 24 horas, conjunto cerrado", link: "https://info.wasi.co/apartamento-venta-envigado-centro/9744456", disponible: false },
].map((p) => ({ id: uid(), org_id: demoOrg.id, ...p }));

const db = {
  organizations: [demoOrg],
  properties,
  leads: [],
  conversations: [],
  messages: [],
  uid,
};

module.exports = db;
