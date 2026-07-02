// Criterios de "interes genuino". Un lead califica por dos caminos:
// 1. Clasico: conocemos presupuesto, urgencia y al menos una preferencia (zona o tipo).
// 2. Cierre directo: mostro interes confirmado en una propiedad especifica
//    (property_ref_origen) y ya sabemos su forma de pago — la propiedad misma
//    define presupuesto y zona, asi que no hace falta preguntarlos.

const WEIGHTS = {
  nombre: 10,
  presupuesto: 30,
  zona_interes: 20,
  tipo_interes: 15,
  urgencia: 25,
  forma_pago: 30,
  property_ref_origen: 25,
};

// Piso de score para leads calificados: un lead que ya califica es prioridad
// para el asesor aunque no tengamos todos los campos.
const QUALIFIED_FLOOR = 70;

function computeScore(lead) {
  const score = Object.entries(WEIGHTS).reduce(
    (sum, [field, weight]) => sum + (lead[field] ? weight : 0),
    0
  );
  const capped = Math.min(100, score);
  return isQualified(lead) ? Math.max(QUALIFIED_FLOOR, capped) : capped;
}

function isQualified(lead) {
  const clasico = Boolean(lead.presupuesto && lead.urgencia && (lead.zona_interes || lead.tipo_interes));
  const cierreDirecto = Boolean(lead.property_ref_origen && lead.forma_pago);
  return clasico || cierreDirecto;
}

module.exports = { computeScore, isQualified, WEIGHTS };
