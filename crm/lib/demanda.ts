// Tipos y constantes del Mapa de demanda (CRM /demanda). El calculo lo hace
// el bot (src/groups/mapa-demanda.js, POST /api/demanda); aca solo lo que
// la pagina necesita para pintarlo.

export const META_CAPTACIONES_MES = 10;

export const PERIODOS_DEMANDA = [7, 30, 90] as const;
export type Operacion = "venta" | "arriendo";

export type Celda = {
  id: string;
  macrozona: string;
  tipo: string;
  banda: string;
  bandaLabel: string;
  pedidos: number;
  pedidosMes: number;
  tenemos: number;
  refs: string[];
  porPropiedad: number;
  caliente: boolean;
  quePiden: { barras: { texto: string; pct: number }[]; barrios: string[] };
  pedidos30: number;
  pedidos90: number;
  argumento: string | null;
  argumentoMotivo: string | null;
};

export type NoCalza = { ref: string; titulo: string | null; zona: string | null; motivo: string };

export type MapaDemanda = {
  ok: boolean;
  org: { name: string };
  dias: number;
  operacion: Operacion;
  umbralCaliente: number;
  kpis: {
    pedidos: number;
    grupos: number;
    sinInventario: number;
    pctSinInventario: number;
    celdasCalientes: number;
    captacionesCalientes: number;
  };
  celdas: Celda[];
  captaciones: string[];
  noCalza: { total: number; n: number; lista: NoCalza[] };
  generadoAt?: string;
};

const TIPO_LABEL: Record<string, string> = {
  apartamento: "apartamento",
  casa: "casa",
  lote: "lote",
  apartaestudio: "apartaestudio",
  "local-oficina": "local u oficina",
  finca: "finca",
  otro: "otro",
};

export function tipoLabel(t: string): string {
  return TIPO_LABEL[t] ?? t;
}

// 1 decimal con coma, como en el mockup ("2,5").
export function fmtDecimal(n: number): string {
  return (Math.round(n * 10) / 10).toString().replace(".", ",");
}

export function fmtEntero(n: number): string {
  return n.toLocaleString("es-CO");
}
