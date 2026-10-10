import YAML from "yaml";

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseFrontmatter(text: string): { data: unknown; body: string } {
  // Files checked out with core.autocrlf come back with \r\n; work on \n throughout.
  const m = FENCE.exec(text.replace(/\r\n/g, "\n"));
  if (!m) throw new Error("missing frontmatter");
  return { data: YAML.parse(m[1]), body: m[2].replace(/^\r?\n/, "") };
}

export function stringifyFrontmatter(data: Record<string, unknown>, body: string): string {
  // Drop undefined so optional fields don't show up as empty keys.
  const clean = JSON.parse(JSON.stringify(data));
  return `---\n${YAML.stringify(clean, { lineWidth: 0 }).trimEnd()}\n---\n\n${body.trimEnd()}\n`;
}
