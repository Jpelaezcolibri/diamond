const { test } = require("node:test");
const assert = require("node:assert");
const { enqueue } = require("../src/lib/user-queue");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("tareas de la misma key corren en orden, una a la vez", async () => {
  const order = [];
  const p1 = enqueue("a", async () => {
    order.push("start-1");
    await sleep(20);
    order.push("end-1");
  });
  const p2 = enqueue("a", async () => {
    order.push("start-2");
    await sleep(5);
    order.push("end-2");
  });
  await Promise.all([p1, p2]);
  assert.deepStrictEqual(order, ["start-1", "end-1", "start-2", "end-2"]);
});

test("keys distintas corren en paralelo sin bloquearse", async () => {
  const order = [];
  const slow = enqueue("lento", async () => {
    order.push("slow-start");
    await sleep(30);
    order.push("slow-end");
  });
  const fast = enqueue("rapido", async () => {
    order.push("fast-start");
    await sleep(5);
    order.push("fast-end");
  });
  await Promise.all([slow, fast]);
  // La tarea rapida de otra key termina ANTES que la lenta — no espero
  // orden estricto de los "start" (dependen del scheduler), pero fast-end
  // debe llegar antes que slow-end si de verdad corrieron en paralelo.
  assert.ok(order.indexOf("fast-end") < order.indexOf("slow-end"));
});

test("una tarea que falla no traba las siguientes de la misma key", async () => {
  const order = [];
  const p1 = enqueue("b", async () => {
    order.push("t1");
    throw new Error("fallo simulado");
  });
  const p2 = enqueue("b", async () => {
    order.push("t2");
  });
  await assert.rejects(p1, /fallo simulado/);
  await p2;
  assert.deepStrictEqual(order, ["t1", "t2"]);
});

test("cada llamada devuelve el resultado de SU propia tarea", async () => {
  const r1 = await enqueue("c", async () => 1);
  const r2 = await enqueue("c", async () => 2);
  assert.strictEqual(r1, 1);
  assert.strictEqual(r2, 2);
});
