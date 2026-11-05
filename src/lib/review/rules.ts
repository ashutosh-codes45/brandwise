import "server-only";

import { htmlToText } from "@/lib/html-to-text";
import type {
  ReviewFinding,
  ReviewSection,
  VaultSource,
} from "./types";

const acronymAllowlist = new Set([
  "API",
  "B2B",
  "CEO",
  "CFO",
  "CTO",
  "FAQ",
  "GDPR",
  "HTML",
  "HTTP",
  "HTTPS",
  "ID",
  "IP",
  "ISO",
  "IT",
  "LLM",
  "PDF",
  "SaaS",
  "SEO",
  "SQL",
  "UI",
  "URL",
  "UX",
]);

export function runRuleChecks(
  sections: ReviewSection[],
  sources: VaultSource[]
): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const terms = sources.filter((source) => source.kind === "term");
  const facts = sources.filter((source) => source.kind === "fact");
  const voiceGuide = sources.find(
    (source) =>
      source.kind === "guideline" &&
      source.tags.some((tag) => tag.toLocaleLowerCase() === "voice")
  );
  const today = new Date().toISOString().slice(0, 10);

  for (const section of sections) {
    if (section.type === "image") {
      if (!section.alt_text?.trim()) {
        findings.push({
          section_id: section.id,
          category: "accessibility",
          severity: "fix",
          excerpt: "",
          reason: "This image section is missing descriptive alt text.",
          source_item_id: null,
          source_label: null,
          source_quote: null,
          suggestion: "Add concise text describing the image's relevant content.",
          origin: "rule",
          rule_id: "missing_alt_text",
          confidence: 1,
          suggestion_origin: "ai",
          recommended_from_correction_id: null,
          note: null,
        });
      }
      continue;
    }

    const text = htmlToText(section.body ?? "");
    if (!text) {
      continue;
    }

    for (const term of terms) {
      const bodyLines = (term.body ?? "").split(/\r?\n/);
      for (const line of bodyLines) {
        const [preferred, avoid] = line.split("|").map((part) => part?.trim());
        if (!preferred || !avoid || preferred.length > 100 || avoid.length > 100) {
          continue;
        }

        const escapedAvoid = avoid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = new RegExp(`\\b${escapedAvoid}\\b`, "i").exec(text);
        if (!match) {
          continue;
        }
        findings.push({
          section_id: section.id,
          category: "terminology",
          severity: "fix",
          excerpt: match[0],
          reason: `"${avoid}" is marked as a term to avoid in the Vault.`,
          source_item_id: term.id,
          source_label: term.title,
          source_quote: line.slice(0, 200),
          suggestion: preferred,
          origin: "rule",
          rule_id: "term_avoid",
          confidence: 1,
          suggestion_origin: "ai",
          recommended_from_correction_id: null,
          note: null,
        });
      }
    }

    for (const fact of facts) {
      if (!fact.valid_until || fact.valid_until >= today) {
        continue;
      }
      const mentions = [fact.title, fact.body ?? ""]
        .map((candidate) => candidate.trim())
        .filter((candidate) => candidate.length >= 12)
        .sort((a, b) => b.length - a.length);
      const mention = mentions.find((candidate) =>
        text.toLocaleLowerCase().includes(candidate.toLocaleLowerCase())
      );
      if (!mention) {
        continue;
      }
      const mentionIndex = text
        .toLocaleLowerCase()
        .indexOf(mention.toLocaleLowerCase());
      const excerpt = text.slice(mentionIndex, mentionIndex + mention.length);
      findings.push({
        section_id: section.id,
        category: "outdated",
        severity: "fix",
        excerpt,
        reason: `This section references "${fact.title}", whose Vault fact expired on ${fact.valid_until}.`,
        source_item_id: fact.id,
        source_label: fact.title,
        source_quote: fact.body?.slice(0, 200) ?? fact.title.slice(0, 200),
        suggestion: "Verify this information and replace it with a current approved fact.",
        origin: "rule",
        rule_id: "expired_reference",
        confidence: 1,
        suggestion_origin: "ai",
        recommended_from_correction_id: null,
        note: null,
      });
    }

    const uppercaseWords = text.match(/\b[A-Z]{4,}\b/g) ?? [];
    const unusualWords = [...new Set(uppercaseWords)].filter(
      (word) => !acronymAllowlist.has(word)
    );
    if (unusualWords.length > 0) {
      const word = unusualWords[0];
      findings.push({
        section_id: section.id,
        category: "voice",
        severity: voiceGuide ? "fix" : "info",
        excerpt: word,
        reason: voiceGuide
          ? `The all-caps word "${word}" may conflict with the voice guidance.`
          : `The all-caps word "${word}" may read as shouting.`,
        source_item_id: voiceGuide?.id ?? null,
        source_label: voiceGuide?.title ?? null,
        source_quote: voiceGuide?.body?.slice(0, 200) ?? null,
        suggestion: word.toLocaleLowerCase(),
        origin: "rule",
        rule_id: "shouting_caps",
        confidence: voiceGuide ? 1 : 0.8,
        suggestion_origin: "ai",
        recommended_from_correction_id: null,
        note: null,
      });
    }

    const exclamationMatch = /!{2,}/.exec(text);
    if (exclamationMatch) {
      findings.push({
        section_id: section.id,
        category: "voice",
        severity: voiceGuide ? "fix" : "info",
        excerpt: exclamationMatch[0],
        reason: voiceGuide
          ? "Consecutive exclamation marks may conflict with the voice guidance."
          : "Multiple consecutive exclamation marks may read as shouting.",
        source_item_id: voiceGuide?.id ?? null,
        source_label: voiceGuide?.title ?? null,
        source_quote: voiceGuide?.body?.slice(0, 200) ?? null,
        suggestion: "!",
        origin: "rule",
        rule_id: "shouting_caps",
        confidence: voiceGuide ? 1 : 0.8,
        suggestion_origin: "ai",
        recommended_from_correction_id: null,
        note: null,
      });
    }
  }

  return findings;
}
