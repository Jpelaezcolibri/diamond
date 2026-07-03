# Importa propiedades desde el Excel exportado (hoja DATOS) a la tabla properties de Supabase.
# Uso: python scripts/import_excel.py "ruta\al\archivo.xlsx"
# Lee SUPABASE_URL y SUPABASE_SERVICE_KEY del .env de la raiz.
# NO importa las columnas de comisiones (datos internos del negocio).
import sys, os, re, json, math
import urllib.request, urllib.error
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def env(key):
    with open(os.path.join(ROOT, ".env"), encoding="utf-8") as f:
        for line in f:
            if line.strip().startswith(key + "="):
                return line.split("=", 1)[1].strip().strip('"')
    raise SystemExit(f"Falta {key} en .env")

SUPABASE_URL = env("SUPABASE_URL")
SERVICE_KEY = env("SUPABASE_SERVICE_KEY")

def api(method, path, body=None, prefer=None):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={
            "apikey": SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type": "application/json",
            **({"Prefer": prefer} if prefer else {}),
        },
    )
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        print("ERROR", e.code, ":", e.read().decode()[:600])
        raise SystemExit(1)

def norm(c):
    return re.sub(r"[^A-Z ]", "", c.upper().replace("Ñ", "N").replace("Ó", "O").replace("Í", "I").replace("Á", "A").replace("É", "E").replace("Ú", "U")).strip()

def val(row, cols, sub):
    key = next((c for c in cols if sub in norm(c)), None)
    if key is None:
        return None
    v = row[key]
    if isinstance(v, float) and math.isnan(v):
        return None
    return v

def money(n):
    return "$" + f"{int(n):,}".replace(",", ".") if n else None

def main(path):
    df = pd.read_excel(path, sheet_name="DATOS")
    df.columns = [str(c).strip() for c in df.columns]
    cols = list(df.columns)

    org = api("GET", "organizations?select=id&whatsapp_phone_id=eq.DEMO_PHONE_ID")[0]
    org_id = org["id"]

    records, skipped = [], 0
    for _, row in df.iterrows():
        codigo = val(row, cols, "CODIGO WASI")
        precio = val(row, cols, "VALOR DEL INMUEBLE")
        municipio = val(row, cols, "MUNICIPIO")
        if not codigo or not precio or not municipio:
            skipped += 1
            continue
        ref = str(int(codigo))
        tipo_raw = val(row, cols, "TIPO DE INMUEBLE") or "Inmueble"
        tipo = str(tipo_raw).title().replace(" De ", " de ").replace(" Para ", " para ")
        negocio = str(val(row, cols, "TIPO DE NEGOCIO") or "VENTA").upper()
        operacion = "Arriendo" if "RENTA" in negocio or "ARRIENDO" in negocio else "Venta"
        barrio = str(val(row, cols, "BARRIO") or "").strip()
        area = val(row, cols, "METROS CUADRADOS")
        hab = val(row, cols, "HABITACIONES")
        banos = val(row, cols, "BANOS") or val(row, cols, "DE BA")
        parq = val(row, cols, "PARQUEADERO")
        piso = val(row, cols, "PISO")
        estrato = val(row, cols, "ESTRATO")
        admon = val(row, cols, "ADMINISTRA")
        cuarto = val(row, cols, "CUARTO")
        ropas = val(row, cols, "ROPAS")
        balcon = val(row, cols, "BALCN") or val(row, cols, "BALC")
        negociable = str(val(row, cols, "NEGOCIABLE") or "").upper() == "SI"
        permuta = str(val(row, cols, "PERMUTA") or "").upper() == "SI"
        url = val(row, cols, "URL WASI")

        garaje, feats = 0, []
        if isinstance(parq, (int, float)):
            garaje = int(parq)
        elif isinstance(parq, str) and "COM" in norm(parq):
            garaje, _ = 1, feats.append("parqueadero comun")
        if isinstance(banos, str):
            banos = 0
        if piso:
            feats.append(f"piso {int(piso)}")
        if str(balcon or "").upper() == "SI":
            feats.append("balcon")
        if isinstance(cuarto, (int, float)) and cuarto:
            feats.append("cuarto util")
        if str(ropas or "").upper() == "SI":
            feats.append("zona de ropas")
        if negociable:
            feats.append("precio negociable")
        if permuta:
            feats.append("acepta permuta")

        area_txt = None
        if area:
            a = float(area)
            area_txt = f"{int(a) if a == int(a) else a}m2"

        desc = f"{tipo} en {operacion.lower()} en {barrio}, {municipio}."
        if area_txt:
            desc += f" {area_txt}"
            if piso:
                desc += f", piso {int(piso)}"
            desc += "."
        if feats:
            desc += " Cuenta con " + ", ".join(f for f in feats if f) + "."

        records.append({
            "org_id": org_id,
            "ref": ref,
            "titulo": f"{tipo} en {operacion} - {barrio}, {municipio}",
            "tipo": tipo,
            "operacion": operacion,
            "precio": money(precio),
            "area": area_txt,
            "habitaciones": int(hab) if isinstance(hab, (int, float)) else None,
            "banos": int(banos) if isinstance(banos, (int, float)) else None,
            "garaje": garaje,
            "estrato": int(estrato) if estrato else None,
            "administracion": money(admon) if admon else "No aplica",
            "zona": barrio,
            "ciudad": str(municipio),
            "descripcion": desc,
            "caracteristicas": ", ".join(f for f in feats if f) or None,
            "link": str(url) if url else None,
            "disponible": True,
        })

    # Deduplicar por ref (el Excel puede repetir el mismo codigo Wasi): gana la ultima fila
    unicos = {}
    for r in records:
        if r["ref"] in unicos:
            print(f"  duplicado en el Excel: ref {r['ref']} ({r['titulo']}) — se usa la ultima fila")
        unicos[r["ref"]] = r
    records = list(unicos.values())

    api("POST", "properties?on_conflict=org_id,ref", records, prefer="resolution=merge-duplicates,return=minimal")
    print(f"Importadas/actualizadas: {len(records)} | omitidas (sin codigo/precio/ciudad): {skipped}")

if __name__ == "__main__":
    main(sys.argv[1])
