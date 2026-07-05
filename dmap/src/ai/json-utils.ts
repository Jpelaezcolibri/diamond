/**
 * Claude a veces envuelve el JSON pedido en fences ```json ... ``` o agrega
 * texto alrededor a pesar de la instruccion de responder solo JSON. Este
 * parser es defensivo: intenta el texto completo primero y, si falla,
 * extrae el primer bloque {...} balanceado.
 */
export function tryParseJSON(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // sigue abajo
  }

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // sigue abajo
    }
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      // sigue abajo
    }
  }

  throw new Error("No se pudo extraer JSON de la respuesta del modelo");
}
