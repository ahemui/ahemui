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
