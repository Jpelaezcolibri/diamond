# Auditoría Radar — camino al MVP comercial

**Fecha:** 2026-08-02 · **Autor:** Principal Engineer · **Estado:** para decisión del CTO

Toda afirmación de este documento está respaldada por una consulta a la base de
producción, un archivo del repo o una llamada a la Graph API. Lo que es opinión
está marcado como tal.

---

## 1. Diagnóstico en una frase

Radar está construido, desplegado, probado y aprobado — y **ningún asesor puede
usarlo**, porque la única pantalla del producto está detrás de un guard de
administrador. Hoy el producto solo funciona si Juan lo opera a mano.

## 2. La evidencia

### El bloqueante raíz

`crm/app/(dashboard)/grupos/page.tsx:27`

```ts
if (!user || !isAdmin(user)) redirect("/inbox");
```

**La pantalla completa de Radar es admin-only.** Subir grupos, ver pedidos, ver
matches, marcar gestionado: todo. Un asesor que entra al CRM es redirigido a su
bandeja y nunca ve el producto.

El comentario del código explica por qué se puso: *"acá se ve qué líneas están
vinculadas y el contenido de los grupos gremiales"*. Era correcto cuando WAHA
conectaba **una línea para toda la organización** y los grupos de un asesor eran
visibles para todos. **Con el flujo de exports esa premisa ya no existe**: cada
asesor sube los suyos. El guard quedó protegiendo un modelo que se eliminó.

### El estado real de la base de producción

```
whatsapp_groups : 0
group_signals   : 0
```

Radar lleva desde el 30 de julio desplegado. **Nunca procesó un mensaje en
producción.** Los "1.630 mensajes y 25+ matches" ocurrieron en pruebas locales.

### Lo que sí funciona, verificado

| Pieza | Evidencia |
|---|---|
| Plantilla del digest | `APPROVED MARKETING radar_grupos (es)` — Graph API |
| Worker del digest | `[digest] activo — 7h Colombia` — logs de Railway |
| Migraciones | Las 6 candidatas corrieron. Probadas contra PostgREST |
| Suite | 411/411 en verde |
| Bot en producción | Arrancó limpio sobre `9658952` |
| Camino por WhatsApp | El asesor responde "VER" al digest → `consultar_radar_grupos` le lista lo detectado |

### Los datos que van a limitar el resultado

| Dato | Valor | Consecuencia |
|---|---|---|
| Propiedades | 114 | — |
| Operación | **100% Venta · 0 arriendo** | Toda demanda de arriendo cruza contra vacío |
| Sin zona | **17 de 114 (15%)** | Invisibles para el matching |
| Asesores elegibles | 4 filas / **2 personas** | Danna Ospina duplicada ×3 |
| Leads con `ad_referral` | **0 de 15** | El embudo de pauta nunca se abrió |

---

## 3. Los 7 pasos del MVP, medidos uno por uno

La condición de salida que fijó el CTO, contra la realidad:

| # | El asesor puede… | Hoy | Por qué |
|---|---|---|---|
| 1 | **instalar Radar** | ❌ | La extensión no existe. El spike de IndexedDB está construido y **sin correr**. |
| 2 | **subir sus grupos** | ❌ | `/grupos` es admin-only. |
| 3 | **recibir el digest** | ✅ | Plantilla aprobada, worker vivo, destinatarios resueltos. |
| 4 | **abrir las señales** | ◐ | Por WhatsApp sí (solo lectura). Por CRM no. |
| 5 | **actuar sobre ellas** | ◐ | Copia el borrador, pero no puede marcar estado ni desde WhatsApp ni desde el CRM. |
| 6 | **dar retroalimentación** | ❌ | No existe canal. No hay campo de motivo. |
| 7 | **usarlo a diario sin el equipo** | ❌ | Cada paso hoy lo ejecuta Juan. |

**3 de 7 pasos rotos, 2 a medias.** Y el paso 7 —el que define el MVP— falla
por acumulación de los otros seis.

### El punto que cambia la secuencia del roadmap

El export nativo de WhatsApp es **por chat**. Un asesor con 80 grupos son **80
exports manuales al día**. Nadie hace eso.

Conclusión, y es la que ordena todo lo demás:

- **Para el piloto de validación**, el export alcanza: 5-10 grupos, tres días.
- **Para el uso diario (paso 7), no alcanza.** La extensión no es un lujo ni
  POST-MVP: es la única forma de que el paso 7 exista.

Y como el único consumidor de la auth por asesor es la extensión, **auth y
extensión son la misma pieza de producto y se justifican juntas.**

---

## 4. Bloqueantes priorizados

Clasificación: **[O]** obligatoria para vender Radar · **[D]** deseable, fuera del Sprint.

| # | Bloqueante | Estado | Impacto | Tiempo | Depende de | Riesgo | Valor para el asesor |
|---|---|---|---|---|---|---|---|
| **B1** [O] | `/grupos` admin-only | Roto | **Total** — el asesor no ve el producto | 0,5 día | — | Bajo: quitar un guard y acotar por asesor | Sin esto no hay producto |
| **B2** [O] | Primera corrida real en producción | Nunca hecho | Alto — no sabemos si sirve | 1 día | B1, exports de un asesor | Medio: puede revelar fallas del clasificador | Es la prueba de valor |
| **B3** [O] | El asesor no puede marcar ni dar feedback | Roto | Alto — sin esto no hay medición ni aprendizaje | 1 día | B1 | Bajo | Cierra el ciclo |
| **B4** [O] | Danna Ospina duplicada ×3 | Roto **en producción hoy** | Alto — 75% de los leads a una persona | 0,5 día | — | Medio: hay que reasignar referencias antes de borrar | Reparto justo |
| **B5** [O] | 0 propiedades en arriendo · 17 sin zona | Incompleto | Alto — mata la tasa de match | Negocio | Wasi | Bajo | Más matches reales |
| **B6** [O] | La extensión no existe | No empezado | **Total para el paso 7** | 5-8 días | Spike sin correr | Alto: sin el spike no sabemos el alcance de captura | Uso diario sin fricción |
| **B7** [O] | Auth por asesor | No empezado | Alto — hoy solo hay clave global no revocable | 2-3 días | Va con B6 | Medio | Seguridad de su cuenta |
| **B8** [O] | Onboarding de un asesor | Manual | Alto para el paso 7 | 1 día | B1 | Bajo | Autoservicio |
| B9 [D] | `metrics.worker` de DMAP falla 100% | Roto | Bajo — no toca Radar | — | — | Bajo | Ninguno |
| B10 [D] | RLS `using(true)` en ~20 tablas | Deuda | Nulo con 1 org · **Total al vender** | 2-3 días | — | Alto al comercializar | Ninguno hoy |
| B11 [D] | Consultas de `/grupos` sin filtro `org_id` | Deuda | Nulo con 1 org | 0,5 día | B10 | Alto al comercializar | Ninguno hoy |

**Camino crítico al MVP: B1 → B2 → B3 → B4 → B5 → (B6 + B7) → B8.**

---

## 5. Funcionalidades incompletas — qué falta para declararlas terminadas

| Funcionalidad | Falta para cerrarla |
|---|---|
| Pantalla de Radar | Acceso del asesor · alcance por asesor · marcar visto |
| Señales | `visto_at` · `motivo_descarte` · acción desde WhatsApp |
| Digest | Métrica de apertura. Hoy se sabe que salió, no que se leyó |
| Import de exports | Que lo dispare el asesor, no un admin |
| Extensión | Todo. Solo existe el spike, sin correr |
| Auth por asesor | Todo |
| Lista blanca de grupos | Nada: **proponer eliminarla** (ver §7) |

## 6. Deuda técnica clasificada

**Crítica (impide vender):** ninguna. El núcleo está sano.

**Alta (impide vender a un segundo cliente):**
- RLS `using(true)` en ~20 tablas; el CRM resuelve org con `.limit(1)`.
- `/grupos` consulta `group_signals` sin filtrar `org_id`.
- Dedup roto entre export y extensión (precisión de minuto vs segundo;
  `group_id` virtual `export:<slug>` vs jid real). Solución ya diseñada:
  truncar al minuto server-side + `conciliarGrupo()`.

**Media:** `radar_grupos` quedó como MARKETING y no UTILITY — Meta aplica
límites de frecuencia a marketing; un digest diario puede empezar a ser
throttled.

**Baja:** `metrics.worker` de DMAP · dos nombres para el mismo secreto
(`SUPABASE_SERVICE_KEY` / `SUPABASE_SERVICE_ROLE_KEY`).

**Recomendación:** corregir solo Media y lo que aparezca en el camino crítico.
La deuda Alta se ataca cuando exista el segundo cliente, no antes.

## 7. Qué eliminar

**`listGroups`, `setModo` y `registrarGrupo` de `src/data/whatsapp-groups.js`.**
Verificado: no tienen ningún llamador desde que se sacó WAHA. `registrarGrupo`
solo lo usa `asegurarGrupoVirtual` dentro del mismo archivo. En el flujo de
exports el grupo se crea solo.

Son ~60 líneas y una pantalla que nunca se construyó, sosteniendo un modelo
—elegir en qué grupos escuchar— que dejó de existir. **Propongo borrar
`listGroups` y `setModo`, y dejar `registrarGrupo` como función privada.**

## 8. Roadmap hasta producto utilizable

### Sprint 2 — Que un asesor pueda usarlo (3-4 días)
*Riesgo que reduce: **de negocio** — no sabemos si Radar cambia el comportamiento del asesor.*

- B1 · acceso del asesor a `/grupos`, acotado a sus grupos
- B4 · migración: reasignar referencias, borrar duplicados, `unique (org_id, phone)`
- B3 · `visto_at` + `motivo_descarte` + UI para marcar
- Eliminar el código muerto de §7
- B2 · **primera corrida real** con un asesor de Diamond
- B5 · Juan: cargar arriendo y las 17 zonas

**Salida:** un asesor de Diamond usa Radar tres días y hay evidencia medida.

### Sprint 3 — Que pueda usarlo a diario (6-9 días)
*Riesgo que reduce: **operacional** — 80 exports al día es inviable.*
*Condición de entrada: que el Sprint 2 haya dado evidencia positiva.*

- Correr el spike de IndexedDB (define el alcance de captura)
- B7 · auth por asesor, con el alcance recortado ya acordado
- B6 · la extensión, host del EPE
- Ingesta server-side con buffer

### Sprint 4 — Que se instale sin nosotros (2-3 días)
*Riesgo que reduce: **operacional**.*

- B8 · onboarding autoservicio: alta de asesor, token, instrucciones
- Publicación en Chrome Web Store

**Ahí termina el roadmap.** Todo lo demás es POST-MVP.

### POST-MVP — no implementar
Multi-tenant real y RLS por org · rate limiting · rotación de tokens · scopes ·
dashboard de métricas · instrumentación fina de señal→conversación→propiedad ·
arreglo de `metrics.worker` · segundo host del EPE.

## 9. Qué se puede ejecutar en paralelo

Aplicando P12:

| Carril | Sprint 2 | Sprint 3 |
|---|---|---|
| **A — Producto** | B1, B3, B4, eliminación de código muerto | Extensión (B6) |
| **B — Negocio (Juan)** | B5: arriendo y zonas en Wasi | Chrome Web Store |
| **C — Evidencia** | B2: la corrida real y las conversaciones diarias con el asesor | — |
| **D — Ingeniería independiente** | — | Auth (B7): no toca el pipeline ni el experimento |

**No paralelizable:** B2 depende de B1. B6 depende del spike.

## 10. Riesgos abiertos

| Riesgo | Tipo | Mitigación |
|---|---|---|
| El digest no cambia el comportamiento del asesor | Negocio | Es el objeto del Sprint 2. Se sabe en 3 días |
| El spike revela que solo se lee el grupo abierto | Técnico | La extensión pasa a recorrer grupos, más lenta y más visible. Cambia el diseño, no la viabilidad |
| Un tercer baneo | Seguridad | Mitigado por diseño: nunca cliente no oficial, nunca escribir. P6 protegido por test |
| Meta throttlea el digest por ser MARKETING | Operacional | Re-someter como UTILITY si aparece |
| Tasa de match baja por inventario pobre | Negocio | B5. La pantalla ya avisa cuando pasa |
| Vender antes de resolver RLS | Seguridad | **Bloqueo explícito**: no vender al segundo cliente sin B10 |

## 11. Condiciones para declarar MVP comercial

1. Un asesor instala la extensión sin ayuda del equipo.
2. Sus grupos entran solos, todos los días, sin exportar nada a mano.
3. Recibe el digest a las 7am y lo abre.
4. Abre señales, actúa y marca lo que no sirvió, con motivo.
5. Lo usa **cinco días seguidos sin que nadie del equipo toque nada**.
6. Al menos una señal produjo una acción comercial real y verificable.
7. Puede desinstalarlo y revocar su acceso solo.

Las 7. La 5 y la 6 son las que no se pueden simular.

## 12. Qué haría distinto para vender a 10 asesores la semana próxima

Opinión profesional, marcada como tal.

1. **No vendería la extensión todavía. Vendería el digest, operado por nosotros.**
   Diez asesores mandan sus exports por WhatsApp; nosotros los subimos. Es
   trabajo manual y no escala — y es exactamente lo que hay que hacer para
   aprender qué señales importan antes de automatizar la captura.
2. **Cobraría desde el primer día**, aunque sea poco. Un piloto gratis no prueba
   valor: prueba cortesía.
3. **Mediría una sola cosa:** cuántos asesores piden el digest del día siguiente
   sin que se lo recordemos.
4. **No mostraría el CRM.** Radar por WhatsApp es una experiencia entendible en
   diez segundos; el CRM abre veinte preguntas que no son del producto.
5. **Arreglaría el inventario antes de la primera demo.** Una tasa de match baja
   frente a un asesor destruye la credibilidad y no se recupera.
6. **Bloquearía la venta al segundo cliente** hasta cerrar RLS. Hoy un error de
   consulta muestra datos de otra inmobiliaria.
