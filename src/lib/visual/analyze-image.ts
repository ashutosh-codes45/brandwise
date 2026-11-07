"use client";

export type DominantColor = { hex: string; share: number };
export type ImageAnalysis = {
  width: number;
  height: number;
  format: string;
  hasTransparency: boolean;
  dominantColors: DominantColor[];
};

export async function analyzeImage(file: File): Promise<ImageAnalysis> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 200 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("Could not analyze the image in this browser.");
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const bins = new Map<string, number>();
    let visiblePixels = 0;
    let hasTransparency = false;

    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3];
      if (alpha < 255) {
        hasTransparency = true;
      }
      if (alpha < 16) {
        continue;
      }
      visiblePixels += 1;
      const red = Math.min(255, Math.round(data[index] / 32) * 32);
      const green = Math.min(255, Math.round(data[index + 1] / 32) * 32);
      const blue = Math.min(255, Math.round(data[index + 2] / 32) * 32);
      const hex = `#${[red, green, blue]
        .map((channel) => channel.toString(16).padStart(2, "0"))
        .join("")}`;
      bins.set(hex, (bins.get(hex) ?? 0) + 1);
    }

    const dominantColors = [...bins.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([hex, count]) => ({
        hex,
        share: visiblePixels ? count / visiblePixels : 0,
      }));

    return {
      width: bitmap.width,
      height: bitmap.height,
      format: file.type.split("/")[1]?.toLowerCase() ?? "unknown",
      hasTransparency,
      dominantColors,
    };
  } finally {
    bitmap.close();
  }
}
