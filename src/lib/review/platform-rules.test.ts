import assert from "node:assert/strict";
import test from "node:test";
import {
  EMAIL_SUBJECT_RULE_ID,
  PLATFORM_HASHTAG_RULE_ID,
  PLATFORM_LINK_RULE_ID,
  PLATFORM_NONE_RULE_ID,
  PLATFORM_OVER_LIMIT_RULE_ID,
  formatPlatformCount,
  hasNewFigures,
  runPlatformChecks,
  summarizePlatformFit,
  type PlatformCheckSection,
} from "./platform-rules";
import type { VaultSource } from "./types";

function textSection(body: string, id = "s1"): PlatformCheckSection {
  return { id, type: "text", body, alt_text: null, position: 0 };
}

function hashtags(count: number): string {
  return Array.from({ length: count }, (_, index) => `#tag${index}`).join(" ");
}

test("flags a 700-character X draft and reports the live count", () => {
  const body = `<p>${"x".repeat(700)}</p>`;

  const [row] = summarizePlatformFit([textSection(body)], ["X (Twitter)"]);
  assert.equal(row.count, 700);
  assert.equal(row.limit, 280);
  assert.equal(row.over, true);

  const findings = runPlatformChecks({
    platforms: ["X (Twitter)"],
    title: "",
    sections: [textSection(body)],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule_id, PLATFORM_OVER_LIMIT_RULE_ID);
  assert.equal(findings[0].category, "platform");
  assert.equal(findings[0].severity, "blocker");
  assert.equal(findings[0].origin, "rule");
  assert.equal(findings[0].suggestion_kind, "manual");
  assert.match(findings[0].reason, /420 characters over the X limit of 280/);
  assert.match(findings[0].source_label ?? "", /X limit \(280 characters/);
});

test("counts graphemes and X URLs at 23 characters", () => {
  // A single grapheme assembled from escapes so the zero-width joiners survive.
  const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}";
  const [row] = summarizePlatformFit(
    [textSection(`<p>${family} https://example.com</p>`)],
    ["X (Twitter)"]
  );
  // family (1) + space (1) + URL (23) = 25
  assert.equal(row.count, 25);
});

test("starts the overflow excerpt at the previous sentence boundary", () => {
  const body = `<p>Alpha beta gamma. ${"x".repeat(300)}</p>`;
  const findings = runPlatformChecks({
    platforms: ["X (Twitter)"],
    title: "",
    sections: [textSection(body)],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].excerpt, "x".repeat(300));
});

test("flags more hashtags than the platform allows, without changing them", () => {
  const over = runPlatformChecks({
    platforms: ["Instagram"],
    title: "",
    sections: [textSection(`<p>Post ${hashtags(31)}</p>`)],
  });
  const hashtag = over.find((finding) => finding.rule_id === PLATFORM_HASHTAG_RULE_ID);
  assert.ok(hashtag);
  assert.equal(hashtag.severity, "fix");
  assert.match(hashtag.reason, /maximum is 30/);
  assert.match(hashtag.reason, /not changed/);

  const within = runPlatformChecks({
    platforms: ["Instagram"],
    title: "",
    sections: [textSection(`<p>Post ${hashtags(30)}</p>`)],
  });
  assert.equal(
    within.some((finding) => finding.rule_id === PLATFORM_HASHTAG_RULE_ID),
    false
  );
});

test("honours a stricter hashtag limit set by a Vault guideline", () => {
  const guideline: VaultSource = {
    id: "g1",
    kind: "guideline",
    title: "Hashtags",
    body: "Use no more than 5 hashtags per post.",
    tags: [],
    valid_until: null,
    is_confidential: false,
    similarity: 1,
  };
  const findings = runPlatformChecks({
    platforms: ["Instagram"],
    title: "",
    sections: [textSection(`<p>Post ${hashtags(6)}</p>`)],
    guidelines: [guideline],
  });
  const hashtag = findings.find((finding) => finding.rule_id === PLATFORM_HASHTAG_RULE_ID);
  assert.ok(hashtag);
  assert.match(hashtag.reason, /maximum is 5/);
});

test("flags a 61-character email subject but not a 59-character one", () => {
  const long = runPlatformChecks({
    platforms: ["Email"],
    title: "a".repeat(61),
    sections: [textSection("<p>Body</p>")],
  });
  assert.ok(long.some((finding) => finding.rule_id === EMAIL_SUBJECT_RULE_ID));

  // An un-violated recommendation ("Recommended subject length: 60") is silent.
  const short = runPlatformChecks({
    platforms: ["Email"],
    title: "a".repeat(59),
    sections: [textSection("<p>Body</p>")],
  });
  assert.equal(short.length, 0);
});

test("flags a link in an Instagram caption as informational", () => {
  const findings = runPlatformChecks({
    platforms: ["Instagram"],
    title: "",
    sections: [textSection("<p>Read more https://example.com</p>")],
  });
  const link = findings.find((finding) => finding.rule_id === PLATFORM_LINK_RULE_ID);
  assert.ok(link);
  assert.equal(link.severity, "info");
});

test("asks for a platform when none is selected", () => {
  const findings = runPlatformChecks({
    platforms: [],
    title: "",
    sections: [textSection("<p>Body</p>")],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule_id, PLATFORM_NONE_RULE_ID);
  assert.equal(findings[0].severity, "info");
});

test("rejects a suggestion that introduces new figures", () => {
  assert.equal(hasNewFigures("Grow 99.99% faster", "Grow faster"), true);
  assert.equal(hasNewFigures("Save 50% today", "Save 50% today"), false);
  assert.equal(hasNewFigures("Visit https://new.example", "Visit example"), true);
});

test("formats a platform without a limit as characters, never '/ No limit'", () => {
  const [row] = summarizePlatformFit([textSection("<p>Body</p>")], ["Blog/Website"]);
  assert.equal(formatPlatformCount(row), "4 characters (no limit)");
  assert.doesNotMatch(formatPlatformCount(row), /No limit characters/);
});
