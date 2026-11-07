import type { BrandKit } from "@/lib/context/brand-kit";
import { contrastRatio, deltaE76, hexToLab, isNeutral } from "./color";
import type { ImageAnalysis } from "./analyze-image";

export function isImageAnalysis(value: unknown): value is ImageAnalysis {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const image = value as Record<string, unknown>;
  return (
    typeof image.width === "number" &&
    Number.isFinite(image.width) &&
    image.width > 0 &&
    typeof image.height === "number" &&
    Number.isFinite(image.height) &&
    image.height > 0 &&
    typeof image.format === "string" &&
    typeof image.hasTransparency === "boolean" &&
    Array.isArray(image.dominantColors) &&
    image.dominantColors.every(
      (colour) =>
        typeof colour === "object" &&
        colour !== null &&
        "hex" in colour &&
        typeof colour.hex === "string" &&
        /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(colour.hex) &&
        "share" in colour &&
        typeof colour.share === "number" &&
        Number.isFinite(colour.share) &&
        colour.share >= 0 &&
        colour.share <= 1
    )
  );
}

export type VisualCheck = {
  id: "logo_min_size" | "logo_format" | "logo_contrast" | "palette_match";
  status: "pass" | "fail" | "skipped";
  severity: "fix" | "info";
  message: string;
  kitRule: string | null;
};

export function evaluateImage(
  image: ImageAnalysis,
  role: "logo" | "graphic" | "photo",
  placedBackground: string | null,
  kit: BrandKit
): VisualCheck[] {
  const checks: VisualCheck[] = [];
  const logoRule = `Logo minimum width is ${kit.logo.minWidthPx}px.`;

  if (role === "logo") {
    checks.push({
      id: "logo_min_size",
      status: image.width >= kit.logo.minWidthPx ? "pass" : "fail",
      severity: "fix",
      message: `Logo width is ${image.width}px; minimum is ${kit.logo.minWidthPx}px.`,
      kitRule: logoRule,
    });
    const format = image.format.toLowerCase().replace(/^jpeg$/, "jpg");
    const allowed = kit.logo.allowedFormats.map((item) =>
      item.toLowerCase().replace(/^\./, "").replace(/^jpeg$/, "jpg")
    );
    checks.push({
      id: "logo_format",
      status: allowed.includes(format) ? "pass" : "fail",
      severity: "fix",
      message: `Logo format is ${image.format}; allowed formats are ${kit.logo.allowedFormats.join(", ")}.`,
      kitRule: `Allowed logo formats: ${kit.logo.allowedFormats.join(", ")}.`,
    });

    if (placedBackground) {
      const dominant = image.dominantColors[0];
      const ratio = dominant
        ? contrastRatio(dominant.hex, placedBackground)
        : null;
      checks.push({
        id: "logo_contrast",
        status: ratio !== null && ratio >= 3 ? "pass" : "fail",
        severity: "fix",
        message:
          ratio === null
            ? "Logo contrast could not be calculated."
            : `Logo contrast is ${ratio.toFixed(2)}:1; minimum is 3.0:1.`,
        kitRule: "Maintain at least 3.0:1 contrast between the logo and its placed background.",
      });
    }
  }

  if (role !== "photo") {
    const palette = kit.colours
      .map((colour) => ({ ...colour, lab: hexToLab(colour.hex) }))
      .filter((colour) => colour.lab !== null);
    const outsidePalette = image.dominantColors.filter((colour) => {
      if (colour.share < 0.1) {
        return false;
      }
      if (kit.allowNeutrals && isNeutral(colour.hex)) {
        return false;
      }
      const lab = hexToLab(colour.hex);
      return (
        lab !== null &&
        !palette.some(
          (brandColour) =>
            brandColour.lab !== null &&
            deltaE76(lab, brandColour.lab) <= kit.paletteTolerance
        )
      );
    });
    const hasForbiddenNeutral =
      !kit.allowNeutrals &&
      outsidePalette.some((colour) => isNeutral(colour.hex));
    checks.push({
      id: "palette_match",
      status: outsidePalette.length === 0 ? "pass" : "fail",
      severity: "fix",
      message:
        outsidePalette.length === 0
          ? "All significant image colours match the brand palette."
          : `Image colours outside the brand palette: ${outsidePalette
              .map((colour) => `${colour.hex} (${Math.round(colour.share * 100)}%)`)
              .join(", ")}.`,
      kitRule: hasForbiddenNeutral
        ? "Use only brand palette colours; neutrals are not permitted."
        : `Brand palette tolerance is ${kit.paletteTolerance} Delta E.`,
    });
  }
  return checks;
}
