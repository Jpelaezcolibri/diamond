// Que dice el colega de lo automatico (Juan, 2026-10-21). Lo usan
// sofi-linea.js y puente-sofi.js: ninguno de los dos le contesta a quien
// rechaza el bot o pide una persona, ni a la respuesta automatica de otra
// inmobiliaria.

// PIDE UNA PERSONA. Casos: Propiedades Carva ("no entiendo esta maquina la
// verdad, si de pronto un asesor se comunica"), Alberto Posada ("Enviame los
// link sin explicacion automaticas" y, un mes antes, "Su sistema de IA esta
// fallando"), Lina Posada ("Me gusta comunicarme con un asesor, no con
// asistente virtual").
const RECHAZA_BOT = /\b(m[aá]quina|robot|bot|contestadora?|autom[aá]tic[oa]s?)\b/i;
// "IA" solo en mayuscula y con su contexto: "ia" suelta es un pedazo de palabra.
const RECHAZA_IA = /\b(sistema|bot|robot|respuesta)s? de IA\b|\binteligencia artificial\b|\basistente virtual\b/;
const QUIEN = /\b(asesor[a]?|una persona|un humano|ser humano|alguien)\b/i;
const QUE_HAGA = /\b(comuni\w*|llam\w*|habl\w*|escrib\w*|atiend\w*|contact\w*)\b/i;
const LLAMAME = /\bll[aá]m(ame|enme|arme|eme)\b/i;
// "Te habla Victoria Rios asesora inmobiliaria": se presenta, no pide una.
const SE_PRESENTA = /\b(soy|te habla|le habla|les habla|mi nombre es)\b/i;

// RESPUESTA AUTOMATICA de otra inmobiliaria (Fenix, Colpropiedades, la misma
// Propiedades Carva): 20 de 594 mensajes reales de colegas en la linea. Si se
// le contesta, quedan dos bots en loop.
const AUTORESPUESTA = /gracias por (contactar|contactarnos|comunicarte|comunicarse|escribir|escribirnos|tu mensaje|su mensaje)|horario de atenci[oó]n|mensaje autom[aá]tico|respuesta autom[aá]tica|en breve (te|le) (atender|responder|contactar)|(pasado|conectado|enviado|remitido) (este|tu|su) mensaje (a|con) nuestro equipo|accedas a nuestro cat[aá]logo|nuestro cat[aá]logo aqu[ií] en whatsapp|se pondr[aá] en contacto|lunes a viernes \d/i;

function esAutorespuesta(texto) {
  return AUTORESPUESTA.test(String(texto || ""));
}

function pidePersona(texto) {
  const t = String(texto || "");
  return RECHAZA_BOT.test(t) || RECHAZA_IA.test(t) || LLAMAME.test(t) || (QUIEN.test(t) && QUE_HAGA.test(t) && !SE_PRESENTA.test(t));
}

module.exports = { pidePersona, esAutorespuesta };
