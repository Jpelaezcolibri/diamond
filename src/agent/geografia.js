// Conocimiento geografico de Medellin y Antioquia, compartido por las dos
// Sofis: Sofi-Cliente (src/agent/prompts.js) lo usa para ubicar propiedades
// sin inventar cercanias, y Sofi-Comando (sofi-comando-prompts.js) para
// ayudar al asesor a validar sectores y distancias. Es un bloque de HECHOS:
// las reglas de como usarlo viven en cada prompt segun su interlocutor.
const GEOGRAFIA_MEDELLIN = `GEOGRAFIA DE MEDELLIN Y ANTIOQUIA (conoces la ciudad como buena paisa — usala para ubicar bien y NUNCA inventar cercanias):
- Medellin, El Poblado (comuna 14, oriente, estrato alto): Loma del Indio, Loma de los Balsos, Loma del Campestre, Los Naranjos, Castropol, Manila, Provenza, Astorga, Patio Bonito, El Tesoro, San Lucas, Las Lomas, Santa Maria de los Angeles, Ciudad del Rio, Poblado Lalinde. Subiendo la montana esta el corredor de la via Las Palmas (camino al aeropuerto). El Poblado limita al sur con Envigado por Las Vegas y Zuniga.
- Medellin, Laureles-Estadio (comuna 11, centro-occidente): Laureles, Simon Bolivar, San Joaquin, Bolivariana, Estadio, Conquistadores, La Castellana, Florida Nueva.
- Medellin, Belen (comuna 16, suroccidente): Belen, La Mota, La Palma, Rosales, Loma de los Bernal. La America y Calasanz (comuna 12, occidente). Guayabal (comuna 15, sur). Robledo (noroccidente).
- Medellin corregimientos rurales: Santa Elena (oriente, montana, clima frio, fincas), San Cristobal, San Antonio de Prado.
- Sur del Valle de Aburra (municipios al sur de Medellin, en orden): Envigado (Loma del Chocho, Loma del Esmeraldal, El Portal, La Mesa, Zuniga, Las Vegas), Sabaneta, Itagui, La Estrella, Caldas (el mas al sur). OJO: Envigado NO es El Poblado — son vecinos pero zonas distintas, y sus "lomas" (Loma del Chocho, del Esmeraldal) quedan lejos de las lomas de El Poblado (del Indio, de los Balsos).
- Oriente antioqueno (fuera del Valle de Aburra, clima templado/frio, fincas y parcelaciones): Rionegro y alrededores, Llano Grande, Las Antillas.
- Occidente antioqueno (clima calido, fincas de recreo, a 1 a 1.5h de Medellin): San Jeronimo, Sopetran, Santa Fe de Antioquia.
- Suroeste antioqueno: Urrao (mas lejos). Otro departamento: Manizales y Santagueda (Caldas, NO es Antioquia, clima calido).`;

module.exports = { GEOGRAFIA_MEDELLIN };
