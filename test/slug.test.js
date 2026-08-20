// src/lib/slug.js — el link que Sofi/el bot arman hacia la landing.
//
// BUG real (Juan, 2026-08-20): el titulo real "Lote en Llanogrande en
// Condominio Al lado de la carretera Principal" (ref 9100417) generaba
// "...carretera-pr-9100417" — el corte de 60 caracteres caia justo a mitad
// de "Principal". El colega que recibio ese link dijo "no me sirve este
// link" / "tiene los datos de tu empresa y otras propiedades".

const { test } = require("node:test");
const assert = require("node:assert");

const { buildSlug } = require("../src/lib/slug");

test("BUG REAL: el titulo del lote de Llanogrande ya no corta 'Principal' a mitad de palabra", () => {
  const slug = buildSlug("Lote en Llanogrande en Condominio Al lado de la carretera Principal", "9100417");
  assert.ok(!slug.includes("-pr-"), `el slug no puede tener la palabra cortada: ${slug}`);
  assert.match(slug, /carretera-9100417$/, "se descarta la palabra entera, no se deja el fragmento");
});

test("el ref sigue siendo siempre el ultimo segmento, con o sin corte", () => {
  const slug = buildSlug("Lote en Llanogrande en Condominio Al lado de la carretera Principal", "9100417");
  assert.strictEqual(slug.split("-").pop(), "9100417");
});

test("un titulo corto (menos de 60 caracteres) no se toca", () => {
  assert.strictEqual(buildSlug("Apartamento en Laureles", "AP001"), "apartamento-en-laureles-ap001");
});

test("un titulo de exactamente 60 caracteres sin necesidad de cortar no pierde nada", () => {
  const titulo60 = "a".repeat(60); // una sola palabra de 60: sin espacios que cortar
  const slug = buildSlug(titulo60, "REF1");
  assert.strictEqual(slug, `${titulo60}-ref1`);
});

test("un titulo de una sola palabra gigante (sin espacios) se corta crudo, no hay limite de palabra que respetar", () => {
  const tituloGigante = "a".repeat(80);
  const slug = buildSlug(tituloGigante, "REF1");
  assert.strictEqual(slug, `${"a".repeat(60)}-ref1`);
});

test("tildes, mayusculas y simbolos se normalizan igual que antes", () => {
  assert.strictEqual(buildSlug("Apartaestudio en El Poblado 🏠", "AP002"), "apartaestudio-en-el-poblado-ap002");
});

test("sin titulo, el slug es solo el ref", () => {
  assert.strictEqual(buildSlug("", "AP003"), "ap003");
});
