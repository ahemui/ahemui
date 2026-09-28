import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { parseArgs } from "node:util";
import { defaultAuthor, type Item, PRIORITIES, type Shot, AhemError, AhemStore, STATUSES, type Status, TYPES, workOrder } from "@ahemui/core";
import { relative } from "node:path";
import { exportBoard, openInBrowser } from "./board.js";
import { serve } from "./server.js";
import { updateProject } from "./update.js";
import { waitForStartNow } from "./wait.js";

const HELP = `ahemui — visual feedback backlog stored in .ahemui/

usage:
  ahemui init [--origin <url>]... [--port <n>]
  ahemui serve [--port <n>]
  ahemui board [--no-open]          open the live backlog board (starts ahemui serve if it isn't running)
  ahemui export [--out <file>]      write a read-only backlog snapshot (default .ahemui/backlog.html)
  ahemui list [--status <s>]... [--route <p>] [--type <t>] [--label <l>] [--area <a>] [--untriaged] [--all] [--json]
  ahemui show <id> [--json]
  ahemui add --prompt <text> [--source <file:line>] [--selector <css>] [--route <path>] [--shot <file>]
  ahemui claim <id> [--as <name>] [--force]
  ahemui resolve <id> [--done | --wontfix] [--sha <commit>] [--note <text>]   (default: review, if enabled)
  ahemui triage <id> [--type <t>] [--priority <p>] [--area <a>] [--label <l>]...
  ahemui reopen <id>
  ahemui note <id> <text>
  ahemui prune [--drop-shots <days>]
                                  move done/wontfix items to .ahemui/done/, optionally dropping old screenshots
  ahemui reply <id> <text>          answer Claude's question on an item
  ahemui approve <id> [--note <t>]  approve an item in review
  ahemui changes <id> --note <t>    send an item in review back with feedback
  ahemui wait [--timeout <sec>] [--as <name>]
                                  block until "Start now" items arrive, print them, exit 0 (3 on timeout)
  ahemui unwatch                    clear the "Claude is watching" presence
  ahemui update [--from <tgz>] [--force]
                                  install the newest AhemUI package into this project (used by /ahemui:update)
  ahemui clear [--archive] [--yes]  delete all backlog items (and with --archive, .ahemui/done/ too); setup stays
  ahemui --version

ids can be abbreviated to any unique prefix.
types: ${TYPES.join(", ")} · priorities: ${PRIORITIES.join(", ")}`;

const OPTIONS = {
  origin: { type: "string", multiple: true },
  port: { type: "string" },
  status: { type: "string", multiple: true },
  all: { type: "boolean" },
  json: { type: "boolean" },
  prompt: { type: "string" },
  source: { type: "string" },
  selector: { type: "string" },
  route: { type: "string" },
  shot: { type: "string" },
  as: { type: "string" },
  force: { type: "boolean" },
  wontfix: { type: "boolean" },
  done: { type: "boolean" },
  sha: { type: "string" },
  note: { type: "string" },
  type: { type: "string" },
  label: { type: "string", multiple: true },
  area: { type: "string" },
  priority: { type: "string" },
  untriaged: { type: "boolean" },
  timeout: { type: "string" },
  "drop-shots": { type: "string" },
  out: { type: "string" },
  "no-open": { type: "boolean" },
  archive: { type: "boolean" },
  from: { type: "string" },
  yes: { type: "boolean", short: "y" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

declare const __AHEMUI_VERSION__: string | undefined;
declare const __AHEMUI_BUILD__: string | undefined;

async function main(argv: string[]) {
  const { values: o, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const [cmd, ...args] = positionals;
  if (o.version) {
    const v = typeof __AHEMUI_VERSION__ === "string" ? __AHEMUI_VERSION__ : "dev";
    return console.log(`ahemui ${v}${typeof __AHEMUI_BUILD__ === "string" ? ` (build ${__AHEMUI_BUILD__})` : ""}`);
  }
  if (!cmd || o.help) return console.log(HELP);

  process.env.AHEMUI_AUTHOR ||= defaultAuthor();

  if (cmd === "init") {
    const store = await AhemStore.init(process.cwd(), {
      ...(o.origin && { devOrigins: o.origin }),
      ...(o.port && { port: Number(o.port) }),
    });
    return console.log(`initialized ${store.dir}`);
  }

  const store = AhemStore.find();
  const id = () => args[0] ?? fail(`usage: ahemui ${cmd} <id>`);

  switch (cmd) {
    case "serve": {
      const s = await serve(store, { port: o.port ? Number(o.port) : undefined });
      process.on("SIGINT", () => s.close().then(() => process.exit(0)));
      return;
    }
    case "board": {
      const running = await findServer(store);
      if (running) {
        console.log(`board: ${running}/`);
        if (!o["no-open"]) openInBrowser(`${running}/`);
        return;
      }
      const s = await serve(store, { port: o.port ? Number(o.port) : undefined });
      const url = `http://127.0.0.1:${s.port}/`;
      console.log(`board: ${url}  (Ctrl+C to stop)`);
      if (!o["no-open"]) openInBrowser(url);
      process.on("SIGINT", () => s.close().then(() => process.exit(0)));
      return;
    }
    case "export": {
      const file = await exportBoard(store, o.out);
      return console.log(`wrote ${file}`);
    }
    case "list": {
      const status = o.status?.map(parseStatus);
      const items = workOrder(
        await store.list({
          status,
          includeDone: o.all,
          route: o.route,
          type: o.type ? oneOf(o.type, TYPES, "type") : undefined,
          label: o.label?.[0],
          area: o.area,
          untriaged: o.untriaged,
        }),
      );
      if (o.json) return console.log(JSON.stringify(items, null, 2));
      if (items.length === 0) return console.log("no items");
      for (const it of items) console.log(summary(it));
      return;
    }
    case "show": {
      const it = await store.get(id());
      if (o.json) return console.log(JSON.stringify({ ...it, shotPath: store.shotPath(it) }, null, 2));
      return console.log(`${summary(it)}\n${details(it, store)}\n\n${it.body}`);
    }
    case "add": {
      if (!o.prompt) fail("add needs --prompt");
      const shot = o.shot ? await loadShot(o.shot) : undefined;
      const it = await store.create(
        { prompt: o.prompt!, route: o.route, anchor: { source: o.source, selector: o.selector } },
        shot,
      );
      return console.log(`added ${it.id}`);
    }
    case "claim":
      return console.log(summary(await store.claim(id(), o.as ?? process.env.AHEMUI_AUTHOR!, o.force)));
    case "resolve":
      return console.log(
        summary(await store.resolve(id(), { status: o.wontfix ? "wontfix" : o.done ? "done" : undefined, sha: o.sha, note: o.note })),
      );
    case "triage":
      return console.log(
        summary(
          await store.triage(id(), {
            type: o.type ? oneOf(o.type, TYPES, "type") : undefined,
            priority: o.priority ? oneOf(o.priority, PRIORITIES, "priority") : undefined,
            area: o.area,
            labels: o.label,
          }),
        ),
      );
    case "reopen":
      return console.log(summary(await store.reopen(id())));
    case "note": {
      const text = args.slice(1).join(" ");
      if (!text) fail("usage: ahemui note <id> <text>");
      return console.log(summary(await store.addNote(id(), process.env.AHEMUI_AUTHOR!, text)));
    }
    case "wait": {
      const items = await waitForStartNow(store, o.as ?? process.env.AHEMUI_AUTHOR!, o.timeout ? Number(o.timeout) * 1000 : 0);
      if (items === "stopped") {
        console.log("STOPPED watching was stopped from the browser");
        process.exit(4);
      }
      if (!items.length) {
        console.log("TIMEOUT no start-now items");
        process.exit(3);
      }
      for (const it of items) console.log(`START ${it.id} ${it.page?.routePattern ?? it.route ?? ""} — ${it.body.split("\n")[0].slice(0, 100)}`);
      return;
    }
    case "update": {
      const result = updateProject(store, { from: o.from, force: o.force });
      if (!result.apps.length) console.log("no package.json here depends on ahemui (was /ahemui:setup run?)");
      for (const app of result.apps) {
        const where = relative(store.root, app.dir) || ".";
        if (!app.ok) console.log(`✗ ${where}: install failed; see the output above`);
        else if (app.before === app.after) console.log(`✓ ${where}: already up to date (build ${app.after})`);
        else console.log(`✓ ${where}: updated ${app.before ?? "(not installed)"} → ${app.after}`);
      }
      const running = await findServer(store);
      if (running) {
        const health = await fetch(`${running}/api/health`).then((r) => r.json()).catch(() => null);
        const newest = result.apps.find((a) => a.after)?.after;
        if (health?.build && newest && health.build !== newest) {
          console.log(`\n! The dev server is still running AhemUI build ${health.build}. Restart it, then reload the page.`);
        }
      }
      return;
    }
    case "clear": {
      const active = await store.list();
      const archived = o.archive ? (await store.list({ includeDone: true })).filter((i) => i.location === "done") : [];
      if (!active.length && !archived.length) return console.log("backlog is already empty");
      const what = `${active.length} backlog item(s)${o.archive ? ` and ${archived.length} archived item(s)` : ""}`;
      if (!o.yes) {
        console.log(`would delete ${what} from ${store.dir}:`);
        for (const it of [...active, ...archived]) console.log(`  ${summary(it)}`);
        console.log("\nrun again with --yes to delete them (committed items can be restored from git)");
        return;
      }
      await store.setWatcher(null);
      const removed = await store.clear({ archive: o.archive });
      return console.log(`deleted ${removed.length} item(s): ${what}`);
    }
    case "unwatch":
      await store.setWatcher(null);
      await store.setWatchControl(null);
      return console.log("no longer watching");
    case "prune": {
      const { moved, shotsDropped } = await store.prune({ dropShotsOlderThanDays: o["drop-shots"] ? Number(o["drop-shots"]) : undefined });
      console.log(moved.length ? `moved ${moved.length} item(s) to .ahemui/done/` : "nothing to archive");
      if (shotsDropped) console.log(`removed ${shotsDropped} old screenshot(s) from archived items`);
      return;
    }
    case "reply": {
      const text = args.slice(1).join(" ");
      if (!text) fail("usage: ahemui reply <id> <text>");
      return console.log(summary(await store.reply(id(), process.env.AHEMUI_AUTHOR!, text)));
    }
    case "approve":
      return console.log(summary(await store.review(id(), process.env.AHEMUI_AUTHOR!, "approved", o.note)));
    case "changes":
      if (!o.note) fail("usage: ahemui changes <id> --note <what should change>");
      return console.log(summary(await store.review(id(), process.env.AHEMUI_AUTHOR!, "changes", o.note)));
    default:
      fail(`unknown command "${cmd}"\n\n${HELP}`);
  }
}

const MARK: Record<Status, string> = { open: "○", "in-progress": "◐", review: "◎", done: "✓", wontfix: "✗" };
const nowMark = (it: Item) => (it.start === "now" && it.status === "open" ? "⚡" : " ");

function summary(it: Item): string {
  const where = it.anchor.source ?? it.page?.routePattern ?? it.route ?? "";
  const cls = [it.type, it.priority === "high" ? "!" : "", it.area].filter(Boolean).join(" ");
  const first = it.body.split("\n")[0].slice(0, 72);
  return `${MARK[it.status]}${nowMark(it)}${it.id.slice(0, 14)}  ${it.status.padEnd(11)} ${(cls || "-").padEnd(24)} ${where.padEnd(36)} ${first}`;
}

/** The running ahemui serve for this repo, if any (it may live inside the Vite dev server). */
async function findServer(store: AhemStore): Promise<string | null> {
  const { port } = await store.config();
  for (let p = port; p < port + 10; p++) {
    const base = `http://127.0.0.1:${p}`;
    const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) })
      .then((r) => r.json())
      .catch(() => null);
    if (health?.name === "ahemui" && health.root === store.root) return base;
  }
  return null;
}

function oneOf<T extends string>(value: string, allowed: readonly T[], what: string): T {
  if (!(allowed as readonly string[]).includes(value)) fail(`${what} must be one of ${allowed.join(", ")}`);
  return value as T;
}

function details(it: Item, store: AhemStore): string {
  const lines = [
    `author: ${it.author}   created: ${it.created}${it.claimed_by ? `   claimed by: ${it.claimed_by}` : ""}`,
    (it.type || it.area || it.labels?.length || it.priority) &&
      `triage: ${[it.type, it.priority, it.area, ...(it.labels ?? []).map((l) => `#${l}`)].filter(Boolean).join(" · ")}`,
    it.route && `route: ${it.route}${it.viewport ? `  (${it.viewport})` : ""}`,
    it.page && `page: ${[it.page.heading ?? it.page.title, it.page.routeName && `route "${it.page.routeName}"`, it.page.routePattern, it.page.section && `› ${it.page.section}`, it.page.env].filter(Boolean).join(" · ")}`,
    it.anchor.components?.length && `components: ${it.anchor.components.join(" > ")}`,
    it.anchor.selector && `selector: ${it.anchor.selector}`,
    it.anchor.text && `text: "${it.anchor.text}"`,
    store.shotPath(it) && `shot: ${store.shotPath(it)}`,
    it.resolved_by && `resolved by: ${it.resolved_by}`,
  ];
  return lines.filter(Boolean).join("\n");
}

function parseStatus(s: string): Status {
  if (!(STATUSES as readonly string[]).includes(s)) fail(`status must be one of ${STATUSES.join(", ")}`);
  return s as Status;
}

async function loadShot(path: string): Promise<Shot> {
  const ext = extname(path).slice(1).toLowerCase().replace("jpeg", "jpg");
  if (ext !== "webp" && ext !== "png" && ext !== "jpg") fail("--shot must be .webp, .png or .jpg");
  return { data: await readFile(path), ext: ext as Shot["ext"] };
}


function fail(msg: string): never {
  throw new AhemError(msg);
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof AhemError ? `ahemui: ${err.message}` : err);
  process.exit(1);
});
