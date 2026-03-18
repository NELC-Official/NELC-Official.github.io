/**
 * 皮肤列表在 /css/skins/skins.json
 * 默认皮肤：paper（id = "paper"）
 * "Butterfly 默认" 选项：id = "__butterfly__"，不加载任何 skin CSS
 */

(function () {
  "use strict";

  /* ─── 配置 ─────────────────────────────────────────── */
  const SKINS_DIR = "/css/skins/";
  const SKINS_JSON = SKINS_DIR + "skins.json";
  const LINK_ID = "active-skin-css"; // <link> 标签的 id
  const STORAGE_KEY = "butterfly-skin"; // localStorage key
  const DEFAULT_SKIN_ID = "paper"; // 首次访问时的默认皮肤
  const BUTTERFLY_ID = "__butterfly__"; // "Butterfly 默认" 伪皮肤

  /* ─── 内部状态 ──────────────────────────────────────── */
  let skinsData = []; // 从 JSON 加载的皮肤列表
  let panelEl = null; // 浮层 DOM 节点
  let isOpen = false;

  /* ═══════════════════════════════════════════════════════
     1. 工具函数
  ══════════════════════════════════════════════════════════ */

  /** 读取当前已保存的皮肤 id（首次访问返回默认值） */
  function getSavedId() {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_SKIN_ID;
  }

  /** 保存皮肤 id 到 localStorage */
  function saveId(id) {
    localStorage.setItem(STORAGE_KEY, id);
  }

  /**
   * 应用皮肤：
   *   - id === BUTTERFLY_ID → 移除 <link>（不加载任何 skin CSS）
   *   - 否则 → 懒加载对应 CSS，替换旧 <link>
   */
  function applySkin(id) {
    const existing = document.getElementById(LINK_ID);

    if (id === BUTTERFLY_ID) {
      // 移除当前 skin CSS（如果存在的话）
      if (existing) existing.remove();
      return;
    }

    const skin = skinsData.find((s) => s.id === id);
    if (!skin) return;

    const href = SKINS_DIR + skin.file;

    if (existing) {
      // 已有 <link>：直接替换 href（浏览器会自动加载新 CSS）
      if (existing.getAttribute("href") === href) return; // 已是当前皮肤，跳过
      existing.setAttribute("href", href);
    } else {
      // 首次：创建 <link> 并插入 <head>
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.id = LINK_ID;
      link.href = href;
      document.head.appendChild(link);
    }
  }

  /* ═══════════════════════════════════════════════════════
     2. 面板 UI
  ══════════════════════════════════════════════════════════ */

  function buildPanel() {
    if (panelEl) return; // 已建过

    const panel = document.createElement("div");
    panel.id = "skin-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "皮肤选择");
    panel.innerHTML = `
      <div class="skin-panel-header">
        <span class="skin-panel-title">选择皮肤</span>
        <button class="skin-panel-close" aria-label="关闭" title="关闭">✕</button>
      </div>
      <ul class="skin-list" role="listbox"></ul>
    `;

    /* 样式（注入一次） */
    injectStyles();

    /* 关闭按钮 */
    panel
      .querySelector(".skin-panel-close")
      .addEventListener("click", closePanel);

    /* 皮肤列表 */
    const ul = panel.querySelector(".skin-list");
    const current = getSavedId();

    // "Butterfly 默认" 选项（置首）
    ul.appendChild(
      buildItem({ id: BUTTERFLY_ID, name: "Butterfly 默认" }, current),
    );

    // 来自 JSON 的皮肤
    skinsData.forEach((skin) => {
      ul.appendChild(buildItem(skin, current));
    });

    document.body.appendChild(panel);
    panelEl = panel;
  }

  function buildItem(skin, currentId) {
    const li = document.createElement("li");
    li.className =
      "skin-item" + (skin.id === currentId ? " skin-item--active" : "");
    li.dataset.id = skin.id;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", skin.id === currentId ? "true" : "false");
    li.textContent = skin.name;

    li.addEventListener("click", () => {
      selectSkin(skin.id);
    });

    return li;
  }

  function selectSkin(id) {
    saveId(id);
    applySkin(id);
    updateActiveItem(id);
    closePanel();
  }

  function updateActiveItem(id) {
    if (!panelEl) return;
    panelEl.querySelectorAll(".skin-item").forEach((el) => {
      const active = el.dataset.id === id;
      el.classList.toggle("skin-item--active", active);
      el.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  /* ─── 开 / 关面板 ─────────────────────────────────── */

  function openPanel() {
    buildPanel(); // 懒建
    panelEl.classList.add("skin-panel--open");
    isOpen = true;

    // 定位到按钮下方
    positionPanel();

    // 点击外部关闭
    setTimeout(() => {
      document.addEventListener("click", outsideClickHandler, {
        once: true,
        capture: true,
      });
    }, 0);
  }

  function closePanel() {
    if (!panelEl) return;
    panelEl.classList.remove("skin-panel--open");
    isOpen = false;
  }

  function togglePanel() {
    isOpen ? closePanel() : openPanel();
  }

  function outsideClickHandler(e) {
    if (
      panelEl &&
      !panelEl.contains(e.target) &&
      e.target.id !== "skin-toggle"
    ) {
      closePanel();
    }
  }

  function positionPanel() {
    const btn = document.getElementById("skin-toggle");
    if (!btn || !panelEl) return;

    const rect = btn.getBoundingClientRect();
    const panelW = 200;

    // 面板右边缘与按钮右边缘对齐，再额外向左偏移 50px 避开工具栏
    const TOOLBAR_OFFSET = 50; // 额外向左让开工具栏的距离
    const right = window.innerWidth - rect.right + TOOLBAR_OFFSET;

    // 面板出现在按钮上方，留 8px 间距
    const bottom = window.innerHeight - rect.top;

    panelEl.style.right = right + "px";
    panelEl.style.bottom = bottom + "px";
    panelEl.style.left = ""; // 清除可能残留的 left 值
    panelEl.style.top = ""; // 清除可能残留的 top 值
  }

  /* ═══════════════════════════════════════════════════════
     3. 样式注入
  ══════════════════════════════════════════════════════════ */

  function injectStyles() {
    if (document.getElementById("skin-switcher-style")) return;

    const style = document.createElement("style");
    style.id = "skin-switcher-style";
    style.textContent = `
      #skin-panel {
        position: fixed;
        z-index: 99999;
        width: 200px;
        background: var(--card-bg, #fff);
        border: 1px solid var(--card-border-color, #e0e0e0);
        border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0,0,0,.12);
        overflow: hidden;
        opacity: 0;
        transform: translateY(6px) scale(.97);
        pointer-events: none;
        transition: opacity .18s ease, transform .18s ease;
      }
      #skin-panel.skin-panel--open {
        opacity: 1;
        transform: translateY(0) scale(1);
        pointer-events: auto;
      }
      .skin-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px 8px;
        border-bottom: 1px solid var(--card-border-color, #e8e8e8);
      }
      .skin-panel-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--font-color, #333);
        letter-spacing: .02em;
      }
      .skin-panel-close {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 13px;
        color: var(--font-color, #888);
        padding: 0 2px;
        line-height: 1;
        opacity: .6;
        transition: opacity .15s;
      }
      .skin-panel-close:hover { opacity: 1; }

      .skin-list {
        list-style: none;
        margin: 0;
        padding: 6px 0;
        max-height: 320px;
        overflow-y: auto;
      }
      .skin-item {
        padding: 8px 16px;
        font-size: 13px;
        color: var(--font-color, #444);
        cursor: pointer;
        transition: background .12s, color .12s;
        position: relative;
      }
      .skin-item:hover {
        background: var(--hover-bg, rgba(0,0,0,.05));
      }
      .skin-item--active {
        color: var(--theme-color, #49b1f5);
        font-weight: 600;
      }
      .skin-item--active::after {
        content: '✓';
        position: absolute;
        right: 14px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 12px;
        color: var(--theme-color, #49b1f5);
      }
    `;
    document.head.appendChild(style);
  }

  /* ═══════════════════════════════════════════════════════
     4. 初始化
  ══════════════════════════════════════════════════════════ */

  async function init() {
    /* 4-1. 加载 skins.json */
    try {
      const res = await fetch(SKINS_JSON);
      if (!res.ok) throw new Error("skins.json 加载失败: " + res.status);
      skinsData = await res.json();
    } catch (err) {
      console.warn("[skin-switcher]", err);
      skinsData = [];
    }

    /* 4-2. 应用上次保存的皮肤（懒加载：只加载用户选中的那一个） */
    const savedId = getSavedId();
    applySkin(savedId);

    /* 4-3. 绑定按钮 */
    const btn = document.getElementById("skin-toggle");
    if (!btn) {
      console.warn("[skin-switcher] 找不到 #skin-toggle 按钮");
      return;
    }
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePanel();
    });

    /* 4-4. 窗口尺寸变化时重定位 */
    window.addEventListener("resize", () => {
      if (isOpen) positionPanel();
    });
  }

  /* ─── 等待 DOM 就绪后启动 ─────────────────────────── */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
