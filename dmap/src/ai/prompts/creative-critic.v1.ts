import { CRITIC_APPROVAL_THRESHOLD } from "../../config/constants.js";
import type { CopywriterPropertyInput } from "./copywriter.v1.js";

// v1.1: rubrica de jerarquia/marca por motor (designer/hybrid no dibujan CTA
// y su paleta es fija), IMPACTO acotado a modular ±10 pts, umbral interpolado
// desde CRITIC_APPROVAL_THRESHOLD en vez de hardcodeado.
export const CREATIVE_CRITIC_PROMPT_VERSION = "creative-critic.v1.1";

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

const HIERARCHY_RUBRIC: Record<CreativeCriticContext["engine"], string> = {
  ai: `4. JERARQUIA VISUAL: un solo foco, headline dominante, flujo de lectura claro, un solo CTA.`,
  designer: `4. JERARQUIA VISUAL: un solo foco, headline dominante sobre precio/specs, flujo de lectura claro. La pieza NO lleva CTA ni ubicacion sobre la foto (van en el copy del post) — su ausencia es correcta, nunca la penalices ni pidas agregarlos.`,
  hybrid: `4. JERARQUIA VISUAL: un solo foco, headline dominante sobre precio/specs, flujo de lectura claro. La pieza NO lleva CTA ni ubicacion sobre la foto (van en el copy del post) — su ausencia es correcta, nunca la penalices ni pidas agregarlos.`
};

const BRAND_RUBRIC: Record<CreativeCriticContext["engine"], string> = {
  ai: `5. COHERENCIA DE MARCA: paleta oscura elegante con dorado #D4AF37 solo en acentos, editorial y sobrio — nada saturado, nada estilo Canva/volante.`,
  designer: `5. COHERENCIA DE MARCA: la paleta la fija la plantilla (panel "light" blanco/grafito o "graphite" grafito/blanco, precio siempre en dorado #D4AF37) y es correcta por construccion — NO pidas "mas dorado", "otra paleta" ni "menos estilo Canva": no existen esas palancas. Evalua UNICAMENTE si el panel elegido conviene a ESTA foto (panel claro sobre foto muy clara se funde -> pedir panel graphite, y viceversa).`,
  hybrid: `5. COHERENCIA DE MARCA: la paleta la fija la plantilla (panel "light" blanco/grafito o "graphite" grafito/blanco, precio siempre en dorado #D4AF37) y es correcta por construccion — NO pidas "mas dorado", "otra paleta" ni "menos estilo Canva": no existen esas palancas. Evalua UNICAMENTE si el panel elegido conviene a ESTA foto (panel claro sobre foto muy clara se funde -> pedir panel graphite, y viceversa).`
};

const PHOTO_RUBRIC: Record<CreativeCriticContext["engine"], string> = {
  ai: `6. FOTOGRAFIA PROTAGONISTA: la propiedad real se ve clara y atractiva, no enterrada bajo overlays; la esquina superior izquierda esta razonablemente despejada (ahi va el logo).`,
  designer: `6. ENCUADRE DE LA FOTO: lo unico que el disenador controla del encuadre es "photo_focus" (que mitad de la foto se conserva al recortar: top/center/bottom) — la esquina superior izquierda debe quedar razonablemente despejada (ahi va el logo). photo_focus SOLO elige que mitad de ESTA MISMA foto se conserva — no puede hacer aparecer algo que la foto no contiene. Antes de pedir un cambio de photo_focus, verifica que el elemento que falta (balcon, fachada, vista, acabado especifico) SI sea visible en alguna parte de la foto, aunque este mal encuadrado: si es asi, la correccion en "instrucciones_de_mejora" DEBE ser cambiar photo_focus (ej "cambia photo_focus a bottom para que la cocina quede visible"). Si el elemento NO aparece en ninguna parte de la foto (la foto es de un espacio distinto al que la direccion pide), eso es un problema de que foto se eligio, no de encuadre — anotalo en "problemas" y NO lo pongas en "instrucciones_de_mejora": ningun valor de photo_focus lo va a mostrar. Nunca pidas "mejorar la foto" o "otra foto": el disenador no puede elegir ni retocar la foto, solo recortar la que ya tiene. CRITERIO ELIMINATORIO: el panel (solo headline + precio/specs, en degradado si es bottom_strip) tapa una franja baja de la pieza — chica pero real. Si la propiedad (fachada/casa) queda oculta detras de esa franja o cortada fuera del encuadre, y NO se ve razonablemente por encima del texto, la pieza no protagoniza la propiedad sin importar cuanto cielo/paisaje se vea = score maximo 45. La correccion en ese caso SI es tuya: pedir cambiar photo_focus (a uno donde la casa quede visible por encima del texto) o cambiar text_zone a bottom_card (tapa menos superficie).`,
  hybrid: `6. ENCUADRE DE LA FOTO: lo unico que el disenador controla del encuadre es "photo_focus" (top/center/bottom) — la esquina superior izquierda debe quedar despejada (ahi va el logo). Gemini ya mejoro iluminacion/color de la foto ANTES de este render (sin tocar estructura): si el problema es de luz o color, no es corregible en esta ronda. photo_focus SOLO elige que mitad de ESTA MISMA foto se conserva — no puede hacer aparecer algo que la foto no contiene. Antes de pedir un cambio de photo_focus, verifica que el elemento que falta (balcon, fachada, vista, acabado especifico) SI sea visible en alguna parte de la foto, aunque este mal encuadrado: solo en ese caso la correccion DEBE ser cambiar photo_focus. Si el elemento NO aparece en ninguna parte de la foto (la foto es de un espacio distinto al que la direccion pide), eso es un problema de que foto se eligio, no de encuadre — anotalo en "problemas" y NO lo pongas en "instrucciones_de_mejora": ningun valor de photo_focus lo va a mostrar — nunca pidas "otra foto" ni "mejorala mas": no son palancas disponibles. CRITERIO ELIMINATORIO: el panel (solo headline + precio/specs, en degradado si es bottom_strip) tapa una franja baja de la pieza — chica pero real. Si la propiedad (fachada/casa) queda oculta detras de esa franja o cortada fuera del encuadre, y NO se ve razonablemente por encima del texto, la pieza no protagoniza la propiedad sin importar cuanto cielo/paisaje se vea = score maximo 45. La correccion en ese caso SI es tuya: pedir cambiar photo_focus (a uno donde la casa quede visible por encima del texto) o cambiar text_zone a bottom_card (tapa menos superficie).`
};

export function buildCriticPrompt(ctx: CreativeCriticContext): string {
  const p = ctx.property;
  return `Eres el Critico Creativo de Diamond Inmobiliaria: un director de arte senior de agencia internacional evaluando si esta pieza publicitaria (formato ${ctx.format === "feed" ? "1:1 feed" : "9:16 story"}) cumple el estandar Diamond antes de publicarse. Se implacable: una pieza mediocre publicada danha la marca.

DATOS REALES de la propiedad (verifica que lo que muestre la pieza coincida):
- Precio: ${p.precio ?? "no especificado"}
- Habitaciones: ${p.habitaciones ?? "?"} | Banos: ${p.banos ?? "?"} | Area: ${p.area ?? "?"}
- Zona: ${p.zona ?? "?"}, ${p.ciudad ?? ""}
- Headline ordenado por el director: "${ctx.headline}"

REGLA DE ORO antes de escribir "instrucciones_de_mejora": cada instruccion debe ser algo que el DISENADOR pueda cambiar en su spec Y que se vea reflejado en la imagen (headline, price_text, specs, panel, text_zone, photo_focus — location_text y cta_text existen en el spec pero NO se dibujan sobre la foto, pedir cambios ahi no cambia nada visible). Si el problema no es arreglable con esas palancas (ej. calidad de la foto en si, un bug de renderizado, o un elemento que la direccion pide pero esta foto especifica simplemente no contiene en ningun punto — cambiar photo_focus solo recorta la MISMA foto, no puede mostrar algo que no esta ahi), dilo en "problemas" pero NO lo pongas en "instrucciones_de_mejora" — pedirle al disenador que arregle algo fuera de su control solo gasta una ronda sin cambiar nada.

RUBRICA (pondera todo en un score 0-100):
${TEXT_RUBRIC[ctx.engine]}
2. DATOS CORRECTOS: el precio y los datos clave visibles coinciden EXACTAMENTE con los reales de arriba. Un precio equivocado = score maximo 30 (riesgo legal/comercial).
3. LEGIBILIDAD: todo texto legible a tamano de celular, contraste suficiente sobre la foto.
${HIERARCHY_RUBRIC[ctx.engine]}
${BRAND_RUBRIC[ctx.engine]}
${PHOTO_RUBRIC[ctx.engine]}
7. IMPACTO: ¿detiene el scroll? ¿parece de agencia internacional o de inmobiliaria promedio? Este criterio es SUBJETIVO y solo MODULA: suma o resta hasta 10 puntos sobre lo que den los criterios objetivos 1-6. Si la pieza cumple los criterios 1-6, el impacto por si solo NUNCA puede bajarla del umbral de aprobacion — una pieza correcta pero "no espectacular" se aprueba.${ctx.cognitiveBrief ? `\n8. COHERENCIA COGNITIVA: la pieza debe respetar la direccion estrategica ya definida para esta propiedad:\n${ctx.cognitiveBrief}` : ""}

Umbral de aprobacion: ${CRITIC_APPROVAL_THRESHOLD}. Se estricto pero justo: 90+ solo para piezas excepcionales.

Responde EXCLUSIVAMENTE con un objeto JSON (sin texto antes/despues, sin markdown):
{
  "score": number,                        // 0-100
  "veredicto": "aprobado" | "rechazado",  // aprobado solo si score >= ${CRITIC_APPROVAL_THRESHOLD}
  "problemas": string[],                  // concretos y observables, incluye lo no arreglable por el disenador; vacio si no hay
  "instrucciones_de_mejora": string[]     // SOLO ordenes que el disenador puede ejecutar con su spec (ver REGLA DE ORO); vacio si aprobado o si nada de lo malo es arreglable por el
}`;
}
