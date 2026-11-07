import type { PlatformKey } from "./platforms";

// Client-safe, dependency-free counting helpers. The export converter and the
// editor's live counters both use these so the numbers always match.

export const urlPattern = /https?:\/\/[^\s<>"']+/giu;
export const hashtagPattern = /#[\p{L}\p{N}_]+/gu;

const xUrlPattern = /^https?:\/\/[^\s<>"']+/iu;
const trailingPunctuationPattern = /[.,!?;:)\]}]+$/u;

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

export function graphemeCount(value: string): number {
  return [...graphemeSegmenter.segment(value)].length;
}

export function countPlatformCharacters(
  value: string,
  platform: PlatformKey
): number {
  if (platform !== "X (Twitter)") return graphemeCount(value);

  let count = 0;
  let previousIndex = 0;
  for (const match of value.matchAll(urlPattern)) {
    const url = match[0].replace(trailingPunctuationPattern, "");
    const index = match.index ?? 0;
    const trailing = match[0].slice(url.length);
    count += graphemeCount(value.slice(previousIndex, index));
    count += 23;
    count += graphemeCount(trailing);
    previousIndex = index + match[0].length;
  }
  return count + graphemeCount(value.slice(previousIndex));
}

export function countHashtags(value: string): number {
  return [...value.matchAll(hashtagPattern)].length;
}

type CountedUnit = { index: number; length: number; cost: number };

function countedUnits(value: string, platform: PlatformKey): CountedUnit[] {
  const graphemes = [...graphemeSegmenter.segment(value)];
  const units: CountedUnit[] = [];
  let index = 0;

  while (index < graphemes.length) {
    const grapheme = graphemes[index];
    if (platform === "X (Twitter)") {
      const match = xUrlPattern.exec(value.slice(grapheme.index));
      if (match) {
        const url = match[0].replace(trailingPunctuationPattern, "");
        if (url.length > 0) {
          units.push({ index: grapheme.index, length: url.length, cost: 23 });
          const urlEnd = grapheme.index + url.length;
          index += 1;
          while (index < graphemes.length && graphemes[index].index < urlEnd) {
            index += 1;
          }
          continue;
        }
      }
    }
    units.push({
      index: grapheme.index,
      length: grapheme.segment.length,
      cost: 1,
    });
    index += 1;
  }

  return units;
}

/**
 * Returns the code-unit index in the converted text where the platform count
 * first exceeds `max`. Everything from that index onward is the overflow.
 */
export function findOverflowCutoff(
  value: string,
  platform: PlatformKey,
  max: number
): number {
  let count = 0;
  for (const unit of countedUnits(value, platform)) {
    if (count + unit.cost > max) return unit.index;
    count += unit.cost;
  }
  return value.length;
}
