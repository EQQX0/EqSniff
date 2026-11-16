// Shared entrance-motion helper: staggers [data-reveal] children into view once,
// and powers the masked-headline split on [data-mask-lines]. No-op under reduced motion.
(() => {
  "use strict";

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function splitMaskLines() {
    document.querySelectorAll("[data-mask-lines]").forEach((el) => {
      const lines = el.querySelectorAll(":scope > span");
      lines.forEach((line, i) => {
        line.style.display = "block";
        line.style.overflow = "hidden";
        const inner = document.createElement("span");
        inner.style.display = "block";
        inner.style.transform = reduced ? "none" : "translateY(110%)";
        inner.style.transition = reduced ? "none" : `transform 900ms var(--ease-out) ${i * 110}ms`;
        inner.textContent = line.textContent;
        line.textContent = "";
        line.appendChild(inner);
        requestAnimationFrame(() => requestAnimationFrame(() => { inner.style.transform = "translateY(0)"; }));
      });
    });
  }

  function wireReveal() {
    if (reduced) {
      document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
      return;
    }
    const groups = document.querySelectorAll("[data-reveal]");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const items = entry.target.querySelectorAll(".reveal");
          items.forEach((el, i) => {
            el.style.transitionDelay = `${i * 70}ms`;
            el.classList.add("in");
          });
          io.unobserve(entry.target);
        });
      },
      { threshold: 0.2 }
    );
    groups.forEach((g) => io.observe(g));
  }

  document.addEventListener("DOMContentLoaded", () => {
    splitMaskLines();
    wireReveal();
  });
})();
