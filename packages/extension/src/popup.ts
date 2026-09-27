import type { PopupState, Reply, Server } from "./messages.js";

const app = document.getElementById("app")!;
let tabId: number;

async function send<T>(msg: Record<string, unknown>): Promise<T> {
  const reply: Reply<T> = await chrome.runtime.sendMessage(msg);
  if ("error" in reply) throw new Error(reply.error);
  return reply.data;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function render(state: PopupState) {
  document.getElementById("site")!.textContent = state.origin ?? "";
  if (!state.origin) {
    app.innerHTML = `<section class="muted">Snap can't run on this page. Open your app in a normal http(s) tab.</section>`;
    return;
  }

  const auto = state.choice === null;
  const serverRow = (s: Server) => `
    <label class="opt">
      <input type="radio" name="project" value="${esc(s.root)}" ${state.choice === s.root || (auto && state.active?.root === s.root) ? "checked" : ""}>
      <span><span class="name">${esc(s.project)}</span>${s.branch ? ` <span class="muted">· ${esc(s.branch)}</span>` : ""}
        <div class="sub">${esc(s.root)} · :${s.base.split(":").pop()}${auto && state.active?.root === s.root ? " · auto (listed in devOrigins)" : ""}</div></span>
    </label>`;

  const choiceMissing = state.choice && state.choice !== "none" && !state.servers.some((s) => s.root === state.choice);
  const projects = state.servers.length
    ? state.servers.map(serverRow).join("")
    : `<div class="muted">No Snap projects running. In your repo run <code>npx snap serve</code> or start <code>vite dev</code> with the Snap plugin.</div>`;

  app.innerHTML = `
    <section>
      <h2>Send feedback from this site to</h2>
      ${projects}
      ${choiceMissing ? `<div class="warn">Chosen project (${esc(state.choice!)}) isn't running right now.</div>` : ""}
      <label class="opt"><input type="radio" name="project" value="none" ${state.choice === "none" || (auto && !state.active) ? "checked" : ""}>
        <span><span class="name">None</span><div class="sub">Snap stays hidden on this site</div></span></label>
    </section>
    <section>
      ${
        state.builtIn
          ? `<div class="muted">Local dev site: Snap is always available here.</div>`
          : `<label class="switch"><span><span class="name">Enable Snap on ${esc(new URL(state.origin).hostname)}</span>
               <div class="sub">For deployed dev, staging or prod. Page scripts can't see Snap or your backlog.</div></span>
               <input type="checkbox" id="enabled" ${state.enabled ? "checked" : ""}></label>`
      }
    </section>
    <section>
      <button class="primary" id="capture" ${state.enabled && state.active ? "" : "disabled"}>Capture feedback <span class="muted" style="color:#ddd">Alt+Shift+S</span></button>
      <div class="status"><span class="dot ${state.active ? "ok" : ""}"></span>${
        state.active ? `Connected to ${esc(state.active.project)} on :${state.active.base.split(":").pop()}` : "Not connected"
      }${state.active ? ` · <a href="${esc(state.active.base)}/" target="_blank">Open backlog board ↗</a>` : ""}</div>
    </section>`;

  app.querySelectorAll<HTMLInputElement>('input[name="project"]').forEach((input) =>
    input.addEventListener("change", async () => {
      render(await send<PopupState>({ type: "set-project", tabId, origin: state.origin, root: input.value }));
    }),
  );
  app.querySelector<HTMLInputElement>("#enabled")?.addEventListener("change", async (e) => {
    const enabled = (e.target as HTMLInputElement).checked;
    try {
      render(await send<PopupState>({ type: "set-enabled", tabId, origin: state.origin, enabled }));
    } catch (err) {
      app.insertAdjacentHTML("beforeend", `<section class="warn">${esc((err as Error).message)}</section>`);
    }
  });
  app.querySelector("#capture")?.addEventListener("click", async () => {
    await send({ type: "toggle", tabId }).catch(() => {});
    window.close();
  });
}

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab.id!;
  render(await send<PopupState>({ type: "popup-state", tabId }));
})();
