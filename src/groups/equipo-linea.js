// Mensajes del EQUIPO en la linea del radar (2026-10-27).
//
// EL CASO: Catherine publico un pedido en un grupo como cualquier colega, el
// radar le mando el DM por la linea de Daiana y ella le contesto ahi a Daiana:
// "listo confirmada cita en Luna del Campo en Robledo". dm.js lo trato como un
// colega: lo guardo en linea_dm, el clasificador lo marco "cita_confirmada" y
// visita-linea dejo una cita a nombre de "cathe Uribe relator" con la ref de
// otra propiedad. Lo que una asesora de la casa le escribe a otra es
// coordinacion interna: no es un colega, no se cuenta como avance ni como cita.
//
// Quien es del equipo: un telefono que esta en `advisors` (activo o no: una
// asesora dada de baja tampoco es un colega). El remitente casi siempre llega
// solo con lid, asi que se prueban tres telefonos: el del mensaje, el que
// resuelve el directorio de lids y el autor del pedido al que responde.
// FALLA ABIERTA: si algo no responde, el mensaje sigue como de un colega.
const advisors = require("../data/advisors");
const directorio = require("./directorio");

async function esDelEquipo(org, { telefono = null, lid = null, señal = null } = {}) {
  try {
    const candidatos = [telefono];
    if (lid) candidatos.push(await directorio.telefonoDe(org.id, lid).catch(() => null));
    if (señal && señal.autor_telefono) candidatos.push(señal.autor_telefono);
    for (const t of candidatos.filter(Boolean)) {
      const a = await advisors.findByPhone(org.id, t).catch(() => null);
      if (a) return a;
    }
    return null;
  } catch (e) {
    console.warn("[equipo-linea] no se pudo verificar, sigue como colega:", e.message);
    return null;
  }
}

module.exports = { esDelEquipo };
