// The one live thing on the home page: replays the noise-to-host demo in the
// showcase section. Purely illustrative — labelled as such on the page.
(() => {
  "use strict";

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const noiseEl = document.getElementById("noise-number");
  const hostEl = document.getElementById("host-number");
  const replayBtn = document.getElementById("replay-capture");
  if (!noiseEl || !hostEl || !replayBtn) return;

  let running = false;

  function play() {
    if (running) return;
    running = true;
    replayBtn.disabled = true;
    hostEl.classList.remove("settled");

    if (reduced) {
      noiseEl.textContent = "214";
      setTimeout(() => {
        hostEl.classList.add("settled");
        running = false;
        replayBtn.disabled = false;
      }, 300);
      return;
    }

    const counts = [58, 143, 97, 201, 176, 214];
    let i = 0;
    const tick = setInterval(() => {
      noiseEl.textContent = String(counts[i % counts.length]);
      i += 1;
      if (i >= 9) {
        clearInterval(tick);
        noiseEl.textContent = "214";
        hostEl.classList.add("settled");
        running = false;
        replayBtn.disabled = false;
      }
    }, 90);
  }

  replayBtn.addEventListener("click", play);

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          play();
          io.disconnect();
        }
      });
    },
    { threshold: 0.5 }
  );
  io.observe(document.querySelector(".showcase"));
})();
