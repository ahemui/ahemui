import axe from "axe-core";

export interface A11yIssue {
  id: string;
  impact?: string;
  help: string;
  nodes: number;
  targets?: string[];
}

/** Runs axe-core on the highlighted element (and its subtree); attached to `a11y` items automatically. */
export async function checkA11y(el: Element): Promise<A11yIssue[]> {
  const result = await axe.run(el, { resultTypes: ["violations"] });
  return result.violations.slice(0, 30).map((v) => ({
    id: v.id,
    impact: v.impact ?? undefined,
    help: v.help.slice(0, 300),
    nodes: v.nodes.length,
    targets: v.nodes.slice(0, 5).map((n) => String(n.target.join(" ")).slice(0, 300)),
  }));
}
