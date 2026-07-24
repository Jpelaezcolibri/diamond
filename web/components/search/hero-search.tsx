"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/design-system/button";
import { Input, NativeSelect } from "@/components/design-system/input";
import { useLanguage } from "@/components/shared/language-provider";

interface HeroSearchProps {
  zonas: string[];
  operaciones: string[];
}

/**
 * Buscador del hero (patron Airbnb): una experiencia, no un formulario.
 * Operacion + zona → /propiedades con searchParams. Sin JS igual funciona
 * (GET nativo del form).
 */
export function HeroSearch({ zonas, operaciones }: HeroSearchProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const { t } = useLanguage();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    const operacion = data.get("operacion");
    const q = data.get("q");
    if (operacion && operacion !== "todas") params.set("operacion", String(operacion));
    if (q) params.set("q", String(q).trim());
    startTransition(() => router.push(`/propiedades${params.size ? `?${params}` : ""}`));
  }

  return (
    <form
      action="/propiedades"
      method="get"
      onSubmit={onSubmit}
      role="search"
      aria-label="Buscar propiedades"
      className="flex w-full max-w-2xl flex-col gap-2 rounded-brand-lg bg-surface/95 p-2 shadow-overlay backdrop-blur-md sm:flex-row sm:items-center"
    >
      <NativeSelect
        name="operacion"
        aria-label={t("filterBar.operation")}
        defaultValue="todas"
        className="border-0 bg-transparent sm:w-52"
      >
        <option value="todas">{t("heroSearch.operationAll")}</option>
        {operaciones.includes("Venta") ? <option value="Venta">{t("heroSearch.operationBuy")}</option> : null}
        {operaciones.includes("Arriendo") ? <option value="Arriendo">{t("heroSearch.operationRent")}</option> : null}
      </NativeSelect>

      <div className="hidden h-6 w-px bg-line sm:block" aria-hidden="true" />

      <Input
        name="q"
        type="search"
        list="ref-zonas"
        placeholder={t("heroSearch.placeholder")}
        aria-label={t("heroSearch.placeholder")}
        // min-w-0: sin esto el input no encoge bajo su ancho intrínseco y
        // desborda el viewport en móviles de 320px.
        className="min-w-0 flex-1 border-0 bg-transparent"
        autoComplete="off"
      />
      <datalist id="ref-zonas">
        {zonas.map((zona) => (
          <option key={zona} value={zona} />
        ))}
      </datalist>

      <Button type="submit" size="md" className="sm:px-7" disabled={pending}>
        <Search aria-hidden="true" />
        {t("heroSearch.submit")}
      </Button>
    </form>
  );
}
