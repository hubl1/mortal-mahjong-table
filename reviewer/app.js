(() => {
  "use strict";

  const DEFAULT_DATA = "../comparisons/2026-10-03T20-38-24-099Z/decisions.json";
  const TILE_ROOT = "../vendor/Majiang-master/dist/img/skin-classic2d";
  const WINDS = ["东", "南", "西", "北"];
  const state = { decisions: [], index: 0, filter: "all", sourceName: "" };
  const $ = (id) => document.getElementById(id);

  const refs = {
    title: $("dataset-title"), subtitle: $("dataset-subtitle"), total: $("metric-total"),
    diff: $("metric-diff"), rate: $("metric-rate"), rounds: $("metric-rounds"),
    round: $("round-label"), centerRound: $("center-round"), tilesLeft: $("tiles-left"),
    dora: $("dora"), scoreGrid: $("score-grid"), event: $("event-chip"),
    position: $("decision-position"), decisionEvent: $("decision-event"), timeline: $("timeline"),
    verdict: $("verdict-card"), verdictTitle: $("verdict-title"), verdictDetail: $("verdict-detail"),
    computerAction: $("computer-action"), mortalAction: $("mortal-action"),
    mortalCandidates: $("mortal-candidates"), computerCandidates: $("computer-candidates"),
    mortalShanten: $("mortal-shanten"), computerShanten: $("computer-shanten"),
    context: $("context-list"), toast: $("toast")
  };

  function cleanTile(tile) {
    if (!tile) return "";
    return String(tile).replace(/[_*+\-=]/g, "").slice(0, 2);
  }

  function toAssetTile(tile) {
    const t = cleanTile(tile);
    if (!/^[mpsz][0-9]$/.test(t)) return "back";
    return t;
  }

  function tileImage(tile, className = "") {
    const code = toAssetTile(tile);
    const img = document.createElement("img");
    img.className = `tile ${className}`.trim();
    img.src = `${TILE_ROOT}/${code}.png`;
    img.alt = code === "back" ? "暗牌" : code;
    img.draggable = false;
    return img;
  }

  function backTile(className = "") {
    const img = tileImage("back", `back ${className}`);
    return img;
  }

  function parseCompactTiles(value) {
    const concealed = String(value || "").split(",")[0].replace(/\*/g, "");
    const result = [];
    let suit = "";
    for (const char of concealed) {
      if (/[mpsz]/.test(char)) suit = char;
      else if (/\d/.test(char) && suit) result.push(`${suit}${char}`);
    }
    return result;
  }

  function parseMeld(meld) {
    const suit = String(meld || "")[0];
    return [...String(meld || "").slice(1)].filter((c) => /\d/.test(c)).map((n) => suit + n);
  }

  function relativePosition(absoluteSeat, selfSeat) {
    return ["bottom", "right", "top", "left"][(absoluteSeat - selfSeat + 4) % 4];
  }

  function fillBackHand(position, count = 13) {
    const node = $(`hand-${position}`);
    node.replaceChildren();
    for (let i = 0; i < count; i += 1) node.append(backTile());
  }

  function renderHand(decision) {
    ["top", "right", "left"].forEach((p) => fillBackHand(p));
    const node = $("hand-bottom");
    node.replaceChildren();
    parseCompactTiles(decision.snapshot.hand).forEach((tile) => node.append(tileImage(tile)));
    const melds = decision.snapshot.melds?.[decision.snapshot.seat] || [];
    melds.forEach((meld) => {
      const spacer = document.createElement("span");
      spacer.className = "meld-break";
      node.append(spacer);
      parseMeld(meld).forEach((tile) => node.append(tileImage(tile)));
    });
  }

  function renderRivers(decision) {
    ["bottom", "right", "top", "left"].forEach((p) => $(`river-${p}`).replaceChildren());
    (decision.snapshot.rivers || []).forEach((river, seat) => {
      const pos = relativePosition(seat, decision.snapshot.seat);
      const node = $(`river-${pos}`);
      river.forEach((tile) => {
        const img = tileImage(tile, "mini");
        if (String(tile).includes("*")) img.classList.add("riichi");
        node.append(img);
      });
    });
  }

  function renderWalls(tilesLeft) {
    const each = Math.max(0, Math.ceil(Number(tilesLeft || 0) / 4));
    ["top", "right", "bottom", "left"].forEach((p) => {
      const node = $(`wall-${p}`);
      node.replaceChildren();
      for (let i = 0; i < each; i += 1) node.append(backTile());
    });
  }

  function renderCenter(decision) {
    const snap = decision.snapshot;
    refs.round.textContent = snap.round;
    refs.centerRound.textContent = snap.round;
    refs.tilesLeft.textContent = `余 ${snap.tilesLeft}`;
    refs.event.textContent = translateAction(decision.event);
    refs.dora.replaceChildren();
    (snap.doraIndicators || []).forEach((tile) => refs.dora.append(tileImage(tile, "mini")));
    refs.scoreGrid.replaceChildren();
    (snap.scores || []).forEach((score, seat) => {
      const cell = document.createElement("div");
      if (seat === snap.seat) cell.className = "self";
      const relative = (seat - snap.seat + 4) % 4;
      cell.innerHTML = `<span>${relative === 0 ? "自家" : WINDS[seat]}</span><b>${Number(score).toLocaleString("zh-CN")}</b>`;
      refs.scoreGrid.append(cell);
    });
  }

  function translateAction(text) {
    return String(text || "")
      .replace(/^Dahai\s+/i, "切 ")
      .replace(/^Reach$/i, "立直")
      .replace(/^Chi\s+/i, "吃 ")
      .replace(/^Pon\s+/i, "碰 ")
      .replace(/^Kan\s+/i, "杠 ")
      .replace(/^Hora$/i, "和牌")
      .replace(/^None$/i, "跳过")
      .replace(/([0-9])([mps])/g, "$2$1")
      .replace(/([1-7])z/g, (_, n) => ["", "东", "南", "西", "北", "白", "发", "中"][Number(n)]);
  }

  function tileFromAction(text) {
    const m = String(text || "").match(/([0-9][mpsz]|[mpsz][0-9])/i);
    if (!m) return "";
    const t = m[1].toLowerCase();
    return /\d/.test(t[0]) ? `${t[1]}${t[0]}` : t;
  }

  function percentNumber(value) {
    const n = Number.parseFloat(String(value || "0").replace("%", ""));
    return Number.isFinite(n) ? n : 0;
  }

  function candidateRow(label, displayValue, width, extra = "") {
    const row = document.createElement("div");
    row.className = "candidate";
    const action = document.createElement("div");
    action.className = "candidate-action";
    const tile = tileFromAction(label);
    if (tile) action.append(tileImage(tile));
    const name = document.createElement("span");
    name.textContent = translateAction(label);
    action.append(name);
    const track = document.createElement("div");
    track.className = "bar-track";
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.width = `${Math.max(2, Math.min(100, width))}%`;
    track.append(bar);
    const value = document.createElement("div");
    value.className = "candidate-value";
    value.innerHTML = `${displayValue}${extra ? `<br><small>${extra}</small>` : ""}`;
    row.append(action, track, value);
    return row;
  }

  function renderCandidates(decision) {
    refs.mortalCandidates.replaceChildren();
    const mortal = decision.mortalTop || [];
    if (!mortal.length) refs.mortalCandidates.innerHTML = '<div class="empty-state">没有候选概率数据</div>';
    mortal.forEach((item) => {
      const pct = percentNumber(item.value);
      refs.mortalCandidates.append(candidateRow(item.label, item.value, pct));
    });
    const mShanten = decision.mortalRaw?.meta?.shanten;
    refs.mortalShanten.textContent = Number.isFinite(mShanten) ? `${mShanten} 向听` : "— 向听";

    refs.computerCandidates.replaceChildren();
    const original = decision.originalTop || [];
    const values = original.map((item) => Number(item.evaluation) || 0);
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    if (!original.length) refs.computerCandidates.innerHTML = '<div class="empty-state">没有候选估值数据</div>';
    original.slice(0, 5).forEach((item) => {
      const normalized = max === min ? 100 : ((Number(item.evaluation) - min) / (max - min)) * 92 + 8;
      refs.computerCandidates.append(candidateRow(item.action, Number(item.evaluation).toFixed(1), normalized, `${item.effectiveTiles ?? "—"}枚`));
    });
    const cShanten = original[0]?.shanten;
    refs.computerShanten.textContent = Number.isFinite(cShanten) ? `${cShanten} 向听` : "— 向听";
  }

  function category(decision) {
    const joined = `${decision.originalAction} ${decision.mortalAction}`;
    if (/立直|Reach/i.test(joined)) return "riichi";
    if (/鸣牌|跳过|Chi|Pon|Kan|吃|碰|杠/i.test(joined) || decision.snapshot?.incoming?.fulou || decision.snapshot?.incoming?.dapai) return "call";
    return "discard";
  }

  function renderAnalysis(decision) {
    refs.verdict.classList.toggle("is-different", !decision.same);
    refs.verdictTitle.textContent = decision.same ? "两者选择一致" : "发现不同决策";
    refs.verdictDetail.textContent = decision.same
      ? "在这个局面中，电脑麻将 AI 与 Mortal 的第一选择相同。"
      : category(decision) === "riichi" ? "双方对立直时机的判断不同，适合重点复盘。"
        : category(decision) === "call" ? "双方对鸣牌或鸣牌形状的判断不同。"
          : "双方保留的手牌结构不同；候选栏可查看差距大小。";
    refs.computerAction.textContent = translateAction(decision.originalAction);
    refs.mortalAction.textContent = translateAction(decision.mortalAction);
    renderCandidates(decision);

    const snap = decision.snapshot;
    const topP = decision.mortalTop?.[0]?.value || "—";
    const rows = [
      ["决策编号", `#${decision.decision}`],
      ["事件位置", `${decision.eventIndex}`],
      ["自家座位", WINDS[snap.seat] || snap.seat],
      ["剩余牌", `${snap.tilesLeft} 张`],
      ["手牌", snap.hand],
      ["Mortal置信", topP],
      ["分歧类型", decision.same ? "一致" : ({ riichi: "立直", call: "鸣牌", discard: "弃牌" })[category(decision)]]
    ];
    refs.context.replaceChildren();
    rows.forEach(([key, val]) => {
      const dt = document.createElement("dt"); dt.textContent = key;
      const dd = document.createElement("dd"); dd.textContent = val;
      refs.context.append(dt, dd);
    });
  }

  function renderTimeline() {
    refs.timeline.replaceChildren();
    state.decisions.forEach((decision, index) => {
      const button = document.createElement("button");
      const cat = category(decision);
      button.className = `${decision.same ? "" : "diff"} ${cat}`.trim();
      if (index === state.index) button.classList.add("current");
      if (!matchesFilter(decision, state.filter)) button.classList.add("hidden-by-filter");
      button.title = `#${decision.decision} ${decision.snapshot.round} · ${translateAction(decision.originalAction)} / ${translateAction(decision.mortalAction)}`;
      button.addEventListener("click", () => go(index));
      refs.timeline.append(button);
    });
    requestAnimationFrame(() => refs.timeline.querySelector(".current")?.scrollIntoView({ block: "nearest", inline: "center" }));
  }

  function render() {
    const decision = state.decisions[state.index];
    if (!decision) return;
    renderHand(decision);
    renderRivers(decision);
    renderWalls(decision.snapshot.tilesLeft);
    renderCenter(decision);
    renderAnalysis(decision);
    refs.position.textContent = `${state.index + 1} / ${state.decisions.length}`;
    refs.decisionEvent.textContent = translateAction(decision.event);
    renderTimeline();
    $("prev-decision").disabled = state.index === 0;
    $("next-decision").disabled = state.index === state.decisions.length - 1;
  }

  function matchesFilter(decision, filter) {
    if (filter === "all") return true;
    if (filter === "diff") return !decision.same;
    return category(decision) === filter;
  }

  function go(index) {
    state.index = Math.max(0, Math.min(state.decisions.length - 1, index));
    render();
  }

  function jump(direction, predicate) {
    let i = state.index + direction;
    while (i >= 0 && i < state.decisions.length) {
      if (predicate(state.decisions[i])) return go(i);
      i += direction;
    }
    showToast(direction > 0 ? "后面没有符合条件的决策" : "前面没有符合条件的决策");
  }

  function jumpRound(direction) {
    const current = state.decisions[state.index].snapshot.round;
    let i = state.index + direction;
    while (i >= 0 && i < state.decisions.length && state.decisions[i].snapshot.round === current) i += direction;
    if (i >= 0 && i < state.decisions.length) {
      const targetRound = state.decisions[i].snapshot.round;
      if (direction < 0) while (i > 0 && state.decisions[i - 1].snapshot.round === targetRound) i -= 1;
      go(i);
    } else showToast(direction > 0 ? "已经是最后一局" : "已经是第一局");
  }

  function summarize(decisions, sourceName) {
    const diffs = decisions.filter((d) => !d.same).length;
    const roundNames = [...new Set(decisions.map((d) => d.snapshot.round))];
    refs.total.textContent = decisions.length;
    refs.diff.textContent = diffs;
    refs.rate.textContent = `${((diffs / Math.max(1, decisions.length)) * 100).toFixed(1)}%`;
    refs.rounds.textContent = roundNames.length;
    refs.title.textContent = sourceName || "电脑麻将 AI vs Mortal";
    refs.subtitle.textContent = `${roundNames[0] || "—"} 至 ${roundNames.at(-1) || "—"} · 数据仅保存在本机`;
  }

  function validate(data) {
    if (!Array.isArray(data) || !data.length) throw new Error("文件中没有决策记录");
    if (!data.every((item) => item.snapshot && item.originalAction && item.mortalAction)) throw new Error("这不是本工具生成的 decisions.json");
    return data;
  }

  async function loadUrl(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`读取失败：${response.status}`);
    loadData(validate(await response.json()), url.split("/").slice(-2, -1)[0] || "比较结果");
  }

  function loadData(decisions, sourceName) {
    state.decisions = decisions;
    state.index = 0;
    state.sourceName = sourceName;
    summarize(decisions, sourceName);
    render();
  }

  function showToast(message) {
    refs.toast.textContent = message;
    refs.toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => refs.toast.classList.remove("show"), 1900);
  }

  $("prev-decision").addEventListener("click", () => go(state.index - 1));
  $("next-decision").addEventListener("click", () => go(state.index + 1));
  $("prev-diff").addEventListener("click", () => jump(-1, (d) => !d.same));
  $("next-diff").addEventListener("click", () => jump(1, (d) => !d.same));
  $("prev-round").addEventListener("click", () => jumpRound(-1));
  $("next-round").addEventListener("click", () => jumpRound(1));
  $("open-file").addEventListener("click", () => $("file-input").click());
  $("file-input").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { loadData(validate(JSON.parse(await file.text())), file.name); showToast("牌谱比较已载入"); }
    catch (error) { showToast(error.message); }
    event.target.value = "";
  });
  document.querySelectorAll(".filter").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach((b) => b.classList.remove("active"));
    button.classList.add("active");
    state.filter = button.dataset.filter;
    if (!matchesFilter(state.decisions[state.index], state.filter)) jump(1, (d) => matchesFilter(d, state.filter));
    else renderTimeline();
  }));
  $("help-button").addEventListener("click", () => $("help-dialog").showModal());
  $("help-close").addEventListener("click", () => $("help-dialog").close());
  document.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); event.shiftKey ? jump(-1, (d) => !d.same) : go(state.index - 1); }
    if (event.key === "ArrowRight") { event.preventDefault(); event.shiftKey ? jump(1, (d) => !d.same) : go(state.index + 1); }
  });

  const requested = new URLSearchParams(location.search).get("data");
  loadUrl(requested || DEFAULT_DATA).catch((error) => {
    refs.title.textContent = "请打开 decisions.json";
    refs.subtitle.textContent = error.message;
    showToast("默认对局读取失败，请手动打开文件");
  });
})();
