"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveBrandKit } from "./actions";
import {
  DEFAULT_BRAND_KIT,
  normalizeHex,
  type BrandKit,
  brandKitSchema,
} from "@/lib/context/brand-kit";
import { contrastRatio } from "@/lib/visual/color";

const AVAILABLE_FORMATS = ["PNG", "SVG", "JPEG", "WebP"] as const;

const ROLE_OPTIONS = [
  { value: "primary", label: "Primary" },
  { value: "secondary", label: "Secondary" },
  { value: "accent", label: "Accent" },
  { value: "background", label: "Background" },
  { value: "text", label: "Text" },
] as const;

function toValidColorPickerValue(hex: string): string {
  const normalized = normalizeHex(hex);
  if (/^#[0-9A-F]{6}$/i.test(normalized)) {
    return normalized.toLowerCase();
  }
  return "#000000";
}

export function BrandKitPanel({
  initialKit,
  canManage,
  isConfidential = false,
}: {
  initialKit: BrandKit | null;
  renderedRules?: string;
  canManage: boolean;
  isConfidential?: boolean;
}) {
  const router = useRouter();

  const baseKit = initialKit ?? DEFAULT_BRAND_KIT;

  const [colours, setColours] = useState(baseKit.colours);
  const [fonts, setFonts] = useState(baseKit.fonts);
  const [logoMinWidth, setLogoMinWidth] = useState(baseKit.logo.minWidthPx);
  const [logoMinHeight, setLogoMinHeight] = useState<number | "">(
    baseKit.logo.minHeightPx ?? ""
  );
  const [allowedFormats, setAllowedFormats] = useState<string[]>(
    baseKit.logo.allowedFormats
  );
  const [allowedBackgrounds, setAllowedBackgrounds] = useState<string[]>(
    baseKit.logo.allowedBackgrounds ?? []
  );
  const [clearSpace, setClearSpace] = useState<number | "">(
    baseKit.logo.clearSpacePercent ?? ""
  );
  const [forbiddenUses, setForbiddenUses] = useState<string[]>(
    baseKit.logo.forbiddenUses ?? []
  );
  const [newForbiddenUse, setNewForbiddenUse] = useState("");
  const [newBgColor, setNewBgColor] = useState("#FFFFFF");

  const [tolerance, setTolerance] = useState(baseKit.paletteTolerance ?? 25);
  const [allowNeutrals, setAllowNeutrals] = useState(
    baseKit.allowNeutrals ?? true
  );
  const [minContrast, setMinContrast] = useState(
    baseKit.minTextContrast ?? 4.5
  );
  const [notes, setNotes] = useState(baseKit.notes ?? "");
  const [confidential, setConfidential] = useState(isConfidential);

  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "warning" | "error";
  } | null>(null);

  const [isPending, startTransition] = useTransition();

  // Auto-dismiss toast after 6 seconds
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Construct current BrandKit object
  const currentKit: BrandKit = useMemo(
    () => ({
      colours,
      paletteTolerance: tolerance,
      allowNeutrals,
      minTextContrast: minContrast,
      notes,
      fonts,
      logo: {
        minWidthPx: Number(logoMinWidth) || 0,
        minHeightPx:
          logoMinHeight === "" || logoMinHeight === null
            ? null
            : Number(logoMinHeight),
        allowedFormats,
        allowedBackgrounds,
        clearSpacePercent:
          clearSpace === "" || clearSpace === null ? null : Number(clearSpace),
        forbiddenUses,
      },
    }),
    [
      colours,
      tolerance,
      allowNeutrals,
      minContrast,
      notes,
      fonts,
      logoMinWidth,
      logoMinHeight,
      allowedFormats,
      allowedBackgrounds,
      clearSpace,
      forbiddenUses,
    ]
  );

  // Field-level error validation mapping from Zod
  const validation = useMemo(() => {
    const result = brandKitSchema.safeParse(currentKit);
    const errors: Record<string, string> = {};

    if (!result.success) {
      for (const issue of result.error.issues) {
        const path = issue.path.join(".");
        if (path === "colours" && issue.code === "too_small") {
          errors["colours"] = "At least one brand colour is required.";
        } else if (path.startsWith("colours.") && path.endsWith(".hex")) {
          errors[path] =
            "Enter a valid hex colour code (e.g. #1F4FD8 or #FFF).";
        } else if (path.startsWith("colours.") && path.endsWith(".name")) {
          errors[path] = "Colour name is required.";
        } else if (path === "logo.minWidthPx") {
          errors["logo.minWidthPx"] =
            "Minimum width must be a positive integer.";
        } else if (
          path === "logo.allowedFormats" &&
          issue.code === "too_small"
        ) {
          errors["logo.allowedFormats"] =
            "Select at least one allowed logo format.";
        } else if (path.startsWith("fonts.") && path.endsWith(".name")) {
          errors[path] = "Font name is required.";
        } else {
          errors[path] = issue.message;
        }
      }
    }

    return { isValid: result.success, errors };
  }, [currentKit]);

  // Color actions
  function addColour() {
    if (colours.length >= 20 || !canManage) return;
    setColours([
      ...colours,
      { name: "", hex: "#1F4FD8", role: "secondary" },
    ]);
  }

  function updateColour(
    index: number,
    field: "name" | "hex" | "role",
    val: string
  ) {
    if (!canManage) return;
    setColours(
      colours.map((item, i) =>
        i === index
          ? {
              ...item,
              [field]: field === "hex" ? val : val,
            }
          : item
      )
    );
  }

  function removeColour(index: number) {
    if (!canManage) return;
    setColours(colours.filter((_, i) => i !== index));
  }

  // Font actions
  function addFont() {
    if (fonts.length >= 10 || !canManage) return;
    setFonts([...fonts, { name: "", usage: "" }]);
  }

  function updateFont(index: number, field: "name" | "usage", val: string) {
    if (!canManage) return;
    setFonts(
      fonts.map((item, i) => (i === index ? { ...item, [field]: val } : item))
    );
  }

  function removeFont(index: number) {
    if (!canManage) return;
    setFonts(fonts.filter((_, i) => i !== index));
  }

  // Logo formats toggle
  function toggleFormat(format: string) {
    if (!canManage) return;
    if (allowedFormats.includes(format)) {
      setAllowedFormats(allowedFormats.filter((f) => f !== format));
    } else {
      setAllowedFormats([...allowedFormats, format]);
    }
  }

  // Background chips
  function addBackground() {
    if (!canManage) return;
    const norm = normalizeHex(newBgColor);
    if (!/^#[0-9A-F]{6}$/i.test(norm)) return;
    if (!allowedBackgrounds.includes(norm)) {
      setAllowedBackgrounds([...allowedBackgrounds, norm]);
    }
  }

  function removeBackground(bg: string) {
    if (!canManage) return;
    setAllowedBackgrounds(allowedBackgrounds.filter((item) => item !== bg));
  }

  // Forbidden uses
  function addForbiddenUse() {
    if (!canManage) return;
    const trimmed = newForbiddenUse.trim();
    if (!trimmed || forbiddenUses.includes(trimmed)) return;
    setForbiddenUses([...forbiddenUses, trimmed]);
    setNewForbiddenUse("");
  }

  function removeForbiddenUse(index: number) {
    if (!canManage) return;
    setForbiddenUses(forbiddenUses.filter((_, i) => i !== index));
  }

  // Reset form
  function handleReset() {
    if (!canManage) return;
    setColours(baseKit.colours);
    setFonts(baseKit.fonts);
    setLogoMinWidth(baseKit.logo.minWidthPx);
    setLogoMinHeight(baseKit.logo.minHeightPx ?? "");
    setAllowedFormats(baseKit.logo.allowedFormats);
    setAllowedBackgrounds(baseKit.logo.allowedBackgrounds ?? []);
    setClearSpace(baseKit.logo.clearSpacePercent ?? "");
    setForbiddenUses(baseKit.logo.forbiddenUses ?? []);
    setTolerance(baseKit.paletteTolerance ?? 25);
    setAllowNeutrals(baseKit.allowNeutrals ?? true);
    setMinContrast(baseKit.minTextContrast ?? 4.5);
    setNotes(baseKit.notes ?? "");
    setConfidential(isConfidential);
    setToast(null);
  }

  // Save handler
  function handleSave() {
    if (!canManage || !validation.isValid || isPending) return;

    startTransition(async () => {
      const result = await saveBrandKit(currentKit, confidential);

      if (result.error) {
        setToast({ message: result.error, type: "error" });
        return;
      }

      if (result.warning) {
        setToast({ message: result.warning, type: "warning" });
        router.refresh();
        return;
      }

      setToast({
        message: "Brand kit saved and indexed",
        type: "success",
      });
      router.refresh();
    });
  }

  // Live contrast pairs calculation
  const contrastPairs = useMemo(() => {
    const textColours = colours.filter(
      (c) =>
        c.role.toLowerCase() === "text" && /^#[0-9A-F]{3,6}$/i.test(c.hex.trim())
    );
    const bgColours = colours.filter(
      (c) =>
        c.role.toLowerCase() === "background" &&
        /^#[0-9A-F]{3,6}$/i.test(c.hex.trim())
    );

    // Fallbacks if roles are not yet explicitly set
    const effectiveTextColours =
      textColours.length > 0
        ? textColours
        : colours.filter(
            (c) =>
              c.role.toLowerCase() !== "background" &&
              /^#[0-9A-F]{3,6}$/i.test(c.hex.trim())
          );
    const effectiveBgColours =
      bgColours.length > 0
        ? bgColours
        : [
            { name: "White", hex: "#FFFFFF", role: "background" },
            { name: "Light Grey", hex: "#F5F7FB", role: "background" },
          ];

    const pairs: Array<{
      textName: string;
      textHex: string;
      bgName: string;
      bgHex: string;
      ratio: number | null;
      passed: boolean;
    }> = [];

    for (const t of effectiveTextColours) {
      for (const b of effectiveBgColours) {
        const ratio = contrastRatio(t.hex, b.hex);
        const passed = ratio !== null && ratio >= minContrast;
        pairs.push({
          textName: t.name || t.hex,
          textHex: t.hex,
          bgName: b.name || b.hex,
          bgHex: b.hex,
          ratio,
          passed,
        });
      }
    }

    return pairs;
  }, [colours, minContrast]);

  return (
    <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      {/* Toast notification */}
      {toast && (
        <div
          aria-live="polite"
          className={`mb-6 flex items-center justify-between rounded-xl border p-4 text-sm font-medium transition ${
            toast.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : toast.type === "warning"
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-red-200 bg-red-50 text-red-800"
          }`}
          role="status"
        >
          <span>{toast.message}</span>
          <button
            aria-label="Dismiss toast"
            className="ml-3 text-lg font-bold leading-none hover:opacity-70"
            onClick={() => setToast(null)}
            type="button"
          >
            ×
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-100 pb-5">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900">Brand kit</h2>
          <p className="mt-1 text-sm text-zinc-600">
            {canManage
              ? "Define colours, fonts, logo rules, and visual tolerances used for deterministic checks."
              : "Read-only view of organisation brand rules and visual standards."}
          </p>
        </div>

        {canManage && (
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
              disabled={isPending}
              onClick={handleReset}
              type="button"
            >
              Reset
            </button>
            <button
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isPending || !validation.isValid}
              onClick={handleSave}
              type="button"
            >
              {isPending ? "Saving..." : "Save Brand kit"}
            </button>
          </div>
        )}
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_360px]">
        {/* Form fields */}
        <div className="space-y-8">
          {/* 1. Colours Section */}
          <div className="rounded-xl border border-zinc-200 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-zinc-900">
                  Colours
                </h3>
                <p className="text-xs text-zinc-500">
                  Palette colours used for branding and image evaluation (max
                  20).
                </p>
              </div>
              {canManage && (
                <button
                  className="rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50"
                  disabled={colours.length >= 20}
                  onClick={addColour}
                  type="button"
                >
                  + Add colour
                </button>
              )}
            </div>

            {validation.errors["colours"] && (
              <p className="mt-2 text-xs font-medium text-red-600">
                {validation.errors["colours"]}
              </p>
            )}

            <div className="mt-4 space-y-3">
              {colours.map((colour, index) => {
                const hexErr = validation.errors[`colours.${index}.hex`];
                const nameErr = validation.errors[`colours.${index}.name`];

                return (
                  <div
                    className="flex flex-col gap-2 rounded-lg border border-zinc-100 bg-zinc-50/60 p-3"
                    key={`colour-${index}`}
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      {/* Colour picker with live swatch */}
                      <div className="relative flex shrink-0 items-center">
                        <input
                          aria-label={`Select colour ${index + 1}`}
                          className="size-9 cursor-pointer rounded-lg border border-zinc-300 p-0.5"
                          disabled={!canManage}
                          onChange={(e) =>
                            updateColour(
                              index,
                              "hex",
                              e.target.value.toUpperCase()
                            )
                          }
                          type="color"
                          value={toValidColorPickerValue(colour.hex)}
                        />
                      </div>

                      {/* Hex input */}
                      <div className="w-28 shrink-0">
                        <input
                          aria-label={`Hex code for colour ${index + 1}`}
                          className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 font-mono text-xs uppercase text-zinc-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:bg-zinc-100"
                          disabled={!canManage}
                          maxLength={7}
                          onBlur={(e) =>
                            updateColour(
                              index,
                              "hex",
                              normalizeHex(e.target.value)
                            )
                          }
                          onChange={(e) =>
                            updateColour(index, "hex", e.target.value)
                          }
                          placeholder="#1F4FD8"
                          type="text"
                          value={colour.hex}
                        />
                      </div>

                      {/* Name input */}
                      <div className="min-w-36 flex-1">
                        <input
                          aria-label={`Name for colour ${index + 1}`}
                          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:bg-zinc-100"
                          disabled={!canManage}
                          maxLength={80}
                          onChange={(e) =>
                            updateColour(index, "name", e.target.value)
                          }
                          placeholder="e.g. Lumio Blue"
                          type="text"
                          value={colour.name}
                        />
                      </div>

                      {/* Role select */}
                      <div className="w-32 shrink-0">
                        <select
                          aria-label={`Role for colour ${index + 1}`}
                          className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:bg-zinc-100"
                          disabled={!canManage}
                          onChange={(e) =>
                            updateColour(index, "role", e.target.value)
                          }
                          value={colour.role.toLowerCase()}
                        >
                          {ROLE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Remove button */}
                      {canManage && (
                        <button
                          aria-label={`Remove colour ${colour.name || index + 1}`}
                          className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-red-600"
                          onClick={() => removeColour(index)}
                          type="button"
                        >
                          <svg
                            className="size-4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            viewBox="0 0 24 24"
                          >
                            <path
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      )}
                    </div>

                    {/* Inline field errors */}
                    {(hexErr || nameErr) && (
                      <div className="flex gap-4 px-1 text-xs text-red-600">
                        {hexErr && <span>{hexErr}</span>}
                        {nameErr && <span>{nameErr}</span>}
                      </div>
                    )}
                  </div>
                );
              })}

              {colours.length === 0 && (
                <p className="text-center text-sm text-zinc-500 py-3">
                  No brand colours added yet. Click &quot;Add colour&quot; to
                  define your palette.
                </p>
              )}
            </div>
          </div>

          {/* 2. Fonts Section */}
          <div className="rounded-xl border border-zinc-200 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-zinc-900">Fonts</h3>
                <p className="text-xs text-zinc-500">
                  Approved typography styles and intended usage (max 10).
                </p>
              </div>
              {canManage && (
                <button
                  className="rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50"
                  disabled={fonts.length >= 10}
                  onClick={addFont}
                  type="button"
                >
                  + Add font
                </button>
              )}
            </div>

            <div className="mt-4 space-y-3">
              {fonts.map((font, index) => {
                const nameErr = validation.errors[`fonts.${index}.name`];
                return (
                  <div key={`font-${index}`}>
                    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-100 bg-zinc-50/60 p-3">
                      <div className="min-w-40 flex-1">
                        <label
                          className="sr-only"
                          htmlFor={`font-name-${index}`}
                        >
                          Font name
                        </label>
                        <input
                          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:bg-zinc-100"
                          disabled={!canManage}
                          id={`font-name-${index}`}
                          maxLength={100}
                          onChange={(e) =>
                            updateFont(index, "name", e.target.value)
                          }
                          placeholder="e.g. Inter"
                          type="text"
                          value={font.name}
                        />
                      </div>

                      <div className="min-w-40 flex-1">
                        <label
                          className="sr-only"
                          htmlFor={`font-usage-${index}`}
                        >
                          Font usage
                        </label>
                        <input
                          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:bg-zinc-100"
                          disabled={!canManage}
                          id={`font-usage-${index}`}
                          maxLength={100}
                          onChange={(e) =>
                            updateFont(index, "usage", e.target.value)
                          }
                          placeholder="e.g. Headings, Body text"
                          type="text"
                          value={font.usage}
                        />
                      </div>

                      {canManage && (
                        <button
                          aria-label={`Remove font ${font.name || index + 1}`}
                          className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-red-600"
                          onClick={() => removeFont(index)}
                          type="button"
                        >
                          <svg
                            className="size-4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            viewBox="0 0 24 24"
                          >
                            <path
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      )}
                    </div>
                    {nameErr && (
                      <p className="mt-1 px-1 text-xs text-red-600">{nameErr}</p>
                    )}
                  </div>
                );
              })}

              {fonts.length === 0 && (
                <p className="text-center text-sm text-zinc-500 py-3">
                  No brand fonts defined. Click &quot;Add font&quot; to specify
                  typography.
                </p>
              )}
            </div>
          </div>

          {/* 3. Logo Rules Section */}
          <div className="rounded-xl border border-zinc-200 p-5 space-y-5">
            <div>
              <h3 className="text-base font-semibold text-zinc-900">
                Logo rules
              </h3>
              <p className="text-xs text-zinc-500">
                Dimension thresholds, formats, and placement restrictions.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  className="block text-xs font-medium text-zinc-700"
                  htmlFor="minWidthPx"
                >
                  Minimum width in px <span className="text-red-500">*</span>
                </label>
                <input
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:bg-zinc-100"
                  disabled={!canManage}
                  id="minWidthPx"
                  max={10000}
                  min={1}
                  onChange={(e) =>
                    setLogoMinWidth(Number.parseInt(e.target.value, 10) || 0)
                  }
                  required
                  type="number"
                  value={logoMinWidth || ""}
                />
                {validation.errors["logo.minWidthPx"] && (
                  <p className="mt-1 text-xs text-red-600">
                    {validation.errors["logo.minWidthPx"]}
                  </p>
                )}
              </div>

              <div>
                <label
                  className="block text-xs font-medium text-zinc-700"
                  htmlFor="minHeightPx"
                >
                  Minimum height in px (optional)
                </label>
                <input
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:bg-zinc-100"
                  disabled={!canManage}
                  id="minHeightPx"
                  max={10000}
                  min={1}
                  onChange={(e) =>
                    setLogoMinHeight(
                      e.target.value === ""
                        ? ""
                        : Number.parseInt(e.target.value, 10) || ""
                    )
                  }
                  placeholder="Optional"
                  type="number"
                  value={logoMinHeight}
                />
              </div>

              <div>
                <label
                  className="block text-xs font-medium text-zinc-700"
                  htmlFor="clearSpace"
                >
                  Clear space around logo (% number, optional)
                </label>
                <input
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:bg-zinc-100"
                  disabled={!canManage}
                  id="clearSpace"
                  max={100}
                  min={0}
                  onChange={(e) =>
                    setClearSpace(
                      e.target.value === ""
                        ? ""
                        : Number.parseFloat(e.target.value) || ""
                    )
                  }
                  placeholder="e.g. 20"
                  type="number"
                  value={clearSpace}
                />
              </div>

              <div>
                <span className="block text-xs font-medium text-zinc-700">
                  Allowed formats <span className="text-red-500">*</span>
                </span>
                <div className="mt-2 flex flex-wrap gap-4">
                  {AVAILABLE_FORMATS.map((fmt) => (
                    <label
                      className="inline-flex items-center gap-1.5 text-xs text-zinc-700 cursor-pointer"
                      key={fmt}
                    >
                      <input
                        checked={allowedFormats.includes(fmt)}
                        className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                        disabled={!canManage}
                        onChange={() => toggleFormat(fmt)}
                        type="checkbox"
                      />
                      <span>{fmt}</span>
                    </label>
                  ))}
                </div>
                {validation.errors["logo.allowedFormats"] && (
                  <p className="mt-1 text-xs text-red-600">
                    {validation.errors["logo.allowedFormats"]}
                  </p>
                )}
              </div>
            </div>

            {/* Allowed Background Colours */}
            <div>
              <span className="block text-xs font-medium text-zinc-700">
                Allowed background colours
              </span>
              <p className="text-xs text-zinc-500">
                Approved background shades behind the logo.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {allowedBackgrounds.map((bg) => (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-800 shadow-sm"
                    key={bg}
                  >
                    <span
                      aria-hidden="true"
                      className="size-3.5 rounded-full border border-zinc-300"
                      style={{ backgroundColor: bg }}
                    />
                    <span className="font-mono">{bg}</span>
                    {canManage && (
                      <button
                        aria-label={`Remove background ${bg}`}
                        className="text-zinc-400 hover:text-red-600"
                        onClick={() => removeBackground(bg)}
                        type="button"
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}

                {canManage && (
                  <div className="flex items-center gap-1.5">
                    <input
                      aria-label="New background colour"
                      className="size-7 cursor-pointer rounded border border-zinc-300 p-0.5"
                      onChange={(e) =>
                        setNewBgColor(e.target.value.toUpperCase())
                      }
                      type="color"
                      value={toValidColorPickerValue(newBgColor)}
                    />
                    <button
                      className="rounded-lg border border-zinc-300 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                      onClick={addBackground}
                      type="button"
                    >
                      + Add background
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Forbidden uses */}
            <div>
              <span className="block text-xs font-medium text-zinc-700">
                Forbidden logo uses
              </span>
              <p className="text-xs text-zinc-500">
                Explicit restrictions cited during reviews (e.g. &quot;Do not
                stretch or recolour the logo&quot;).
              </p>
              <ul className="mt-2 space-y-1.5">
                {forbiddenUses.map((use, index) => (
                  <li
                    className="flex items-center justify-between rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-800"
                    key={`use-${index}`}
                  >
                    <span>• {use}</span>
                    {canManage && (
                      <button
                        aria-label={`Remove forbidden rule ${index + 1}`}
                        className="text-zinc-400 hover:text-red-600"
                        onClick={() => removeForbiddenUse(index)}
                        type="button"
                      >
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              {canManage && (
                <div className="mt-2 flex gap-2">
                  <input
                    className="flex-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs text-zinc-900 outline-none focus:border-indigo-500"
                    onChange={(e) => setNewForbiddenUse(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addForbiddenUse();
                      }
                    }}
                    placeholder="e.g. Do not stretch or recolour the logo"
                    type="text"
                    value={newForbiddenUse}
                  />
                  <button
                    className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-200"
                    onClick={addForbiddenUse}
                    type="button"
                  >
                    Add rule
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 4. Matching Rules Section */}
          <div className="rounded-xl border border-zinc-200 p-5 space-y-5">
            <div>
              <h3 className="text-base font-semibold text-zinc-900">
                Matching rules
              </h3>
              <p className="text-xs text-zinc-500">
                Algorithmic visual check parameters and Delta E tolerance.
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label
                  className="text-xs font-medium text-zinc-700"
                  htmlFor="tolerance-slider"
                >
                  Palette tolerance (Delta E)
                </label>
                <span className="rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-xs font-semibold text-zinc-800">
                  {tolerance} Delta E
                </span>
              </div>
              <input
                className="mt-2 w-full accent-indigo-600"
                disabled={!canManage}
                id="tolerance-slider"
                max={50}
                min={5}
                onChange={(e) => setTolerance(Number(e.target.value))}
                step={1}
                type="range"
                value={tolerance}
              />
              <p className="mt-1 text-xs text-zinc-500">
                How far an image colour may differ from a brand colour. Lower =
                stricter.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <input
                checked={allowNeutrals}
                className="size-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                disabled={!canManage}
                id="allowNeutrals"
                onChange={(e) => setAllowNeutrals(e.target.checked)}
                type="checkbox"
              />
              <label
                className="text-xs font-medium text-zinc-700 cursor-pointer"
                htmlFor="allowNeutrals"
              >
                Allow neutrals (white, black, grey)
              </label>
            </div>
          </div>

          {/* 5. Text Contrast */}
          <div className="rounded-xl border border-zinc-200 p-5 space-y-3">
            <div>
              <h3 className="text-base font-semibold text-zinc-900">
                Text contrast
              </h3>
              <p className="text-xs text-zinc-500">
                Minimum contrast ratio required between text and backgrounds.
              </p>
            </div>

            <div className="max-w-xs">
              <label
                className="block text-xs font-medium text-zinc-700"
                htmlFor="minContrast"
              >
                Minimum text contrast
              </label>
              <input
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:bg-zinc-100"
                disabled={!canManage}
                id="minContrast"
                max={21}
                min={1}
                onChange={(e) =>
                  setMinContrast(Number.parseFloat(e.target.value) || 4.5)
                }
                step={0.1}
                type="number"
                value={minContrast}
              />
              <p className="mt-1 text-xs text-zinc-500">WCAG recommends 4.5.</p>
            </div>
          </div>

          {/* 6. Notes */}
          <div className="rounded-xl border border-zinc-200 p-5 space-y-2">
            <label
              className="block text-base font-semibold text-zinc-900"
              htmlFor="notes"
            >
              Notes
            </label>
            <p className="text-xs text-zinc-500">
              Guidance notes, brand tone hints, or context for review judges.
            </p>
            <textarea
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:bg-zinc-100"
              disabled={!canManage}
              id="notes"
              maxLength={2000}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Primary colours must dominate corporate presentations..."
              rows={3}
              value={notes}
            />
          </div>

          {/* 7. Confidential Toggle */}
          <div className="flex items-center gap-3 rounded-xl border border-zinc-200 p-5">
            <input
              checked={confidential}
              className="size-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
              disabled={!canManage}
              id="confidentialToggle"
              onChange={(e) => setConfidential(e.target.checked)}
              type="checkbox"
            />
            <div>
              <label
                className="text-sm font-semibold text-zinc-900 cursor-pointer"
                htmlFor="confidentialToggle"
              >
                Confidential
              </label>
              <p className="text-xs text-zinc-500">
                When active, confidential items are only visible to Brand
                Managers.
              </p>
            </div>
          </div>
        </div>

        {/* 8. Live Preview Card (Right Column) */}
        <aside className="space-y-6">
          <div className="sticky top-6 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-5 shadow-sm space-y-6">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
                Live Preview
              </h3>
              <p className="mt-0.5 text-xs text-zinc-600">
                Real-time swatches and contrast evaluation.
              </p>
            </div>

            {/* Palette Swatches */}
            <div>
              <h4 className="text-xs font-semibold text-zinc-800">
                Palette Swatches ({colours.length})
              </h4>
              <div className="mt-3 flex flex-wrap gap-2">
                {colours.map((c, i) => (
                  <div
                    className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 shadow-xs"
                    key={`preview-swatch-${i}`}
                  >
                    <span
                      aria-hidden="true"
                      className="size-4 rounded-full border border-zinc-300 shrink-0"
                      style={{
                        backgroundColor: /^#[0-9A-F]{3,6}$/i.test(c.hex)
                          ? c.hex
                          : "#000",
                      }}
                    />
                    <div className="leading-tight">
                      <p className="text-xs font-medium text-zinc-900">
                        {c.name || "Untitled"}
                      </p>
                      <p className="text-[10px] text-zinc-500 uppercase">
                        {c.role} · {c.hex}
                      </p>
                    </div>
                  </div>
                ))}

                {colours.length === 0 && (
                  <p className="text-xs text-zinc-400 italic">
                    No colours defined.
                  </p>
                )}
              </div>
            </div>

            {/* Contrast Ratio Matrix Table */}
            <div>
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-zinc-800">
                  Text on Background Contrast
                </h4>
                <span className="text-[10px] text-zinc-500">
                  Min {minContrast}:1
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                Pairs of text-role colours against background-role colours.
              </p>

              <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-xs">
                {contrastPairs.length > 0 ? (
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-zinc-100 bg-zinc-50 text-[10px] text-zinc-500 uppercase tracking-wider">
                      <tr>
                        <th className="px-2.5 py-2 font-medium">Text</th>
                        <th className="px-2.5 py-2 font-medium">Bg</th>
                        <th className="px-2.5 py-2 font-medium text-right">
                          Ratio
                        </th>
                        <th className="px-2.5 py-2 font-medium text-center">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 text-zinc-700">
                      {contrastPairs.map((pair, index) => (
                        <tr
                          className="hover:bg-zinc-50/60"
                          key={`contrast-${index}`}
                        >
                          <td className="px-2.5 py-2 flex items-center gap-1.5">
                            <span
                              className="size-2.5 rounded-full border border-zinc-300 shrink-0"
                              style={{ backgroundColor: pair.textHex }}
                            />
                            <span className="truncate max-w-[80px]" title={pair.textName}>
                              {pair.textName}
                            </span>
                          </td>
                          <td className="px-2.5 py-2">
                            <div className="flex items-center gap-1.5">
                              <span
                                className="size-2.5 rounded-full border border-zinc-300 shrink-0"
                                style={{ backgroundColor: pair.bgHex }}
                              />
                              <span className="truncate max-w-[80px]" title={pair.bgName}>
                                {pair.bgName}
                              </span>
                            </div>
                          </td>
                          <td className="px-2.5 py-2 text-right font-mono text-[11px]">
                            {pair.ratio !== null
                              ? `${pair.ratio.toFixed(2)}:1`
                              : "—"}
                          </td>
                          <td className="px-2.5 py-2 text-center">
                            {pair.passed ? (
                              <span className="inline-block rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                                Pass
                              </span>
                            ) : (
                              <span className="inline-block rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-800">
                                Fail
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="p-3 text-center text-xs text-zinc-400">
                    Add colours with &quot;Text&quot; and &quot;Background&quot;
                    roles to see live contrast scores.
                  </p>
                )}
              </div>
            </div>

            {/* Quick Logo Specs */}
            <div className="border-t border-zinc-200 pt-4 text-xs text-zinc-600 space-y-1">
              <p>
                <span className="font-medium text-zinc-900">Logo Size:</span>{" "}
                Min {logoMinWidth}px
                {logoMinHeight ? ` × ${logoMinHeight}px` : " width"}
              </p>
              <p>
                <span className="font-medium text-zinc-900">Formats:</span>{" "}
                {allowedFormats.join(", ") || "None"}
              </p>
              {clearSpace !== "" && (
                <p>
                  <span className="font-medium text-zinc-900">Clear Space:</span>{" "}
                  {clearSpace}%
                </p>
              )}
            </div>

            {/* Actions in sidebar */}
            {canManage && (
              <div className="pt-2">
                <button
                  className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isPending || !validation.isValid}
                  onClick={handleSave}
                  type="button"
                >
                  {isPending ? "Saving..." : "Save Brand kit"}
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
