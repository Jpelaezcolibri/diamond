# Rescate de pedidos y DM con aclaración — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Que los pedidos de colegas con una propiedad nuestra en la zona pedida, a la que solo le falta un dato, salgan por DM con una aclaración; arreglar los dos bugs que hoy los frenan mal (barrios del Poblado/Laureles y el piso); que ningún pedido pierda su motivo; y que un radar callado le avise a Juan.

**Architecture:** La compuerta de calidad (`src/groups/publicable.js`) aprende a separar "dato que falta" de "dato que no cumple". Lo que falta, en una lista cerrada, deja de bloquear y se convierte en aclaración en la ficha (`aclaracionParaColega` + `leFalta`, que `redactar.mensajesAlColega` ya imprime como "Aclaración:"). Primero salen las fichas que encajan del todo y después las que necesitan aclaración, hasta 3. Un script de lote con prueba en seco rescata los pedidos de las últimas N horas. Un scheduler vigila que entren pedidos.

**Tech Stack:** Node.js CommonJS, `node --test`, Supabase, WAHA.

Contexto: diagnóstico en `C:\Users\JuanPelaez\bot-inmobiliario\Claude outputs\pedidos-sin-dm-diagnostico.md` (léelo: secciones "Hallazgos de código/bugs" y "Qué haría falta"). Regla de Juan del 2026-09-19 (`docs/superpowers/specs/2026-09-18-match-literal-design.md`): zona, piso y parqueaderos literales. Decisión de Juan del 2026-10-20: lo DESCONOCIDO de barrio, piso, parqueadero y precio sale con aclaración; zona vecina NUNCA sale; lo que se sabe y NO cumple sigue sin salir.

## Global Constraints

- Motivos que pasan a aclaración (dato desconocido): `sector_sin_confirmar`, `piso_sin_confirmar`, `garajes_sin_dato`, `precio_sin_confirmar`. Ningún otro. Verificar los nombres exactos de motivo en `publicable.js`/`politica.js` y usar esos.
- `zona_vecina` nunca sale. Un dato conocido que no cumple (piso real fuera de rango, menos parqueaderos de los pedidos, precio fuera del margen) nunca sale.
- Orden dentro del DM: primero las fichas sin aclaración (por puntaje), después las con aclaración (por puntaje); máximo 3 por DM (`MAX_POR_DM` existente).
- Interruptor `RADAR_DM_CON_ACLARACION` (`true` lo enciende; apagado por defecto). Apagado = comportamiento de hoy, byte a byte.
- Todo envío respeta: `quitarYaEnviadas` (7 días), `colegas.esSoloLlamada`, tope de la línea, cuota de WhatsApp < 80 %, horario.
- El texto nuevo que se escriba usa tuteo profesional y cercano (sin voseo: nada de "decime", "querés", "pedíselas"). No reescribir textos existentes en esta tarea salvo los que se tocan.
- Nunca correr nada de escritura contra producción ni enviar mensajes reales en los tests. El script real solo con `--aplicar` y lo corre el controlador con OK de Juan.
- Commits en español con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Suite: `npm test` (base 2.399, en este worktree hay un `.env` con clave falsa para los tests).

---

### Task 1: Barrios del Poblado y Laureles, y piso leído de la ficha

**Files:** `src/lib/zonas.js` (`SUBZONA_DE`, ~l.118-134 `VECINDAD`), `src/groups/piso.js` (`pisoDe`), tests existentes de zonas/ubicación y de piso (buscar en `test/`).

- Agregar a `SUBZONA_DE` los barrios que están DENTRO de El Poblado y de Laureles para que un pedido de esos barrios contra una ficha registrada solo como "El Poblado"/"Laureles" se gradúe `zona_general` (→ motivo `sector_sin_confirmar`), no `vecina`. Lista mínima (verificar contra lo que ya está en `VECINDAD`/`zonas.js` y no duplicar):
  - El Poblado: Los Balsos, Lalinde (La Linde), Castropol, El Tesoro, La Tomatera, La Calera, San Lucas, Patio Bonito, Las Palmas (sector Poblado), Provenza, Manila, Astorga, Alejandría, El Diamante, Los Almendros, Santa María de los Ángeles, Villa Carlota, Altos del Poblado, Loma de los Parra, Loma del Indio, Las Lomas, Aguacatala, Ciudad del Río, Barrio Colombia, El Campestre, Los Naranjos.
  - Laureles: Conquistadores, Santa Teresita, San Joaquín, Carlos E. Restrepo, Bolivariana, Las Acacias, Florida Nueva, Laureles (Primer/Segundo Parque), La Castellana, Lorena, El Velódromo, Suramericana, Naranjal.
  Si alguno es ambiguo (pertenece a otra comuna o a Envigado, ej. "Las Palmas" vía), dejarlo fuera y anotarlo en el reporte.
- Tests: "Conquistadores" vs ficha "Laureles" → general (no vecina); "Balsos" vs "El Poblado" → general; un par realmente vecino (Itagüí↔Sabaneta, Envigado↔El Poblado) sigue `vecina`.
- `pisoDe` debe leer el piso también de `caracteristicas` ("piso 9, balcon", "Piso: 3") y del formato tabla `PISO | 3` en la descripción. Tests con esos tres formatos y con "pisos en madera" (que NO es un piso) y "3 pisos" (casa de 3 niveles, no es piso) → null.
- Commit: `fix(radar): los barrios del Poblado y Laureles no son zona vecina y el piso se lee de la ficha`.

### Task 2: Ningún pedido sin motivo

**Files:** `src/groups/vivo.js` (salidas `sin_candidatas`, `sin_veredicto`, `descartada_por_sofi` ~l.433-450 y el paso de `utilesSegunSofi` ~l.485-582; las mismas en el camino manual ~l.837), `src/groups/politica.js` si hace falta.

- Las salidas `sin_candidatas`, `sin_veredicto` y `descartada_por_sofi` llaman `guardarPolitica` con ese motivo.
- Cuando Sofi marca solo `refs_dudosas` (ninguna útil), el motivo es `solo_dudosas`, no `ok`.
- Descarte de Sofi que contradice el dato: si Sofi descarta una ref PROPIA (tiene `ref`) de puntaje ≥ 95 diciendo que es de aliado (el texto del motivo menciona "aliad"), ese descarte no vale y la ref vuelve a útiles. Test con el caso real (`ccdc2404`: 10013037, puntaje 100, Sofi dijo "las tres son de aliados").
- Tests de cada motivo guardado.
- Commit: `fix(radar): cada pedido guarda por que no salio`.

### Task 3: Alerta de radar callado a Juan

**Files:** Create `src/scheduler/radar-callado.js`; modify `src/server.js`. Reusar `src/lib/alerta-saldo.js#enviarAlertaTecnica` (va a `ALERTA_TECNICA_TO`, que en Railway es el número de Juan; no lo apaga `ASESORA_SOLO_VISITAS`).

- Cada 30 min, de lunes a sábado 8:00-20:00 Bogotá: si la `group_signals` más reciente de la org tiene más de **6 horas hábiles** (horas dentro de L-S 8-20) → alerta "El radar no recibe pedidos desde {fecha hora}: revisar WAHA/sesión, saldo de Anthropic y el sync". Una sola alerta por episodio (en memoria + no repetir hasta que entre un pedido nuevo); cuando vuelve a entrar un pedido, aviso corto "El radar volvió a recibir pedidos".
- Además: si `linea_dm` lleva 24 h hábiles sin filas, mismo tipo de alerta para la línea.
- Interruptor `RADAR_CALLADO_ACTIVO` (por defecto ENCENDIDO: es una alerta a Juan, no a terceros).
- Tests: cálculo de horas hábiles (cruza noche y domingo), una alerta por episodio, recuperación.
- Commit: `feat(radar): alerta a Juan cuando el radar se queda callado`.

### Task 4: DM con aclaración (automático y manual)

**Files:** `src/groups/publicable.js` (`filtrar`, `clasificarMotivos`, `aclaracionParaColega`), `src/groups/vivo.js` (camino automático `asistir`/`decidirDm`, `responderPorDmManual`, `prepararAviso`), `src/groups/redactar.js` solo si la aclaración no llega a la ficha.

- Con `RADAR_DM_CON_ACLARACION=true`: una ficha cuyos motivos de bloqueo son TODOS de la lista de Global Constraints pasa como publicable "con aclaración"; su `leFalta` lleva `aclaracionParaColega(motivos)` (más el desvío de sector si aplica). Cualquier otro motivo la sigue bloqueando.
- Orden y tope según Global Constraints. El primer mensaje (presentación) no cambia salvo la salvedad existente.
- El camino manual del CRM (`responderPorDmManual`, `prepararAviso`) usa la misma regla, con el mismo interruptor.
- La señal que sale con al menos una ficha con aclaración guarda `politica_motivo = 'dm_con_aclaracion'`.
- Tests: ficha con solo `piso_sin_confirmar` sale con "Aclaración: … piso …"; ficha con `zona_vecina` + `piso_sin_confirmar` no sale; ficha con piso conocido fuera de rango no sale; orden exactas-primero; interruptor apagado = resultado idéntico al de hoy (comparar contra el comportamiento actual en los tests existentes).
- Commit: `feat(radar): los pedidos con un dato por confirmar salen con aclaracion`.

### Task 5: Script de rescate con prueba en seco

**Files:** Create `scripts/rescate-pedidos.js`, test `test/rescate-pedidos.test.js`.

- `node scripts/rescate-pedidos.js [--horas 24] [--aplicar] [--solo id1,id2]`. Sin `--aplicar` = prueba en seco: imprime, por pedido, el colega (solo lid/teléfono enmascarado: últimos 4 dígitos), las fichas que saldrían en orden con su aclaración, y el TEXTO EXACTO de cada mensaje; y los que no salen con su motivo. Escribe además un JSON en `Claude outputs/rescate-pedidos-<fecha>.json`.
- Selección: `group_signals` de las últimas N horas, `clase` demanda, sin `respondida_at`, sin `colega_escribio_at`, con match propio; vuelve a correr la política con el código ACTUAL (Task 1, 2 y 4 incluidas, como si `RADAR_DM_CON_ACLARACION=true`) sobre los `matches` guardados, refrescando la disponibilidad de cada ref desde `properties`.
- Duplicados: el mismo colega con el mismo pedido en dos grupos dentro de 15 min → se manda una vez (marcar ambas señales).
- Con `--aplicar`: envía por el mismo camino que el DM automático (`envio-colega.enviarAlColega` por la sesión activa de la línea), respeta todos los frenos, marca la señal (`marcarRespondida` como el automático + `politica_motivo='dm_con_aclaracion'` o `dm_rescate`), 20-40 s entre colegas, para al primer error de WAHA y lo reporta.
- Tests con dependencias inyectadas (sin red): selección, dedup, orden, prueba en seco no envía nada, `--aplicar` llama al enviador y marca.
- Commit: `feat(radar): script para rescatar pedidos sin DM con prueba en seco`.
