"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, CheckCircle2, LoaderCircle } from "lucide-react";
import { LeadFormSchema, type LeadFormValues } from "@/lib/lead-schema";
import { trackPixelLead } from "@/lib/pixel";
import { Button } from "@/components/design-system/button";
import { Input, NativeSelect } from "@/components/design-system/input";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/components/shared/language-provider";

interface LeadFormProps {
  /** Origen del formulario (define el copy y el dato propertyRef). */
  context: "home" | "property" | "seller";
  propertyRef?: string;
  className?: string;
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Formulario corto de conversion (5 campos max). El lead se guarda en el CRM
 * ANTES de redirigir a WhatsApp: si el visitante no completa el chat, el
 * asesor igual puede contactarlo.
 */
export function LeadForm({ context, propertyRef, className }: LeadFormProps) {
  const [status, setStatus] = React.useState<"idle" | "sending" | "success" | "error">("idle");
  const renderedAt = React.useRef(Date.now());
  const { t } = useLanguage();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LeadFormValues>({
    resolver: zodResolver(LeadFormSchema),
    defaultValues: {
      operacion: context === "seller" ? "vender" : "comprar",
      context,
      propertyRef,
      _gotcha: "",
      _ts: renderedAt.current,
    },
  });

  async function onSubmit(values: LeadFormValues) {
    setStatus("sending");
    // Mismo event_id para el Pixel (cliente) y CAPI (servidor): Meta deduplica.
    const eventId = crypto.randomUUID();
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, eventId, _ts: renderedAt.current }),
      });
      const data = (await res.json()) as { ok: boolean; whatsappUrl?: string };
      if (!res.ok || !data.ok) throw new Error("request failed");
      trackPixelLead(eventId, { context, propertyRef });
      setStatus("success");
      if (data.whatsappUrl) {
        window.location.href = data.whatsappUrl;
      }
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className={cn("rounded-brand-lg border border-line bg-surface p-8 text-center", className)}>
        <CheckCircle2 className="mx-auto size-10 text-whatsapp" aria-hidden="true" />
        <p className="mt-4 font-heading text-xl">{t("leadForm.successTitle")}</p>
        <p className="mt-2 text-sm text-muted">{t("leadForm.successBody")}</p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className={cn("rounded-brand-lg border border-line bg-surface p-6 shadow-card md:p-8", className)}
    >
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label={t("leadForm.name")} htmlFor="lead-nombre" error={errors.nombre?.message}>
          <Input
            id="lead-nombre"
            autoComplete="name"
            placeholder={t("leadForm.namePlaceholder")}
            aria-invalid={!!errors.nombre}
            {...register("nombre")}
          />
        </Field>

        <Field label={t("leadForm.phone")} htmlFor="lead-telefono" error={errors.telefono?.message}>
          <Input
            id="lead-telefono"
            type="tel"
            autoComplete="tel"
            placeholder="300 123 4567"
            aria-invalid={!!errors.telefono}
            {...register("telefono")}
          />
        </Field>

        <Field label={t("leadForm.operation")} htmlFor="lead-operacion" error={errors.operacion?.message}>
          <NativeSelect id="lead-operacion" {...register("operacion")}>
            <option value="comprar">{t("leadForm.operationBuy")}</option>
            <option value="arrendar">{t("leadForm.operationRent")}</option>
            <option value="vender">{t("leadForm.operationSell")}</option>
          </NativeSelect>
        </Field>

        <Field label={t("leadForm.zone")} htmlFor="lead-zona" error={errors.zona?.message}>
          <Input id="lead-zona" placeholder={t("leadForm.zonePlaceholder")} {...register("zona")} />
        </Field>

        <div className="sm:col-span-2">
          <Field label={t("leadForm.budget")} htmlFor="lead-presupuesto" error={errors.presupuesto?.message}>
            <Input id="lead-presupuesto" placeholder={t("leadForm.budgetPlaceholder")} {...register("presupuesto")} />
          </Field>
        </div>
      </div>

      {/* Honeypot anti-spam: invisible para humanos */}
      <div className="sr-only" aria-hidden="true">
        <label htmlFor="lead-gotcha">{t("leadForm.honeypot")}</label>
        <input id="lead-gotcha" type="text" tabIndex={-1} autoComplete="off" {...register("_gotcha")} />
      </div>

      {status === "error" ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {t("leadForm.errorBody")}
        </p>
      ) : null}

      <Button type="submit" size="lg" className="mt-6 w-full" disabled={status === "sending"}>
        {status === "sending" ? (
          <>
            <LoaderCircle className="animate-spin" aria-hidden="true" />
            {t("leadForm.sending")}
          </>
        ) : (
          <>
            {t("leadForm.submit")}
            <ArrowRight aria-hidden="true" />
          </>
        )}
      </Button>
      <p className="mt-3 text-center text-xs text-muted">{t("leadForm.disclaimer")}</p>
    </form>
  );
}
