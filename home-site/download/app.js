(() => {
  "use strict";
  fetch("/updates/update.json")
    .then((r) => r.json())
    .then((data) => {
      if (data.version) document.getElementById("version").textContent = "Version " + data.version;
      if (data.sha256) {
        const hash = document.getElementById("hash");
        hash.hidden = false;
        hash.querySelector("code").textContent = data.sha256;
      }
    })
    .catch(() => {
      document.getElementById("version").textContent = "EqNetwork for Windows";
    });
})();
