import { execFileSync } from "node:child_process";

let branchCache: { root: string; at: number; branch: string | null } | undefined;

/** Current git branch, cached briefly so health checks and board exports stay cheap. */
export function gitBranch(root: string): string | null {
  if (branchCache?.root === root && Date.now() - branchCache.at < 5000) return branchCache.branch;
  let branch: string | null = null;
  try {
    branch = execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    /* not a git repo */
  }
  branchCache = { root, at: Date.now(), branch };
  return branch;
}
