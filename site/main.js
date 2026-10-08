// Sections fade up as they come into view; items in a row follow one another.
document.documentElement.classList.add("js");
if ("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const seen = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("in");
        seen.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
  );
  const groups = ".gains, .trio, .steps, .grid, .vs-grid, .flow, .ticks";
  for (const el of document.querySelectorAll(`main > section:not(.hero) .wrap > *:not(${groups}), ${groups.split(", ").map((g) => g + " > *").join(", ")}`)) {
    const row = el.parentElement.matches(groups) ? [...el.parentElement.children].indexOf(el) : 0;
    el.style.setProperty("--d", `${Math.min(row, 6) * 0.07}s`);
    el.classList.add("reveal");
    seen.observe(el);
  }
  seen.observe(document.querySelector(".final"));
} else {
  document.querySelector(".final")?.classList.add("in");
}

// Copy buttons
for (const line of document.querySelectorAll(".copyline")) {
  const button = line.querySelector("button");
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(line.dataset.copy);
      button.textContent = "Copied";
      button.classList.add("done");
      setTimeout(() => {
        button.textContent = "Copy";
        button.classList.remove("done");
      }, 1600);
    } catch {
      /* clipboard blocked; the command is still selectable */
    }
  });
}

// ——— hero demo: lasso → request → Claude works it → review → approve ———

const $ = (id) => document.getElementById(id);
const page = $("demo-page");
const target = $("demo-target");
const lasso = $("demo-lasso");
const marker = $("demo-marker");
const bubble = $("demo-bubble");
const typed = $("demo-typed");
const pop = $("demo-pop");
const toast = $("demo-toast");
const term = $("demo-term");
const REQUEST = 'Make this full width and say "Deploy to production"';
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rel = (el) => {
  const p = page.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left - p.left, y: r.top - p.top, w: r.width, h: r.height };
};

function place() {
  const t = rel(target);
  const pad = 14;
  Object.assign(lasso.style, { left: `${t.x - pad}px`, top: `${t.y - pad}px`, width: `${t.w + pad * 2}px`, height: `${t.h + pad * 2}px` });
  Object.assign(marker.style, { left: `${t.x + t.w - 10}px`, top: `${t.y - 12}px` });
  const pw = page.clientWidth;
  const ph = page.clientHeight;
  const bw = bubble.offsetWidth || 270;
  const bh = bubble.offsetHeight || 110;
  Object.assign(bubble.style, {
    left: `${Math.max(8, Math.min(t.x + t.w / 2 - bw / 2, pw - bw - 8))}px`,
    top: `${Math.min(t.y + t.h + pad + 10, ph - bh - 8)}px`,
  });
  const popw = pop.offsetWidth || 252;
  const right = t.x + t.w + 16;
  Object.assign(pop.style, {
    left: `${right + popw < pw ? right : Math.max(8, t.x - popw - 16)}px`,
    top: `${Math.max(8, Math.min(t.y - 30, ph - (pop.offsetHeight || 120) - 8))}px`,
  });
}

function line(html) {
  term.insertAdjacentHTML("beforeend", html + "\n");
}

function setMarker(state, text) {
  marker.className = `marker show ${state}`;
  marker.textContent = text;
}

function showToast(text) {
  toast.textContent = text;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 1800);
}

function reset() {
  target.classList.remove("fixed");
  target.textContent = "Deploy";
  marker.className = "marker";
  lasso.classList.remove("draw");
  bubble.classList.remove("show");
  pop.classList.remove("show");
  typed.textContent = "";
  term.innerHTML = "";
  line('<span class="t-cmd">&gt; /ahemui:watch</span>');
  line("Watching for ⚡ Start now… (you can keep chatting)");
}

function finalState() {
  term.innerHTML = "";
  line('<span class="t-cmd">&gt; /ahemui:watch</span>');
  line(`<span class="t-acc">START</span> 01J9Z /projects: ${REQUEST}`);
  line("Reading src/components/ProjectCard.vue:14");
  line("Editing ProjectCard.vue  <span class=\"t-ok\">+3</span> <span class=\"t-warn\">−1</span>");
  line('<span class="t-ok">✓</span> ahemui_resolve → review');
  line('<span class="t-ok">✓</span> Approved by you');
  target.classList.add("fixed");
  target.textContent = "Deploy to production";
  place();
  setMarker("done", "✓");
}

async function run() {
  for (;;) {
    reset();
    place();
    await sleep(900);
    lasso.classList.add("draw");
    await sleep(1300);
    bubble.classList.add("show");
    place();
    for (const ch of REQUEST) {
      typed.textContent += ch;
      await sleep(34);
    }
    await sleep(500);
    bubble.querySelector(".go").classList.add("press");
    await sleep(220);
    bubble.querySelector(".go").classList.remove("press");
    bubble.classList.remove("show");
    lasso.classList.remove("draw");
    setMarker("", "⚡");
    showToast("⚡ Claude is starting on it");
    await sleep(700);
    line(`<span class="t-acc">START</span> 01J9Z /projects: ${REQUEST}`);
    await sleep(500);
    setMarker("doing", "◐");
    line("Reading src/components/ProjectCard.vue:14");
    await sleep(1100);
    line("Editing ProjectCard.vue  <span class=\"t-ok\">+3</span> <span class=\"t-warn\">−1</span>");
    await sleep(700);
    target.classList.add("fixed");
    target.textContent = "Deploy to production";
    place();
    await sleep(600);
    line('<span class="t-ok">✓</span> ahemui_resolve → review');
    line("Committed: ahemui: full-width deploy button");
    setMarker("review", "◎");
    await sleep(600);
    place();
    pop.classList.add("show");
    await sleep(1700);
    pop.querySelector(".ok").classList.add("press");
    await sleep(220);
    pop.querySelector(".ok").classList.remove("press");
    pop.classList.remove("show");
    setMarker("done", "✓");
    showToast("Approved ✓");
    line('<span class="t-ok">✓</span> Approved by you');
    await sleep(3200);
  }
}

addEventListener("resize", place);
if (reduced) finalState();
else run();

// ——— living illustrations: each runs only while on screen, and not at all with reduced motion ———

function whileVisible(el, start, stop = () => {}) {
  if (!el || reduced || !("IntersectionObserver" in window)) return;
  let on = false;
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !on) { on = true; start(); }
    else if (!e.isIntersecting && on) { on = false; stop(); }
  }, { threshold: 0.35 }).observe(el);
}

// 1. The tally: notes move through backlog → in progress → review → done, and the count keeps up.
(() => {
  const box = document.querySelector(".vis.tally");
  if (!box) return;
  const rows = [...box.querySelectorAll(".row")];
  const count = box.querySelector(".tally-head span:last-child");
  const STAGES = [["open", "backlog"], ["doing", "in progress"], ["review", "review"], ["done", "done"]];
  const initial = rows.map((r) => STAGES.findIndex(([, label]) => label === r.querySelector("em").textContent));
  let stage = [...initial];
  let timer;
  const paint = () => {
    rows.forEach((r, i) => {
      const [cls, label] = STAGES[stage[i]];
      r.querySelector(".dot").className = `dot ${cls}`;
      r.querySelector("em").textContent = label;
      r.classList.toggle("fin", cls === "done");
    });
    const done = stage.filter((s) => s === 3).length;
    count.textContent = done === rows.length ? `${rows.length} items · all done` : `${rows.length} items · ${done} done`;
  };
  const tick = () => {
    const next = stage.map((s, i) => [s, i]).filter(([s]) => s < 3).sort((a, b) => b[0] - a[0])[0];
    if (!next) {
      timer = setTimeout(() => { stage = [...initial]; paint(); timer = setTimeout(tick, 1400); }, 2200);
      return;
    }
    stage[next[1]]++;
    const row = rows[next[1]];
    row.classList.remove("bump"); void row.offsetWidth; row.classList.add("bump");
    paint();
    timer = setTimeout(tick, 1100);
  };
  whileVisible(box, () => { paint(); timer = setTimeout(tick, 900); }, () => clearTimeout(timer));
})();

// 2. Feedback with receipts: the item file writes itself, the way a capture lands in the repo.
(() => {
  const pre = document.querySelector(".receipts .file pre");
  const code = pre?.querySelector("code");
  if (!code) return;
  const lines = code.innerHTML.split("\n");
  let played = false;
  whileVisible(pre, async () => {
    if (played) return;
    played = true;
    pre.style.minHeight = `${pre.offsetHeight}px`;
    code.innerHTML = "";
    for (let i = 0; i < lines.length; i++) {
      code.innerHTML = lines.slice(0, i + 1).join("\n") + '<span class="type-caret"></span>';
      await sleep(lines[i].trim() === "---" ? 380 : 75);
    }
    await sleep(900);
    code.innerHTML = lines.join("\n");
  });
})();

// 3. Trackers: a capture travels browser → repo → Claude Code → your tracker; the ticket moves along.
(() => {
  const flow = document.querySelector(".flow");
  const ticket = document.querySelector(".ticket");
  if (!flow || !ticket) return;
  const nodes = [...flow.querySelectorAll(".node")];
  const arrows = [...flow.querySelectorAll(".arrow")];
  const state = ticket.querySelector(".state");
  const STATES = ["Todo", "In progress", "In review"];
  let n = 0;
  let round = 0;
  let timer;
  const step = () => {
    nodes.forEach((el, i) => el.classList.toggle("lit", i === n));
    arrows.forEach((el, i) => el.classList.toggle("lit", i === n - 1));
    if (n === nodes.length - 1) {
      state.textContent = STATES[round % STATES.length];
      ticket.classList.remove("ping"); void ticket.offsetWidth; ticket.classList.add("ping");
      round++;
    }
    n = (n + 1) % nodes.length;
    timer = setTimeout(step, n === 0 ? 1900 : 800);
  };
  whileVisible(flow, () => { timer = setTimeout(step, 400); }, () => {
    clearTimeout(timer);
    nodes.forEach((el) => el.classList.remove("lit"));
    arrows.forEach((el) => el.classList.remove("lit"));
  });
})();

// 4. How it works: a progress line runs across the four steps, lighting each in turn.
(() => {
  const steps = document.querySelector(".steps");
  if (!steps) return;
  const items = [...steps.children];
  let i = 0;
  let timer;
  const step = () => {
    items.forEach((el, k) => el.classList.toggle("on", k === i));
    steps.style.setProperty("--p", `${((i + 1) / items.length) * 100}%`);
    i = (i + 1) % items.length;
    timer = setTimeout(step, i === 0 ? 2600 : 1700);
  };
  steps.classList.add("animated");
  whileVisible(steps, step, () => clearTimeout(timer));
})();
