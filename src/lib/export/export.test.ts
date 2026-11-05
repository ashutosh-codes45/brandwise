import assert from "node:assert/strict";
import test from "node:test";
import {
  convertApprovedSnapshot,
  countPlatformCharacters,
  type ApprovedExportSection,
} from "./convert";
import { splitIntoThread } from "./thread";

function textSection(body: string): ApprovedExportSection {
  return {
    type: "text",
    body,
    image_path: null,
    alt_text: null,
    position: 0,
  };
}

test("converts unordered and numbered lists to plain-text list markers", () => {
  const bullets = convertApprovedSnapshot(
    [textSection("<ul><li><p>First</p></li><li><p>Second</p></li></ul>")],
    "LinkedIn"
  );
  assert.equal(bullets.text, "• First\n• Second");

  const numbered = convertApprovedSnapshot(
    [textSection("<ol><li><p>First</p></li><li><p>Second</p></li></ol>")],
    "LinkedIn"
  );
  assert.equal(numbered.text, "1. First\n2. Second");
});

test("renders descriptive links with their destination", () => {
  const result = convertApprovedSnapshot(
    [textSection('<p><a href="https://example.com">Read more</a></p>')],
    "LinkedIn"
  );
  assert.equal(result.text, "Read more (https://example.com)");
  assert.ok(result.changes.some((change) => change.description.includes("Added URLs")));
});

test("counts every X URL as 23 characters", () => {
  assert.equal(countPlatformCharacters("Go https://example.com!", "X (Twitter)"), 27);
});

test("flags over-limit text without truncating it", () => {
  const body = "x".repeat(3_001);
  const result = convertApprovedSnapshot([textSection(body)], "LinkedIn");
  assert.equal(result.overLimit, true);
  assert.equal(result.text.length, 3_001);
  assert.ok(result.warnings.some((warning) => warning.includes("1 characters")));
});

test("thread split includes numbered suffixes within the character limit", () => {
  const { parts } = splitIntoThread("A sentence. ".repeat(80), 280);
  assert.ok(parts.length > 1);
  for (const part of parts) {
    assert.ok(countPlatformCharacters(part, "X (Twitter)") <= 280);
    assert.match(part, /\(\d+\/\d+\)$/);
  }
});

test("preserves hashtags", () => {
  const result = convertApprovedSnapshot(
    [textSection("<p>Brand #One #Two</p>")],
    "Instagram"
  );
  assert.equal(result.text, "Brand #One #Two");
});

test("warns when image alt text is empty", () => {
  const image: ApprovedExportSection = {
    type: "image",
    body: null,
    image_path: "org/content/image.png",
    alt_text: "",
    position: 0,
  };
  const result = convertApprovedSnapshot([image], "Facebook");
  assert.ok(result.warnings.some((warning) => warning.includes("empty alt text")));
});
