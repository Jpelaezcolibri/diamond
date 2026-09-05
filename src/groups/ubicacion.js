// Como calza la UBICACION de una propiedad con lo que pidio el colega.
//
// Codigo puro, sin base ni red: depende solo de src/lib/zonas.js (tokens,
// vecindad, subzonas). Vivia dentro de match.js; se separo el 2026-09-05
// (auditoria del motor, H5/H6) por dos razones:
//
//   1. UNA SOLA DEFINICION DE "MISMA ZONA". El mensaje al colega
//      (redactar.js#desvios) comparaba zonas por su cuenta, con substring, y
//      contradecia al motor: "queda en San Joaquin, no en Laureles" sobre una
//      propiedad que el motor califico EXACTA. Ahora redactar.js importa esto.
//   2. match.js esta en un ciclo de require con vivo.js y los tests de
//      asistido lo reemplazan entero en require.cache (solo dejan `cruzar`).
//      Un modulo hoja no puede quedar a medio cargar ni ser pisado por un stub.
//
// match.js sigue re-exportando todo esto, asi que nadie mas se movio.
const zonas = require("../lib/zonas");

// La zona pedida se compara SOLO contra la zona de la propiedad. Mezclar la
// ciudad convertia "Loma del Chocho" en "todo Envigado": ese cruce cruzado
// explica 656 de los ~731 falsos positivos medidos el 2026-07-29.
//
// BUG real (2026-07-29, caso Patricia): la comparacion era por SUBSTRING sobre
// el string entero de la propiedad — "laureles".includes("laurel") da true.
// "Laurel" y "Bulevar Alcazar" son unidades de SABANETA, no el barrio
// Laureles, y ese substring le ofrecia a la asesora 6 apartamentos del barrio
// equivocado para un cliente de otro municipio. La comparacion ahora es por
// TOKEN EXACTO: se tokeniza tambien la zona de la propiedad (mismo criterio
// que la del pedido) y se exige que un token completo aparezca en el otro
// conjunto — "laurel" ya no cae dentro de "laureles" porque son tokens
// distintos, pero "bernal" sigue matcheando "Loma de los Bernal" porque ahi
// SI es un token propio.
// Un pedido puede nombrar VARIAS zonas ("POBLADO/ENVIGADO" es como se pide de
// verdad). El clasificador devuelve `zonas` como lista; `zona` se conserva por
// compatibilidad con lo ya guardado y con el export.
function zonasPedidas(c) {
  const lista = Array.isArray(c.zonas) && c.zonas.length ? c.zonas : [c.zona];
  return lista.map((z) => String(z || "").trim()).filter(Boolean);
}

function zonaCoincide(p, c) {
  // CUANDO LA "ZONA" ES UN MUNICIPIO (caso Esteban Higuita, 2026-09-05).
  //
  // En el Valle de Aburra el colega nombra municipios —Sabaneta, Envigado,
  // Itagui, La Estrella— como si fueran barrios, y Wasi los guarda en `ciudad`
  // dejando `zona` vacia. Con la zona vacia esta funcion daba false, zonaVecina
  // tambien, y ubicacionCoincide terminaba descartando la propiedad ENTERA en
  // su `if (!ciudadCoincide) return null` — antes de que nadie mirara area,
  // precio ni alcobas.
  //
  // El caso: Esteban pidio "Envigado y Sabaneta"; la ref 9776631 (Apartamento
  // en Sabaneta, 77 m2, 3 alcobas, 2 baños, $470M, disponible) tiene `zona`
  // vacia y `ciudad = Sabaneta`. Nunca salio. Con la zona cargada puntua 95.
  // Medido ese dia: 17 de 122 propiedades sin zona, 3 invisibles para el
  // municipio que las contiene.
  //
  // ANGOSTO A PROPOSITO: la ciudad se mira SOLO si `zona` esta vacia. Si
  // valiera siempre, quien pide "El Poblado" empezaria a recibir cualquier
  // cosa de Medellin — que es el bug de zona mal comparada que costo 656
  // falsos positivos en julio.
  const zonaCruda = String(p.zona || "").trim();
  const ubicacion = zonaCruda || String(p.ciudad || "").trim();
  const tokensPropiedadArr = zonas.zonaTokens(ubicacion);
  const tokensPropiedad = new Set(tokensPropiedadArr);
  for (const z of zonasPedidas(c)) {
    const tokensPedido = zonas.distinctiveTokens(zonas.zonaTokens(z));
    if (tokensPedido.length && tokensPedido.some((t) => tokensPropiedad.has(t))) return true;
    // Sub-zona conocida ("San Joaquin" pedido "Laureles"): es tan exacta como
    // el token literal, no una vecina. Ver la nota en src/lib/zonas.js.
    if (tokensPedido.length && zonas.subzonaCoincide(tokensPedido, tokensPropiedadArr)) return true;
  }
  return false;
}

// Zona distinta pero contigua: quien pide El Poblado compra en Envigado. Ver
// VECINDAD en src/lib/zonas.js — es geografia declarada, no laxitud.
// Zonas que el pedido EXCLUYE explicitamente ("No Loma del Indio").
function zonasExcluidas(c) {
  return (Array.isArray(c.zonas_excluidas) ? c.zonas_excluidas : []).map((z) => String(z || "").trim()).filter(Boolean);
}

// BUG real (Juan, 2026-08-20): "❌No Loma del Indio" en un pedido no se
// guardaba en ningun lado — el motor podia ofrecer justo lo que el cliente
// rechazo (no paso esta vez de pura suerte de puntaje, pero era cuestion de
// tiempo). Mismo criterio de token exacto que zonaCoincide/zonaVecina, y
// veta ANTES que cualquier otra cosa: una zona excluida no se ofrece ni como
// "otra_zona" marcada para que alguien la revise.
function zonaExcluida(p, c) {
  const excluidas = zonasExcluidas(c);
  if (!excluidas.length) return false;
  const tokensPropiedad = new Set(zonas.zonaTokens(p.zona || ""));
  return excluidas.some((z) => {
    const tokensExcluida = zonas.distinctiveTokens(zonas.zonaTokens(z));
    return tokensExcluida.length && tokensExcluida.some((t) => tokensPropiedad.has(t));
  });
}

function zonaVecina(p, c) {
  const tokensPropiedad = zonas.zonaTokens(p.zona || "");
  if (!tokensPropiedad.length) return false;
  for (const z of zonasPedidas(c)) {
    const tokensPedido = zonas.distinctiveTokens(zonas.zonaTokens(z));
    if (zonas.sonVecinas(tokensPedido, tokensPropiedad)) return true;
  }
  return false;
}

// Pero un pedido puede ser legitimamente de municipio ("busco casa en
// Envigado") y ese negocio es real. Se acepta, contra la CIUDAD de la
// propiedad y no contra su barrio, y vale menos puntaje: un match de municipio
// es mas debil que uno de barrio, y la pantalla tiene que poder decirlo.
// Mismo fix de token exacto que zonaCoincide, y por el mismo motivo.
function ciudadCoincide(p, c) {
  const tokensPedido = zonas.distinctiveTokens(zonas.zonaTokens(c.ciudad || ""));
  if (tokensPedido.length === 0) return false;
  const tokensCiudad = new Set(zonas.zonaTokens(p.ciudad || ""));
  return tokensPedido.some((t) => tokensCiudad.has(t));
}

// Devuelve como calza la ubicacion, o null si no calza.
// LA UBICACION YA NO ES UNA COMPUERTA BINARIA, ES UN GRADO (2026-08-18).
//
// Antes: si el pedido nombraba un barrio y la propiedad no estaba ahi, se
// descartaba. Eso perdia negocio real — quien pide El Poblado compra en
// Envigado, son contiguos y el mismo cliente se mueve entre los dos.
//
// Ahora se devuelve el grado y cada match lo lleva encima, para que Sofi pueda
// razonar sobre el ("¿le sirve Envigado a este cliente en particular?"). El
// castigo de puntaje refleja la distancia.
//
// LO QUE NO SE TOCA, porque fue lo que causo 656 de 731 falsos positivos: la
// comparacion por token exacto (nunca substring) y el fallback a la ciudad
// entera, que sigue siendo el ultimo grado y el mas castigado.
//
// Y una separacion que importa: este grado alimenta el AVISO a la asesora, que
// pasa por el juicio de Sofi y de una persona. Para PUBLICAR en el grupo,
// src/groups/publicable.js sigue exigiendo zona exacta o vecina — ahi no hay
// nadie revisando y el error se ve delante de 80 competidores.
// Pesos recalibrados (Juan, 2026-08-19): con datos reales del radar en vivo,
// una zona EXACTA sin mas dato que el precio quedaba en 65 (55 base + 10 de
// precio) y una VECINA bien especificada rara vez pasaba de 67 — los dos por
// debajo del umbral de publicacion (70), asi que un match geograficamente
// correcto solo pasaba si ademas calzaban dos o tres exigencias incidentales
// (alcobas, area, banos...) que muchos pedidos ni mencionan. El sintoma en
// produccion: el radar callaba casi todo, no solo lo que de verdad no servia.
//
// La correccion mueve peso HACIA la ubicacion —que es el dato que mas importa
// para decidir si algo "sirve"— y LEJOS de otra_zona, para que ningun combo de
// exigencias incidentales pueda compensar estar en el barrio equivocado (el
// techo teorico de otra_zona con TODO lo demas a favor queda en 65, todavia
// bajo el umbral). zonaCoincide/zonaVecina — la comparacion por token exacto
// que evito los 656 falsos positivos de julio — no se toca: esto solo cambia
// cuanto vale cada grado, no como se calcula.
function ubicacionCoincide(p, c) {
  // Veto absoluto: una zona que el cliente rechazo explicitamente no se
  // ofrece bajo ningun grado, ni siquiera "otra_zona" marcada para revisar.
  if (zonaExcluida(p, c)) return null;

  const pide = zonasPedidas(c).length > 0;

  // La ubicacion que se MUESTRA: la zona si la hay, y si no la ciudad (que en
  // ese caso es lo que hizo coincidir — ver la nota en zonaCoincide). Sin
  // esto la asesora leia "Zona: " a secas, un dato vacio donde va el motivo.
  const donde = String(p.zona || "").trim() || String(p.ciudad || "").trim();

  if (pide && zonaCoincide(p, c)) return { razon: `Zona: ${donde}`, puntos: 20, grado: "exacta" };
  if (pide && zonaVecina(p, c)) {
    return { razon: `${donde} (vecina de lo pedido)`, puntos: -5, grado: "vecina" };
  }
  if (pide) {
    // Zona distinta y no contigua. Entra, pero muy castigada y marcada: solo
    // llega a la asesora si TODO lo demas calza y Sofi lo aprueba.
    if (!ciudadCoincide(p, c)) return null;
    return { razon: `${donde} (fuera de la zona pedida)`, puntos: -35, grado: "otra_zona" };
  }
  if (ciudadCoincide(p, c)) {
    return { razon: `Ciudad: ${p.ciudad} (sin barrio en el pedido)`, puntos: -15, grado: "ciudad" };
  }
  return null;
}

module.exports = { zonasPedidas, zonaCoincide, zonasExcluidas, zonaExcluida, zonaVecina, ciudadCoincide, ubicacionCoincide };
