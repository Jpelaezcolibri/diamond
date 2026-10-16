# Kit de publicación en grupos + captación de dueños para arriendo

Fecha: 2026-10-16 · Estado: diseño aprobado por Juan, mockup aprobado
(`docs/superpowers/mockups/2026-10-16-kit-publicacion.html`).

## 1. Por qué

Juan quiere vender desde hoy usando los grupos gremiales y poder poner aptos
en renta. El análisis del 2026-10-16 encontró:

- **Grupos:** la línea del radar solo escribe en un grupo como respuesta
  citada a un pedido (`whatsapp-group.js:342`), y eso está apagado
  (`GRUPOS_RESPUESTA_MODO=asistido`). No hay publicación de ofertas. Publicar
  por WAHA es el patrón con más baneos y la línea (Daiana, 301 188 0668) ya
  fue baneada una vez y ya pasa la cuota de ~300/mes solo con DM. La F4 del
  spec `2026-10-07-app-diamond-asesores-design.md` (publicación automática)
  queda **fuera** de este trabajo.
- **Arriendo:** un dueño que escribe "quiero arrendar mi apto" queda como
  INQUILINO (`tools.js:708` mapea todo "arrend" a `arrendar`; `intent.js` solo
  reconoce vender/consignar) y Sofi le ofrece inventario. En la landing pasa
  lo mismo (`lead-form.tsx` solo tiene "vender" para el propietario). Sin
  captación no hay inventario de arriendo (hoy 2 a 8 propiedades).

## 2. Alcance

**Entra:**
- A. Página `/kit` del CRM, pensada para el celular de la asesora: elegir
  propiedad → post con fotos + texto → Compartir nativo a WhatsApp.
- B. Sofi capta dueños que quieren arrendar (mensual o renta corta), arma una
  ficha corta y la transfiere a la asesora de arriendos.
- C. Opción "Arrendar mi propiedad" en el formulario de propietarios de la
  landing.

**No entra:** publicación automática por WAHA (F4), reservas/calendario de
renta corta, contratos, estudio del arrendatario, recaudo.

## 3. A — Kit de publicación

### 3.1 Flujo (mockup, pantallas 1-3)

1. La asesora abre `crm…/kit`. Arriba, tres KPIs de color sólido:
   compartidas esta semana (índigo), clientes que llegaron a Sofi por un post
   en 7 días (teal), propiedades listas para publicar (ámbar).
2. Selector Venta / Arriendo, chips de zona, lista de propiedades con foto,
   título, zona, área, alcobas, ref, precio y una etiqueta:
   "Nunca compartida" o "Compartida hace N días [por Asesor N]". Si la
   compartieron hace menos de 7 días, la etiqueta va en ámbar.
3. Al tocar una propiedad: galería con las primeras 4 fotos, el texto del
   post y el interruptor "Incluir 'Comparto comisión con colegas'"
   (encendido por defecto).
4. Botón verde **Compartir en WhatsApp** → `navigator.share({ files, text })`.
   El menú nativo del celular abre WhatsApp con las fotos y el texto y ella
   elige los grupos. Si el navegador no soporta compartir archivos
   (`navigator.canShare` falso), quedan **Copiar texto** y **Descargar fotos**.
5. Al compartir (o copiar) se registra la publicación.

Lo envía la asesora desde su WhatsApp, como un mensaje normal: **no pasa por
WAHA ni por la Cloud API**, no gasta cuota y no arriesga la línea.

### 3.2 Qué propiedades aparecen

Solo las que se pueden publicar sin pedido de por medio. Se reusan los
criterios de calidad de dato que ya existen, no los de match:

- `disponible = true`, de la org del usuario (multi-tenant por `org_id`).
- Con `linkWasi` (`enlazarWasiPublico`), y no en `GRUPOS_REFS_BLOQUEADAS`.
- Sync de Wasi fresco (`GRUPOS_SYNC_MAX_HORAS`); si está viejo, la página
  muestra un aviso arriba y no lista nada ("el inventario no está al día").
- Con al menos una foto en `properties.images`.
- El link de Wasi se verifica con `verificar-link.js#verificar` **al abrir la
  ficha** (no al listar, para no hacer 100 requests). Si no abre, la ficha
  muestra "el link de Wasi no abre, no la compartas" y deshabilita Compartir.

La lógica vive en el bot (donde ya están `publicable`, `verificar-link`,
`redactar` y `enlazarWasiPublico`), expuesta en `src/api/crm.js`:

- `POST /api/kit/propiedades` `{ orgId, operacion, zona? }` → lista con la
  etiqueta de última publicación.
- `POST /api/kit/post` `{ orgId, ref, comision }` → `{ texto, fotos[], linkOk }`.
- `POST /api/kit/registrar` `{ orgId, ref, userId, accion }` →
  `accion ∈ compartir | copiar | descargar`.

El CRM llama por `crm/lib/bot.ts#callBot` desde route handlers en
`crm/app/api/kit/…`, con la sesión de Supabase del usuario (cualquier usuario
autenticado de la org; no hace falta ser admin).

### 3.3 El texto del post (sin IA, costo $0)

Sale de una función nueva `redactar.postGrupo(propiedad, { org, comision })`
que reusa `ficha()` y sus helpers (`tituloUtil`, `textoAdministracion`,
`formato.*`) pero sin el índice "1)" ni la sangría:

```
Apartamento en La Frontera, Envigado
Ref 10077063 · Venta
85 m² · 3 alcobas · $480.000.000
2 baños · 1 garaje · estrato 4 · administración $350.000
Piscina · Gimnasio · Portería 24 h

Comparto comisión con colegas 🤝

Fotos y ficha: <linkWasi>
Info o visita con Sofi: <linkContactoOficial(org, "Hola, vi en un grupo la Ref 10077063")>
```

- Lo que no está cargado no aparece (misma regla de la ficha: un hueco no se
  disfraza de "0 baños").
- **Nunca** el nombre ni el celular de la asesora (regla de identidad pública,
  `src/lib/identidad-publica.js`).
- Sin `linkContactoOficial` configurado para la org, se omite esa línea.
- La línea de comisión sale solo con el interruptor encendido.

### 3.4 Fotos

- Las primeras 4 de `properties.images`.
- El navegador no puede bajar las fotos de Wasi directo (CORS). Una ruta del
  CRM, `GET /api/kit/foto?ref=…&i=…`, las trae del lado del servidor y las
  devuelve como imagen. Solo acepta índices de las fotos de esa propiedad en
  la base: **nunca una URL arbitraria** (no es un proxy abierto).
- El cliente arma los `File` para `navigator.share`. Si una foto falla, se
  comparte con las que sí bajaron; si no baja ninguna, solo texto y un aviso.

### 3.5 Registro y medición

Migración nueva `db/migrations/2026-10-16_kit_publicacion.sql` (solo agrega):

```sql
create table if not exists kit_publicaciones (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  property_ref text not null,
  user_id uuid references auth.users(id) on delete set null,
  accion text not null,          -- compartir | copiar | descargar
  created_at timestamptz not null default now()
);
create index if not exists kit_publicaciones_org_ref_idx
  on kit_publicaciones (org_id, property_ref, created_at desc);

alter table leads add column if not exists kit_ref text;
alter table leads add column if not exists kit_at timestamptz;
```

- "Compartida hace N días por Asesor N" sale de `kit_publicaciones` (el alias
  público del usuario, nunca su nombre).
- **Atribución:** en `engine.js`, si el mensaje trae
  `vi en un grupo la Ref (\d+)` y el lead no tiene `kit_ref`, se guardan
  `kit_ref` y `kit_at`. No se toca `leads.source` (es el canal, y un colega
  lo sobreescribe con `colega`). La ref ya la reconoce `REF_PATTERN`, así que
  Sofi atiende como siempre.
- Escritura best-effort: si la migración no corrió, el kit funciona igual y
  solo pierde el aviso de repetición y el KPI (log `[kit]`).

## 4. B — Sofi capta dueños que quieren arrendar

### 4.1 Detectar al dueño

- `src/agent/intent.js`: nuevo `OWNER_RENT_RE` y `detectOwnerRentIntent(text)`
  → `"consignar_arriendo"`. Frases de ALTA precisión, el dueño hablando de SU
  inmueble: "arrendar mi apto", "poner en arriendo mi casa", "tengo un
  apartamento para arrendar", "quiero rentar mi apto", "mi apto para Airbnb",
  "ustedes administran arriendos". No dispara con "busco arrendar un apto" ni
  "quiero arrendar un apartamento en Envigado".
- Donde hoy se usa `detectSellerIntent`, se usa también esta, con la misma
  semántica de piso de confiabilidad.
- `tools.js:708` (`registrar_dato_lead` campo `intencion`): reconoce el valor
  `consignar_arriendo` (y textos como "dueño arriendo") **antes** del regex
  `arrend` → `arrendar`.
- `resolveLeadAdvisor`: `consignar_arriendo` entra en `sigueFlujoEspecial`
  (no se le asigna el captador de una propiedad que haya mirado).

### 4.2 La ficha corta

Reglas nuevas en `src/agent/prompts.js`, después de la 33, con la misma forma
que la captación para vender:

- Apenas se note que es un DUEÑO que quiere arrendar: registrar
  `intencion = consignar_arriendo`. Nunca ofrecerle inventario ni armarle
  link de "estoy interesado".
- Preguntar de a poco, sin interrogatorio y sin repetir lo que ya dijo: zona
  y barrio, tipo de inmueble, alcobas, canon esperado, si está amoblado, si
  es arriendo mensual o por noches, y su nombre.
- Si es por noches: preguntar si tiene RNT y si el edificio (la propiedad
  horizontal) permite renta corta. No le da asesoría legal ni promete nada
  sobre eso: solo lo anota.
- Cada dato va con una herramienta nueva `registrar_inmueble_ofrecido`
  (campos opcionales: `zona`, `tipo`, `habitaciones`, `canon`, `amoblado`,
  `periodo` mensual|corta, `rnt`, `ph_permite`), que hace merge en
  `leads.inmueble_ofrecido` (jsonb).
- Con zona, tipo y nombre, transferir con `transferir_a_asesor` especialidad
  `arriendo` e intención `consignar_arriendo`. Lo que falte lo completa la
  asesora en la visita de captación.

Migración: en el mismo archivo `2026-10-16_kit_publicacion.sql`:

```sql
alter table leads add column if not exists inmueble_ofrecido jsonb;
```

Persistencia best-effort, como `intencion`: en memoria siempre, en la base si
la columna existe.

### 4.3 Qué recibe la asesora

- La transferencia va por el camino actual (alerta en el chat del CRM) con un
  encabezado distinto: **"Dueño · renta corta"** o **"Dueño · arriendo
  mensual"** y la ficha (mockup, pantalla 4).
- El lead queda `categoria='alquiler'` e `intencion='consignar_arriendo'`, y
  la ficha se ve en el chat del lead en el CRM (isla navy/dorado del mockup).
- Asesor: `findForTransfer(org, 'arriendo')`. Hoy cae en Daiana.

## 5. C — Landing

`web/components/forms/lead-form.tsx`: la opción del propietario pasa a ser
"Vender mi propiedad" / "Arrendar mi propiedad". La segunda manda
`intencion='consignar_arriendo'`; `web/app/api/leads/route.ts` la acepta y la
guarda con `categoria='alquiler'`. El texto prellenado de WhatsApp para ese
caso dice "Hola, quiero poner en arriendo mi propiedad" (que
`detectOwnerRentIntent` reconoce).

## 6. Pruebas

- `test/intent.test.js`: frases de dueño (mensual y Airbnb) → 
  `consignar_arriendo`; frases de inquilino → `null`; las de vender siguen
  dando `vender`.
- `test/redactar.test.js`: `postGrupo` con propiedad completa, con huecos
  (no aparecen), sin comisión, sin contacto oficial; nunca contiene el nombre
  ni el teléfono de un asesor.
- Tests de la API `/api/kit/*`: filtra no disponibles, sin link, bloqueadas y
  sin foto; respeta `org_id`; registrar sin la tabla no rompe.
- Ruta de foto del CRM: rechaza un índice fuera de rango y una ref de otra
  org.
- `engine`: el mensaje "vi en un grupo la Ref X" guarda `kit_ref` una sola
  vez.
- Golden set (`railway run --service diamond node scripts/golden-revalidar.js`)
  después de tocar el prompt, y una conversación de prueba de dueño mensual,
  dueño Airbnb e inquilino.
- Verificación en el celular (o `resize_window` mobile) con Juan logueado:
  Compartir abre el menú con las fotos.

## 7. Riesgos

- **Quemar los grupos:** si comparten la misma propiedad todos los días los
  sacan. El aviso de 7 días es solo un aviso; no bloquea.
- **iPhone/Android viejos:** `navigator.share` con archivos no está en todos;
  queda Copiar + Descargar.
- **Prompt:** reglas nuevas pueden mover el flujo de venta; por eso el golden
  set.
- **Falsos positivos de dueño:** el regex se queda en frases de alta
  precisión; si se escapa una, el modelo todavía puede registrar la intención
  por su cuenta.
