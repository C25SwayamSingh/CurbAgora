"use client";

import * as React from "react";
import { useActionState } from "react";
import { AlertCircle, X } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { VendorUnit } from "@/lib/supabase/database.types";
import { idleState } from "@/features/authentication/action-state";
import { FieldError } from "@/features/authentication/components/field-error";
import { SubmitButton } from "@/features/authentication/components/submit-button";
import {
  createVendorUnitAction,
  updateVendorUnitAction,
} from "@/features/vendors/actions";
import {
  CUISINE_CATEGORIES,
  MAX_CUISINE_ENTRIES,
  OPERATING_STATUSES,
  PAYMENT_METHODS,
  VENDOR_UNIT_TYPES,
  suggestSlug,
} from "@/features/vendors/schemas";

const PREDEFINED_CUISINE_VALUES = new Set(
  CUISINE_CATEGORIES.map((c) => c.value),
);

/** A single choice pill: a visually hidden native input inside a styled label. */
function OptionPill({
  type,
  name,
  value,
  label,
  checked,
  onChange,
}: {
  type: "radio" | "checkbox";
  name: string;
  value: string;
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={cn(
        "cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors",
        checked
          ? "border-primary bg-primary/10 font-medium text-primary"
          : "border-border text-muted-foreground hover:bg-accent/50",
      )}
    >
      <input
        type={type}
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      {label}
    </label>
  );
}

export function VendorUnitForm({
  initialUnit,
  organizationSlug,
}: {
  initialUnit?: VendorUnit;
  organizationSlug: string;
}) {
  const isEdit = Boolean(initialUnit);
  const [state, formAction] = useActionState(
    isEdit ? updateVendorUnitAction : createVendorUnitAction,
    idleState,
  );

  const [slug, setSlug] = React.useState(initialUnit?.slug ?? "");
  const [slugEditable, setSlugEditable] = React.useState(false);
  const [unitType, setUnitType] = React.useState(initialUnit?.unit_type ?? "");
  const [operatingStatus, setOperatingStatus] = React.useState(
    initialUnit?.operating_status ?? "open",
  );

  const initialCuisines = initialUnit?.cuisine_categories ?? [];
  const [cuisineCategories, setCuisineCategories] = React.useState<string[]>(
    initialCuisines.filter((c) => PREDEFINED_CUISINE_VALUES.has(c)),
  );
  const [customCuisines, setCustomCuisines] = React.useState<string[]>(
    initialCuisines.filter((c) => !PREDEFINED_CUISINE_VALUES.has(c)),
  );
  const [showCustomCuisine, setShowCustomCuisine] = React.useState(
    initialCuisines.some((c) => !PREDEFINED_CUISINE_VALUES.has(c)),
  );
  const [customCuisineInput, setCustomCuisineInput] = React.useState("");

  const [paymentMethods, setPaymentMethods] = React.useState<string[]>(
    initialUnit?.payment_methods ?? [],
  );
  const [contactPhoneVisible, setContactPhoneVisible] = React.useState(
    initialUnit?.contact_phone_visible ?? false,
  );
  const [contactEmailVisible, setContactEmailVisible] = React.useState(
    initialUnit?.contact_email_visible ?? false,
  );

  function toggle(list: string[], value: string): string[] {
    return list.includes(value)
      ? list.filter((v) => v !== value)
      : [...list, value];
  }

  const totalCuisineCount = cuisineCategories.length + customCuisines.length;

  function addCustomCuisine() {
    const trimmed = customCuisineInput.trim().replace(/\s+/g, " ");
    if (!trimmed || totalCuisineCount >= MAX_CUISINE_ENTRIES) {
      setCustomCuisineInput("");
      return;
    }
    const alreadyPresent =
      customCuisines.some((c) => c.toLowerCase() === trimmed.toLowerCase()) ||
      cuisineCategories.some(
        (c) =>
          CUISINE_CATEGORIES.find((o) => o.value === c)?.label.toLowerCase() ===
          trimmed.toLowerCase(),
      );
    if (!alreadyPresent) {
      setCustomCuisines((prev) => [...prev, trimmed]);
    }
    setCustomCuisineInput("");
  }

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {state.status === "error" && state.message ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      {isEdit && initialUnit ? (
        <input type="hidden" name="unitId" value={initialUnit.id} />
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="name">Vendor name</Label>
        <Input
          id="name"
          name="name"
          placeholder="Maria's Taco Cart"
          defaultValue={initialUnit?.name}
          required
          onChange={(event) => {
            if (!slugEditable) {
              setSlug(suggestSlug(event.target.value));
            }
          }}
          aria-describedby="name-error"
          aria-invalid={Boolean(state.fieldErrors?.name)}
        />
        <FieldError id="name-error" errors={state.fieldErrors?.name} />
      </div>

      <div className="space-y-2">
        <Label>Public page link</Label>
        <p className="break-all text-sm text-muted-foreground">
          /vendors/{organizationSlug}/
          <span className="font-medium text-foreground">{slug || "…"}</span>
        </p>
        {slugEditable ? (
          <>
            <Input
              id="slug"
              name="slug"
              value={slug}
              onChange={(event) => setSlug(event.target.value.toLowerCase())}
              placeholder="marias-taco-cart"
              required
              aria-describedby="slug-error slug-hint"
              aria-invalid={Boolean(state.fieldErrors?.slug)}
            />
            <p id="slug-hint" className="text-xs text-muted-foreground">
              Lowercase letters, numbers, and hyphens — only needs to be unique
              among your own vendor units.
            </p>
            <FieldError id="slug-error" errors={state.fieldErrors?.slug} />
          </>
        ) : (
          <>
            <input type="hidden" name="slug" value={slug} />
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={() => setSlugEditable(true)}
            >
              Edit link
            </Button>
          </>
        )}
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Vendor type</legend>
        <div className="flex flex-wrap gap-2">
          {VENDOR_UNIT_TYPES.map((option) => (
            <OptionPill
              key={option.value}
              type="radio"
              name="unitType"
              value={option.value}
              label={option.label}
              checked={unitType === option.value}
              onChange={() => setUnitType(option.value)}
            />
          ))}
        </div>
        <FieldError id="unitType-error" errors={state.fieldErrors?.unitType} />
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="description">Short description</Label>
        <Textarea
          id="description"
          name="description"
          placeholder="What makes your food worth the stop?"
          maxLength={280}
          defaultValue={initialUnit?.description}
          aria-describedby="description-error"
          aria-invalid={Boolean(state.fieldErrors?.description)}
        />
        <FieldError
          id="description-error"
          errors={state.fieldErrors?.description}
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Cuisine categories</legend>
        <div className="flex flex-wrap gap-2">
          {CUISINE_CATEGORIES.map((option) => (
            <OptionPill
              key={option.value}
              type="checkbox"
              name="cuisineCategories"
              value={option.value}
              label={option.label}
              checked={cuisineCategories.includes(option.value)}
              onChange={() =>
                setCuisineCategories((prev) => toggle(prev, option.value))
              }
            />
          ))}
          <button
            type="button"
            onClick={() => setShowCustomCuisine((v) => !v)}
            aria-expanded={showCustomCuisine}
            className={cn(
              "cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors",
              showCustomCuisine
                ? "border-primary bg-primary/10 font-medium text-primary"
                : "border-border text-muted-foreground hover:bg-accent/50",
            )}
          >
            Other
          </button>
        </div>

        {showCustomCuisine ? (
          <div className="space-y-2 pt-1">
            <div className="flex gap-2">
              <Input
                value={customCuisineInput}
                onChange={(event) => setCustomCuisineInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addCustomCuisine();
                  }
                }}
                placeholder="e.g. Ethiopian"
                aria-label="Add a custom cuisine"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addCustomCuisine}
              >
                Add
              </Button>
            </div>
            {customCuisines.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {customCuisines.map((cuisine) => (
                  <span
                    key={cuisine}
                    className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary/10 py-1 pl-3 pr-1.5 text-sm font-medium text-primary"
                  >
                    {cuisine}
                    <input
                      type="hidden"
                      name="cuisineCategories"
                      value={cuisine}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setCustomCuisines((prev) =>
                          prev.filter((c) => c !== cuisine),
                        )
                      }
                      aria-label={`Remove ${cuisine}`}
                      className="rounded-full p-0.5 hover:bg-primary/20"
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Choose up to {MAX_CUISINE_ENTRIES}, including custom entries.
        </p>
        <FieldError
          id="cuisineCategories-error"
          errors={state.fieldErrors?.cuisineCategories}
        />
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="city">City</Label>
        <Input
          id="city"
          name="city"
          placeholder="Austin"
          defaultValue={initialUnit?.city}
          required
          aria-describedby="city-error"
          aria-invalid={Boolean(state.fieldErrors?.city)}
        />
        <FieldError id="city-error" errors={state.fieldErrors?.city} />
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Business contact</legend>
        <p className="text-xs text-muted-foreground">
          Separate from your personal account — a field is only shown on your
          public page if you turn on its &quot;Show publicly&quot; toggle.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="contactPhone">Business phone (optional)</Label>
            <Input
              id="contactPhone"
              name="contactPhone"
              type="tel"
              placeholder="(555) 555-0100"
              defaultValue={initialUnit?.contact_phone ?? ""}
              aria-describedby="contactPhone-error"
              aria-invalid={Boolean(state.fieldErrors?.contactPhone)}
            />
            <FieldError
              id="contactPhone-error"
              errors={state.fieldErrors?.contactPhone}
            />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                name="contactPhoneVisible"
                checked={contactPhoneVisible}
                onChange={(e) => setContactPhoneVisible(e.target.checked)}
                className="size-4 rounded border-input"
              />
              Show publicly
            </label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="contactEmail">Business email (optional)</Label>
            <Input
              id="contactEmail"
              name="contactEmail"
              type="email"
              placeholder="hello@example.com"
              defaultValue={initialUnit?.contact_email ?? ""}
              aria-describedby="contactEmail-error"
              aria-invalid={Boolean(state.fieldErrors?.contactEmail)}
            />
            <FieldError
              id="contactEmail-error"
              errors={state.fieldErrors?.contactEmail}
            />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                name="contactEmailVisible"
                checked={contactEmailVisible}
                onChange={(e) => setContactEmailVisible(e.target.checked)}
                className="size-4 rounded border-input"
              />
              Show publicly
            </label>
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          Payment methods accepted
        </legend>
        <div className="flex flex-wrap gap-2">
          {PAYMENT_METHODS.map((option) => (
            <OptionPill
              key={option.value}
              type="checkbox"
              name="paymentMethods"
              value={option.value}
              label={option.label}
              checked={paymentMethods.includes(option.value)}
              onChange={() =>
                setPaymentMethods((prev) => toggle(prev, option.value))
              }
            />
          ))}
        </div>
        <FieldError
          id="paymentMethods-error"
          errors={state.fieldErrors?.paymentMethods}
        />
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Operating status</legend>
        <div className="flex flex-wrap gap-2">
          {OPERATING_STATUSES.map((option) => (
            <OptionPill
              key={option.value}
              type="radio"
              name="operatingStatus"
              value={option.value}
              label={option.label}
              checked={operatingStatus === option.value}
              onChange={() => setOperatingStatus(option.value)}
            />
          ))}
        </div>
        <FieldError
          id="operatingStatus-error"
          errors={state.fieldErrors?.operatingStatus}
        />
      </fieldset>

      <SubmitButton
        className="w-full sm:w-auto"
        pendingLabel={isEdit ? "Saving…" : "Creating…"}
      >
        {isEdit ? "Save changes" : "Create vendor profile"}
      </SubmitButton>
    </form>
  );
}
