(() => {
  const FADE_DURATION = 400;

  function fadeIn() {
    document.documentElement.classList.add("loaded");
    document.body.style.opacity = "";
  }

  window.addEventListener("load", fadeIn);

  // 页面加载淡入
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) {
      fadeIn();
    }
  });

  document.addEventListener(
    "click",
    (e) => {
      const a = e.target.closest("a");
      if (!a || !a.href || a.target === "_blank") return;
      if (a.getAttribute("href").startsWith("#") || a.hasAttribute("download"))
        return;

      const url = new URL(a.href);
      if (url.origin !== location.origin) return;

      e.preventDefault();

      document.body.style.transition = `opacity ${FADE_DURATION}ms`;
      document.body.style.opacity = 0;

      setTimeout(() => {
        window.location.href = a.href;
      }, FADE_DURATION);
    },
    true,
  );
})();
