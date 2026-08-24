// Un mensaje de grupo tiene que llevar la fecha REAL del mensaje.
//
// BUG FATAL (Juan, 2026-08-24): faltaba `instanteIso` en el objeto `mensaje`
// del camino en vivo, asi que politica.js#decidirDm recibia undefined y
// devolvia `sin_fecha_mensaje` SIEMPRE: el DM automatico al colega no mandaba
// nada y nunca lo iba a hacer. Verificado en produccion — fecha_mensaje estaba
// NULL en 12 de 12 senales en vivo. Alimenta tambien el digest de la manana.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const fuente = fs.readFileSync(path.join(__dirname, "..", "src", "channels", "whatsapp-group.js"), "utf8");
const bloque = fuente.slice(fuente.indexOf("async function procesar(org, ev, grupo, sesion)"));
const mensaje = bloque.slice(0, bloque.indexOf("};"));

test("el mensaje de grupo lleva instanteIso, o el DM nunca sale", () => {
  assert.match(mensaje, /instanteIso:/, "sin instanteIso, decidirDm siempre devuelve sin_fecha_mensaje");
});

test("instanteIso sale del timestamp de WhatsApp, no de la hora de proceso", () => {
  // new Date() a secas seria la hora en que lo procesamos: un backlog al
  // arrancar pareceria recien llegado y el DM saldria por pedidos viejos.
  assert.match(mensaje, /instanteIso:[^,]*ev\.tsMs/, "tiene que derivar de ev.tsMs");
  assert.doesNotMatch(mensaje, /instanteIso:\s*new Date\(\)/, "no puede ser la hora de proceso");
});

test("sin timestamp queda null, no una fecha inventada", () => {
  // Falla cerrada: decidirDm no manda nada sin fecha, que es lo correcto.
  assert.match(mensaje, /instanteIso:\s*typeof ev\.tsMs === "number"[\s\S]*?:\s*null/);
});
