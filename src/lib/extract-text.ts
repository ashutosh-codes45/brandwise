import mammoth from "mammoth";
import { extractText as extractPdfText } from "unpdf";

const maxExtractedCharacters = 50_000;

export async function extractText(
  file: File,
  extension: string
): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  let text: string;

  if (extension === "pdf") {
    const result = await extractPdfText(new Uint8Array(buffer), {
      mergePages: true,
    });
    text = result.text;
  } else if (extension === "docx") {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else {
    text = buffer.toString("utf8");
  }

  return text.slice(0, maxExtractedCharacters).trim();
}
