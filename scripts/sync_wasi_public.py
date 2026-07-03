# Sincroniza precio, titulo y operacion de cada propiedad contra su pagina
# publica de info.wasi.co (puente mientras se conecta la API oficial de Wasi).
# Uso: python scripts/sync_wasi_public.py
import os, re, json, time, sys
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

def fetch_wasi(url):
    # URLs con tildes o espacios: codificar el path
    url = urllib.parse.quote(url.strip(), safe=":/?&=")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "ignore")
    precio_m = re.search(r'Precio\s+(venta|renta)\s*<p class="pr1">\s*(\$[\d.]+)', html)
    title_m = re.search(r"<title>(.*?)</title>", html, re.S)
    return {
        "operacion": ("Arriendo" if precio_m and precio_m.group(1) == "renta" else "Venta") if precio_m else None,
        "precio": precio_m.group(2) if precio_m else None,
        "titulo": title_m.group(1).strip() if title_m else None,
    }

def main():
    props = api("GET", "properties?select=id,ref,precio,titulo,operacion,link&link=ilike.*info.wasi.co*&disponible=eq.true&limit=500")
    cambios, errores = 0, 0
    for p in props:
        try:
            wasi = fetch_wasi(p["link"])
        except Exception as e:
            print(f"  ! {p['ref']}: no se pudo leer la pagina ({e})")
            errores += 1
            continue
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
        if update:
            api("PATCH", f"properties?id=eq.{p['id']}", update)
            detalle = ", ".join(
                f"{k}: {p[k]} -> {v}" for k, v in update.items()
            )
            print(f"  * {p['ref']}: {detalle}")
            cambios += 1
        time.sleep(0.4)
    print(f"\nSincronizadas: {len(props)} | actualizadas: {cambios} | errores: {errores}")

if __name__ == "__main__":
    main()
