// The JSON object the text holds, comments allowed, or undefined if it holds something else or isn't JSON.
export function readJsonc(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(stripJsonc(text));
    return isObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

// The text, which holds a JSON object, comments allowed, with the object's `key` set to `value`. Comments and
// everything else stay as they were. A new key goes on a line of its own after the last one, indented as it is, or two
// spaces in an empty object.
export function setJsoncProperty(text: string, key: string, value: unknown) {
  const { opening, properties } = topLevelObject(text);
  const json = JSON.stringify(value);
  const existing = properties.filter((property) => property.key === key);
  if (existing.length > 0) {
    return existing
      .toReversed()
      .reduce((updated, { start, end }) => updated.slice(0, start) + json + updated.slice(end), text);
  }
  const added = `${JSON.stringify(key)}: ${json}`;
  const last = properties.at(-1);
  if (!last) {
    const after = text.slice(opening + 1);
    return `${text.slice(0, opening + 1)}\n  ${added}${after.startsWith("\n") ? "" : "\n"}${after}`;
  }
  const lineStart = text.lastIndexOf("\n", last.keyStart) + 1;
  const indent = /^[ \t]*$/.test(text.slice(lineStart, last.keyStart)) ? text.slice(lineStart, last.keyStart) : "  ";
  const comma = text[nextToken(text, last.end)] === "," ? "" : ",";
  // Past the last value and its comma, and past a comment that ends its line, so the comment stays with it.
  const position = comma ? last.end : nextToken(text, last.end) + 1;
  const restOfLine = /^[ \t]*(\/\/[^\n]*)?(?=\n)/.exec(text.slice(position));
  const insertAt = restOfLine ? position + restOfLine[0].length : position;
  const before = `${text.slice(0, last.end)}${comma}${text.slice(last.end, insertAt)}`;
  return `${before}\n${indent}${added}${text.slice(insertAt)}`;
}

// Where the text's top-level object opens, and where each of its values sits, with its key, in order.
function topLevelObject(text: string) {
  const properties: { key: string; keyStart: number; start: number; end: number }[] = [];
  const opening = nextToken(text, 0);
  let position = nextToken(text, opening + 1);
  while (text[position] === '"') {
    const keyEnd = stringEnd(text, position);
    const key = JSON.parse(text.slice(position, keyEnd)) as string;
    const start = nextToken(text, nextToken(text, keyEnd) + 1);
    const end = valueEnd(text, start);
    properties.push({ key, keyStart: position, start, end });
    position = nextToken(text, end);
    if (text[position] === ",") position = nextToken(text, position + 1);
  }
  return { opening, properties };
}

// Just past the JSON value starting at `start`.
function valueEnd(text: string, start: number) {
  if (text[start] === '"') return stringEnd(text, start);
  let position = start;
  if (!"{[".includes(text[start])) {
    while (position < text.length && !/[\s,}\]/]/.test(text[position])) position += 1;
    return position;
  }
  let depth = 0;
  while (position < text.length) {
    const character = text[position];
    if (character === '"') {
      position = stringEnd(text, position);
      continue;
    }
    if (text.startsWith("//", position) || text.startsWith("/*", position)) {
      position = commentEnd(text, position);
      continue;
    }
    if ("{[".includes(character)) depth += 1;
    if ("}]".includes(character)) depth -= 1;
    position += 1;
    if (depth === 0) return position;
  }
  return position;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The text as plain JSON: comments become spaces and commas before a closing bracket or brace are dropped, outside
// strings.
function stripJsonc(text: string) {
  let json = "";
  let position = 0;
  while (position < text.length) {
    const character = text[position];
    if (character === '"') {
      const end = stringEnd(text, position);
      json += text.slice(position, end);
      position = end;
    } else if (text.startsWith("//", position) || text.startsWith("/*", position)) {
      const end = commentEnd(text, position);
      json += " ";
      position = end;
    } else if (character === "," && "]}".includes(text[nextToken(text, position + 1)] ?? "?")) {
      position += 1;
    } else {
      json += character;
      position += 1;
    }
  }
  return json;
}

// Just past the string starting at `start`, skipping escaped quotes; the end of the text if it never closes.
function stringEnd(text: string, start: number) {
  let position = start + 1;
  while (position < text.length && text[position] !== '"') position += text[position] === "\\" ? 2 : 1;
  return Math.min(position + 1, text.length);
}

// Just past the comment starting at `start`: a line comment runs to the end of its line.
function commentEnd(text: string, start: number) {
  if (text.startsWith("//", start)) {
    const end = text.indexOf("\n", start);
    return end === -1 ? text.length : end;
  }
  const end = text.indexOf("*/", start + 2);
  return end === -1 ? text.length : end + 2;
}

// The position of the next character that isn't whitespace or part of a comment.
function nextToken(text: string, start: number) {
  let position = start;
  while (position < text.length) {
    if (/\s/.test(text[position])) position += 1;
    else if (text.startsWith("//", position) || text.startsWith("/*", position)) position = commentEnd(text, position);
    else break;
  }
  return position;
}
