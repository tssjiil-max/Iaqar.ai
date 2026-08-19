/**
 * Responsive header: compact on load, ultra-thin bar while scrolling.
 */

function bindHeaderScroll() {
  const header = document.querySelector(".app > .header");
  if (!header || header.dataset.scrollBound === "1") return;
  header.dataset.scrollBound = "1";

  let ticking = false;
  const update = () => {
    ticking = false;
    const scrolled = window.scrollY > 8;
    header.classList.toggle("is-scrolled", scrolled);
  };

  update();
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  }, { passive: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindHeaderScroll);
} else {
  bindHeaderScroll();
}
