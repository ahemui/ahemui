/**
 * Two-step confirm for a destructive button next to the main action. The first click turns it red with a short
 * label ("Confirm") for 4 s; only a second click inside that window goes through. The button keeps its width, so
 * nothing around it moves, and moving the pointer doesn't cancel it (only time does).
 */
export function armDanger(b: HTMLButtonElement, label = "Confirm"): boolean {
  if (b.classList.contains("armed")) return true;
  const original = b.innerHTML;
  const originalLabel = b.getAttribute("aria-label");
  b.style.minWidth = `${b.offsetWidth}px`;
  b.classList.add("armed");
  b.textContent = label;
  b.setAttribute("aria-label", `${label}: click again to dismiss`);
  setTimeout(() => {
    if (!b.isConnected) return;
    b.classList.remove("armed");
    b.innerHTML = original;
    b.style.minWidth = "";
    if (originalLabel) b.setAttribute("aria-label", originalLabel);
    else b.removeAttribute("aria-label");
  }, 4000);
  return false;
}

/** True while some button in `root` is armed, so live re-renders can wait instead of wiping it. */
export const hasArmed = (root: ParentNode) => !!root.querySelector(".armed");
