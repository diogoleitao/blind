// Each of the query's letters scores 1, plus this at the start of a word.
const wordStartBonus = 2;
// And plus this right after the letter before it.
const runBonus = 3;

// How well the text holds the query's letters in order, ignoring case and the query's spaces, taking the placement of
// the letters that scores best; undefined if it doesn't hold them. An empty query scores 0.
export function fuzzyScore(query: string, text: string): number | undefined {
  const characters = [...text.toLowerCase()];
  // At each position, the best score of the letters so far with the last of them there.
  let scores: (number | undefined)[] | undefined;
  for (const letter of query.toLowerCase().replaceAll(" ", "")) {
    const previous = scores;
    // The best score of the letters before ending two or more positions back, so not in a run with this one.
    let apart: number | undefined;
    scores = characters.map((character, position) => {
      if (position >= 2) apart = highest(apart, previous?.[position - 2]);
      if (character !== letter) return undefined;
      const own = 1 + (isWordStart(characters, position) ? wordStartBonus : 0);
      if (!previous) return own;
      const adjacent = previous[position - 1];
      const before = highest(apart, adjacent === undefined ? undefined : adjacent + runBonus);
      return before === undefined ? undefined : before + own;
    });
  }
  return scores ? highest(...scores) : 0;
}

function isWordStart(characters: string[], position: number) {
  return position === 0 || !/[\p{L}\p{N}]/u.test(characters[position - 1]);
}

function highest(...values: (number | undefined)[]) {
  const defined = values.filter((value) => value !== undefined);
  return defined.length > 0 ? Math.max(...defined) : undefined;
}
