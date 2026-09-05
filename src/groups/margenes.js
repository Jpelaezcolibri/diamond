// Margenes de captura del motor de match, en un modulo sin dependencias.
//
// Viven aparte de match.js porque los lee tambien el prompt de Sofi
// (src/groups/revalidar.js) para decirle con numeros hasta donde acepta el
// motor, y match.js esta en un ciclo de require con vivo.js: cargarlo desde
// revalidar.js en el orden equivocado dejaba los margenes en NaN sin ruido
// (auditoria 2026-09-05, H2). Un modulo hoja no puede quedar a medio cargar.
//
// MARGEN DE CAPTURA (Juan, 2026-08-20): el techo de precio y el piso de area
// eran compuertas duras — un apartamento de $720M para un presupuesto de
// $700M (2.9% arriba) se descartaba de plano, aunque para el cliente esos
// $20M casi seguro sean negociables. El pedido explicito fue "capturar la
// mayor cantidad de ofertas posible" dandole margen al bot en las variables
// que NO son criticas para el cliente (precio, metros). El margen relaja la
// compuerta, no la borra: mas alla de el, se sigue rechazando igual que
// antes. Configurable sin redesplegar.
const MARGEN_PRECIO = Number(process.env.GRUPOS_MARGEN_PRECIO || 0.10);
const MARGEN_AREA = Number(process.env.GRUPOS_MARGEN_AREA || 0.10);

module.exports = { MARGEN_PRECIO, MARGEN_AREA };
