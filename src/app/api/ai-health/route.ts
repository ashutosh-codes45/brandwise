import { z } from "zod";
import { getCurrentMember } from "@/lib/auth/current-member";
import { generateJsonWithProvider } from "@/lib/ai/provider";

const healthSchema = z.object({ ok: z.literal(true) });

export async function POST() {
  const member = await getCurrentMember();
  if (!member) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }
  if (member.role !== "brand_manager") {
    return Response.json({ error: "Brand Manager access required." }, { status: 403 });
  }

  const started = performance.now();
  try {
    await generateJsonWithProvider(
      "Return a JSON object with the single property ok set to true.",
      "Connection test.",
      healthSchema,
      { geminiOnly: true }
    );
    return Response.json({
      provider: "gemini",
      ms: Math.round(performance.now() - started),
      ok: true,
      error: null,
    });
  } catch (error) {
    return Response.json({
      provider: "gemini",
      ms: Math.round(performance.now() - started),
      ok: false,
      error: error instanceof Error ? error.message : "Gemini connection failed.",
    });
  }
}
