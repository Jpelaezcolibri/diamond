# Deep dive técnico — WhatsApp Group Gateway → Sofi → Wasi → respuesta

**Fecha:** 2026-08-16 · **Continuación de:**
[investigacion-whatsapp-matching-2026-08.md](investigacion-whatsapp-matching-2026-08.md) (Fase 1) ·
**Audiencia:** interna técnica (Diamond / Vértice Studio)

**Alcance.** Este documento resuelve UNA sola pregunta: cómo conectar de forma segura el mundo
de los grupos gremiales (50–80 agentes) con el sistema que ya existe (Sofi + inventario Wasi +
matching), sin reconstruir nada y sin poner en riesgo la línea. No repite la investigación
general de la Fase 1; la cita.

Etiquetas de fuente: **[OFICIAL]** Meta/ley · **[PROVEEDOR]** doc del proveedor ·
**[SECUNDARIA]** · **[COMUNIDAD]** · **[INTERNA]** evidencia del repo · **[INFERENCIA]**.

---

## 1. WHAT CHANGED FROM PHASE 1

La re-verificación con fuentes de agosto 2026 se hizo contra las conclusiones previas del
proyecto (D7/D9 del EPE, verificadas el 2026-08-02) y contra la Fase 1. Resultado: **ninguna
conclusión estructural cambió; varias se precisaron.**

| Conclusión anterior | Nueva evidencia (ago-2026) | Conclusión actual |
|---|---|---|
| D9: "Groups API (nueva en 2026): solo grupos creados por API, máx. 8" | Changelog oficial: anunciada 6-oct-2025; desde el **3-feb-2026** *"available to all businesses with an Official Business Account"*. Máx. 8 confirmado textual; 10.000 grupos/número; 1 empresa por grupo [OFICIAL] | **Se sostiene, con fechas y requisito precisos: ya es GA, la llave es el OBA.** Novedad aprovechable: dentro de grupos propios hay ciclo completo (webhook con `group_id` + respuesta con `recipient_type: group`) |
| Supuesto de la Fase 1 previa del negocio: "OBA no habilita nada de grupos" | Doc oficial: el OBA es ahora **el requisito de acceso** a la Groups API [OFICIAL] | **Corregido:** OBA sí abre grupos — pero solo los propios de ≤8. Tramitarlo pasa de "nice to have" a paso del roadmap |
| D9: Coexistence — *"Group chats will not be synchronized"* | Confirmado textual en la tabla de features y en el webhook `history` (*"messages that are part of a group chat will not be included"*). Detalle nuevo: un número en Coexistence **tampoco califica** para la Groups API y queda a 20 msg/s [OFICIAL] | **Se sostiene y se refuerza:** Coexistence no es puente a grupos por ninguna dirección |
| Forense interna: la sanción fue por el cliente, no por la conducta | ToS endurecidos oct-2025 (vigentes 15-ene-2026); ola 2026 de baneos en Baileys/WAHA/Evolution; whatsmeow #807/#810: advertencias a cuentas de bajo volumen solo-respuesta [COMUNIDAD] | **Se sostiene con evidencia externa nueva:** la detección apunta al cliente. No hay configuración "prudente" segura |
| "Ningún proveedor oficial lee grupos existentes" (implícito en D9) | Auditados 15 BSPs + 15 productos "group inbox": **cero** lo hacen por vía oficial; todos los que lo hacen usan sesión QR vinculada [PROVEEDOR] | **Se sostiene, ahora demostrado por enumeración** (§3) |
| Sin datos de pricing consolidados | Rate card oficial 1-jul-2026, fila Colombia: Marketing USD 0.0125 · Utility USD 0.0008 · Auth USD 0.0008 por mensaje entregado; COP como moneda desde abr-2026 [OFICIAL] | Nuevo insumo de costos; además detecta que la plantilla del digest (hoy MARKETING) cuesta 15× lo que debería |
| — | **Meta Business Agent** (jun-2026): agentes IA operados por Meta sobre WhatsApp [OFICIAL] | Vigilar: es 1:1, no grupos, pero es la señal más clara de hacia dónde abre Meta la automatización. No cambia nada hoy |

**Nada de lo encontrado contradice D7 ni D9.** El hallazgo más importante es negativo y
definitivo: se agotaron todas las ramas del §28 del encargo (Groups API, Coexistence, BSPs,
Tech Provider, partners, betas, enterprise, group inbox, APIs privadas, novedades 2026) y
**todas terminan en NO** para grupos existentes.

---

## 2. La pregunta nº1, por superficie

> ¿Existe alguna API oficial o proveedor autorizado que permita conectar un número a grupos
> EXISTENTES y recibir sus mensajes en tiempo real? ¿Y publicar respuestas en esos grupos?

Veredicto por capacidad y por vía (grupos gremiales existentes de 50–80, creados manualmente):

| Capacidad | Cloud API | Groups API | Coexistence | Partner/beta | Producto "group inbox" |
|---|---|---|---|---|---|
| **READ** (leer mensajes del grupo) | ❌ | ❌ (solo grupos propios ≤8) | ❌ (*"will not be synchronized"*) | ❌ (no existe programa) | ✅ pero por sesión QR no oficial 🔴 |
| **RECEIVE** (webhook en tiempo real) | ❌ | ✅ solo grupos propios (`group_id`) | ❌ (`history` y `smb_message_echoes` excluyen grupos) | ❌ | ✅ no oficial 🔴 |
| **WRITE** (enviar al grupo) | ❌ | ✅ solo grupos propios (`recipient_type: group`) | ❌ | ❌ | ✅ no oficial 🔴 |
| **REPLY** (responder en el mismo grupo) | ❌ | ✅ solo grupos propios | ❌ | ❌ | ✅ no oficial 🔴 |
| **EXISTING GROUP** (grupos creados manualmente antes) | ❌ | ❌ — sin endpoint para unirse; *"you cannot manually add participants... send your invite link"* solo aplica a grupos que la API creó | ❌ — los grupos quedan solo en el teléfono | ❌ | ✅ no oficial 🔴 |
| **LARGE GROUP** (50–80 participantes) | n/a | ❌ — *"Max group participants: 8"*, diseño deliberado | n/a | ❌ | ✅ no oficial 🔴 |

Fuentes: doc de Groups API/Coexistence de Meta (Fase 1 §2, URLs en §17 de ese informe);
auditoría de proveedores en §3 de este documento. [OFICIAL][PROVEEDOR]

**Conclusión formal: NO existe la pieza "Group Gateway oficial" para grupos existentes. La
demostración es por agotamiento — no quedó rama sin revisar.** Lo que sí existe oficialmente es
el patrón completo (webhook de grupo + respuesta al grupo) **dentro del universo de grupos
creados por el negocio**: Meta construyó la tubería, pero solo para sus grupos de 8.
[OFICIAL][INFERENCIA]

---

## 3. Auditoría de proveedores: qué hay debajo de cada "we support groups"

Tabla consolidada (metodología: doc técnica del proveedor, no marketing; el método real se
clasifica según §10 del encargo — A: Cloud API · C: Groups API de Meta · E: Coexistence ·
F: sesión WhatsApp Web vinculada · H: librería reverse-engineered · J: otra):

| Proveedor | Lee grupos existentes | Webhook | Responde en grupo | API oficial | Coexistence | Método real | Riesgo |
|---|---|---|---|---|---|---|---|
| 360dialog | ❌ | solo grupos API propios | solo esos | ✅ BSP | ✅ (sin grupos) | A+C | 🟢 |
| Twilio | ❌ | ❌ | ❌ (relay 1:1 con fan-out; no es grupo real) | ✅ BSP | ✅ | A+J | 🟢 |
| Infobip | ❌ | ❌ | ❌ | ✅ BSP | ✅ | A | 🟢 |
| Vonage | ❌ | ❌ | ❌ | ✅ BSP | — | A | 🟢 |
| Sinch | ⚠️ solo doc legada Wavy (On-Premises, en sunset) | legado | legado | ✅ BSP | — | B muerta | 🟢 |
| Gupshup | ❌ | ❌ | ❌ | ✅ BSP | ✅ | A | 🟢 |
| Bird | ❌ ("channel groups" ≠ grupos WA) | ❌ | ❌ | ✅ BSP | — | A | 🟢 |
| WATI | ❌ (lo dice su FAQ) | ❌ | ❌ | ✅ BSP | ✅ | A | 🟢 |
| respond.io | ❌ (roadmap: esperando a Meta) | ❌ | ❌ | ✅ BSP | ✅ (sin grupos) | A | 🟢 |
| Interakt | ❌ | ❌ | ❌ | ✅ BSP | ✅ | A | 🟢 |
| Zoko | ❌ | solo grupos API propios | solo esos | ✅ | ✅ | A+C | 🟢 |
| SleekFlow | ❌ (grupos solo visibles en el teléfono) | ❌ | ❌ | ✅ BSP | ✅ | A+E | 🟢 |
| Trengo | ❌ | ❌ | ❌ | ✅ BSP | — | A | 🟢 |
| Rasayel | ❌ | ❌ | ❌ | ✅ BSP | ✅ | A | 🟢 |
| Kapso | ❌ (waitlist = Groups API de Meta) | solo grupos API propios | solo esos | ✅ Tech Provider | ✅ | A+C | 🟢 |
| Whapi.cloud | ✅ | ✅ | ✅ | ❌ | n/a | F/H (QR: *"linked-device session... paired via QR code"*) | 🔴 |
| Periskope | ✅ | ✅ | ✅ | ❌ (*"No Business API required"*) | n/a | F/G (QR sobre número existente) | 🔴 |
| TimelinesAI | ✅ | ✅ | ✅ | ❌ (*"appears as a linked device, exactly like WhatsApp Web"* — textual) | n/a | F | 🔴 |
| Unipile | ✅ | ✅ | ✅ | ❌ (*"not affiliated with... WhatsApp or Meta"*) | n/a | F | 🔴 |
| 2Chat | ✅ | ✅ (`whatsapp.group.message.received`) | ✅ | ⚠️ mensajería sí; grupos ❌ (docs bajo ruta `/WhatsApp/Web/` + QR) | n/a | híbrido A + F | 🟡/🔴 en grupos |
| Wassenger | ✅ | ✅ | ✅ | ⚠️ anuncia "sin riesgo de bloqueo" pero su API de grupos hace cosas imposibles en Cloud API | n/a | híbrido A + F | 🔴 en grupos (y marketing engañoso) |
| Green-API / Maytapi / UltraMsg / WASenderApi | ✅ | ✅ | ✅ | ❌ | n/a | F (QR; Maytapi vende "warming tools") | 🔴 |
| Evolution API | ✅ (vía Baileys) | ✅ | ✅ | ⚠️ dual: Cloud API oficial disponible, grupos solo por Baileys | n/a | A + H | 🟡 como middleware Cloud API; 🔴 en grupos |
| n8n/Make/Zapier (nodo oficial) | ❌ | ❌ | ❌ | ✅ | — | A | 🟢 |
| n8n/Make/Zapier (nodos comunidad) | ✅ | ✅ | ✅ | ❌ | — | envoltorio de F/H | 🔴 |

**Tres patrones que valen como reglas de evaluación permanentes** [INFERENCIA sobre PROVEEDOR]:

1. **QR = no oficial (para grupos).** La única excepción de QR legítimo es el onboarding de
   Coexistence — que explícitamente no da grupos. Si un producto lee grupos existentes tras
   escanear un QR, está hablando el protocolo por ti.
2. **"No Business API required" / "skip Meta approvals" es una confesión**, no una ventaja.
3. **El proveedor que niega el riesgo es más peligroso que el que lo admite.** Los honestos
   (Whapi, Maytapi, Green-API) publican FAQs de baneo; Wassenger promete "sin riesgo" haciendo
   lo mismo.

---

## 4. El Group Gateway, diseñado como adaptador (sin tocar Sofi)

Aunque el transporte automático no exista por vía oficial, **el Gateway se diseña igual** —
como contrato — para que el sistema sea indiferente a cómo entra la señal (reenvío hoy, export
hoy, extensión mañana, Groups API propia, o cualquier vía futura que Meta abra). Esto ya es
mayormente cierto en el código: el motor nunca supo de WAHA y sobrevivió a su muerte. [INTERNA]

### 4.1 Contrato de entrada — evento crudo (`group.message.observed`)

```json
{
  "source": "whatsapp",
  "channel": "group",
  "transport": "reenvio | export | extension | groups_api",
  "org_id": "…",
  "group_id": "export:<slug> | reenvio:<hash> | <jid-real>",
  "message_id": "<sha256-40hex: grupo|instante|autor|plano(texto)>",
  "sender_id": "<jid o null>",
  "sender_name": "<string o null>",
  "observer_advisor_id": "<quién lo observó — la interpretación tiene dueño>",
  "timestamp": "<fecha del MENSAJE, no de la carga>",
  "text": "…",
  "media": null
}
```

Decisiones ya congeladas que este contrato respeta [INTERNA]: el `message_id` usa la semilla
de hash D2 (dedup idéntico entre transportes); `timestamp` es la fecha del mensaje (regla del
importador: frescura = fecha del mensaje, no del upload); `observer_advisor_id` va en la señal
y nunca en el grupo ("el grupo es compartido, la interpretación no"); `sender_id` puede ser
null (los reenvíos no traen autor) y los `@lid` no son teléfonos marcables.

### 4.2 Contrato intermedio — señal extraída

Es, campo por campo, el schema ya forzado por API en `src/groups/classify.js` [INTERNA]:

```json
{
  "clase": "demanda | oferta | ruido",
  "confianza": 0.94,
  "operacion": "venta | arriendo",
  "tipo": "apartamento", "zona": "laureles", "ciudad": "medellin",
  "precio_min": 0, "precio_max": 650000000,
  "habitaciones": 3, "area_min": 0, "banos": 0, "garajes": 0, "estrato": 0,
  "contacto": "", "notas": ""
}
```

(Convención existente: no-nullable; `0`/`""` = no especificado.)

### 4.3 Contrato de salida — decisión

```json
{
  "decision": "draft_for_human | reply_1to1 | digest | ask_more_info | ignore",
  "confidence": 0.93,
  "matches": [{ "ref": "…", "puntaje": 87, "razones": ["…"], "origen": "propio|aliado" }],
  "response_draft": "…",
  "requires_human_approval": true,
  "policy_trace": ["dedup:ok", "rate:ok", "confianza:0.93>=0.85", "matches:3"]
}
```

Nota deliberada: **no existe `decision: "reply_in_group"`.** No hay transporte oficial que la
ejecute y la regla del proyecto la prohíbe (§8). Si Meta abriera mañana la escritura a grupos
grandes, se agregaría el valor al enum — el resto del sistema no cambia. `policy_trace` hace
auditable por qué se decidió cada cosa.

### 4.4 Mapeo sobre los módulos reales

| Pieza del Gateway | Ya existe | Falta |
|---|---|---|
| Ingesta reenvío | `src/channels/whatsapp.js` (webhook Cloud API) | Marcar el reenvío como señal de grupo con `transport: "reenvio"` de forma explícita |
| Ingesta export | `/api/grupos/importar-export` + `src/groups/parse-export.js` + jobs | — |
| Normalización + dedup | `epe/core` (hash D2, corte, dedup, prefiltro) | — |
| Message Router | `src/groups/importar-export.js` orquesta parse→corte→dedup→prefiltro→clasificar→cruzar | Extraerlo como función transporte-agnóstica que consuma el evento 4.1 (refactor menor) |
| "Sofi" (extracción) | `src/groups/classify.js` (Haiku, schema forzado) | — |
| Wasi (inventario) | tabla `properties` sincronizada por DMAP + `ally_properties` | — |
| Matching | `src/groups/match.js` (gates + scoring) | Re-match al entrar inventario nuevo (hoy los matches quedan congelados en la señal) |
| Response Builder | `borrador()` en `crm/components/senales-grupos.tsx` + alertas `src/notifications/advisor.js` + digest | Mover el borrador a servidor para que `response_draft` viaje en el evento y sirva a cualquier salida |
| Salidas | CRM (aprobar/copiar), digest 7am, Sofi 1:1 | Enum de decisión 4.3 como política central (§5) |
| Aprendizaje | `signal_events` append-only (7 outcomes) | Usarlo para calibrar umbrales (§5.3) |

**Conclusión de diseño: el Gateway no es un servicio nuevo — es formalizar los contratos que
ya existen entre módulos y centralizar la política de decisión.** Cero reconstrucción de Sofi,
CRM, matching o inventario. [INFERENCIA sobre INTERNA]

---

## 5. Pipeline de decisión y anti-spam interno

Política central (nueva pieza, pequeña y determinística), aplicable hoy a salidas
humanas/1:1 y a cualquier automatización futura permitida:

```
evento crudo
   ↓ prefiltro léxico            → ruido evidente: IGNORE (85%, gratis)
   ↓ dedup exacto (hash D2)      → ya visto: IGNORE
   ↓ clasificación (Haiku)       → clase=ruido: IGNORE
   ↓ dedup semántico             → misma demanda ya activa: agrupar, no duplicar
   ↓ validación de campos        → demanda sin zona NI tipo NI precio: ASK_MORE_INFO*
   ↓ búsqueda inventario (Wasi)  → matching determinístico
   ↓ score y confianza           → sin matches: solo registro (radar aprende igual)
   ↓ rate limits                 → presupuesto de grupo/usuario agotado: DIGEST (no en vivo)
   ↓ política de respuesta       → DRAFT_FOR_HUMAN | REPLY_1TO1 | DIGEST
```

\* `ASK_MORE_INFO` solo por canales legítimos: si el mensaje llegó por reenvío, se le pregunta
al asesor que reenvió (1:1); nunca se le escribe en frío al autor original del grupo (Ley 1581,
caso Movistar — Fase 1 §12).

### 5.1 Cuándo responde / ignora / pregunta / privado / humano

| Situación | Decisión |
|---|---|
| Ruido, duplicado, oferta sin datos utilizables | **Ignora** (y el ruido no se persiste — invariante de privacidad) |
| Demanda con matches, confianza y score altos | **Borrador para humano** (hoy) · **REPLY_1TO1** si el autor ya escribió a Sofi (ventana 24h abierta) |
| Demanda ambigua pero prometedora | **Pregunta** al asesor-puente por 1:1 |
| Demanda de un colega identificado con opt-in previo | **Privado 1:1** desde la línea de Sofi (plantilla utility si la ventana está cerrada) |
| Cualquier envío hacia un grupo | **Humano siempre** — sin excepción (regla "Fase C — nunca") |
| Cualquier caso bajo umbral de confianza | **Humano** o silencio; nunca auto |

### 5.2 Controles anti-spam propios (aunque la plataforma permitiera más)

- **Per-group rate limit:** máx. N intervenciones/día/grupo (arranque sugerido: 3), presupuesto
  compartido entre asesores del mismo grupo. El exceso va al digest.
- **Per-user rate limit:** máx. 1 contacto proactivo/día/colega; el pair rate limit de Meta
  existe además como límite duro externo. [OFICIAL]
- **Dedup exacto:** hash D2 (ya congelado, idéntico entre export/reenvío/extensión). [INTERNA]
- **Dedup semántico:** misma `(operacion, tipo, zona, banda de precio ±10%, habitaciones)` en
  ventana de 48h = una sola oportunidad con N observaciones. Ojo con la asimetría: "busco apto
  Laureles 600M" (demanda) y "tengo cliente para apto Laureles 600" (demanda de colega) son la
  misma demanda; "tengo apto en Laureles 600M" es oferta — el schema ya separa `clase`, y el
  dedup solo agrupa dentro de la misma clase.
- **Cooldown:** tras intervenir sobre una oportunidad, silencio sobre sus duplicados
  posteriores (se anotan como observaciones del mismo caso).
- **Confidence threshold:** actuar solo si `confianza_clasificacion ≥ 0.85` **y**
  `puntaje_match ≥ 80` (el umbral verde ya usado en el CRM); entre 60–80, solo digest; bajo 60,
  solo registro. Umbrales en config, no en código.
- **Human override:** `radar_activo` por org (ya existe: apaga clasificación y digest);
  aprender del baneo: el kill switch se verifica en logs, no se asume. [INTERNA]

### 5.3 Calibración con datos propios

`signal_events` (append-only, 7 outcomes: SIN_RESPUESTA → CIERRE/PERDIDO/DESCARTADO) ya
registra qué pasó con cada señal. Regla de calibración: si los matches de puntaje 80–85
terminan sistemáticamente en DESCARTADO, el umbral sube; si los de 70–80 generan CONVERSACION,
baja. Revisión mensual, manual al principio — los pesos no se tocan sin evidencia. [INTERNA]

---

## 6. Las alternativas de captura, evaluadas con su UX

### 6.1 Forward-to-Sofi (reenvío) — implementado

UX real: mantener pulsado → Reenviar → Sofi. ~5 segundos, desde el teléfono donde el asesor ya
vive. Sofi contesta 1:1 con matches al instante (motor ya en producción). Es además el mejor
prefiltro que existe: el humano no reenvía el 98,4% de ruido. Debilidad: depende del hábito —
la pieza es social (pedirlo, celebrarlo, medirlo), no técnica. [INTERNA]

### 6.2 Click-to-Sofi — activar

El asesor (nuestro, o cualquier colega convencido) publica en el grupo un mensaje con enlace
`https://wa.me/<numero_sofi>?text=<texto prellenado>` ("🔎 ¿Buscás algo? Escribile a Sofi").
Quien hace click cae 1:1 con Sofi con la ventana de 24h abierta — conversación, matching y
ficha completos, y el colega queda como contacto marcable (lo que los `@lid` nunca fueron).
[OFICIAL: wa.me y ventana de servicio][INTERNA]

¿Compite en velocidad contra un bot dentro del grupo? En latencia percibida sí — la respuesta
1:1 llega en segundos. Lo que no da es la vitrina pública en el grupo; esa la da el humano que
pega el borrador (6.4). Es el complemento natural del reenvío: reenvío = empuje del asesor;
click = atracción del colega.

### 6.3 "Sofi como participante del grupo" — veredicto documentado: imposible oficialmente

Para que Sofi fuera un participante automatizado de un grupo gremial existente necesitaría ser
un dispositivo/cliente en ese grupo. Vías: (a) Groups API — no puede unirse a grupos ajenos y
además máx. 8 [OFICIAL]; (b) Coexistence — los grupos no se sincronizan a la API [OFICIAL];
(c) cliente no oficial — prohibido y demostrado como causa de baneo [INTERNA]. **No existe la
figura "bot miembro de grupo de consumidores" en la plataforma oficial. Demostrado en §2.**
La única versión legítima: Sofi como miembro de **grupos propios de ≤8 creados por Groups
API**, donde sí puede leer y responder oficialmente — útil para micro-grupos por negocio, no
para el gremio.

### 6.4 Bot + humano en coexistencia — ya resuelto en el producto

- **1:1 (Cloud API):** ya funciona hoy — `modo: "humano"` silencia a Sofi en esa conversación y
  el asesor sigue desde el CRM; el patrón borrador-y-copiar deja al humano la última palabra
  hacia grupos. [INTERNA]
- **1:1 (Coexistence):** oficialmente soportado — el teléfono y la API conviven en el mismo
  número con espejo bidireccional (`smb_message_echoes`); útil POST-MVP para meter los 1:1 de
  asesores al CRM. Sin grupos. [OFICIAL]
- **Grupos:** la coexistencia es humano-con-asistencia: la máquina observa (por las vías
  seguras), prepara y sugiere; el humano publica. Es exactamente el flujo del CRM actual.

---

## 7. Matriz de opciones y riesgo razonado

| Opción | Lee grupos actuales | Responde mismo grupo | Oficial | Riesgo línea | Complejidad | Costo | Escalabilidad |
|---|---|---|---|---|---|---|---|
| Cloud API sola | ❌ | ❌ | ✅ | 🟢 | Baja (hecha) | Bajo | Alta |
| Groups API | ❌ (solo propios ≤8) | ✅ solo propios | ✅ | 🟢 | Media (OBA) | Bajo | Media |
| Coexistence | ❌ | ❌ | ✅ | 🟢 | Media | Bajo | Media |
| BSP (cualquiera) | ❌ | ❌ | ✅ | 🟢 | Baja | Medio (fees) | Alta |
| Proveedor especializado (Whapi/Periskope/…) | ✅ | ✅ | ❌ | 🔴 | Baja | Medio | Alta |
| WhatsApp Web automation (librerías) | ✅ | ✅ | ❌ | 🔴 | Media | Bajo | Alta |
| Gateway híbrido (captura humana → motor → salida oficial) | ✅ curado | vía humano | ✅ | 🟢 | Baja (hecho) | Bajo | Media |
| Forward-to-Sofi | ✅ curado | vía humano | ✅ | 🟢 | Hecha | Bajo | Media |
| Click-to-Sofi | atrae la demanda | ❌ (responde 1:1) | ✅ | 🟢 | Baja | Bajo | Alta |
| Extensión Chrome solo-lectura | ✅ (chat abierto) | ❌ (jamás escribe) | ⚠️ gris | 🟡 | Alta (MV3+Store) | Medio | Media |
| Ruta D (Android + notificaciones) | parcial | ❌ | ⚠️ | 🟡 | Alta | Medio | Baja |

**Por qué cada clasificación de riesgo** (sin probabilidades inventadas):

- 🟢 **Bajo:** ninguna pieza habla el protocolo de WhatsApp fuera de la Cloud API oficial; el
  contrato con Meta se cumple a la letra; no hay superficie que un cambio de enforcement pueda
  castigar. Evidencia: es la arquitectura actual y la línea Cloud API no ha tenido un solo
  incidente. [INTERNA]
- 🟡 **Medio:** no se habla el protocolo (sin vector de baneo por cliente), pero hay zona gris
  de ToS ("uso automatizado") y fragilidad técnica (DOM/Store para la extensión; notificaciones
  truncadas y grupos silenciados para la Ruta D). Evidencia: cero casos documentados de baneo
  por lectura pasiva, todos los conocidos son de envío; precedente GistGem publicado en Web
  Store. El riesgo dominante es de *proyecto* (semanas perdidas), no de línea. [SECUNDARIA][INFERENCIA]
- 🔴 **Alto:** cliente no autorizado = violación estructural de ToS con detección por
  fingerprint demostrada en nuestros propios logs y en la ola 2026 de la comunidad; la sanción
  cae sobre la línea conectada, independientemente de la conducta. [INTERNA][COMUNIDAD][OFICIAL]

---

## 8. La solución que no estaba en la lista

El objetivo de negocio es *"agente publica necesidad → Sofi la detecta → encuentra propiedad →
devuelve respuesta rápida"* — no "leer cada byte de cada grupo". Con esa lente, tres jugadas
que valen más que cualquier gateway:

1. **Invertir la dirección: que la demanda venga a Sofi.** Click-to-Sofi (6.2) + posicionar a
   Sofi como *el buscador del gremio* ("¿buscás algo para tu cliente? Sofi te lo cruza en
   segundos contra 58 inmobiliarias"). El grupo deja de ser algo que espiar y pasa a ser un
   canal de distribución del enlace. El incentivo del colega es real: él gana comisión
   compartida si el match cierra.
2. **El lado oferta ya no depende de los grupos:** la red pública de sitios Wasi (PoC: 58
   sitios / 11,5 s / 162 propiedades) da el inventario del gremio estructurado y fresco, con
   dedup por `ref` y contacto publicado. Contra el 1,6% de accionables de la captura en vivo,
   es mejor dato con riesgo cero. [INTERNA]
3. **El digest operado como producto:** más que vender "un bot que lee grupos", operar el
   radar nosotros y entregar cada mañana al asesor las 3–5 oportunidades con match — la opinión
   contraria ya registrada en la auditoría del MVP apunta ahí. El valor percibido es el mismo y
   no exige resolver la captura total.

### Niveles de automatización — dónde está el techo seguro hoy

| Nivel | Descripción | ¿Disponible seguro? |
|---|---|---|
| 0 | Humano hace todo | ✅ |
| 1 | Humano reenvía/exporta a Sofi | ✅ hoy (producción) |
| 2 | Sofi interpreta, cruza y prepara respuesta | ✅ hoy (producción) |
| 3 | Humano aprueba y publica | ✅ hoy (CRM, borrador-y-copiar) |
| 4 | Sofi responde automáticamente | ✅ **solo 1:1** (ventana 24h / plantilla a opt-in) y en **grupos propios ≤8** — jamás en grupos gremiales |
| 5 | Sofi responde y sostiene la conversación | ✅ solo 1:1 (ya lo hace con clientes) |

**Máximo nivel seguro hoy: 3 hacia grupos gremiales; 5 en 1:1; 4–5 en micro-grupos propios.**
El criterio de éxito obligatorio del encargo (§26) se cumple completo en ese techo: procesa
solicitudes ✅, usa Sofi ✅, consulta Wasi ✅, matchea ✅, genera respuesta ✅, impacto mínimo en
infra ✅. Del "ideal", se cede exactamente una cosa: la publicación automática en el grupo.

---

## 9. Escenarios, recomendación y respuestas ejecutivas

### ESCENARIO A — ¿Existe solución oficial (para leer los grupos existentes)?

**No existe.** Demostrado por agotamiento en §2 (seis vías, todas ❌, con citas oficiales).
Lo único oficial que existe es el patrón de grupos **propios** de ≤8 con OBA.

### ESCENARIO B — ¿Existe solución híbrida aceptable?

**Sí, dos, con riesgos distintos y acotados:**

- **La que ya corre:** captura humana (reenvío + export) → motor → salida humana/1:1. Riesgo
  introducido: cero para la línea; el costo es cobertura parcial y dependencia del hábito.
- **La candidata:** extensión Chrome de solo lectura sobre el WhatsApp Web del asesor
  (post-D7: lee el DOM del chat abierto; nunca escribe; prefiltro local). Riesgo introducido:
  zona gris de ToS sin precedente de sanción por lectura, fragilidad de DOM, calendario de
  Chrome Web Store. **Condición: solo después de que el piloto pruebe el valor** — y con
  canario en cuenta propia, jamás estrenarla en la línea de un asesor.

### ESCENARIO C — Mejor alternativa conservando el valor

Es la arquitectura recomendada de la Fase 1 (§7): motor actual + reenvío + export +
click-to-Sofi + red Wasi para oferta + digest operado + micro-grupos propios con OBA +
respuesta 1:1 automática donde es legal y humana hacia los grupos. Conserva ~todo el valor de
negocio; renuncia solo a la publicación automática en el grupo, que ninguna vía defendible
permite.

### Recomendación final (§29 — con posición)

**Si esta fuera mi inmobiliaria y la línea fuera crítica, implementaría el Escenario C
empezando esta semana, con el B-candidata (extensión) como decisión diferida a datos.**

1. **Por qué:** es la única arquitectura donde la línea no puede perderse por diseño; el 90%
   ya está construido; y los datos propios (1,6% accionable) dicen que la captura total
   automática vale menos que la curaduría humana + la red pública.
2. **Cómo:** roadmap de la Fase 1 §14 (piloto 4–6 semanas con gates numéricos ya definidos).
3. **Qué sacrificamos:** la respuesta automática dentro del grupo y la cobertura total pasiva
   de los 80 grupos.
4. **Qué ganamos:** línea indestructible por diseño, compliance defendible (Meta + SIC),
   contacto marcable de los colegas, y un sistema que ningún cambio de enforcement de Meta
   puede apagar.
5. **Riesgo restante:** privacidad (mitigada con los 12 controles), adopción del hábito por
   los asesores (riesgo real nº1, social), y la fragilidad futura de la extensión si se
   aprueba.
6. **Costo:** ≤ USD 40/mes de infra+API+LLM para el piloto (Fase 1 §13); desarrollo interno.
7. **Tiempo:** piloto listo para arrancar ya (falta hábito, no código); OBA ~semanas de
   trámite; extensión (si se aprueba) semanas adicionales por Web Store.
8. **Migración:** ya ocurrió — WAHA está fuera del repo desde ago-2026; los pasos restantes
   son consolidación (Fase 1 §8).

### Respuesta ejecutiva final (§31)

**1. ¿Podemos leer automáticamente nuestros grupos actuales de 50–80 agentes?**
No por ninguna vía oficial (demostrado por agotamiento: Cloud API, Groups API, Coexistence,
OBA, 15 BSPs, partners y betas — todas ❌). Sí parcialmente por captura mediada por humanos
(reenvío + export, ya en producción), y potencialmente más con la extensión de solo lectura,
que es zona gris aceptable solo tras probar el valor.

**2. ¿Podemos responder automáticamente en esos mismos grupos?**
No. No existe vía oficial de escritura a grupos de consumidores, y la regla del proyecto lo
prohíbe además por diseño ("Fase C — nunca"). La respuesta automática legítima existe en 1:1
(ventana de 24h / plantillas a opt-in) y dentro de grupos propios de ≤8 vía Groups API.

**3. ¿Cuál es la forma más segura de hacerlo?**
La que ya está desplegada: humano saca el mensaje del grupo (reenvío/export) → motor
determinístico + Haiku hace interpretación y matching → humano publica la respuesta en el
grupo o Sofi responde 1:1. Riesgo de línea: cero estructural.

**4. ¿Cuál es la forma técnicamente más potente pero arriesgada?**
Un gateway de sesión vinculada (Whapi/Periskope/Baileys y familia): lee y escribe todo, en
tiempo real, en los 80 grupos — y es exactamente la categoría que nos baneó una línea el
2026-07-30, viola los ToS a la letra y está bajo una ola de enforcement documentada en 2026.
Potencia total, activo en riesgo total: descartada.

**5. ¿Qué implementarías tú mañana si la línea fuera tuya?**
El Escenario C tal cual: piloto de 4–6 semanas con reenvío + export en 5–10 grupos clave,
click-to-Sofi publicado por los asesores, red Wasi alimentando la oferta, digest operado, OBA
en trámite, y los umbrales del spec como jueces. Si los datos dicen que la demanda en tiempo
real es negocio, construyo la extensión de solo lectura con canario en mi propia cuenta. Y la
línea de Sofi no toca jamás un cliente no oficial — esa lección ya está pagada.
