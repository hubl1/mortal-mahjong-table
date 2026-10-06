#!/usr/bin/env node

"use strict";

const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const root = path.resolve(process.env.MORTAL_ROOT || path.join(__dirname, ".."));
const prefix = "/mortal";
const listenPort = Number(process.env.MORTAL_GATEWAY_PORT || 4614);
const gamePort = Number(process.env.MORTAL_GAME_PORT || 4615);
const poolPort = Number(process.env.MORTAL_POOL_PORT || 14615);
const advisorPort = Number(process.env.MORTAL_ADVISOR_PORT || 15615);
const logsDir = path.join(root, "logs");
const paipuDir = path.join(root, "paipu");
const node = process.execPath;
const bridge = path.join(root, "runtime", "node_modules", "@kobalab", "majiang-server", "bin", "bridge.js");
const poolClient = path.join(root, "runtime", "bin", "mortal-pool-client");
const roomBots = new Map();

fs.mkdirSync(logsDir, { recursive: true });
fs.mkdirSync(paipuDir, { recursive: true });

function stripPrefix(url = "/") {
  if (url === prefix) return "/";
  if (url.startsWith(`${prefix}/`)) return url.slice(prefix.length);
  return null;
}

function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readJson(req, limit = 24 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("request too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

function proxyHttp(req, res, port, upstreamPath) {
  const headers = { ...req.headers, host: `127.0.0.1:${port}` };
  const upstream = http.request({
    host: "127.0.0.1", port, method: req.method, path: upstreamPath, headers,
  }, response => {
    const outgoing = { ...response.headers };
    if (typeof outgoing.location === "string" && outgoing.location.startsWith("/")) {
      outgoing.location = `${prefix}${outgoing.location}`;
    }
    res.writeHead(response.statusCode || 502, outgoing);
    response.pipe(res);
  });
  upstream.on("error", error => {
    if (!res.headersSent) json(res, 502, { error: error.message });
    else res.destroy(error);
  });
  req.pipe(upstream);
}

function spawnBots(room) {
  const existing = roomBots.get(room);
  if (existing?.some(child => child.exitCode === null)) return false;

  const children = [];
  for (let number = 1; number <= 3; number += 1) {
    const log = fs.openSync(path.join(logsDir, `mortal-${room}-${number}.log`), "a");
    const child = spawn(node, [
      bridge,
      "--room", room,
      "--name", `Mortal-${number}`,
      `http://127.0.0.1:${gamePort}/server`,
      poolClient,
      "--", "--pool-port", String(poolPort),
    ], {
      cwd: root,
      env: { ...process.env, PATH: `${path.dirname(node)}:${process.env.PATH || ""}` },
      stdio: ["ignore", log, log],
    });
    child.on("exit", () => fs.closeSync(log));
    children.push(child);
  }
  roomBots.set(room, children);
  return true;
}

function normalizePlayerName(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 20) || "本地玩家";
}

function filenamePlayerName(value) {
  return normalizePlayerName(value)
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_");
}

function localSeatMetadata(majiang, tenhou, requestedPlayerName) {
  const playerName = normalizePlayerName(requestedPlayerName);
  const tenhouNames = Array.isArray(tenhou?.name) ? tenhou.name : [];
  const majiangPlayers = Array.isArray(majiang?.player) ? majiang.player : [];
  const majiangPlayerID = majiangPlayers.findIndex(name => String(name).replace(/\n.*$/, "") === playerName);
  const qijia = Number.isInteger(majiang?.qijia) ? majiang.qijia : null;
  let targetPlayerID = tenhouNames.findIndex(name => String(name).replace(/\n.*$/, "") === playerName);
  if (targetPlayerID < 0 && majiangPlayerID >= 0 && qijia !== null) {
    targetPlayerID = (majiangPlayerID - qijia + 4) % 4;
  }
  const metadata = { format_version: 1, player_name: playerName };
  if (targetPlayerID >= 0 && targetPlayerID < 4) {
    metadata.target_player_id = targetPlayerID;
    metadata.starting_seat_index = targetPlayerID;
    metadata.starting_seat = ["东家", "南家", "西家", "北家"][targetPlayerID];
    metadata.starting_seat_code = ["E", "S", "W", "N"][targetPlayerID];
  }
  if (majiangPlayerID >= 0) metadata.majiang_player_id = majiangPlayerID;
  if (qijia !== null) metadata.initial_dealer_player_id = qijia;
  return metadata;
}

function savePaipu(payload) {
  const majiang = payload.majiang;
  const tenhou = payload.tenhou;
  if (!majiang || !tenhou) throw new Error("missing paipu");
  const playerName = normalizePlayerName(payload.player_name);
  const metadata = localSeatMetadata(majiang, tenhou, playerName);
  majiang._mortal = metadata;
  tenhou._mortal = metadata;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
  const seat = Number.isInteger(metadata.target_player_id) ? `_ID${metadata.target_player_id}` : "";
  const base = `${stamp}_${filenamePlayerName(playerName)}${seat}`;
  const files = [`${base}_Majiang.json`, `${base}_Tenhou.json`];
  fs.writeFileSync(path.join(paipuDir, files[0]), JSON.stringify(majiang, null, 2));
  fs.writeFileSync(path.join(paipuDir, files[1]), JSON.stringify(tenhou, null, 2));
  const decisions = Array.isArray(payload.review_decisions) ? payload.review_decisions : [];
  if (decisions.length) {
    const reviewDir = fs.mkdtempSync(path.join(logsDir, "review-build-"));
    const reportName = `${base}_Review.json`;
    try {
      fs.writeFileSync(path.join(reviewDir, "game-paipu.json"), JSON.stringify(majiang));
      fs.writeFileSync(path.join(reviewDir, "game-tenhou.json"), JSON.stringify(tenhou));
      fs.writeFileSync(path.join(reviewDir, "decisions.json"), JSON.stringify(decisions));
      const build = spawnSync(node, [
        path.join(root, "tools", "build-killer-report.js"),
        reviewDir,
        path.join(paipuDir, reportName),
      ], {
        cwd: root,
        env: {
          ...process.env,
          MORTAL_REVIEW_PLAYER: playerName,
          MORTAL_REVIEW_MODEL: path.basename(process.env.MORTAL_MODEL_PATH || "mortal-finetune-ours560-step-1100000.pth"),
        },
        encoding: "utf8",
      });
      if (build.status !== 0) {
        throw new Error((build.stderr || build.stdout || "Mortal review build failed").trim());
      }
      files.push(reportName);
    }
    finally {
      fs.rmSync(reviewDir, { recursive: true, force: true });
    }
  }
  return files;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function paipuIndex(res) {
  const files = fs.readdirSync(paipuDir)
    .filter(name => name.endsWith(".json"))
    .sort().reverse().slice(0, 100);
  const items = files.map(name => {
    const fileUrl = `${prefix}/mortal-api/files/${encodeURIComponent(name)}`;
    if (name.endsWith("_Review.json")) {
      const reviewUrl = `${prefix}/mortal-reviewer/?data=${encodeURIComponent(fileUrl)}&showMortal=1`;
      return `<li class="review"><a href="${reviewUrl}">Mortal复盘：${escapeHtml(name)}</a></li>`;
    }
    return `<li><a href="${fileUrl}">${escapeHtml(name)}</a></li>`;
  }).join("");
  const body = Buffer.from(`<!doctype html><meta charset="utf-8"><title>Mortal 麻将牌谱</title>
    <style>body{font:16px system-ui;margin:40px;max-width:1000px;background:#f7faf8;color:#173e35}li{margin:10px 0}a{color:#075e54}.review{font-weight:700}</style>
    <h1>Mortal 麻将牌谱</h1><p>“Mortal复盘”由本机 110 万步模型生成，其余文件可直接下载。</p><ul>${items || "<li>还没有牌谱</li>"}</ul>`);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": body.length });
  res.end(body);
}

async function handleApi(req, res, url) {
  try {
    if (url === "/mortal-api/room-ready" && req.method === "POST") {
      const payload = await readJson(req, 4096);
      const room = String(payload.room || "");
      if (!/^[A-HJ-NP-Z][0-9]{4}$/.test(room)) return json(res, 400, { error: "invalid room" });
      return json(res, 200, { ok: true, started: spawnBots(room) });
    }
    if (url === "/mortal-api/save-paipu" && req.method === "POST") {
      return json(res, 200, { ok: true, files: savePaipu(await readJson(req)) });
    }
    if (url === "/mortal-api/paipu" && req.method === "GET") return paipuIndex(res);
    if (url.startsWith("/mortal-api/files/") && req.method === "GET") {
      const name = path.basename(decodeURIComponent(url.slice("/mortal-api/files/".length)));
      const file = path.join(paipuDir, name);
      if (!name.endsWith(".json") || !fs.existsSync(file)) return json(res, 404, { error: "not found" });
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      });
      return fs.createReadStream(file).pipe(res);
    }
    if (url === "/mortal-api/react" && req.method === "POST") {
      return proxyHttp(req, res, advisorPort, "/react");
    }
    return json(res, 404, { error: "not found" });
  }
  catch (error) {
    console.error(error);
    if (!res.headersSent) json(res, 500, { error: error.message });
  }
}

const server = http.createServer((req, res) => {
  const url = stripPrefix(req.url);
  if (url === null) return json(res, 404, { error: "not found" });
  if (url === "/" || url.startsWith("/?")) {
    res.writeHead(302, { Location: `${prefix}/netplay.html?local=1&autostart=1&renderer=web` });
    return res.end();
  }
  if (url.startsWith("/mortal-api/")) return void handleApi(req, res, url);
  proxyHttp(req, res, gamePort, url);
});

server.on("upgrade", (req, socket, head) => {
  const url = stripPrefix(req.url);
  if (url === null || !url.startsWith("/server/socket.io/")) return socket.destroy();
  const upstream = net.connect(gamePort, "127.0.0.1", () => {
    let request = `${req.method} ${url} HTTP/${req.httpVersion}\r\n`;
    for (let index = 0; index < req.rawHeaders.length; index += 2) {
      const name = req.rawHeaders[index];
      const value = name.toLowerCase() === "host" ? `127.0.0.1:${gamePort}` : req.rawHeaders[index + 1];
      request += `${name}: ${value}\r\n`;
    }
    upstream.write(`${request}\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});

function shutdown() {
  for (const children of roomBots.values()) {
    for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

if (require.main === module) {
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  server.listen(listenPort, "127.0.0.1", () => {
    console.log(`Mortal web gateway listening on http://127.0.0.1:${listenPort}${prefix}/`);
  });
}

module.exports = { localSeatMetadata, savePaipu };
