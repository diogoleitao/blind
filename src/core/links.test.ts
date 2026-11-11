import { describe, expect, it } from "vitest";
import { findLinks } from "./links";

describe("finding links in a line", () => {
  it("finds a URL with where it starts and ends", () => {
    expect(findLinks("    https://example.com/docs?page=2#top  ")).toEqual([
      { start: 4, end: 39, text: "https://example.com/docs?page=2#top" },
    ]);
  });

  it("leaves out punctuation and brackets around a URL, keeping brackets that open inside it", () => {
    const texts = (line: string) => findLinks(line).map((link) => link.text);

    expect(texts("https://example.com/a.")).toEqual(["https://example.com/a"]);
    expect(texts("(https://example.com/a),")).toEqual(["https://example.com/a"]);
    expect(texts('"https://example.com/a"')).toEqual(["https://example.com/a"]);
    expect(texts("<https://example.com/a>")).toEqual(["https://example.com/a"]);
    expect(texts("https://en.wikipedia.org/wiki/Bash_(Unix_shell)!")).toEqual([
      "https://en.wikipedia.org/wiki/Bash_(Unix_shell)",
    ]);
  });

  it("offers every other word as a path, in order, without the quotes, brackets and punctuation around it", () => {
    expect(findLinks('src/a.ts:12:3: see "./b.ts", (~/notes.md) and https://example.com')).toEqual([
      { start: 0, end: 13, text: "src/a.ts:12:3" },
      { start: 15, end: 18, text: "see" },
      { start: 20, end: 26, text: "./b.ts" },
      { start: 30, end: 40, text: "~/notes.md" },
      { start: 42, end: 45, text: "and" },
      { start: 46, end: 65, text: "https://example.com" },
    ]);
  });
});
