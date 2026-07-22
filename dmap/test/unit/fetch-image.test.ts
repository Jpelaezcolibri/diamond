import { describe, expect, it, vi } from "vitest";
import { fetchImageBuffer } from "../../src/lib/fetch-image.js";

const okResponse = () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }) as unknown as Response;
const errResponse = (status: number) => ({ ok: false, status, arrayBuffer: async () => new ArrayBuffer(0) }) as unknown as Response;
const noSleep = async () => {};

describe("fetchImageBuffer", () => {
  it("devuelve el buffer al primer intento sin reintentar", async () => {
    const fetchFn = vi.fn(async () => okResponse());
    const buf = await fetchImageBuffer("https://image.wasi.co/x", { fetchFn, sleep: noSleep });
    expect(buf).toBeInstanceOf(Buffer);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("se recupera de un fallo transitorio (status 5xx) reintentando", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(errResponse(503))
      .mockResolvedValueOnce(okResponse());
    const buf = await fetchImageBuffer("https://image.wasi.co/x", { fetchFn, sleep: noSleep });
    expect(buf).toBeInstanceOf(Buffer);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("se recupera de un error de red (fetch que lanza) reintentando", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(okResponse());
    const buf = await fetchImageBuffer("https://image.wasi.co/x", { fetchFn, sleep: noSleep });
    expect(buf).toBeInstanceOf(Buffer);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("lanza tras agotar todos los intentos, incluyendo la URL en el mensaje", async () => {
    const fetchFn = vi.fn(async () => errResponse(404));
    await expect(fetchImageBuffer("https://image.wasi.co/rota", { fetchFn, attempts: 3, sleep: noSleep })).rejects.toThrow(
      /https:\/\/image\.wasi\.co\/rota tras 3 intentos/
    );
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});
