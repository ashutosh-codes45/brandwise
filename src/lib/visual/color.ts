export type Rgb = { r: number; g: number; b: number };
export type Lab = { l: number; a: number; b: number };

export function hexToRgb(hex: string): Rgb | null {
  const normalized = hex.replace(/^#/, "");
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalized)) {
    return null;
  }
  const expanded =
    normalized.length === 3
      ? normalized.split("").map((digit) => digit + digit).join("")
      : normalized;
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

export function rgbToLab({ r, g, b }: Rgb): Lab {
  const linearize = (value: number) => {
    const channel = value / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  };
  const red = linearize(r);
  const green = linearize(g);
  const blue = linearize(b);
  const x = (red * 0.4124564 + green * 0.3575761 + blue * 0.1804375) / 0.95047;
  const y = red * 0.2126729 + green * 0.7151522 + blue * 0.072175;
  const z = (red * 0.0193339 + green * 0.119192 + blue * 0.9503041) / 1.08883;
  const f = (value: number) =>
    value > 216 / 24389
      ? Math.cbrt(value)
      : (24389 / 27 * value + 16) / 116;
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function hexToLab(hex: string): Lab | null {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToLab(rgb) : null;
}

export function deltaE76(first: Lab, second: Lab): number {
  return Math.hypot(
    first.l - second.l,
    first.a - second.a,
    first.b - second.b
  );
}

export function contrastRatio(firstHex: string, secondHex: string): number | null {
  const first = hexToRgb(firstHex);
  const second = hexToRgb(secondHex);
  if (!first || !second) {
    return null;
  }
  const luminance = ({ r, g, b }: Rgb) => {
    const channels = [r, g, b].map((value) => {
      const channel = value / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

export function isNeutral(hex: string): boolean {
  const lab = hexToLab(hex);
  return lab !== null && Math.hypot(lab.a, lab.b) < 12;
}
