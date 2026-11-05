export type ThreadSplit = {
  parts: string[];
  explanation: string;
};

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});
const sentenceSegmenter = new Intl.Segmenter(undefined, {
  granularity: "sentence",
});
const urlPattern = /https?:\/\/[^\s<>"']+/giu;

function count(value: string): number {
  let total = 0;
  let previousIndex = 0;
  for (const match of value.matchAll(urlPattern)) {
    const url = match[0].replace(/[.,!?;:)\]}]+$/u, "");
    const index = match.index ?? 0;
    total += [...graphemeSegmenter.segment(value.slice(previousIndex, index))].length;
    total += 23;
    total += [...graphemeSegmenter.segment(match[0].slice(url.length))].length;
    previousIndex = index + match[0].length;
  }
  return total + [...graphemeSegmenter.segment(value.slice(previousIndex))].length;
}

function packUnits(
  units: string[],
  maxBodyChars: number,
  separator: string
): string[] {
  const output: string[] = [];
  let current = "";
  for (const rawUnit of units) {
    const unit = rawUnit;
    if (!unit.trim()) {
      if (current) current += unit;
      continue;
    }
    if (count(unit) > maxBodyChars) {
      if (current) {
        output.push(current.trimEnd());
        current = "";
      }
      const words = unit.trim().split(/(\s+)/).filter(Boolean);
      let wordPart = "";
      for (const word of words) {
        if (count(word) > maxBodyChars) {
          if (wordPart) output.push(wordPart.trim());
          wordPart = "";
          for (const char of graphemeSegmenter.segment(word)) {
            if (count(wordPart) + 1 > maxBodyChars) {
              output.push(wordPart);
              wordPart = "";
            }
            wordPart += char.segment;
          }
        } else if (count(`${wordPart}${word}`) > maxBodyChars) {
          if (wordPart.trim()) output.push(wordPart.trim());
          wordPart = word.trimStart();
        } else {
          wordPart += word;
        }
      }
      if (wordPart.trim()) current = wordPart.trim();
      continue;
    }

    const candidate = current ? `${current}${separator}${unit}` : unit.trimStart();
    if (count(candidate) > maxBodyChars) {
      if (current) output.push(current.trimEnd());
      current = unit.trimStart();
    } else {
      current = candidate;
    }
  }
  if (current.trim()) output.push(current.trim());
  return output;
}

export function splitIntoThread(text: string, limit = 280): ThreadSplit {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError("Thread limit must be a positive integer.");
  }
  if (!text.trim()) {
    return { parts: [], explanation: "There is no text to split." };
  }

  let posts: string[] = [text.trim()];
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const suffixBudget =
      Math.max(0, ...posts.map((_, index) => count(` (${index + 1}/${posts.length})`)));
    const bodyLimit = limit - suffixBudget;
    if (bodyLimit < 1) {
      throw new RangeError("Thread limit is too small for numbered suffixes.");
    }
    const next = posts.flatMap((post) => {
      if (count(post) <= bodyLimit) return [post];
      const paragraphs = post.split(/\n{2,}/).filter(Boolean);
      if (paragraphs.length > 1) {
        return packUnits(paragraphs, bodyLimit, "\n\n");
      }
      const sentences = [...sentenceSegmenter.segment(post)]
        .map((segment) => segment.segment.trim())
        .filter(Boolean);
      if (sentences.length > 1) return packUnits(sentences, bodyLimit, " ");
      return packUnits(post.split(/(?<=\s)/u), bodyLimit, "");
    });
    if (
      next.length === posts.length &&
      next.every((post, index) => post === posts[index])
    ) {
      break;
    }
    posts = next;
  }

  const numbered = posts.map((post, index) => `${post} (${index + 1}/${posts.length})`);
  if (numbered.some((part) => count(part) > limit)) {
    throw new Error("Could not split the thread within the requested limit.");
  }
  return {
    parts: numbered,
    explanation:
      "Split at paragraph boundaries first, then sentence boundaries, then word boundaries. Numbered suffixes are included in each character count.",
  };
}
