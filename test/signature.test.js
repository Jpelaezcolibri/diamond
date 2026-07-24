const { test } = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const { verifyMetaSignature } = require("../src/lib/signature");

function sign(body, secret) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

test("firma valida pasa", () => {
  const body = Buffer.from(JSON.stringify({ hello: "world" }));
  const secret = "un-secreto-de-prueba";
  const header = sign(body, secret);
  assert.strictEqual(verifyMetaSignature(body, header, secret), true);
});

test("firma con secreto distinto no pasa", () => {
  const body = Buffer.from(JSON.stringify({ hello: "world" }));
  const header = sign(body, "secreto-correcto");
  assert.strictEqual(verifyMetaSignature(body, header, "otro-secreto"), false);
});

test("body alterado no pasa (aunque la firma sea de otro body valido)", () => {
  const secret = "un-secreto-de-prueba";
  const header = sign(Buffer.from(JSON.stringify({ hello: "world" })), secret);
  const alterado = Buffer.from(JSON.stringify({ hello: "mundo" }));
  assert.strictEqual(verifyMetaSignature(alterado, header, secret), false);
});

test("header ausente no pasa", () => {
  const body = Buffer.from("{}");
  assert.strictEqual(verifyMetaSignature(body, undefined, "secreto"), false);
});

test("rawBody ausente no pasa", () => {
  assert.strictEqual(verifyMetaSignature(undefined, "sha256=abc", "secreto"), false);
});

test("appSecret ausente no pasa", () => {
  const body = Buffer.from("{}");
  assert.strictEqual(verifyMetaSignature(body, "sha256=abc", ""), false);
});

test("header con formato invalido (longitud distinta) no pasa", () => {
  const body = Buffer.from("{}");
  assert.strictEqual(verifyMetaSignature(body, "sha256=corto", "secreto"), false);
});
