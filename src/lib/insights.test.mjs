import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAcceptanceRate,
  smallSampleLabel,
  sortAttentionSuggestions,
} from "./insights.ts";

test("calculates acceptance over applied, edited, and rejected outcomes", () => {
  assert.equal(calculateAcceptanceRate(2, 1, 1), 0.75);
  assert.equal(calculateAcceptanceRate(0, 0, 0), null);
});

test("labels samples below ten as small", () => {
  assert.equal(smallSampleLabel(9), "small sample");
  assert.equal(smallSampleLabel(10), null);
});

test("sorts attention suggestions by severity and then evidence count", () => {
  const suggestions = [
    { suggestion_type: "never_cited", evidence_count: 0 },
    { suggestion_type: "often_rejected", evidence_count: 8 },
    { suggestion_type: "repeat_mistake", evidence_count: 2 },
    { suggestion_type: "expired_still_cited", evidence_count: 1 },
    { suggestion_type: "repeat_mistake", evidence_count: 5 },
  ];

  assert.deepEqual(
    sortAttentionSuggestions(suggestions).map(
      (suggestion) => `${suggestion.suggestion_type}:${suggestion.evidence_count}`
    ),
    [
      "expired_still_cited:1",
      "repeat_mistake:5",
      "repeat_mistake:2",
      "often_rejected:8",
      "never_cited:0",
    ]
  );
});
