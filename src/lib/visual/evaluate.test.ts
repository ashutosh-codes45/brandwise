import assert from "node:assert/strict";
import test from "node:test";
import { brandKitSchema } from "@/lib/context/brand-kit";
import { contrastRatio, deltaE76, hexToLab, hexToRgb, isNeutral } from "./color";
import { evaluateImage } from "./evaluate";

const kit = brandKitSchema.parse({
  colours: [{ name: "Blue", hex: "#0000ff", role: "primary" }],
  paletteTolerance: 25,
  allowNeutrals: true,
  fonts: [],
  logo: {
    minWidthPx: 200,
    allowedFormats: ["png", "jpg"],
    forbiddenUses: [],
  },
});

test("converts hexadecimal RGB and CIELAB values", () => {
  assert.deepEqual(hexToRgb("#abc"), { r: 170, g: 187, b: 204 });
  assert.equal(hexToRgb("oops"), null);
  const whiteLab = hexToLab("#ffffff");
  assert.ok(whiteLab);
  assert.ok(Math.abs(whiteLab.l - 100) < 0.001);
  assert.ok(Math.abs(whiteLab.a) < 0.001);
  assert.ok(Math.abs(whiteLab.b) < 0.001);
});

test("computes Delta E, WCAG contrast and neutral colours", () => {
  assert.equal(deltaE76({ l: 1, a: 2, b: 3 }, { l: 1, a: 2, b: 3 }), 0);
  assert.equal(contrastRatio("#000", "#fff"), 21);
  assert.equal(isNeutral("#777777"), true);
  assert.equal(isNeutral("#ff0000"), false);
});

test("fails an undersized logo with a cited minimum-width rule", () => {
  const checks = evaluateImage(
    {
      width: 100,
      height: 80,
      format: "png",
      hasTransparency: true,
      dominantColors: [{ hex: "#0000ff", share: 1 }],
    },
    "logo",
    null,
    kit
  );
  const minimum = checks.find((check) => check.id === "logo_min_size");
  assert.equal(minimum?.status, "fail");
  assert.match(minimum?.message ?? "", /100px; minimum is 200px/);
  assert.equal(minimum?.kitRule, "Logo minimum width is 200px.");
  assert.equal(checks.some((check) => check.id === "logo_contrast"), false);
});

test("skips photos and checks brand graphics against palette", () => {
  const image = {
    width: 400,
    height: 200,
    format: "png",
    hasTransparency: false,
    dominantColors: [{ hex: "#ff0000", share: 0.8 }],
  };
  assert.deepEqual(evaluateImage(image, "photo", null, kit), []);
  assert.equal(
    evaluateImage(image, "graphic", null, kit).find(
      (check) => check.id === "palette_match"
    )?.status,
    "fail"
  );
});
