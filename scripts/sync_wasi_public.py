# Sincroniza precio, titulo, operacion e IMAGENES de cada propiedad contra su
# pagina publica de info.wasi.co (puente mientras se conecta la API oficial).
# Las fotos se sirven via el proxy image.wasi.co/<base64(payload)>; se decodifica
# el payload de los thumbnails (156px) y se re-encodea a 1600px para la landing.
# Uso: python scripts/sync_wasi_public.py
import os, re, json, time, sys, base64
import urllib.request, urllib.error, urllib.parse

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def env(key):
    with open(os.path.join(ROOT, ".env"), encoding="utf-8") as f:
        for line in f:
            if line.strip().startswith(key + "="):
                return line.split("=", 1)[1].strip().strip('"')
    raise SystemExit(f"Falta {key} en .env")

SUPABASE_URL = env("SUPABASE_URL")
SERVICE_KEY = env("SUPABASE_SERVICE_KEY")

def api(method, path, body=None):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={
            "apikey": SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        return json.loads(raw) if raw else None

IMG_WIDTH = 1600  # ancho pedido al proxy para la landing

def extract_images(html):
    """Claves de fotos del inmueble (en orden de galeria) re-encodeadas a 1600px."""
    keys, seen = [], set()
    for b64 in re.findall(r"https://image\.wasi\.co/([A-Za-z0-9+/=]+)", html):
        try:
            payload = json.loads(base64.b64decode(b64 + "=" * (-len(b64) % 4)))
        except Exception:
            continue
        key = payload.get("key", "")
        # Solo fotos del inmueble (descarta logos/iconos de la plantilla Wasi)
        if not key.startswith("inmuebles/") or key in seen:
            continue
        seen.add(key)
        keys.append(key)
    urls = []
    for key in keys:
        new_payload = {
            "bucket": "staticw",
            "key": key,
            "edits": {"normalise": True, "rotate": 0, "resize": {"width": IMG_WIDTH, "fit": "inside"}},
        }
        b64 = base64.b64encode(json.dumps(new_payload).encode()).decode()
        urls.append(f"https://image.wasi.co/{b64}")
    return urls

def fetch_wasi(url):
    # URLs con tildes o espacios: codificar el path
    url = urllib.parse.quote(url.strip(), safe=":/?&=")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "ignore")
    except urllib.error.HTTPError as e:
        # 404/410 = propiedad vendida o eliminada en Wasi → marcar no disponible.
        if e.code in (404, 410):
            return {"gone": True}
        raise
    precio_m = re.search(r'Precio\s+(venta|renta)\s*<p class="pr1">\s*(\$[\d.]+)', html)
    title_m = re.search(r"<title>(.*?)</title>", html, re.S)
    return {
        "gone": False,
        # Si la regex de precio deja de matchear, Wasi cambió el HTML: avisar
        # (no fallar en silencio dejando datos congelados).
        "precio_regex_ok": precio_m is not None,
        "operacion": ("Arriendo" if precio_m and precio_m.group(1) == "renta" else "Venta") if precio_m else None,
        "precio": precio_m.group(2) if precio_m else None,
        "titulo": title_m.group(1).strip() if title_m else None,
        "images": extract_images(html),
    }

def main():
    props = api("GET", "properties?select=id,ref,precio,titulo,operacion,images,link&link=ilike.*info.wasi.co*&disponible=eq.true&limit=500")
    cambios, errores, retiradas = 0, 0, 0
    for p in props:
        try:
            wasi = fetch_wasi(p["link"])
        except Exception as e:
            print(f"  ! {p['ref']}: no se pudo leer la pagina ({e})")
            errores += 1
            continue
        # Propiedad vendida/eliminada en Wasi → retirar del catalogo publico.
        if wasi.get("gone"):
            api("PATCH", f"properties?id=eq.{p['id']}", {"disponible": False})
            print(f"  - {p['ref']}: retirada (404/410 en Wasi, ya no disponible)")
            retiradas += 1
            time.sleep(0.4)
            continue
        # Wasi cambio el HTML: la regex de precio no matcheo. Avisar para revisar.
        if not wasi.get("precio_regex_ok"):
            print(f"  ! {p['ref']}: precio no encontrado (¿Wasi cambio el HTML?) — revisar regex")
        update = {}
        if wasi["precio"] and wasi["precio"] != p["precio"]:
            # Guardian: una VENTA por menos de $50 millones es casi seguro un
            # error de digitacion en Wasi (ej. $1.550.000) — no propagarlo
            monto = int(re.sub(r"\D", "", wasi["precio"]) or 0)
            if wasi["operacion"] == "Venta" and monto < 50_000_000:
                print(f"  ! {p['ref']}: precio sospechoso en Wasi ({wasi['precio']}) — NO se actualiza. Corregir en Wasi.")
            else:
                update["precio"] = wasi["precio"]
        if wasi["titulo"] and wasi["titulo"] != p["titulo"]:
            update["titulo"] = wasi["titulo"]
        if wasi["operacion"] and wasi["operacion"] != p["operacion"]:
            update["operacion"] = wasi["operacion"]
        if wasi["images"] and wasi["images"] != (p.get("images") or []):
            update["images"] = wasi["images"]
        if update:
            api("PATCH", f"properties?id=eq.{p['id']}", update)
            detalle = ", ".join(
                f"images: {len(v)} fotos" if k == "images" else f"{k}: {p[k]} -> {v}"
                for k, v in update.items()
            )
            print(f"  * {p['ref']}: {detalle}")
            cambios += 1
        time.sleep(0.4)
    print(f"\nSincronizadas: {len(props)} | actualizadas: {cambios} | retiradas: {retiradas} | errores: {errores}")

if __name__ == "__main__":
    main()
