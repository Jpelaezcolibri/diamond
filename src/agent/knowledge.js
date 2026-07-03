// Guia legal e hipotecaria de Sofi — COLOMBIA. Fuente UNICA para temas legales.
// Investigada y verificada contra fuentes oficiales en julio de 2026 (Funcion Publica,
// Secretaria del Senado, Minvivienda, Supernotariado, Banco de la Republica, DIAN).
// REGLA: no editar ni ampliar sin verificar contra la norma; los datos que cambian
// (IPC, tarifas, subsidios, salario minimo) llevan su fecha de corte.

const LEGAL_DISCLAIMER = `INSTRUCCIONES PARA TU RESPUESTA (no las muestres literalmente):
- Presenta esto como ORIENTACION GENERAL, nunca como asesoria legal definitiva.
- Usa "aproximadamente" en toda cifra marcada como aproximada o variable.
- No hagas calculos exactos para el caso del cliente (impuestos, cuotas, gastos): da el panorama y deja el calculo al asesor o al banco.
- Cierra aclarando que el asesor de Diamond confirma los detalles del caso concreto y ofrece conectarlo.
- Si el cliente pregunta algo que NO esta en esta guia, dilo con honestidad y ofrece al asesor. No completes con conocimiento propio: NO afirmes ni "confirmes" ningun dato legal, tributario o de otro pais que no aparezca textualmente arriba, aunque creas saberlo.`;

const LEGAL_TOPICS = {
  arrendamiento: {
    titulo: "Arriendo de vivienda urbana (Ley 820 de 2003) y locales comerciales",
    contenido: `ARRIENDO DE VIVIENDA URBANA — Ley 820 de 2003 (datos verificados contra el texto oficial):

INCREMENTO DEL CANON (art. 20):
- El canon solo sube cada 12 meses de ejecucion del contrato con el mismo precio — NO automaticamente el 1 de enero.
- Tope: maximo el 100% del IPC del año calendario anterior. TOPE VIGENTE PARA AUMENTOS EN 2026: 5,10% (que fue el IPC de 2025). Dato de referencia: durante 2025 el tope fue 5,20%.
- El arrendador debe notificar el incremento (monto y fecha) por servicio postal autorizado o el medio pactado; si no notifica, el aumento no es exigible.
- Tope absoluto del precio (art. 18): el canon no puede exceder el 1% del valor comercial del inmueble, y ese valor comercial no puede exceder 2 veces el avaluo catastral.

DURACION Y PRORROGA (arts. 5 y 6):
- Duracion la que pacten; sin pacto se entiende 1 año.
- Se prorroga automaticamente en iguales condiciones si ambas partes cumplieron y el arrendatario acepta los reajustes legales.

TERMINACION POR EL ARRENDADOR (art. 22):
- Durante las prorrogas, sin causal: preaviso escrito de minimo 3 meses + indemnizacion de 3 meses de canon.
- Al vencimiento, sin indemnizacion, con causal especial (vivir el inmueble minimo 1 año, demolerlo/repararlo, o entregarlo por venta): preaviso de 3 meses + caucion de 6 meses de canon a favor del arrendatario.
- Al vencimiento sin causal: solo cuando el contrato lleve minimo 4 años, con preaviso de 3 meses + indemnizacion de 1,5 meses de canon.

TERMINACION POR EL ARRENDATARIO (art. 24):
- En cualquier momento: preaviso escrito de 3 meses + indemnizacion de 3 meses de canon.
- Justo al vencimiento del contrato o su prorroga: con preaviso escrito de minimo 3 meses, SIN causal y SIN indemnizacion.

DEPOSITOS Y GARANTIAS (arts. 15 y 16):
- PROHIBIDO exigir depositos en dinero o cauciones reales en arriendo de vivienda (los "meses de deposito" son ilegales en Colombia).
- SI son validos: codeudor o fiador solidario, fianza con afianzadora y poliza de arrendamiento.
- Excepcion servicios publicos: se puede exigir garantia para responder por las facturas, con tope de 2 periodos de facturacion; denunciando el contrato ante la empresa de servicios el arrendador deja de ser solidario por los consumos.

LOCAL COMERCIAL (Codigo de Comercio, arts. 518-524 — regimen DISTINTO):
- Tras 2 años continuos con un mismo establecimiento, el arrendatario tiene derecho a la renovacion del contrato.
- Si el propietario lo necesita para si o va a demoler/reconstruir, debe dar desahucio con minimo 6 meses de anticipacion.
- NO aplican los topes de IPC ni del 1%: el canon comercial es de libre negociacion. Estas normas son de orden publico (no se pueden pactar en contra).`,
  },

  compraventa_proceso: {
    titulo: "Proceso legal de compraventa de inmueble usado",
    contenido: `PROCESO DE COMPRAVENTA EN COLOMBIA (verificado contra Codigo Civil, Ley 153 de 1887, Ley 1579 de 2012, Ley 675 de 2001):

PROMESA DE COMPRAVENTA (art. 89 Ley 153 de 1887):
- Debe: constar por escrito, fijar plazo o condicion para la escritura, y dejar el negocio totalmente determinado. La jurisprudencia exige ademas identificar el inmueble por linderos y definir notaria, fecha y hora de la escritura.
- Si falta un requisito, la promesa es nula (no se puede exigir judicialmente). Vale documento privado firmado; no necesita autenticarse.

PASOS TIPICOS: 1) Certificado de Tradicion y Libertad reciente → 2) estudio de titulos → 3) promesa de compraventa → 4) paz y salvos → 5) escritura publica en notaria → 6) registro en la Oficina de Registro de Instrumentos Publicos.

CERTIFICADO DE TRADICION Y LIBERTAD (CTL):
- Historia juridica del inmueble: dueños, hipotecas, embargos, patrimonio de familia, afectaciones. Se saca en linea en certificados.supernotariado.gov.co (cuesta aproximadamente $23.000-$25.000, tarifa que cambia cada año).
- Notarias y bancos lo piden con maximo 30 dias de expedido (practica estandar, no plazo legal).
- El estudio de titulos revisa normalmente los ultimos 10 años de tradicion; los bancos siempre lo exigen para credito.

ESCRITURA Y REGISTRO (claves que muchos ignoran):
- La venta de un inmueble solo se perfecciona con ESCRITURA PUBLICA (art. 1857 CC), y la propiedad SOLO se transfiere cuando la escritura se INSCRIBE en el registro (art. 756 CC). Firmar sin registrar = aun no eres dueño.
- La inscripcion debe solicitarse dentro de los 2 meses siguientes a la escritura (si fue en Colombia); tarde causa intereses moratorios sobre el impuesto de registro. Radicada, la oficina registra en maximo 5 dias habiles.
- La hipoteca (del credito) debe registrarse dentro de los 90 dias habiles siguientes o toca otorgarla de nuevo.

PAZ Y SALVOS PARA ESCRITURAR:
- Impuesto predial (secretaria de hacienda municipal) y contribucion de valorizacion donde exista (la entidad varia por ciudad: en Medellin es Fonvalmed).
- En propiedad horizontal (Ley 675 de 2001, art. 29): paz y salvo de administracion expedido por la copropiedad; si se escritura sin el, el nuevo dueño responde SOLIDARIAMENTE por las deudas de administracion del anterior.`,
  },

  gastos_impuestos: {
    titulo: "Gastos e impuestos de la compraventa (cifras aproximadas, verificar tarifa vigente)",
    contenido: `GASTOS TIPICOS DE UNA COMPRAVENTA (todas las cifras son APROXIMADAS: las tarifas se actualizan cada año por resolucion y el impuesto de registro varia por departamento — el asesor confirma los valores exactos):

- DERECHOS NOTARIALES: aproximadamente el 0,3% del valor de venta. Por COSTUMBRE se pagan 50/50 entre comprador y vendedor (la ley los asigna al vendedor salvo pacto — conviene dejarlo pactado en la promesa).
- RETENCION EN LA FUENTE: 1% del valor, la exige el notario al VENDEDOR persona natural antes de la escritura (para persona juridica aplican reglas distintas, ~2,5%).
- IMPUESTO DE REGISTRO (departamental): entre 0,5% y 1% del valor segun el departamento. Lo paga usualmente el COMPRADOR.
- DERECHOS DE REGISTRO (oficina de registro): aproximadamente 0,5%. Tambien del comprador.
- Certificado de Tradicion y Libertad: aproximadamente $23.000-$25.000.

REGLA PRACTICA PARA EL COMPRADOR: presupuestar alrededor de un 1,5%-2% adicional al precio para gastos de escrituracion y registro (aproximado — depende del departamento y de lo pactado).
REGLA PRACTICA PARA EL VENDEDOR: contar con la retencion del 1% + su mitad de gastos notariales.

OTROS QUE PUEDEN APLICAR SEGUN EL CASO (solo mencionarlos, sin calcular):
- Ganancia ocasional del vendedor si vende con utilidad (tiene beneficios para casa de habitacion segun el Estatuto Tributario — tema del contador del cliente).
- Avaluo comercial si el banco lo exige para el credito (lo cobra la entidad avaluadora).
- Predial del año en curso: se acostumbra prorratear o dejarlo pactado en la promesa.`,
  },

  credito_hipotecario: {
    titulo: "Credito hipotecario y leasing habitacional (Ley 546 de 1999 y normas vigentes)",
    contenido: `CREDITO HIPOTECARIO DE VIVIENDA EN COLOMBIA (verificado contra Ley 546 de 1999, Decreto 1077 de 2015 y Decreto 583 de 2025):

CUANTO FINANCIAN:
- Maximo 70% del valor del inmueble (80% si es vivienda de interes social VIS). El valor es el precio de compra o un avaluo de maximo 6 meses.
- En LEASING HABITACIONAL los bancos financian tipicamente mas: 80%-90% segun el perfil (practica comercial, varia por banco). En leasing el inmueble queda a nombre del banco y el cliente lo adquiere al final ejerciendo la opcion de compra.

CUOTA VS INGRESOS (regla actualizada en 2025):
- La primera cuota puede ser de hasta el 40% de los ingresos del hogar (Decreto 583 de mayo de 2025 — antes era 30% para no VIS). Se pueden sumar los ingresos de familiares o pareja que soliciten juntos.

MODALIDADES Y PLAZOS:
- Pesos con tasa fija todo el plazo, o UVR (unidad atada a la inflacion) con tasa fija sobre la UVR. Prohibida la capitalizacion de intereses.
- Plazos: entre 5 y 30 años (los bancos ofrecen comunmente 5 a 20).
- DERECHO A PREPAGO: se puede abonar o pagar todo anticipado SIN penalidad, y el cliente elige si el abono baja la cuota o el plazo (art. 17 Ley 546). Es un derecho legal, no un favor del banco.

SEGUROS OBLIGATORIOS:
- Incendio y terremoto sobre el inmueble, y vida deudores (si el titular fallece, el seguro paga la deuda y la familia conserva la casa). El cliente puede presentar polizas propias que cumplan las condiciones.

REQUISITOS TIPICOS DE LOS BANCOS (varian por entidad — el asesor de Diamond acompaña el proceso):
- Mayoria de edad, ingresos demostrables (empleados: certificacion laboral y desprendibles; independientes: declaracion de renta y extractos), buen historial crediticio, y que la cuota quepa en el 40% de los ingresos.
- Casi todos ofrecen PREAPROBACION en linea que dura unos meses — ideal sacarla ANTES de buscar propiedad para saber el presupuesto real.`,
  },

  subsidios: {
    titulo: "Subsidios de vivienda (estado a mediados de 2026 — TEMA MUY CAMBIANTE)",
    contenido: `SUBSIDIOS DE VIVIENDA — ESTADO A MEDIADOS DE 2026 (este tema cambia con frecuencia; el asesor SIEMPRE debe confirmar la vigencia antes de que el cliente cuente con un subsidio):

MI CASA YA (programa nacional):
- NO recibe nuevas postulaciones desde diciembre de 2024 y el Gobierno confirmo que no asignara nuevos subsidios en 2026. Solo siguen en proceso hogares que ya venian registrados.
- Hay propuestas politicas para reactivarlo con el nuevo gobierno (posesion agosto 2026), pero HOY no son beneficios disponibles — no prometerselo a ningun cliente.

CAJAS DE COMPENSACION (SI vigentes — la principal via de subsidio hoy):
- Para afiliados con ingresos del hogar de hasta 4 SMMLV, que no tengan vivienda ni hayan recibido subsidio antes.
- Monto aproximado: hasta 30 SMMLV (~$52 millones) si el hogar gana hasta 2 SMMLV; hasta 20 SMMLV (~$35 millones) si gana entre 2 y 4. Cubre vivienda nueva VIS/VIP y otras modalidades segun cada caja (Comfama, Comfenalco, etc.).

TOPES DE PRECIO (para que una vivienda califique como VIS/VIP, en salarios minimos):
- VIS: 135 SMMLV (~$236 millones en 2026); en ciudades grandes como Medellin aplica tope de 150 SMMLV (~$263 millones). VIP: 90 SMMLV (~$158 millones).
- OJO: el salario minimo 2026 esta en disputa judicial, asi que los valores en pesos pueden moverse.

ALTERNATIVAS VIGENTES SIN MI CASA YA:
- Fondo Nacional del Ahorro (credito por cesantias o ahorro voluntario, tambien para independientes).
- Subsidios y coberturas de alcaldias/gobernaciones (varian por ciudad y por convocatoria).
- El acompañamiento de Diamond con el credito hipotecario o leasing.`,
  },

  derechos_garantias: {
    titulo: "Protecciones del comprador y vendedor: arras, vicios ocultos, lesion enorme, sobre planos",
    contenido: `PROTECCIONES LEGALES EN LA COMPRAVENTA (verificado contra el Codigo Civil y leyes especiales):

ARRAS (plata que se entrega al firmar la promesa — la redaccion es CRITICA):
- Arras de RETRACTACION (la regla general si no se dice otra cosa): cualquiera puede echarse para atras — quien las dio las pierde; quien las recibio las devuelve DOBLADAS. Sin plazo pactado, el retracto solo cabe dentro de los 2 meses siguientes.
- Arras CONFIRMATORIAS (se pactan expresamente como parte del precio o señal de negocio cerrado): NO permiten retracto; el negocio queda en firme.
- CLAUSULA PENAL: sancion pactada por incumplir (en el mercado se usa 10%-20% del precio — costumbre, no ley). Se cobra sin probar perjuicios.

VICIOS OCULTOS (defectos que ya existian y no se veian):
- Dan derecho a deshacer la venta o pedir rebaja del precio; si el vendedor los conocia y callo, ademas indemnizacion.
- PLAZOS CORTOS en inmuebles: 1 año para deshacer la venta, 18 meses para rebaja — contados desde la ENTREGA. Por eso hay que revisar y reclamar rapido.

LESION ENORME (protege del precio abusivo, solo en inmuebles):
- Si el vendedor recibio MENOS DE LA MITAD del valor comercial, o el comprador pago MAS DEL DOBLE, puede pedirse deshacer o reajustar la venta. Plazo: 4 años desde el contrato.

EMBARGOS E HIPOTECAS (se ven en el Certificado de Tradicion y Libertad):
- Inmueble EMBARGADO: NO se puede vender (la escritura seria nula) hasta levantar el embargo. Es valido prometer la venta condicionada a que lo levanten.
- Inmueble HIPOTECADO: SI se puede vender, pero el banco conserva el derecho de perseguirlo. En la practica: se cancela la hipoteca con parte del precio en la misma operacion — el asesor coordina esto con el banco.

COMPRA SOBRE PLANOS (vivienda nueva):
- El proyecto debe tener permiso/radicacion de enajenacion ante la autoridad municipal ANTES de vender.
- La plata debe entrar a una FIDUCIARIA vigilada por la Superfinanciera, que solo desembolsa al constructor cuando el proyecto alcanza el punto de equilibrio; si no arranca, la fiducia devuelve segun el contrato.
- AMPARO DECENAL (Ley 1796 de 2016): el constructor responde 10 años por fallas estructurales de la vivienda nueva.

ORIGEN DE FONDOS:
- Bancos, fiduciarias y notarias piden declaracion de origen de fondos (normas antilavado). Recomendar siempre: pagar por canales bancarios y conservar los soportes del dinero.`,
  },
};

module.exports = { LEGAL_TOPICS, LEGAL_DISCLAIMER };
