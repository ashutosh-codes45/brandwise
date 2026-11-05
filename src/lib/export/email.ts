import { countPlatformCharacters, type ExportResult } from "./convert";

export type EmailExport = {
  subject: string;
  body: string;
  html: string;
  warnings: string[];
  changes: ExportResult["changes"];
};

export function createEmailExport(
  title: string,
  result: ExportResult
): EmailExport {
  const warnings = [...result.warnings];
  if (countPlatformCharacters(title, "Email") > 60) {
    warnings.push("Email subject is longer than the recommended 60 characters.");
  }
  return {
    subject: title,
    body: result.text,
    html: result.html ?? "",
    warnings: [...new Set(warnings)],
    changes: result.changes,
  };
}
