/**
 * Two-step confirm for destructive buttons sitting next to the main action: the first click turns the button into
 * a red "Dismiss?" for 3 s (or until the pointer leaves it); only a second click inside that window goes through.
 */
export function armDanger(b: HTMLButtonElement, label: string): boolean {
  if (b.classList.contains("armed")) return true;
  const original = b.innerHTML;
  const originalLabel = b.getAttribute("aria-label");
  b.classList.add("armed");
  b.textContent = label;
  b.setAttribute("aria-label", `${label} Click again to confirm`);
  const disarm = () => {
    clearTimeout(timer);
    b.removeEventListener("mouseleave", disarm);
    b.removeEventListener("blur", disarm);
    if (!b.isConnected) return;
    b.classList.remove("armed");
    b.innerHTML = original;
    if (originalLabel) b.setAttribute("aria-label", originalLabel);
    else b.removeAttribute("aria-label");
  };
  const timer = setTimeout(disarm, 3000);
  b.addEventListener("mouseleave", disarm);
  b.addEventListener("blur", disarm);
  return false;
}
