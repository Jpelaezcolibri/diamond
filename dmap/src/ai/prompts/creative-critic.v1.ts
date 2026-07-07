import type { CopywriterPropertyInput } from "./copywriter.v1.js";

export const CREATIVE_CRITIC_PROMPT_VERSION = "creative-critic.v1";

export interface CreativeCriticContext {
  property: CopywriterPropertyInput;
  /** Headline que el director ordeno renderizar — el critico verifica que aparezca legible y sin deformaciones. */
  headline: string;
  format: "feed" | "story";
  /** Brief compacto del Diamond Cognitive Engine — agrega el criterio de coherencia cognitiva. undefined = rubrica legacy. */
  cognitiveBrief?: string;
  /**
   * "ai" = GPT Image dibuja pixeles Y texto (puede deformar letras/tildes).
   * "designer"/"hybrid" = el texto lo dibuja satori de forma deterministica
   * (nunca se deforma) y el encuadre de foto lo controla el spec
   * (photo_focus) — el critico debe evaluar SOLO lo que ese motor controla,
   * o las instrucciones_de_mejora piden algo que ninguna ronda puede arreglar.
   */
  engine: "ai" | "designer" | "hybrid";
}

/**
 * Agente 3 — Critico Creativo: evalua la pieza generada ANTES de aprobarla,
 * como el director de una agencia revisando el trabajo del equipo. Es la
 * defensa contra los modos de fallo tipicos de imagen generativa: texto
 * deformado (especialmente tildes/enie en espanol), datos que no coinciden
 * con la propiedad real, y piezas que se ven "hechas por IA" o de plantilla.
 */
const TEXT_RUBRIC: Record<CreativeCriticContext["engine"], string> = {
  ai: `1. TEXTO SIN DEFORMACIONES (criterio eliminatorio — revisa LETRA POR LETRA): palabras mal escritas, caracteres inventados, tildes/enie corruptas, numeros ilegibles o cambiados (GPT Image dibuja el texto como pixeles, puede deformarlo). Cualquier texto deformado visible = score maximo 40.`,
  designer: `1. LEGIBILIDAD DEL TEXTO: el texto lo dibuja una plantilla determinista (nunca se deforma ni inventa letras) — NO revises ortografia ni tildes, eso es imposible que falle aqui. Evalua solo tamano, contraste sobre su fondo y que no se corte o se superponga.`,
  hybrid: `1. LEGIBILIDAD DEL TEXTO: el texto lo dibuja una plantilla determinista (nunca se deforma ni inventa letras) — NO revises ortografia ni tildes, eso es imposible que falle aqui. Evalua solo tamano, contraste sobre su fondo y que no se corte o se superponga.`
};

const PHOTO_RUBRIC: Record<CreativeCriticContext["engine"], string> = {
  ai: `6. FOTOGRAFIA PROTAGONISTA: la propiedad real se ve clara y atractiva, no enterrada bajo overlays; la esquina superior izquierda esta razonablemente despejada (ahi va el logo).`,
  designer: `6. ENCUADRE DE LA FOTO: lo unico que el disenador controla del encuadre es "photo_focus" (que mitad de la foto se conserva al recortar: top/center/bottom) — la esquina superior izquierda debe quedar razonablemente despejada (ahi va el logo). Si el encuadre relega lo que vende la propiedad (cocina, cama, acabados) a una esquina, la correccion en "instrucciones_de_mejora" DEBE ser cambiar photo_focus (ej "cambia photo_focus a bottom para que la cocina quede visible") — nunca pidas "mejorar la foto" o "otra foto": el disenador no puede elegir ni retocar la foto, solo recortarla.`,
  hybrid: `6. ENCUADRE DE LA FOTO: lo unico que el disenador controla del encuadre es "photo_focus" (top/center/bottom) — la esquina superior izquierda debe quedar despejada (ahi va el logo). Gemini ya mejoro iluminacion/color de la foto ANTES de este render (sin tocar estructura): si el problema es de luz o color, no es corregible en esta ronda. Si el problema es de encuadre, la correccion DEBE ser cambiar photo_focus — nunca pidas "otra foto" ni "mejorala mas": no son palancas disponibles.`
};

export function buildCriticPrompt(ctx: CreativeCriticContext): string {
  const p = ctx.property;
  return `Eres el Critico Creativo de Diamond Inmobiliaria: un director de arte senior de agencia internacional evaluando si esta pieza publicitaria (formato ${ctx.format === "feed" ? "1:1 feed" : "9:16 story"}) cumple el estandar Diamond antes de publicarse. Se implacable: una pieza mediocre publicada danha la marca.

DATOS REALES de la propiedad (verifica que lo que muestre la pieza coincida):
- Precio: ${p.precio ?? "no especificado"}
- Habitaciones: ${p.habitaciones ?? "?"} | Banos: ${p.banos ?? "?"} | Area: ${p.area ?? "?"}
- Zona: ${p.zona ?? "?"}, ${p.ciudad ?? ""}
- Headline ordenado por el director: "${ctx.headline}"

REGLA DE ORO antes de escribir "instrucciones_de_mejora": cada instruccion debe ser algo que el DISENADOR pueda cambiar en su spec (headline, price_text, specs, location_text, cta_text, panel, text_zone, photo_focus). Si el problema no es arreglable con esas palancas (ej. calidad de la foto en si, un bug de renderizado), dilo en "problemas" pero NO lo pongas en "instrucciones_de_mejora" — pedirle al disenador que arregle algo fuera de su control solo gasta una ronda sin cambiar nada.

RUBRICA (pondera todo en un score 0-100):
${TEXT_RUBRIC[ctx.engine]}
2. DATOS CORRECTOS: el precio y los datos clave visibles coinciden EXACTAMENTE con los reales de arriba. Un precio equivocado = score maximo 30 (riesgo legal/comercial).
3. LEGIBILIDAD: todo texto legible a tamano de celular, contraste suficiente sobre la foto.
4. JERARQUIA VISUAL: un solo foco, headline dominante, flujo de lectura claro, un solo CTA.
5. COHERENCIA DE MARCA: paleta oscura elegante con dorado #D4AF37 solo en acentos, editorial y sobrio — nada saturado, nada estilo Canva/volante.
${PHOTO_RUBRIC[ctx.engine]}
7. IMPACTO: ¿detiene el scroll? ¿parece de agencia internacional o de inmobiliaria promedio?${ctx.cognitiveBrief ? `\n8. COHERENCIA COGNITIVA: la pieza debe respetar la direccion estrategica ya definida para esta propiedad:\n${ctx.cognitiveBrief}` : ""}

Umbral de aprobacion: 75. Se estricto pero justo: 90+ solo para piezas excepcionales.

Responde EXCLUSIVAMENTE con un objeto JSON (sin texto antes/despues, sin markdown):
{
  "score": number,                        // 0-100
  "veredicto": "aprobado" | "rechazado",  // aprobado solo si score >= 75
  "problemas": string[],                  // concretos y observables, incluye lo no arreglable por el disenador; vacio si no hay
  "instrucciones_de_mejora": string[]     // SOLO ordenes que el disenador puede ejecutar con su spec (ver REGLA DE ORO); vacio si aprobado o si nada de lo malo es arreglable por el
}`;
}
