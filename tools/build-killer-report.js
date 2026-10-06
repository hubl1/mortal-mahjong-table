#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const inputDir = path.resolve(process.argv[2] || path.join(
  ROOT, "comparisons", "2026-10-03T20-38-24-099Z"
));
const outputPath = path.resolve(process.argv[3] || path.join(inputDir, "killer-report.json"));

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(inputDir, name), "utf8"));
}

function loadTenhou(paipu) {
  const uploaded = path.join(inputDir, "game-tenhou.json");
  if (fs.existsSync(uploaded)) return JSON.parse(fs.readFileSync(uploaded, "utf8"));
  const localConverter = path.join(
    ROOT, "vendor", "Majiang-master", "node_modules", "@kobalab", "tenhou-url-log", "lib", "logconv.js"
  );
  if (!fs.existsSync(localConverter)) {
    throw new Error("缺少 game-tenhou.json，且本机没有安装 tenhou-url-log");
  }
  return require(localConverter)(paipu);
}

function mjaiTile(tile) {
  const value = String(tile || "").replace(/[_*+\-=]/g, "").slice(0, 2);
  if (!value) return "?";
  if (value[0] === "z") return ["", "E", "S", "W", "N", "P", "F", "C"][Number(value[1])];
  if (value[1] === "0") return `5${value[0]}r`;
  return `${value[1]}${value[0]}`;
}

function compactHand(hand) {
  const part = String(hand || "").split(",")[0];
  const tiles = [];
  for (const suitPart of part.match(/[mpsz]\d+/g) || []) {
    const suit = suitPart[0];
    for (const digit of suitPart.slice(1)) tiles.push(mjaiTile(suit + digit));
  }
  return tiles;
}

function meldToAction(meld, actor, currentRound) {
  const value = String(meld);
  const suit = value[0];
  const direction = value.match(/[+\-=]/)?.[0];
  const digits = [...value.slice(1)].filter((c) => /\d/.test(c));
  const directionOffset = { "+": 1, "=": 2, "-": 3 }[direction];
  const target = directionOffset == null ? actor : seatToPlayer((playerToSeat(actor, currentRound) + directionOffset) % 4, currentRound);
  const markerIndex = direction ? value.indexOf(direction) : -1;
  const calledDigit = markerIndex > 1 ? value[markerIndex - 1] : digits.at(-1);
  const calledPos = digits.indexOf(calledDigit);
  const consumedDigits = digits.slice();
  if (direction && calledPos >= 0) consumedDigits.splice(calledPos, 1);
  const normalized = value.replace(/0/g, "5");
  const type = !direction ? "ankan"
    : digits.length === 4 && normalized.match(/(\d)\1\1\1/) ? "daiminkan"
      : normalized.match(/(\d)\1\1/) ? "pon" : "chi";
  return {
    type,
    actor,
    ...(direction ? { target, pai: mjaiTile(suit + calledDigit) } : {}),
    consumed: consumedDigits.map((digit) => mjaiTile(suit + digit))
  };
}

function seatToPlayer(seat, roundIndex) {
  return (roundIndex + seat) % 4;
}

function playerToSeat(player, roundIndex) {
  return (player - roundIndex + 4) % 4;
}

function mapRelative(values, roundIndex) {
  const result = [];
  values.forEach((value, seat) => { result[seatToPlayer(seat, roundIndex)] = value; });
  return result;
}

function resultEvent(item, roundIndex, scores) {
  if (item.hule) {
    const h = item.hule;
    const actor = seatToPlayer(h.l, roundIndex);
    const target = seatToPlayer(h.baojia == null ? h.l : h.baojia, roundIndex);
    const deltas = mapRelative(h.fenpei || [0, 0, 0, 0], roundIndex);
    return {
      type: "hora", actor, target, pai: mjaiTile((h.shoupai.match(/[mpsz]\d/g) || []).at(-1)),
      deltas, scores: scores.map((score, i) => score + (deltas[i] || 0))
    };
  }
  const p = item.pingju;
  if (p) {
    const deltas = mapRelative(p.fenpei || [0, 0, 0, 0], roundIndex);
    return { type: "ryukyoku", reason: p.name, deltas, scores: scores.map((score, i) => score + (deltas[i] || 0)) };
  }
  return null;
}

function convertGame(paipu, tenhou) {
  const mjaiLog = [{ type: "start_game", id: 0, names: tenhou.name }];
  const eventMap = new Map();
  let localEventIndex = 1;

  paipu.log.forEach((roundLog) => {
    const qipai = roundLog[0].qipai;
    const roundIndex = qipai.jushu;
    localEventIndex += 1;
    const scores = mapRelative(qipai.defen, roundIndex);
    const tehais = mapRelative(qipai.shoupai.map(compactHand), roundIndex);
    const start = {
      type: "start_kyoku",
      bakaze: ["E", "S", "W", "N"][qipai.zhuangfeng],
      kyoku: roundIndex + 1,
      honba: qipai.changbang,
      kyotaku: qipai.lizhibang,
      oya: roundIndex,
      dora_marker: mjaiTile(qipai.baopai),
      tehais,
      scores,
      _local_event_index: localEventIndex
    };
    mjaiLog.push(start);
    eventMap.set(localEventIndex, start);

    for (const item of roundLog.slice(1)) {
      localEventIndex += 1;
      let event = null;
      if (item.zimo || item.gangzimo) {
        const z = item.zimo || item.gangzimo;
        event = { type: "tsumo", actor: seatToPlayer(z.l, roundIndex), pai: mjaiTile(z.p) };
      } else if (item.dapai) {
        const d = item.dapai;
        const actor = seatToPlayer(d.l, roundIndex);
        if (d.p.endsWith("*")) mjaiLog.push({ type: "reach", actor });
        event = { type: "dahai", actor, pai: mjaiTile(d.p), tsumogiri: d.p.includes("_") };
      } else if (item.fulou) {
        event = meldToAction(item.fulou.m, seatToPlayer(item.fulou.l, roundIndex), roundIndex);
      } else if (item.gang) {
        event = meldToAction(item.gang.m, seatToPlayer(item.gang.l, roundIndex), roundIndex);
        if (event.type !== "ankan") event.type = "kakan";
      } else if (item.kaigang) {
        event = { type: "dora", dora_marker: mjaiTile(item.kaigang.baopai) };
      } else {
        event = resultEvent(item, roundIndex, scores);
      }
      if (!event) continue;
      event._local_event_index = localEventIndex;
      mjaiLog.push(event);
      eventMap.set(localEventIndex, event);
      if (item.dapai?.p.endsWith("*")) {
        mjaiLog.push({ type: "reach_accepted", actor: event.actor });
      }
    }
    mjaiLog.push({ type: "end_kyoku" });
  });
  mjaiLog.push({ type: "end_game", scores: paipu.defen });
  return { mjaiLog, eventMap };
}

function canonicalAction(action) {
  if (!action) return "none";
  if (action.type === "none") return "none";
  if (action.type === "reach") return "reach";
  if (action.type === "dahai") return `dahai:${action.pai}:${Boolean(action.tsumogiri)}`;
  if (["chi", "pon", "daiminkan"].includes(action.type)) {
    return `${action.type}:${action.pai}:${[...(action.consumed || [])].sort().join(",")}`;
  }
  if (["ankan", "kakan"].includes(action.type)) return `${action.type}:${action.pai || ""}:${[...(action.consumed || [])].sort().join(",")}`;
  return `${action.type}:${action.pai || ""}`;
}

function originalAction(decision, hero, roundIndex) {
  const raw = decision.originalRaw || {};
  if (raw.dapai) {
    if (raw.dapai.endsWith("*")) return { type: "reach", actor: hero };
    return { type: "dahai", actor: hero, pai: mjaiTile(raw.dapai), tsumogiri: raw.dapai.includes("_") };
  }
  if (raw.fulou) {
    const parsed = meldToAction(raw.fulou, hero, roundIndex);
    return parsed;
  }
  if (raw.gang) {
    const parsed = meldToAction(raw.gang, hero, roundIndex);
    if (parsed.type !== "ankan") parsed.type = "kakan";
    return parsed;
  }
  if (raw.hule) return { type: "hora", actor: hero, target: hero };
  if (raw.daopai) return { type: "ryukyoku", actor: hero };
  return { type: "none", actor: hero };
}

function normalizeAction(action, hero, qijia) {
  if (!action) return { type: "none", actor: hero };
  const copy = JSON.parse(JSON.stringify(action));
  copy.actor = hero;
  if (Number.isInteger(copy.target)) copy.target = (copy.target - qijia + 4) % 4;
  delete copy.meta;
  return copy;
}

function softmax(values, temperature = 0.3) {
  const peak = Math.max(...values);
  const exp = values.map((value) => Math.exp((value - peak) / temperature));
  const total = exp.reduce((sum, value) => sum + value, 0) || 1;
  return exp.map((value) => value / total);
}

function reviewEntry(decision, event, qijia) {
  const roundIndex = Number((decision.snapshot.round.match(/[一二三四]/)?.[0] && { 一: 0, 二: 1, 三: 2, 四: 3 }[decision.snapshot.round.match(/[一二三四]/)[0]]) ?? 0);
  const bakaze = decision.snapshot.round.startsWith("南") ? 1 : decision.snapshot.round.startsWith("西") ? 2 : 0;
  const globalRoundIndex = bakaze * 4 + roundIndex;
  const hero = (globalRoundIndex + decision.snapshot.seat) % 4;
  const possible = (decision.possibleActions || []).map((action) => normalizeAction(action, hero, qijia));
  const qValues = (decision.mortalRaw?.meta?.q_values || []).map(Number);
  while (possible.length < qValues.length) possible.push({ type: "none", actor: hero });
  while (qValues.length < possible.length) qValues.push(-20);
  const probabilities = softmax(qValues);
  const actual = originalAction(decision, hero, globalRoundIndex);
  if (!possible.some((action) => canonicalAction(action) === canonicalAction(actual))) {
    possible.push(actual);
    qValues.push(Math.min(...qValues, 0) - 20);
    probabilities.push(1e-12);
  }
  const details = possible.map((action, index) => ({ action, q_value: qValues[index], prob: probabilities[index] }))
    .sort((a, b) => b.prob - a.prob);
  const actualIndex = Math.max(0, details.findIndex((detail) => canonicalAction(detail.action) === canonicalAction(actual)));
  return {
    event_index: decision.eventIndex,
    junme: decision.decision,
    last_actor: event?.actor ?? hero,
    tile: event?.pai,
    tiles_left: decision.snapshot.tilesLeft,
    is_equal: decision.same,
    actual,
    actual_index: actualIndex,
    details
  };
}

function build() {
  const paipu = readJson("game-paipu.json");
  const decisions = readJson("decisions.json");
  const playerName = process.env.MORTAL_REVIEW_PLAYER || "本地玩家";
  const modelTag = process.env.MORTAL_REVIEW_MODEL || "mortal-finetune-ours560-step-1100000.pth";
  const playerIndex = paipu.player.findIndex((name) => String(name).replace(/\n.*$/, "") === playerName);
  if (playerIndex < 0) throw new Error(`找不到复盘玩家：${playerName}`);
  const tenhou = loadTenhou(paipu);
  const { mjaiLog, eventMap } = convertGame(paipu, tenhou);
  const qijia = paipu.qijia || 0;
  const kyokuEntries = paipu.log.map(() => []);
  const numberText = ["一", "二", "三", "四"];
  const windText = ["东", "南", "西", "北"];
  const roundLookup = new Map(paipu.log.map((roundLog, index) => {
    const q = roundLog[0].qipai;
    return [`${windText[q.zhuangfeng]}${numberText[q.jushu]}局${q.changbang || 0}本场`, index];
  }));

  decisions.forEach((decision) => {
    const event = eventMap.get(decision.eventIndex);
    if (!event) throw new Error(`找不到决策 #${decision.decision} 对应的事件 ${decision.eventIndex}`);
    const roundNumber = roundLookup.get(decision.snapshot.round);
    if (roundNumber == null) throw new Error(`找不到局：${decision.snapshot.round}`);
    kyokuEntries[roundNumber].push(reviewEntry(decision, event, qijia));
  });

  const totalMatches = decisions.filter((d) => d.same).length;
  const rating = decisions.reduce((sum, d) => {
    const top = d.mortalTop?.[0]?.value;
    return sum + (d.same ? Number.parseFloat(top || 0) / 100 : 0);
  }, 0) / Math.max(1, decisions.length);
  const report = {
    engine: "Mortal 110万步（本地评估）",
    version: "local-adapter-1",
    game_length: "Hanchan",
    loading_time: "离线",
    review_time: "对局中同步记录",
    player_id: (playerIndex - qijia + 4) % 4,
    mjai_log: mjaiLog,
    split_logs: tenhou.log.map((log) => ({ ...tenhou, log: [log] })),
    review: {
      model_tag: modelTag,
      temperature: 0.3,
      total_matches: totalMatches,
      total_reviewed: decisions.length,
      rating,
      kyokus: paipu.log.map((_, index) => ({ kyoku: index, entries: kyokuEntries[index] || [] }))
    }
  };
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(`${outputPath}\n`);
}

build();
