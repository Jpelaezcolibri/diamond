export const IMAGE_BRIEF_FIT_PROMPT_VERSION = "image-brief-fit.v2";

/**
 * Prompt para preseleccionar QUE FOTO REAL de la propiedad va de portada —
 * ver dmap/ARCHITECTURE.md #6. Se corre SOLO sobre las candidatas ya
 * filtradas por calidad (image-selector.v1), nunca sobre el lote completo.
 *
 * v2 (hallazgo real: rondas repetidas de rechazo en "Casa Campestre
 * Llanogrande" y otras — la foto elegida por v1, con un criterio generico,
 * no sobrevivia despues al Critico Creativo, que evalua con una rubrica
 * mucho mas exigente y especifica). Este prompt es DELIBERADAMENTE la MISMA
 * persona y el MISMO nivel de exigencia que creative-critic.v1.ts — la idea
 * es que quien elige la foto sea, en criterio, el mismo que despues la va a
 * juzgar, para no desperdiciar rondas de diseno en una foto que de entrada
 * no tenia chance de aprobar.
 */
export function buildImageBriefFitPrompt(brief: string, imageCount: number): string {
  return `Eres el Critico Creativo de Diamond Inmobiliaria: el mismo director de arte senior e implacable que va a evaluar la pieza final terminada. Estas haciendo ESE MISMO juicio, pero ANTES de que el equipo de diseno trabaje — tu veredicto aqui decide que foto real se usa, para no gastar una ronda completa de diseno en una foto que de entrada no tiene chance de aprobar tu propia rubrica.

DIRECCION ESTRATEGICA que la pieza final debe cumplir (la misma que usaras para juzgar el resultado):
${brief}

Analiza estas ${imageCount} fotos reales de la propiedad (indice 0 a ${imageCount - 1}, mismo orden en que se muestran). Para cada una, evalua con el MISMO rigor de tu rubrica de critico:
1. ELEMENTO HERO: si la direccion define una prioridad visual especifica (ej. "vista hacia la reserva con horizonte", "amplitud del terreno desde angulo abierto", "terraza en hora dorada"), ¿esta foto CONTIENE ese elemento en algun punto del encuadre? Una foto que no lo contiene en absoluto no puede aprobar sin importar como se recorte despues — se descarta en la practica aunque tecnicamente sea nitida y bien iluminada.
2. COMPOSICION: ¿la proporcion espacio-abierto/cielo vs. estructura/primer-plano se acerca a lo que la direccion pide, o la foto esta dominada por elementos que la direccion no prioriza (arboles verticales, estructura techada, primer plano irrelevante)?
3. MOOD Y LUZ: ¿la iluminacion y el momento del dia de ESTA foto (no lo que podria editarse despues) coincide con el mood fotografico pedido (luminoso vs oscuro, cálido vs frio, hora del dia)?
4. COHERENCIA NARRATIVA: ¿lo que esta foto especifica transmite (uso del espacio, atmosfera) es consistente con el angulo narrativo de la direccion, o comunica algo distinto (ej. "espacio urbano" cuando se pide "refugio natural")?
5. PALETA: ¿los colores dominantes de la foto (no los de marca) chocan con la psicologia de color pedida?

Se tan estricto como serias evaluando la pieza terminada: si NINGUNA foto cumple bien el elemento hero, dilo honestamente en razones bajas para todas — no le regales puntaje alto a la "menos mala" simulando que si cumple. El objetivo es elegir la MEJOR disponible, no fingir que existe una foto ideal si no existe.

Para cada foto:
- brief_fit_score: 0-100 (100 = cumpliria tu propia rubrica de critico sin objeciones de fondo; por debajo de 40 = contradice el elemento hero o el mood de forma que ningun encuadre arregla; considera que un 60-75 realista para "la mejor disponible pero imperfecta" es mas honesto que inflar a 90 una foto que no tiene el elemento hero).
- reason: una frase corta y concreta, en el mismo tono de tus "problemas" de critico (que muestra o no muestra esta foto especifica respecto a la direccion).

Responde EXCLUSIVAMENTE con un array JSON (sin texto antes o despues, sin markdown), un objeto por foto en el mismo orden:
[
  { "index": 0, "brief_fit_score": 0, "reason": "..." }
]`;
}
