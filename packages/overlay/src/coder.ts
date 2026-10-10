// Which coding agent is on the other end: the name the overlay and board use in their wording. Claude Code is the
// default; the watching session says which agent it is (`ahemui wait --agent`), and a project can set one in config.

export interface Coder {
  /** Short name for sentences: "Claude is working on it". */
  name: string;
  /** The app to run commands in: "Run /ahemui:watch in Claude Code". */
  app: string;
}

const CODERS: Record<string, Coder> = {
  "claude-code": { name: "Claude", app: "Claude Code" },
  codex: { name: "Codex", app: "Codex" },
};
const DEFAULT = "claude-code";

let current: Coder = CODERS[DEFAULT];

/** Use the watching session's agent if there is one, else the project's, else Claude Code. */
export function setCoder(...ids: (string | null | undefined)[]): void {
  const id = ids.find((i) => i && CODERS[i]);
  current = CODERS[id ?? DEFAULT];
}

export const who = (): string => current.name;
export const whoApp = (): string => current.app;
