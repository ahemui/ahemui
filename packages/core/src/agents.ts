// The coding agents AhemUI knows by name. Written into the repo as people-readable labels ("Claude (pietari)"),
// so the id travels in config.json / AHEMUI_AGENT and the display name is looked up here.

export const AGENT_NAMES: Record<string, string> = {
  "claude-code": "Claude",
  codex: "Codex",
};

/** The display name for an agent id; an unknown id is shown as it is, and none at all as "Agent". */
export function agentName(id?: string | null): string {
  if (!id) return "Agent";
  return AGENT_NAMES[id] ?? id;
}
