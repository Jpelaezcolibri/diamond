// Los interruptores del DM al colega, FIJOS en cada test (revision del DM
// amplio, 2026-10-26, I4). Antes los tests de "apagado" asumian que las
// variables no estaban en el entorno: con RADAR_DM_DUDOSAS=true o
// RADAR_DM_ZONA_CERCANA=true en Railway, `railway run ... npm test` daba rojo.
//
// Cada test arranca con los tres apagados ("false") y al terminar se restaura
// el valor que traia el proceso. El test que necesita uno encendido lo pone
// el mismo (conEnv / conAclaracion) y lo restaura.
const { beforeEach, afterEach } = require("node:test");

const INTERRUPTORES_DM = ["RADAR_DM_CON_ACLARACION", "RADAR_DM_ZONA_CERCANA", "RADAR_DM_DUDOSAS"];

function apagadosEnCadaTest() {
  let previos = null;
  beforeEach(() => {
    previos = Object.fromEntries(INTERRUPTORES_DM.map((k) => [k, process.env[k]]));
    for (const k of INTERRUPTORES_DM) process.env[k] = "false";
  });
  afterEach(() => {
    for (const k of INTERRUPTORES_DM) {
      if (previos[k] === undefined) delete process.env[k];
      else process.env[k] = previos[k];
    }
  });
}

module.exports = { INTERRUPTORES_DM, apagadosEnCadaTest };
