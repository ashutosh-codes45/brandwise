import { z } from "zod";

const hexColorSchema = z.string().regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i);

export const brandKitSchema = z.object({
  colours: z.array(
    z.object({
      name: z.string().trim().min(1).max(80),
      hex: hexColorSchema,
      role: z.string().trim().min(1).max(80),
    })
  ).max(30),
  paletteTolerance: z.number().min(0).max(100).default(25),
  allowNeutrals: z.boolean().default(true),
  fonts: z.array(
    z.object({
      name: z.string().trim().min(1).max(100),
      usage: z.string().trim().min(1).max(100),
    })
  ).max(20),
  logo: z.object({
    minWidthPx: z.number().int().min(1).max(10_000),
    allowedFormats: z.array(z.string().trim().min(1).max(20)).min(1).max(10),
    clearSpacePercent: z.number().min(0).max(100).optional(),
    forbiddenUses: z.array(z.string().trim().min(1).max(200)).max(30),
  }),
});

export type BrandKit = z.infer<typeof brandKitSchema>;

export function renderBrandKitText(kit: BrandKit): string {
  const lines = [
    ...kit.colours.map(
      (colour) => `Use ${colour.name} (${colour.hex}) as the ${colour.role} brand colour.`
    ),
    `Brand palette tolerance is ${kit.paletteTolerance} Delta E.`,
    kit.allowNeutrals
      ? "Neutral colours are permitted alongside the brand palette."
      : "Use only brand palette colours; neutrals are not permitted.",
    ...kit.fonts.map((font) => `Use ${font.name} for ${font.usage}.`),
    `Logo minimum width is ${kit.logo.minWidthPx}px.`,
    `Allowed logo formats: ${kit.logo.allowedFormats.join(", ")}.`,
    "Maintain at least 3.0:1 contrast between the logo and its placed background.",
    ...(kit.logo.clearSpacePercent === undefined
      ? []
      : [`Keep ${kit.logo.clearSpacePercent}% clear space around the logo.`]),
    ...kit.logo.forbiddenUses.map((use) => `Do not use the logo ${use}.`),
  ];

  return lines.join("\n");
}
