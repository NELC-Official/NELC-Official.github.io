(function () {
  // 等待 DOM 准备
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }

  function main() {
    // ========== 资源/帧定义 ==========
    const S = [
      "/image/mini_neuro/S_look_ahead.svg",
      "/image/mini_neuro/S_look_you.svg",
    ]; // 静止
    const C = ["/image/mini_neuro/C1.svg", "/image/mini_neuro/C2.svg"]; // 眨眼两帧（C1 -> C2）
    const W = [
      "/image/mini_neuro/W1.svg",
      "/image/mini_neuro/W2.svg",
      "/image/mini_neuro/W3.svg",
      "/image/mini_neuro/W4.svg",
    ]; // 行走四帧，必须从 W1 开始并在 W1 时切换回 S

    // ========== 创建或获取 DOM ==========
    // 如果都已经有了
    let puppet = document.getElementById("puppet");
    let sprite = document.getElementById("sprite");
    let bubble = document.getElementById("bubble");
    let loadUI = document.getElementById("load-ui");
    let fileInput = null;
    let btnLoad = null;

    // 如果没有
    if (!puppet) {
      puppet = document.createElement("div");
      puppet.id = "puppet";
      puppet.setAttribute("aria-label", "puppet");
      // 插入到 body 末尾
      document.body.appendChild(puppet);
    }
    if (!sprite) {
      sprite = document.createElement("img");
      sprite.id = "sprite";
      sprite.alt = "puppet";
      sprite.draggable = false;
      // 默认 src 会由 init() 设置
      puppet.appendChild(sprite);
    }
    if (!bubble) {
      bubble = document.createElement("div");
      bubble.id = "bubble";
      bubble.setAttribute("role", "tooltip");
      bubble.setAttribute("aria-hidden", "true");
      document.body.appendChild(bubble);
    }
    if (!loadUI) {
      loadUI = document.createElement("div");
      loadUI.id = "load-ui";
      loadUI.innerHTML = `
        mini_neuro_sentence.json 加载失败或被浏览器阻止。
        <input id="fileinput" type="file" accept="application/json" style="display:none" />
        <button id="btnLoad">从本地选择 JSON</button>
      `;
      document.body.appendChild(loadUI);
    }

    // 安全获取 fileInput / btnLoad
    fileInput = document.getElementById("fileinput");
    btnLoad = document.getElementById("btnLoad");

    // ========== 状态 ==========
    let state = "standing"; // 'standing' | 'blinking' | 'walking'
    let currentS = 0; // index into S
    let walkIndex = 0; // 0..3 -> W[walkIndex]
    // 素材本身朝左，facing='left' 表示不翻转；facing='right' 时添加 .facing-right 翻转
    let facing = "right";

    // 位置与速度
    let x = 8;
    let speed = 1.6; // px per tick (可以调整)

    // 行走定时器
    let walkTimer = null;
    // 得注意下startWalkingShort 内部有个 stopWatcher (局部变量)，无法在外部直接清除

    let stopRequested = false;

    // 拖拽 / 物理状态
    let isDragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    // 物理飞行
    let isFlying = false; // 松手后物理模拟阶段
    let flyX = 0; // fixed left（px）
    let flyY = 0; // fixed top（px）
    let velX = 0; // px/ms
    let velY = 0; // px/ms
    // 速度采样窗口（最近 N 帧鼠标位移）
    const VEL_SAMPLES = 5;
    const velSamples = []; // { x, y, t }

    // 触摸状态
    let touchLongPressTimer = null; // 长按计时器
    let touchDragReady = false; // 长按后进入可拖拽状态
    let touchStartX = 0;
    let touchStartY = 0;
    const TOUCH_LONG_PRESS_MS = 400; // 长按判定时长（ms）
    const TOUCH_MOVE_CANCEL_PX = 10; // 手指移动超过此距离取消长按

    // 闲置控制
    let idleTimeout = null;

    // 文本数据（来自 mini_neuro_sentence.json）
    let phrases = null;
    let forcedNextId = null;
    let lastShownId = null;

    // Neuro 启停控制（由按钮/本地存储控制）
    let puppetEnabled = true;

    const STORAGE_KEY = "neuro-enabled-v2";

    // ========== 辅助：viewport / bounds ==========
    function getBounds() {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rect = puppet.getBoundingClientRect();
      return { vw, vh, rect };
    }

    // ========== 启停函数 ==========
    let rafId = null;

    function disablePuppet() {
      // 标记
      puppetEnabled = false;

      // 取消 rAF
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

      // 停止闲置行为和行走定时器
      if (idleTimeout) {
        clearTimeout(idleTimeout);
        idleTimeout = null;
      }
      if (walkTimer) {
        clearInterval(walkTimer);
        walkTimer = null;
      }

      // 请求停止当前行走（如果存在 stopWatcher 守护它会在下一周期重置 state）
      stopRequested = true;
      state = "standing";
      isFlying = false;
      if (isDragging) {
        document.removeEventListener("mousemove", onDragMove);
        document.removeEventListener("mouseup", onDragEnd);
        isDragging = false;
      }

      // 隐藏 DOM（这样也不会触发鼠标交互）
      puppet.style.display = "none";
      bubble.classList.remove("show");
      bubble.setAttribute("aria-hidden", "true");

      // 更新按钮样式（若存在按钮）
      updateNeuroIcon();
    }

    function enablePuppet() {
      if (puppetEnabled) return;
      puppetEnabled = true;

      // 完全重置所有状态与位置
      if (walkTimer) {
        clearInterval(walkTimer);
        walkTimer = null;
      }
      if (idleTimeout) {
        clearTimeout(idleTimeout);
        idleTimeout = null;
      }
      if (isDragging) {
        document.removeEventListener("mousemove", onDragMove);
        document.removeEventListener("mouseup", onDragEnd);
      }
      isDragging = false;
      isFlying = false;
      velX = 0;
      velY = 0;
      stopRequested = false;
      state = "standing";
      currentS = Math.random() < 0.5 ? 0 : 1;
      sprite.src = S[currentS];

      // 重置位置到左下角
      x = 8;
      puppet.style.transition = "";
      puppet.style.top = "";
      puppet.style.bottom = "0px";
      puppet.style.left = x + "px";

      // 显示 DOM
      puppet.style.display = "block";

      // 恢复闲置行为与渲染循环
      scheduleIdleAction();
      startRenderLoop();

      // 更新按钮样式
      updateNeuroIcon();
    }

    function updateNeuroIcon() {
      const btn = document.getElementById("neuro-toggle");
      if (!btn) return;
      btn.classList.toggle("neuro-off", !puppetEnabled);
    }

    // ========== 初始化 ==========
    function init() {
      // 初始站立姿态
      currentS = Math.random() < 0.5 ? 0 : 1;
      sprite.src = S[currentS];

      // 交互（mouseenter/leave 始终绑定，隐藏状态下不会触发）
      puppet.addEventListener("mouseenter", onHover);
      puppet.addEventListener("mouseleave", onLeave);
      puppet.addEventListener("mousedown", onPuppetMouseDown);

      // 触摸事件
      puppet.addEventListener("touchstart", onTouchStart, { passive: false });
      puppet.addEventListener("touchmove", onTouchMove, { passive: false });
      puppet.addEventListener("touchend", onTouchEnd, { passive: false });
      puppet.addEventListener("touchcancel", onTouchCancel, { passive: false });

      // 读取用户保存的选择（localStorage: 'neuro-enabled'）
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === null) {
        // 没有记录时根据屏幕宽度决定默认行为
        if (window.innerWidth < 768) {
          puppetEnabled = false;
        } else {
          puppetEnabled = true;
        }
      } else {
        puppetEnabled = saved === "1";
      }

      // 根据 puppetEnabled 决定是否启动循环与闲置
      if (puppetEnabled) {
        scheduleIdleAction();
        startRenderLoop();
        puppet.style.display = "block";
      } else {
        puppet.style.display = "none";
        bubble.classList.remove("show");
        bubble.setAttribute("aria-hidden", "true");
      }

      // 尝试加载 JSON（主文件名，希望后面别忘了改：mini_neuro_sentence.json）
      fetchPhrases().catch((err) => {
        // 如果 fetch 失败（例如 file:// 导致 CORS），显示本地加载回退
        loadUI.style.display = "block";
      });

      // 本地文件选择回退
      if (btnLoad) {
        btnLoad.addEventListener("click", () => fileInput && fileInput.click());
      }
      if (fileInput) {
        fileInput.addEventListener("change", (e) => {
          const f = e.target.files && e.target.files[0];
          if (!f) return;
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const data = JSON.parse(reader.result);
              phrases = Array.isArray(data) ? data : data.items || [];
              loadUI.style.display = "none";
            } catch (err) {
              // 忽略解析错误（用户应该会看到无文本）
              loadUI.style.display = "block";
            }
          };
          reader.readAsText(f, "utf-8");
        });
      }

      // 绑定 butterfly 的按钮（若存在）
      const neuroBtn = document.getElementById("neuro-toggle");
      if (neuroBtn) {
        neuroBtn.addEventListener("click", () => {
          if (puppetEnabled) {
            disablePuppet();
            localStorage.setItem(STORAGE_KEY, "0");
          } else {
            enablePuppet();
            localStorage.setItem(STORAGE_KEY, "1");
          }
        });
      }

      // 初始化按钮样式
      updateNeuroIcon();
    }

    // ========== 渲染循环 ==========
    function startRenderLoop() {
      // 如果已经在运行则不重复启动
      if (rafId) return;

      let lastTime = performance.now();
      function loop(now) {
        // 如果被禁用则退出循环（并不再请求下一帧）
        if (!puppetEnabled) {
          rafId = null;
          return;
        }

        const dt = Math.min(now - lastTime, 64); // 最大 64ms，防止丢帧跳变
        lastTime = now;

        // ---- 物理飞行阶段 ----
        if (isFlying) {
          // ── 物理参数（可调）──────────────────────────────────────
          // GRAVITY：重力加速度 px/ms²；越大越快落地，推荐范围 0.003~0.012
          const GRAVITY = 0.008;
          // BOUNCE_Y：落地纵向弹性 0=完全不弹 1=完全弹回；保持小值防止乒乓
          const BOUNCE_Y = 0.1;
          // FRICTION：落地后横向每 16ms 速度保留比例；越小停得越快，推荐 0.70~0.90
          const FRICTION = 0.78;
          // WALL_RESTITUTION：撞侧壁弹性；0=不弹 1=完全弹
          const WALL_RESTITUTION = 0.4;
          // SETTLE_VEL：横速低于此值（px/ms）判定为静止
          const SETTLE_VEL = 0.05;
          // MAX_V（松手初速上限）在 onDragEnd 里设置，默认 2.5 px/ms
          // ────────────────────────────────────────────────────────

          const pw = puppet.offsetWidth;
          const ph = puppet.offsetHeight;
          const vw = window.innerWidth;
          const vh = window.innerHeight;

          const floorY = vh - ph; // 永远落在视口底部

          velY += GRAVITY * dt;
          flyX += velX * dt;
          flyY += velY * dt;

          // 侧壁碰撞
          if (flyX < 0) {
            flyX = 0;
            velX = Math.abs(velX) * WALL_RESTITUTION;
            vibrate(15);
          } else if (flyX > vw - pw) {
            flyX = vw - pw;
            velX = -Math.abs(velX) * WALL_RESTITUTION;
            vibrate(15);
          }

          // 落地碰撞
          const onFloor = flyY >= floorY;
          if (onFloor) {
            const wasAboveFloor = flyY - velY * dt < floorY; // 本帧才着地
            flyY = floorY;
            // 纵向速度极小时直接清零，避免微振
            if (Math.abs(velY) < 0.3) {
              velY = 0;
            } else {
              if (wasAboveFloor) vibrate(20);
              velY = -Math.abs(velY) * BOUNCE_Y;
            }
            // 落地摩擦衰减（基于 dt，避免帧率依赖）
            const fric = Math.pow(FRICTION, dt / 16);
            velX *= fric;
          }

          // 判断是否完全静止
          const settled = onFloor && velY === 0 && Math.abs(velX) < SETTLE_VEL;
          if (settled) {
            velX = 0;
            isFlying = false;
            x = flyX;
            clampX();
            puppet.style.transition = "";
            puppet.style.top = "";
            puppet.style.bottom = "0px";
            puppet.style.left = Math.round(x) + "px";
            // 恢复站立并启动闲置
            state = "standing";
            currentS = 1;
            sprite.src = S[currentS];
            scheduleIdleAction();
          } else {
            puppet.style.left = Math.round(flyX) + "px";
            puppet.style.top = Math.round(flyY) + "px";
          }

          rafId = requestAnimationFrame(loop);
          return; // 飞行中跳过常规逻辑
        }

        // ---- 常规阶段 ----
        if (state === "walking") {
          x += (facing === "right" ? 1 : -1) * speed * (dt / 16);
        }

        // 拖拽中不更新 left / bottom，由拖拽逻辑全权控制
        if (!isDragging) {
          clampX();
          puppet.style.left = Math.round(x) + "px";
        }

        if (bubble.classList.contains("show")) {
          positionBubbleNearPuppet();
        }

        rafId = requestAnimationFrame(loop);
      }

      rafId = requestAnimationFrame(loop);
    }

    function clampX() {
      const { vw, rect } = getBounds();
      const w = rect.width || puppet.offsetWidth;
      const maxX = Math.max(0, vw - w - 8);
      if (x < 0) x = 0;
      if (x > maxX) x = maxX;
    }

    // ========== 闲置行为（随机眨眼、换站立、短走） ==========
    function scheduleIdleAction() {
      if (idleTimeout) clearTimeout(idleTimeout);
      // 可以调整：闲置动作间隔分布（目前 3s .. 10s）
      const delay = 3000 + Math.random() * 7000; // <-- 闲置间隔分布

      // 如果当前被禁用则不安排
      if (!puppetEnabled) {
        idleTimeout = null;
        return;
      }

      idleTimeout = setTimeout(() => {
        performIdleAction();
        scheduleIdleAction();
      }, delay);
    }

    function performIdleAction() {
      if (!puppetEnabled) return;
      if (state !== "standing") return;
      const r = Math.random();

      // 动作的概率分配
      if (r < 0.45) {
        // 眨眼
        triggerBlink();
      } else if (r < 0.65) {
        // 切换站立姿态
        currentS = 1 - currentS;
        sprite.src = S[currentS];
      } else {
        // 开始一次短暂的走路
        startWalkingShort();
      }
    }

    // 眨眼实现（S -> C1 -> C2 -> C1 -> S）
    function triggerBlink() {
      if (!puppetEnabled) return;
      if (state !== "standing") return;

      state = "blinking";
      sprite.src = C[0]; // C1

      // C1 持续时长
      setTimeout(() => {
        sprite.src = C[1]; // C2

        // C2 持续时长
        setTimeout(() => {
          sprite.src = C[0]; // 再回到 C1

          // 第二次 C1 持续时长
          setTimeout(() => {
            state = "standing";
            sprite.src = S[currentS]; // 回到站立帧
          }, 120);
        }, 140);
      }, 120);
    }

    // ========== 行走 ==========
    function startWalkingShort() {
      if (!puppetEnabled) return;
      if (state !== "standing") return;

      const { vw, rect } = getBounds();
      const w = rect.width || puppet.offsetWidth;
      const maxX = Math.max(0, vw - w - 8);

      // 朝向决策：尽量不走出屏幕（基于当前位置）
      if (x > maxX * 0.7) facing = "left";
      else if (x < maxX * 0.15) facing = "right";
      else facing = Math.random() < 0.5 ? "left" : "right";

      // 从 W1 开始（强制）
      walkIndex = 0;
      sprite.src = W[walkIndex];
      state = "walking";
      stopRequested = false;
      puppet.classList.toggle("facing-right", facing === "right");

      // 帧切换间隔
      const frameInterval = 180; // ms per walk frame <-- 改变步伐速度/帧率
      if (walkTimer) clearInterval(walkTimer);
      walkTimer = setInterval(() => {
        // 如果被禁用则停止计时器
        if (!puppetEnabled) {
          clearInterval(walkTimer);
          walkTimer = null;
          return;
        }
        walkIndex = (walkIndex + 1) % W.length;
        sprite.src = W[walkIndex];
        // 停止请求的随机触发（仅在未来 W1 时生效）
        if (Math.random() < 0.08) stopRequested = true;
      }, frameInterval);

      // 本次走动持续时间（在此时间后会请求停止，实际停止需等到 W1）
      const walkDuration = 600 + Math.random() * 1400; // 0.6s .. 2.0s
      setTimeout(() => {
        stopRequested = true;
      }, walkDuration);

      // 监督停止条件：只有在 W1（walkIndex == 0）时才能真正停止并切回 S
      const stopWatcher = setInterval(() => {
        if (!puppetEnabled) {
          clearInterval(stopWatcher);
          return;
        }
        if (stopRequested && walkIndex === 0) {
          clearInterval(walkTimer);
          walkTimer = null;
          clearInterval(stopWatcher);
          state = "standing";
          currentS = Math.random() < 0.5 ? 0 : 1;
          sprite.src = S[currentS];
          puppet.classList.toggle("facing-right", facing === "right");
        }
      }, 80);
    }

    // ========== 文本加载与选择 ==========
    async function fetchPhrases() {
      if (phrases) return phrases;
      try {
        // json位置
        const res = await fetch("/json/mini_neuro_sentence.json", {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        phrases = Array.isArray(data) ? data : data.items || [];
      } catch (e) {
        phrases = null;
        throw e;
      }
      return phrases;
    }

    // 时间限制检查（timeRange.from / timeRange.to）; 支持跨午夜
    function timeInRange(range) {
      if (!range || !range.from || !range.to) return true;
      const now = new Date();
      const parseHM = (str) => {
        const [hh, mm] = (str || "0:0")
          .split(":")
          .map((x) => parseInt(x, 10) || 0);
        return hh * 60 + mm;
      };
      const tnow = now.getHours() * 60 + now.getMinutes();
      const from = parseHM(range.from);
      const to = parseHM(range.to);
      if (from <= to) return tnow >= from && tnow <= to;
      // 跨午夜
      return tnow >= from || tnow <= to;
    }

    // 页面限制匹配
    function pagesMatch(pages) {
      if (!pages || !pages.length) return true;
      const path = location.pathname || "/";
      return pages.indexOf(path) !== -1;
    }

    // 加权随机选择
    function chooseWeighted(list) {
      const total = list.reduce((s, i) => s + (i.weight || 1), 0);
      let r = Math.random() * total;
      for (const item of list) {
        r -= item.weight || 1;
        if (r <= 0) return item;
      }
      return list[list.length - 1];
    }

    // 悬浮触发（鼠标进入）
    async function onHover(ev) {
      if (!puppetEnabled) return;
      try {
        await fetchPhrases();
      } catch (e) {
        showBubble("...");
        return;
      }

      let candidate = null;

      // 如果 forcedNextId 存在，优先播放对应 id
      if (forcedNextId) {
        candidate = phrases.find((p) => p.id === forcedNextId);
        forcedNextId = null;
      }

      if (!candidate) {
        // 过滤候选：排除 onlyChain（除非强制），并应用 timeRange / pages
        const available = (phrases || []).filter((p) => {
          if (p.onlyChain) return false;
          if (!timeInRange(p.timeRange)) return false;
          if (!pagesMatch(p.pages)) return false;
          return true;
        });
        if (available.length === 0) {
          // 退化：若没有满足条件的则尝试使用非 onlyChain 的全部条目或回退至完整数据
          const fallback = (phrases || []).filter((p) => !p.onlyChain);
          candidate = fallback.length
            ? chooseWeighted(fallback)
            : phrases && phrases[0]
              ? phrases[0]
              : null;
        } else {
          candidate = chooseWeighted(available);
        }
      }

      if (!candidate) {
        showBubble("...");
        return;
      }
      if (candidate.nextId) forcedNextId = candidate.nextId;
      lastShownId = candidate.id || null;
      showBubble(candidate.text || "");
    }
    function onLeave(ev) {
      hideBubble();
    }

    // ========== 气泡显示/隐藏及位置 ==========
    function showBubble(text) {
      if (!puppetEnabled) return;
      bubble.textContent = text || "";

      bubble.classList.add("show");
      bubble.setAttribute("aria-hidden", "false");

      // 在下一帧定位，确保浏览器完成 layout
      requestAnimationFrame(() => {
        positionBubbleNearPuppet();
      });
    }
    function hideBubble() {
      bubble.classList.remove("show");
      bubble.setAttribute("aria-hidden", "true");
    }

    // 将气泡放在小人头顶（或在顶部不足时放到下方），并在小人移动时被 repeatedly 调用以实现跟随
    function positionBubbleNearPuppet() {
      const pr = puppet.getBoundingClientRect();

      requestAnimationFrame(() => {
        const bw = bubble.offsetWidth;
        const bh = bubble.offsetHeight;

        let left = pr.left + pr.width / 2 - bw / 2;
        left = Math.min(window.innerWidth - bw - 8, Math.max(8, left));

        let top = pr.top - bh - 12;

        if (top < 8) {
          top = pr.bottom + 8;
        }

        bubble.style.left = left + "px";
        bubble.style.top = top + "px";
      });
    }

    // ========== 拖拽 + 物理投掷 ==========
    function onPuppetMouseDown(e) {
      if (!puppetEnabled) return;
      if (e.button !== 0) return;
      e.preventDefault();
      const pr = puppet.getBoundingClientRect();
      dragOffsetX = e.clientX - pr.left;
      dragOffsetY = e.clientY - pr.top;
      _enterDrag(e.clientX, e.clientY);
      document.addEventListener("mousemove", onDragMove);
      document.addEventListener("mouseup", onDragEnd);
    }

    function onDragMove(e) {
      if (!isDragging) return;
      const newLeft = e.clientX - dragOffsetX;
      const newTop = e.clientY - dragOffsetY;
      puppet.style.left = newLeft + "px";
      puppet.style.top = newTop + "px";
      velSamples.push({ x: e.clientX, y: e.clientY, t: performance.now() });
      if (velSamples.length > VEL_SAMPLES) velSamples.shift();
    }

    function onDragEnd(e) {
      if (!isDragging) return;
      document.removeEventListener("mousemove", onDragMove);
      document.removeEventListener("mouseup", onDragEnd);
      _releaseDrag(e);
    }

    // ========== 触摸处理 ==========
    function vibrate(pattern) {
      try {
        if (navigator.vibrate) navigator.vibrate(pattern);
      } catch (e) {}
    }

    function onTouchStart(e) {
      if (!puppetEnabled) return;
      e.preventDefault(); // 阻止长按菜单 & 页面滚动

      // 如果正在飞行，直接接住（同鼠标点击逻辑）
      if (isFlying) {
        isFlying = false;
        const t = e.touches[0];
        const pr = puppet.getBoundingClientRect();
        touchDragReady = true;
        dragOffsetX = t.clientX - pr.left;
        dragOffsetY = t.clientY - pr.top;
        _enterDrag(t.clientX, t.clientY);
        return;
      }

      const t = e.touches[0];
      touchStartX = t.clientX;
      touchStartY = t.clientY;
      touchDragReady = false;

      // 长按计时
      touchLongPressTimer = setTimeout(() => {
        touchLongPressTimer = null;
        touchDragReady = true;
        vibrate(30); // 震动提示进入拖拽
        const pr = puppet.getBoundingClientRect();
        dragOffsetX = touchStartX - pr.left;
        dragOffsetY = touchStartY - pr.top;
        _enterDrag(touchStartX, touchStartY);
      }, TOUCH_LONG_PRESS_MS);
    }

    function onTouchMove(e) {
      if (!puppetEnabled) return;
      e.preventDefault();

      const t = e.touches[0];

      // 如果还没进入拖拽，检查是否移动过多（取消长按）
      if (!touchDragReady) {
        const dx = t.clientX - touchStartX;
        const dy = t.clientY - touchStartY;
        if (Math.sqrt(dx * dx + dy * dy) > TOUCH_MOVE_CANCEL_PX) {
          _cancelLongPress();
        }
        return;
      }

      // 已在拖拽中，更新位置（复用鼠标拖拽的采样逻辑）
      if (isDragging) {
        const newLeft = t.clientX - dragOffsetX;
        const newTop = t.clientY - dragOffsetY;
        puppet.style.left = newLeft + "px";
        puppet.style.top = newTop + "px";
        velSamples.push({ x: t.clientX, y: t.clientY, t: performance.now() });
        if (velSamples.length > VEL_SAMPLES) velSamples.shift();
      }
    }

    function onTouchEnd(e) {
      if (!puppetEnabled) return;
      e.preventDefault();

      const wasDragging = isDragging;
      const wasLongPress = touchDragReady;

      _cancelLongPress();

      if (wasDragging) {
        // 松手投掷（复用鼠标逻辑）
        _releaseDrag(e.changedTouches[0]);
        return;
      }

      if (!wasLongPress) {
        // 短点击：触发台词（等同 mouseenter）
        onHover(e);
        // 2 秒后自动隐藏气泡（移动端没有 mouseleave）
        setTimeout(() => hideBubble(), 2000);
      }
    }

    function onTouchCancel(e) {
      _cancelLongPress();
      if (isDragging)
        _releaseDrag(e.changedTouches[0] || { clientX: 0, clientY: 0 });
    }

    function _cancelLongPress() {
      if (touchLongPressTimer) {
        clearTimeout(touchLongPressTimer);
        touchLongPressTimer = null;
      }
      touchDragReady = false;
    }

    // 公共：进入拖拽状态（供鼠标和触摸共用）
    function _enterDrag(clientX, clientY) {
      isFlying = false;
      isDragging = true;
      stopRequested = true;
      state = "dragging";
      if (walkTimer) {
        clearInterval(walkTimer);
        walkTimer = null;
      }
      if (idleTimeout) {
        clearTimeout(idleTimeout);
        idleTimeout = null;
      }

      sprite.src = S[1]; // S_look_you.svg

      const pr = puppet.getBoundingClientRect();
      puppet.style.transition = "";
      puppet.style.bottom = "auto";
      puppet.style.left = pr.left + "px";
      puppet.style.top = pr.top + "px";

      velSamples.length = 0;
      velSamples.push({ x: clientX, y: clientY, t: performance.now() });
      hideBubble();
    }

    // 公共：松手投掷（供鼠标和触摸共用）
    function _releaseDrag(pointer) {
      isDragging = false;

      const pr = puppet.getBoundingClientRect();
      flyX = pr.left;
      flyY = pr.top;

      velX = 0;
      velY = 0;
      if (velSamples.length >= 2) {
        const a = velSamples[0];
        const b = velSamples[velSamples.length - 1];
        const dt = b.t - a.t;
        if (dt > 0) {
          velX = (b.x - a.x) / dt;
          velY = (b.y - a.y) / dt;
          const MAX_V = 2.5;
          const mag = Math.sqrt(velX * velX + velY * velY);
          if (mag > MAX_V) {
            velX = (velX / mag) * MAX_V;
            velY = (velY / mag) * MAX_V;
          }
        }
      }

      puppet.style.transition = "";
      puppet.style.bottom = "auto";
      puppet.style.left = Math.round(flyX) + "px";
      puppet.style.top = Math.round(flyY) + "px";
      isFlying = true;
    }

    // ========== 事件绑定 ==========
    // puppet 的mouseenter/leave 在 init() 中已绑定，应该不用再绑了

    // ========== 启动 ==========
    init();

    // ========== 对外调试接口 ==========
    // 万一用得上呢，可以删掉
    window.__puppet = {
      startWalking: startWalkingShort,
      triggerBlink: triggerBlink,
      getState: () => state,
      setFacing: (dir) => {
        facing = dir;
        puppet.classList.toggle("facing-right", dir === "right");
      },
    };
  }
})();
