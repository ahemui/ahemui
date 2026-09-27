export type Reply<T> = { data: T } | { error: string };

/** A running `ahemui serve`, as reported by its /api/health. */
export interface Server {
  base: string;
  project: string;
  branch: string | null;
  root: string;
  devOrigins: string[];
  maxBytes: number;
  watcher: { state: "waiting" | "working"; since: string; item?: string; by?: string } | null;
}

export interface PopupState {
  origin: string | null; // null when AhemUI can't run on this tab (chrome://, file://, …)
  servers: Server[];
  /** Explicit choice for this site: a project root, "none", or null for automatic. */
  choice: string | null;
  /** The server this site currently resolves to. */
  active: Server | null;
  builtIn: boolean; // local dev origin: content scripts always run
  enabled: boolean;
}
