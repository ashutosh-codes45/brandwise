import { z } from "zod";

export const hexColorSchema = z
  .string()
  .trim()
  .regex(
    /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/,
    "Must be a valid hex color code (e.g. #1F4FD8)"
  );

export const brandKitSchema = z.object({
  colours: z
    .array(
      z.object({
        name: z.string().trim().min(1, "Colour name is required").max(80),
        hex: hexColorSchema,
        role: z.string().trim().min(1, "Colour role is required").max(80),
      })
    )
    .min(1, "At least one brand colour is required")
    .max(30),
  paletteTolerance: z.number().min(0).max(100).default(25),
  allowNeutrals: z.boolean().default(true),
  minTextContrast: z.number().min(1).max(21).default(4.5),
  notes: z.string().max(2000).optional().default(""),
  fonts: z
    .array(
      z.object({
        name: z.string().trim().min(1, "Font name is required").max(100),
        usage: z.string().trim().max(100).default(""),
      })
    )
    .max(20)
    .default([]),
  logo: z.object({
    minWidthPx: z
      .number({ error: "Minimum width must be a number" })
      .int("Minimum width must be an integer")
      .min(1, "Minimum width must be at least 1px")
      .max(10_000),
    minHeightPx: z
      .number({ error: "Minimum height must be a number" })
      .int("Minimum height must be an integer")
      .min(1, "Minimum height must be at least 1px")
      .max(10_000)
      .optional()
      .nullable(),
    allowedFormats: z
      .array(z.string().trim().min(1).max(20))
      .min(1, "At least one allowed format is required")
      .max(10),
    allowedBackgrounds: z.array(hexColorSchema).default([]),
    clearSpacePercent: z.number().min(0).max(100).optional().nullable(),
    forbiddenUses: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  }),
});

export type BrandKit = z.infer<typeof brandKitSchema>;

export const DEFAULT_BRAND_KIT: BrandKit = {
  colours: [
    { name: "Lumio Blue", hex: "#1F4FD8", role: "primary" },
    { name: "Midnight Navy", hex: "#0B1F3A", role: "text" },
    { name: "Aqua", hex: "#00C2A8", role: "accent" },
    { name: "Cloud", hex: "#F5F7FB", role: "background" },
  ],
  fonts: [
    { name: "Inter", usage: "Headings" },
    { name: "Source Sans 3", usage: "Body" },
  ],
  logo: {
    minWidthPx: 200,
    minHeightPx: null,
    allowedFormats: ["PNG", "SVG"],
    allowedBackgrounds: ["#FFFFFF", "#0B1F3A"],
    clearSpacePercent: 20,
    forbiddenUses: ["Do not stretch or recolour the logo"],
  },
  paletteTolerance: 25,
  allowNeutrals: true,
  minTextContrast: 4.5,
  notes: "",
};

export function normalizeHex(hex: string): string {
  const trimmed = hex.trim().toUpperCase();
  if (/^#[0-9A-F]{3}$/.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  return trimmed;
}

export function normalizeBrandKitData(input: unknown): unknown {
  if (typeof input !== "object" || input === null) {
    return input;
  }

  const raw = input as Record<string, unknown>;

  // Normalize colours: convert plain strings to objects
  let colours = raw.colours;
  if (Array.isArray(colours)) {
    colours = colours.map((item, index) => {
      if (typeof item === "string") {
        const hex = normalizeHex(item);
        return {
          name: hex,
          hex,
          role: index === 0 ? "primary" : "secondary",
        };
      }
      if (typeof item === "object" && item !== null) {
        const obj = item as Record<string, unknown>;
        const hex = typeof obj.hex === "string" ? normalizeHex(obj.hex) : "";
        return {
          name:
            typeof obj.name === "string" && obj.name.trim()
              ? obj.name.trim()
              : hex,
          hex,
          role:
            typeof obj.role === "string" && obj.role.trim()
              ? obj.role.trim().toLowerCase()
              : index === 0
                ? "primary"
                : "secondary",
        };
      }
      return item;
    });
  }

  // Normalize fonts: convert plain strings to objects
  let fonts = raw.fonts;
  if (Array.isArray(fonts)) {
    fonts = fonts.map((item) => {
      if (typeof item === "string") {
        return {
          name: item.trim(),
          usage: "",
        };
      }
      if (typeof item === "object" && item !== null) {
        const obj = item as Record<string, unknown>;
        return {
          name: typeof obj.name === "string" ? obj.name.trim() : "",
          usage: typeof obj.usage === "string" ? obj.usage.trim() : "",
        };
      }
      return item;
    });
  }

  // Normalize logo rules
  let logo = raw.logo;
  if (typeof logo === "object" && logo !== null) {
    const rawLogo = logo as Record<string, unknown>;
    const minWidthPx =
      typeof rawLogo.minWidthPx === "string"
        ? Number.parseInt(rawLogo.minWidthPx, 10)
        : rawLogo.minWidthPx;
    const minHeightPx =
      typeof rawLogo.minHeightPx === "string"
        ? rawLogo.minHeightPx.trim()
          ? Number.parseInt(rawLogo.minHeightPx, 10)
          : null
        : rawLogo.minHeightPx;
    const clearSpacePercent =
      typeof rawLogo.clearSpacePercent === "string"
        ? rawLogo.clearSpacePercent.trim()
          ? Number.parseFloat(rawLogo.clearSpacePercent)
          : null
        : rawLogo.clearSpacePercent;

    let allowedBackgrounds = rawLogo.allowedBackgrounds;
    if (Array.isArray(allowedBackgrounds)) {
      allowedBackgrounds = allowedBackgrounds.map((bg) =>
        typeof bg === "string" ? normalizeHex(bg) : bg
      );
    } else {
      allowedBackgrounds = [];
    }

    logo = {
      ...rawLogo,
      minWidthPx: Number.isFinite(minWidthPx) ? minWidthPx : 200,
      minHeightPx: Number.isFinite(minHeightPx) ? minHeightPx : null,
      clearSpacePercent: Number.isFinite(clearSpacePercent)
        ? clearSpacePercent
        : null,
      allowedBackgrounds,
      allowedFormats: Array.isArray(rawLogo.allowedFormats)
        ? rawLogo.allowedFormats
        : ["PNG", "SVG"],
      forbiddenUses: Array.isArray(rawLogo.forbiddenUses)
        ? rawLogo.forbiddenUses
        : [],
    };
  }

  const paletteTolerance =
    typeof raw.paletteTolerance === "string"
      ? Number.parseFloat(raw.paletteTolerance)
      : typeof raw.paletteTolerance === "number"
        ? raw.paletteTolerance
        : 25;

  const minTextContrast =
    typeof raw.minTextContrast === "string"
      ? Number.parseFloat(raw.minTextContrast)
      : typeof raw.minTextContrast === "number"
        ? raw.minTextContrast
        : 4.5;

  return {
    ...raw,
    colours: colours ?? [],
    fonts: fonts ?? [],
    logo: logo ?? {
      minWidthPx: 200,
      minHeightPx: null,
      allowedFormats: ["PNG", "SVG"],
      allowedBackgrounds: ["#FFFFFF", "#0B1F3A"],
      clearSpacePercent: 20,
      forbiddenUses: [],
    },
    paletteTolerance: Number.isFinite(paletteTolerance) ? paletteTolerance : 25,
    allowNeutrals:
      typeof raw.allowNeutrals === "boolean" ? raw.allowNeutrals : true,
    minTextContrast: Number.isFinite(minTextContrast) ? minTextContrast : 4.5,
    notes: typeof raw.notes === "string" ? raw.notes : "",
  };
}

export function renderBrandKitText(kit: BrandKit): string {
  const lines = [
    ...kit.colours.map(
      (colour) =>
        `Use ${colour.name} (${colour.hex}) as the ${colour.role} brand colour.`
    ),
    `Brand palette tolerance is ${kit.paletteTolerance} Delta E.`,
    kit.allowNeutrals
      ? "Neutral colours are permitted alongside the brand palette."
      : "Use only brand palette colours; neutrals are not permitted.",
    ...kit.fonts.map((font) =>
      font.usage ? `Use ${font.name} for ${font.usage}.` : `Use ${font.name}.`
    ),
    `Logo minimum width is ${kit.logo.minWidthPx}px.`,
    `Allowed logo formats: ${kit.logo.allowedFormats.join(", ")}.`,
    "Maintain at least 3.0:1 contrast between the logo and its placed background.",
    ...(kit.logo.clearSpacePercent === undefined ||
    kit.logo.clearSpacePercent === null
      ? []
      : [`Keep ${kit.logo.clearSpacePercent}% clear space around the logo.`]),
    ...kit.logo.forbiddenUses.map((use) => `Do not use the logo ${use}.`),
  ];

  return lines.join("\n");
}
