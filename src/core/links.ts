// Text in a terminal's line that Cmd+click may open, by where it sits in the line: `end` is just past its last character.
export interface Link {
  start: number;
  end: number;
  text: string;
}

// What Cmd+clicking a link opens.
export type LinkTarget = { type: "url"; url: string } | { type: "path"; path: string };

// Quotes and angle brackets end a URL, as they do around one in prose and markup.
const urlPattern = /https?:\/\/[^\s"'`<>]+/g;

const closingBrackets: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

// Quotes and opening brackets before a word, e.g. the `(` of `(~/notes.md)`.
const leadingPattern = /^["'`<([{]+/;

// Without the punctuation and quotes that end a sentence or clause, and without closing brackets that close nothing
// opened in the text, e.g. the `)` of a URL written in parentheses, but not the one ending `Bash_(Unix_shell)`.
function trimEnd(text: string) {
  let trimmed = text;
  while (trimmed !== "") {
    const last = trimmed.at(-1)!;
    const opening = closingBrackets[last];
    const unbalanced = opening !== undefined && count(trimmed, last) > count(trimmed, opening);
    if (!unbalanced && !".,;:!?\"'`>".includes(last)) break;
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
}

function count(text: string, character: string) {
  return text.split(character).length - 1;
}

// Every URL, and every other word as a path, in the order they appear. Which words name a file that exists is for the
// caller to find out.
export function findLinks(line: string): Link[] {
  const urls = [...line.matchAll(urlPattern)].map((match) => {
    const text = trimEnd(match[0]);
    return { start: match.index, end: match.index + text.length, text };
  });
  const paths = [...line.matchAll(/\S+/g)].flatMap((word): Link[] => {
    const wordEnd = word.index + word[0].length;
    if (urls.some((url) => url.start < wordEnd && word.index < url.end)) return [];
    const leading = word[0].match(leadingPattern)?.[0].length ?? 0;
    const text = trimEnd(word[0].slice(leading));
    const start = word.index + leading;
    return text === "" ? [] : [{ start, end: start + text.length, text }];
  });
  return [...urls, ...paths].toSorted((a, b) => a.start - b.start);
}

// A line and column after a path, as compilers and linters print them, e.g. `src/app.ts:12:3`.
const lineAndColumnPattern = /(:\d+){1,2}$/;

// A URL as it is, or else the link's path with no `.` or `..` left in it: from the home directory after `~`, and from
// the working directory unless it's absolute.
export function linkTarget(text: string, workingDirectory: string, homeDirectory: string): LinkTarget {
  if (/^https?:\/\//.test(text)) return { type: "url", url: text };
  const path = text.replace(lineAndColumnPattern, "");
  const fromHome = path === "~" || path.startsWith("~/");
  const base = path.startsWith("/") ? "" : fromHome ? homeDirectory : workingDirectory;
  const segments: string[] = [];
  for (const segment of `${base}/${fromHome ? path.slice(1) : path}`.split("/")) {
    if (segment === "..") segments.pop();
    else if (segment !== "" && segment !== ".") segments.push(segment);
  }
  return { type: "path", path: `/${segments.join("/")}` };
}
