# Minería de grupos de WhatsApp — Fase 0

Banco de pruebas **offline** que decide si vale la pena construir el sistema de
Sofi para los grupos gremiales. Diseño completo:
[docs/superpowers/specs/2026-07-28-sofi-grupos-whatsapp-design.md](../../docs/superpowers/specs/2026-07-28-sofi-grupos-whatsapp-design.md).

No toca ninguna línea de WhatsApp, no monta infraestructura y **sólo hace
lecturas** contra Supabase. Su propósito es poder cancelar el proyecto barato:
si los números no dan, se descarta habiendo gastado dos días y cero dólares de
infra.

## Conseguir los exports

En cada grupo, desde WhatsApp: **⋮ → Más → Exportar chat → Sin archivos**.
Sale un `.txt`. Con 3 o 4 grupos representativos alcanza.

> Esos archivos tienen datos de terceros. **Guardalos fuera del repo** y pasá
> la ruta por argumento. Si igual creás `scripts/group-mining/exports/`, el
> `.gitignore` la cubre como red de seguridad.

## Correr

```bash
node scripts/group-mining/run.js ../exports-grupos --sin-ia
```

Corre sólo el parser y el prefiltro e imprime la tasa de descarte. **Es la
primera compuerta y no cuesta un centavo.** No necesita `ANTHROPIC_API_KEY` ni
`SUPABASE_URL`. Si el descarte no llega al 70%, ajustá
[`lexico.js`](lexico.js) y volvé a correr antes de gastar en IA.

```bash
node scripts/group-mining/run.js ../exports-grupos
```

Embudo completo. Necesita `.env` con `ANTHROPIC_API_KEY` y `SUPABASE_URL`, y
escribe `reporte-grupos.html` (o la ruta que le des con `--salida`).

## Cómo leer el reporte

Arriba está la **compuerta de decisión**. Se pasa a la Fase 1 sólo si se cumplen
todas; cada dirección se mide por separado, así que se puede aprobar sólo una
mitad y construir sólo esa.

| Métrica | Umbral | Qué significa si falla |
|---|---|---|
| Descarte en Etapa 0 | ≥ 70% | El léxico deja pasar demasiado ruido y el costo deja de ser trivial |
| Costo proyectado / mes | ≤ 5 USD | Restricción de presupuesto del equipo |
| Demandas / día | ≥ 5 | No hay suficiente flujo de pedidos para justificar el sistema |
| Demandas con ≥1 match | ≥ 30% | Detectamos pedidos que Diamond no puede atender — detectar sin responder no sirve |
| Ofertas / día | ≥ 10 | El inventario de aliados no crecería lo suficiente |
| Ofertas con datos utilizables | ≥ 60% | Los colegas escriben sin precio o sin zona: filas muertas en `ally_properties` |

Las dos últimas **no las calcula el reporte, las juzgás vos**:

- **Precisión** (≥ 80%) — revisá las tablas de demandas y ofertas. ¿Lo que marcó
  como demanda era demanda? ¿Los precios y zonas extraídos son correctos?
- **Falsos negativos** (≤ 10%) — revisá la **muestra de descartados**. Es la
  sección más importante del reporte y la única forma de verlos: un mensaje
  bueno que el embudo mató no aparece en ninguna otra parte. El arreglo va en
  `lexico.js`.

El muestreo es determinístico, así que después de ajustar el léxico podés
comparar las dos corridas.

## Si alguna falla

Ajustá el léxico o el prompt y volvé a correr — es offline y gratis iterar. Si
tras dos o tres iteraciones sigue fallando, **el proyecto se cancela**. Eso es
exactamente para lo que existe la Fase 0.

## Los archivos

| Archivo | Etapa | Nota |
|---|---|---|
| [`parse-export.js`](parse-export.js) | — | Parser del `.txt` (Android + iOS, multilínea, invisibles) |
| [`lexico.js`](lexico.js) | 0 | **Lo que más se ajusta.** Términos por familia |
| [`prefilter.js`](prefilter.js) | 0 | Descarte gratis. Se promueve a `src/` tal cual en Fase 1 |
| [`classify.js`](classify.js) | 1 | Lotes de 20 con Haiku 4.5. Se promueve a `src/` tal cual en Fase 1 |
| [`match.js`](match.js) | 2 | Cruce contra `properties` y `ally_properties` |
| [`report.js`](report.js) | 3 | El HTML |
| [`run.js`](run.js) | — | CLI |

`prefilter.js` y `classify.js` son el activo de largo plazo: están diseñados
para moverse a `src/` sin cambios cuando llegue la Fase 1. El resto es
descartable.

## Variables de entorno

| Variable | Default | Para qué |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Etapa 1. No hace falta con `--sin-ia` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | — | Etapa 2. Sin esto el comando aborta en vez de cruzar contra el inventario de demo y dar matches ficticios |
| `CLAUDE_MODEL_GRUPOS` | `claude-haiku-4-5` | Modelo del clasificador. **No** usa `CLAUDE_MODEL`, que es el del bot de cara al cliente |
