// ⚠️ REGLA DE SEGURIDAD DE ESTE ARCHIVO — leer antes de tocar una línea:
//
//   indexedDB.open(nombre, VERSION) con una version mayor a la actual dispara
//   onupgradeneeded y PUEDE CORROMPER la base local de WhatsApp Web. Y
//   indexedDB.open(nombreQueNoExiste) CREA una base nueva.
//
//   Por eso, sin excepciones:
//     · se abre SIEMPRE sin segundo argumento;
//     · solo se abren nombres que devolvio indexedDB.databases();
//     · todas las transacciones son "readonly".
//
//   El dano de una corrupcion no es un baneo —es un re-link por QR— pero es
//   evitable y seria una anecdota horrible en un proyecto que existe porque ya
//   nos costo una cuenta.
//
// QUE ES ESTO: una herramienta de investigacion de un solo uso. Responde si la
// extension del Radar podra leer TODOS los grupos de la lista blanca o solo el
// que el asesor tenga abierto. Sin esa respuesta, el alcance del producto es
// una suposicion.
//
// LO QUE NO HACE: no captura, no guarda, no envia nada a ningun lado. No tiene
// permisos de red y el manifest no declara host_permissions. Toda su salida va
// a la consola del navegador de quien lo corre.

const MARCA = "[radar-spike]";

// Nombres de store que suenan a mensajes o a chats. Groseros a proposito: es
// mas barato mirar un store de mas que perderse el que importa.
const PISTAS_MENSAJE = ["message", "msg", "mensaje"];
const PISTAS_CHAT = ["chat", "conversation", "conv"];

// Cuantos registros se miran por store. No hace falta mas: la pregunta es
// cualitativa (¿se lee?), no estadistica.
const MUESTRA = 200;

// ── Utilidades ───────────────────────────────────────────────────────────

// El texto de terceros NUNCA se imprime crudo ni se pega en un archivo del
// repo. Se reemplaza por un hash corto, que alcanza para comparar dos
// registros sin exponer a nadie.
async function huella(texto) {
  const bytes = new TextEncoder().encode(String(texto));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].slice(0, 4).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function promesa(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    // Si esto se dispara, algo esta muy mal: significa que la base no existia
    // y la acabamos de crear. Se aborta para no dejarla a medio hacer.
    if ("onupgradeneeded" in request) {
      request.onupgradeneeded = (e) => {
        console.error(`${MARCA} ABORTADO: onupgradeneeded inesperado. No se toca nada.`);
        e.target.transaction?.abort();
        reject(new Error("onupgradeneeded inesperado"));
      };
    }
  });
}

function abrirSoloLectura(nombre) {
  // Sin segundo argumento. Ver la regla del encabezado.
  return promesa(indexedDB.open(nombre));
}

async function leerMuestra(db, store) {
  const tx = db.transaction(store, "readonly");
  const os = tx.objectStore(store);
  try {
    return await promesa(os.getAll(undefined, MUESTRA));
  } catch {
    return [];
  }
}

// ── Analisis de forma ────────────────────────────────────────────────────

// ¿Este valor parece texto legible o parece cifrado/binario?
function pinta(valor) {
  if (valor == null) return "vacio";
  if (valor instanceof ArrayBuffer || ArrayBuffer.isView(valor)) return "binario";
  if (typeof valor === "number") return "numero";
  if (typeof valor === "boolean") return "booleano";
  if (typeof valor === "object") return "objeto";
  if (typeof valor !== "string") return typeof valor;
  if (valor.length === 0) return "vacio";
  // Heuristica de "esto parece cifrado". No pretende ser exacta: solo separa
  // texto legible de un blob.
  //
  // El rango va SIEMPRE como escapes y nunca como caracteres literales: un
  // invisible literal se pierde en una conversion de encoding y la funcion
  // cambia de comportamiento en silencio.
  // Se cuenta por codigo de caracter y no con una regex de rangos: un rango
  // escrito con invisibles literales se pierde en cualquier conversion de
  // encoding y la funcion cambia de comportamiento en silencio. Aca no hay
  // ningun caracter especial en el fuente.
  let control = 0;
  for (const ch of valor) {
    const c = ch.codePointAt(0);
    const esTabOSalto = c === 9 || c === 10 || c === 13;
    if ((c < 32 && !esTabOSalto) || c === 127) control++;
  }
  if (control / valor.length > 0.2) return "ilegible";
  if (/^[A-Za-z0-9+/=]{60,}$/.test(valor)) return "posible-base64";
  return "texto";
}

// Busca, sin asumir nombres, los campos que la extension necesitaria.
const CAMPOS = {
  texto: ["body", "text", "caption", "content", "msg", "message"],
  chat: ["chatId", "chat_id", "chat", "remoteJid", "jid", "to", "from", "id"],
  fecha: ["t", "ts", "timestamp", "messageTimestamp", "time", "date"],
  autor: ["author", "participant", "sender", "from", "notifyName", "pushName"],
};

function buscarCampo(registro, candidatos) {
  for (const c of candidatos) {
    if (registro && Object.prototype.hasOwnProperty.call(registro, c) && registro[c] != null) {
      return { campo: c, valor: registro[c] };
    }
  }
  return null;
}

// Un chatId de grupo termina en @g.us; uno 1:1 en @c.us / @s.whatsapp.net.
function esGrupo(valor) {
  return typeof valor === "string" && valor.includes("@g.us");
}

function chatDeRegistro(registro) {
  const c = buscarCampo(registro, CAMPOS.chat);
  if (!c) return null;
  const v = typeof c.valor === "object" ? (c.valor._serialized || c.valor.id || "") : c.valor;
  return typeof v === "string" ? v : null;
}

// ── El informe ───────────────────────────────────────────────────────────

async function analizarStore(db, nombreDb, nombreStore) {
  const registros = await leerMuestra(db, nombreStore);
  if (registros.length === 0) return null;

  const primero = registros.find((r) => r && typeof r === "object");
  if (!primero) return null;

  const texto = buscarCampo(primero, CAMPOS.texto);
  const chat = buscarCampo(primero, CAMPOS.chat);
  const fecha = buscarCampo(primero, CAMPOS.fecha);
  const autor = buscarCampo(primero, CAMPOS.autor);

  // Pregunta 4, la que decide todo: ¿aparecen grupos distintos?
  const chats = new Map();
  for (const r of registros) {
    const id = chatDeRegistro(r);
    if (!id) continue;
    chats.set(id, (chats.get(id) || 0) + 1);
  }
  const grupos = [...chats.entries()].filter(([id]) => esGrupo(id));

  return {
    base: nombreDb,
    store: nombreStore,
    registros: registros.length,
    claves: Object.keys(primero).slice(0, 25),
    campos: {
      texto: texto && { campo: texto.campo, pinta: pinta(texto.valor), largo: String(texto.valor).length },
      chat: chat && { campo: chat.campo, ejemploEsGrupo: esGrupo(chatDeRegistro(primero)) },
      fecha: fecha && { campo: fecha.campo, valor: fecha.valor, pinta: pinta(fecha.valor) },
      autor: autor && { campo: autor.campo, pinta: pinta(autor.valor) },
    },
    chatsDistintos: chats.size,
    gruposDistintos: grupos.length,
    // Solo los ULTIMOS 12 caracteres del jid: identifica el grupo para Juan sin
    // dejar el identificador completo en un informe.
    gruposVistos: grupos.slice(0, 15).map(([id, n]) => ({ fin: id.slice(-12), mensajes: n })),
    muestraTexto: texto ? await huella(texto.valor) : null,
  };
}

async function correr() {
  console.log(`${MARCA} arrancando. Solo lectura, sin red. Ver el encabezado de spike.js.`);

  if (!indexedDB.databases) {
    console.error(`${MARCA} indexedDB.databases() no existe en este navegador. Pregunta 1: NO.`);
    return;
  }

  const bases = await indexedDB.databases();
  console.log(`${MARCA} P1 — bases visibles desde el mundo aislado: ${bases.length}`);
  console.table(bases.map((b) => ({ nombre: b.name, version: b.version })));

  const informe = { generadoEn: new Date().toISOString(), bases: bases.length, stores: [] };

  for (const { name } of bases) {
    if (!name) continue;
    let db;
    try {
      db = await abrirSoloLectura(name);
    } catch (e) {
      console.warn(`${MARCA} no se pudo abrir "${name}": ${e.message}`);
      continue;
    }

    const stores = [...db.objectStoreNames];
    const interesantes = stores.filter((s) => {
      const t = s.toLowerCase();
      return [...PISTAS_MENSAJE, ...PISTAS_CHAT].some((p) => t.includes(p));
    });

    console.log(`${MARCA} base "${name}": ${stores.length} stores, ${interesantes.length} con pinta de mensajes/chats`);

    for (const store of interesantes) {
      try {
        const r = await analizarStore(db, name, store);
        if (r) informe.stores.push(r);
      } catch (e) {
        console.warn(`${MARCA} error leyendo ${name}/${store}: ${e.message}`);
      }
    }
    db.close();
  }

  // ── Veredicto ──────────────────────────────────────────────────────────
  const conTexto = informe.stores.filter((s) => s.campos.texto?.pinta === "texto");
  const conGrupos = informe.stores.filter((s) => s.gruposDistintos > 0);

  informe.veredicto = {
    p1_databases_visible: true,
    p2_store_de_mensajes: informe.stores.length > 0 ? informe.stores.map((s) => `${s.base}/${s.store}`) : null,
    p3_texto_en_claro: conTexto.length > 0,
    p4_varios_grupos: conGrupos.length > 0 ? Math.max(...conGrupos.map((s) => s.gruposDistintos)) : 0,
    p5_campos_completos: informe.stores.some((s) => s.campos.texto && s.campos.chat && s.campos.fecha),
  };

  console.log(`${MARCA} ══════════ VEREDICTO ══════════`);
  console.log(`${MARCA} P3 ¿el texto se lee en claro?  → ${informe.veredicto.p3_texto_en_claro ? "SI" : "NO"}`);
  console.log(`${MARCA} P4 grupos distintos encontrados → ${informe.veredicto.p4_varios_grupos}`);
  console.log(`${MARCA} P5 ¿trae chat + fecha + texto?  → ${informe.veredicto.p5_campos_completos ? "SI" : "NO"}`);
  console.log(
    `${MARCA} Si P4 es mayor que la cantidad de grupos que abriste en esta sesion,\n` +
    `${MARCA} la extension puede leer sin abrir nada. Ese es el resultado que decide el alcance.`
  );
  console.log(`${MARCA} ═══════════════════════════════`);
  console.log(`${MARCA} Informe completo (copialo y pasaselo a Claude):`);
  console.log(JSON.stringify(informe, null, 2));

  // Para poder recuperarlo sin re-correr: vive en el mundo aislado, la pagina
  // no lo ve.
  globalThis.__radarSpike = informe;
  console.log(`${MARCA} tambien disponible en __radarSpike (consola de la extension)`);
}

correr().catch((e) => console.error(`${MARCA} fallo:`, e));
