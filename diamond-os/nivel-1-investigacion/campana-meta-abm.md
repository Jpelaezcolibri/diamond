# Campaña de Meta — ABM sobre las 239 cuentas

Especificación lista para montar. **Mi recomendación es lanzarla después de las
primeras 15 conversaciones, no antes** — el motivo está en la sección 6. Queda
escrita para que la dispares el día que decidas.

---

## 1. Qué tipo de campaña es esta (y cuál NO es)

**No es una campaña de prospección.** Ya tenés las 239 empresas con nombre,
teléfono, correo y dirección. Pagar por alcanzarlas es pagar por algo que ya
tenés.

**Es una campaña de cobertura aérea (ABM).** Su único trabajo es que, cuando
llames a Inmobiliaria Johnson el miércoles, el gerente ya haya visto tu nombre
tres veces. Sube la tasa de respuesta de la llamada; no genera leads por sí sola.

Por eso el KPI **no** es costo por lead. Es:

- Frecuencia sobre la audiencia objetivo (meta: 3–5 impresiones por cuenta/semana)
- % de cuentas alcanzadas del total cargado
- **Tasa de respuesta de tus llamadas con anuncio vs sin anuncio** — la única que importa

---

## 2. Estructura

```
CAMPAÑA  ·  Objetivo: Reconocimiento de marca  o  Tráfico
│                (NO uses "Clientes potenciales": no querés
│                 formularios de desconocidos, querés que 239
│                 personas concretas te reconozcan)
│
├── CONJUNTO A — "Cuentas objetivo" (el corazón)
│     Audiencia: Custom Audience cargada desde el CSV
│     Ubicación: Valle de Aburrá
│     Presupuesto: 70% del total
│     Optimización: Alcance, con límite de frecuencia 3/semana
│
├── CONJUNTO B — "Similares"
│     Audiencia: Lookalike 1% de la Custom Audience
│     Segmentación extra: cargos de dirección/gerencia + intereses
│                         de bienes raíces
│     Presupuesto: 20%
│
└── CONJUNTO C — "Retargeting"
      Audiencia: visitantes del sitio de Vértice últimos 30 días
                 + engagement con la página
      Presupuesto: 10%
```

**Presupuesto sugerido: $15.000–$25.000 COP/día durante 3 semanas**
(~$315.000–$525.000 COP total). Con una audiencia de 239 cuentas no necesitás
más: gastar de más solo infla la frecuencia hasta molestar.

---

## 3. La Custom Audience — y la advertencia legal

Cargá desde `prospectos-inmobiliarias-valle-aburra.csv`:

| Campo del CSV | Campo de Meta |
|---|---|
| `email` | Email |
| `telefono` | Teléfono (formato +57...) |
| `razon_social` | Nombre de empresa |
| `municipios` | Ciudad |

**Filtrá antes de cargar: solo los 188 registros con dominio corporativo
propio.** Excluí los 51 de Gmail/Hotmail.

> **Advertencia que no puedo suavizar.** Subir estos contactos a Meta es
> transferir datos personales a un tercero. La Ley 1581 de 2012 exige
> autorización del titular para el tratamiento, y los términos de Custom
> Audiences de Meta te obligan a declarar que tenés el derecho de usar esos
> datos. Un correo `gerencia@empresa.com.co` publicado en el directorio del
> gremio es terreno mucho más defendible que un Gmail personal, pero **no es
> terreno limpio**. La Ley 2300 de 2023 además regula el contacto con fines
> comerciales.
>
> Si querés eliminar el riesgo: saltá el Conjunto A, corré solo B y C, y usá el
> correo y el teléfono por fuera de Meta —que es donde de verdad vas a cerrar.
> Es tu decisión y va con el riesgo a la vista.

---

## 4. Anuncios

Tres ángulos, uno por cada cosa que **medimos** que le falta al mercado. Todos
llevan a una landing de Vértice, no a WhatsApp: querés que el gerente lea, no
que un curioso te escriba.

### Ángulo 1 — El dato (el más fuerte)
> **Las 22 inmobiliarias más grandes de Medellín publican un WhatsApp.
> Ninguna lo tiene automatizado.**
> Revisamos las 177 inmobiliarias del Valle de Aburrá una por una. Esto fue lo
> que encontramos.
>
> *CTA: Ver el estudio*

Creativo: la gráfica del embudo del informe. Es sobrio, es cierto, y regala algo
antes de pedir.

### Ángulo 2 — La prueba
> **$51.163 invertidos. 2.938 visitas. $17 por resultado.**
> Una campaña real de una inmobiliaria de Medellín, operada por nosotros.
>
> *CTA: Cómo lo hicimos*

Creativo: captura del administrador de anuncios. Decí siempre "por visita a la
landing", nunca "por cliente".

### Ángulo 3 — El hueco silencioso
> **Su cliente escribe el sábado a las 8 de la noche. ¿Quién le contesta?**
>
> *CTA: Ver a Sofi funcionando*

### Reglas de creativo
- Sin stock photos de gente dándose la mano
- El dato es el protagonista, no el logo
- Formato 1:1 y 4:5 (feed) + 9:16 (stories)
- Firmá **Vértice Studio**, nunca Diamond

---

## 5. Antes de encender

- [ ] Píxel de Meta instalado en la landing de Vértice con evento de conversión
- [ ] Verificación de empresa de Meta al día — **hoy está pendiente**
- [ ] Landing propia de Vértice publicada (hoy no existe; el informe HTML puede
      servir de contenido, pero necesita una página que capture)
- [ ] Custom Audience cargada y con tamaño suficiente para no ser rechazada
      (Meta pide un mínimo; con 188 registros puede quedar corta — si la rechaza,
      subí también los 51 personales o corré solo Lookalike)
- [ ] Límite de frecuencia configurado

---

## 6. Por qué esperaría, y qué gatillo usar

Tres razones concretas:

1. **El copy todavía no existe.** Los tres ángulos de arriba son mi mejor
   hipótesis, no evidencia. Después de 15 llamadas vas a saber qué frase hace
   que el gerente se enderece en la silla. Esa frase es el anuncio. Lanzar
   antes es pagar por adivinar.
2. **Diamond está dentro de la audiencia.** Vas a segmentar inmobiliarias del
   Valle de Aburrá; su equipo verá el anuncio. Aceptaste el conflicto de canal,
   pero el orden importa: es muy distinto que lo descubran después de que ya
   tenés dos clientes nuevos a que lo descubran antes de tener el primero.
3. **Si funciona antes de tiempo, no podés entregar.** Hasta que no montes el
   despliegue aislado, un segundo cliente entra a la instancia de Diamond.

**Gatillo para encenderla:** cuando tengas (a) 15 conversaciones hechas con las
objeciones registradas, (b) el despliegue aislado probado, y (c) una landing de
Vértice que capture. Con eso, la campaña deja de ser un gasto y pasa a ser
apalancamiento.
