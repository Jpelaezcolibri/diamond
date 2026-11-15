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

// Por NOMBRE (2026-11-14, caso Claudia Valencia Chica): llega solo con lid,
// el directorio no la resuelve y no responde a un pedido, así que ningún
// teléfono la delata. Se reconoce si su nombre de WhatsApp trae TODAS las
// palabras del nombre de una asesora (al menos nombre y apellido): "Claudia
// Valencia" calza con "Claudia Valencia Chica"; un "Claudia" suelto, no.
const normalizar = (t) =>
  String(t || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9ñ ]+/g, " ").split(/\s+/).filter(Boolean);

function nombreCoincide(remitente, nombreAsesor) {
  const de = new Set(normalizar(remitente));
  const del = normalizar(nombreAsesor).filter((p) => p.length >= 3);
  return del.length >= 2 && del.every((p) => de.has(p));
}

async function esDelEquipo(org, { telefono = null, lid = null, señal = null, nombre = null } = {}) {
  try {
    const candidatos = [telefono];
    if (lid) candidatos.push(await directorio.telefonoDe(org.id, lid).catch(() => null));
    if (señal && señal.autor_telefono) candidatos.push(señal.autor_telefono);
    for (const t of candidatos.filter(Boolean)) {
      const a = await advisors.findByPhone(org.id, t).catch(() => null);
      if (a) return a;
    }
    if (nombre) {
      const lista = await advisors.listAll(org.id).catch(() => []);
      const a = lista.find((x) => nombreCoincide(nombre, x.name));
      if (a) return a;
    }
    return null;
  } catch (e) {
    console.warn("[equipo-linea] no se pudo verificar, sigue como colega:", e.message);
    return null;
  }
}

module.exports = { esDelEquipo, nombreCoincide };
