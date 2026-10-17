# Método de match del radar (estado al 2026-10-17)

Referencia única de cómo el radar decide qué ficha le manda a un colega. Si
cambia una regla, se actualiza aquí en el mismo commit.

**La regla de Juan (2026-09-18):** los números llevan un margen pequeño; lo que
no es número (zona, piso, parqueadero, tipo, amoblado) es literal.

## 1. El recorrido de un pedido

```
mensaje del grupo (línea de Daiana, WAHA)
  → lista blanca: solo grupos en modo ≠ ignorar         src/data/whatsapp-groups.js
  → clasificador IA (Haiku, con caché): demanda/oferta/ruido + campos   src/groups/classify.js
  → se guarda la señal                                  src/groups/persistir.js → src/data/group-signals.js
  → prefiltro en la base (zona+vecinas, tipo, operación, alcobas)   match.js#filtrosInventario → properties.search
  → compuertas y puntaje por candidata                  match.js#evaluarCandidata
  → "¿puede salir sola?"                                src/groups/publicable.js#filtrar
  → revisión de Sofi (IA) sobre las candidatas          src/groups/revalidar.js (modo asistido)
  → política de conducta (ritmo, cuota, solo-llamada, no repetir 7 días)   src/groups/politica.js
  → DM: 1 mensaje para el colega + hasta 3 fichas       src/groups/envio-colega.js
  → si responde: puente a Sofi con su código            src/groups/puente-sofi.js
```

## 2. Qué extrae el clasificador

operación, tipo (puede venir múltiple: "apartamento, casa"), zonas y
zonas_excluidas, zona_madre, ciudad, precio_min/max, habitaciones,
flexible_habitaciones (dice "estudio" o "inversión"), area_min, baños, garajes,
estrato, edificio, amoblado (si/no/""), período, piso_min/max.

No extrae: **techo de área** (se lee del texto, `areaMaxDe`) ni **varios
pedidos** en un mensaje (se detecta en el texto, `variosPedidos`).

## 3. Compuertas: DESCARTA (la ficha no existe para ese pedido)

| Regla | Dónde |
|---|---|
| Operación distinta (venta ≠ arriendo) | `mismaOperacion` + prefiltro |
| Tipo no pedido (con varios tipos, basta uno) | `tiposPedidos` |
| Techo de área: área > máximo del rango × (1 + 10 %) | `areaMaxDe` |
| Amoblado contrario a lo pedido | `esAmoblada` |
| Piso conocido fuera de la banda (solo apartamentos) | `pisoCumple` |
| Pide que esté rentando y la ficha dice vacía | `estaRentada` |
| Zona: otra zona, otra ciudad o excluida | `ubicacionCoincide`, `zonaExcluida` |
| Precio > tope × (1 + 10 %), o muy por debajo del mínimo | margen `GRUPOS_MARGEN_PRECIO` |
| Área < mínimo × (1 − 10 %), alcobas o parqueaderos cortos | `catalogoExigencias` |

## 4. Marcas: NO SALE SOLA (queda para que una persona decida)

`publicable.js`. Ninguna descarta: la ficha sigue apareciendo en `/grupos`.

| Marca | Cuándo |
|---|---|
| zona_vecina / sector_sin_confirmar | No está en la zona exacta pedida |
| amoblado_sin_confirmar | Pidió amoblado y la ficha no lo dice |
| garajes_sin_dato | Pidió parqueadero y Wasi no tiene el dato |
| piso_sin_confirmar | Pidió piso y la ficha no lo dice |
| edificio_sin_confirmar | Pidió una unidad con nombre y la ficha no la nombra |
| rentada_sin_confirmar | Pidió que esté rentando y la ficha no lo dice |
| periodo_no_soportado | Pide por días o semanas |
| **varios_pedidos** (2026-10-17) | El mensaje traía pedidos numerados 1️⃣ 2️⃣ |
| **precio_sin_confirmar** (2026-10-17) | El precio de la descripción no cuadra (> 3 %) con el de Wasi |
| puntaje_bajo, sin_área, sin_zona, sin_link… | Calidad del dato |

## 5. Dónde se cuelan los errores (lecciones)

1. **Datos de Wasi.** La mayoría de los "no salió" son fichas sin zona, sin
   parqueadero, sin piso o con precios distintos. Arreglarlo en Wasi rinde más
   que tocar el código.
2. **Lo que se guarda no es lo que se usó.** El motor en vivo usa el pedido en
   memoria; todo lo recalculado (DM manual, bandeja, auditorías) usa la fila de
   la base. Un campo que no se guarda rompe esos caminos en silencio (piso,
   hasta el 2026-10-17).
3. **Corte antes del filtro.** `properties.search` cortaba 60 filas antes de
   filtrar el precio; los arriendos quedaban fuera (arreglado 2026-10-17).
4. **Inventario apagado.** Si Wasi falla, el radar calla sin errores. Primero se
   mira `select count(*) from properties where disponible` y la última
   `sync_runs`.

## 6. Cómo medir un cambio antes de desplegarlo

Reproducir los DM automáticos del último mes con el código nuevo
(`respuesta_modo='auto'`, cada `respuesta_refs` contra `evaluarCandidata`) y
contar cuántas fichas se descartan o se frenan, y en cuántos DM. Así se hizo el
2026-09-18 (la mitad salía) y el 2026-10-17 (3 descartadas por área y 43
frenadas por precio).
