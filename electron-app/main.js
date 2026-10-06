"use strict";

const { app, BrowserWindow, ipcMain, Menu, shell } = require("electron");
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");

let mainWindow;
let serverProcess;
let poolProcess;
const bridgeProcesses = [];
const logDescriptors = [];
let room = "";
let botsStarted = false;
let stopping = false;
let port = 0;

function resources() {
  if (!app.isPackaged) {
    const root = path.resolve(__dirname, "..");
    return {
      webRoot: path.join(root, "vendor", "Majiang-master", "dist"),
      serverRoot: path.join(root, "runtime"),
      poolClient: path.join(root, "runtime", "bin", "mortal-pool-client"),
      model: path.join(root, "models", "mortal-finetune-ours560-step-1100000.pth"),
      botRoot: path.join(root, "vendor", "Akagi-MjaiBot-Mortal-main"),
      engine: path.join(root, ".venv311", "bin", "python"),
      engineArgs: [path.join(root, "vendor", "Akagi-MjaiBot-Mortal-main", "bot_pool.py")],
    };
  }

  const root = process.resourcesPath;
  if (process.platform === "win32") {
    return {
      webRoot: path.join(root, "game"),
      serverRoot: path.join(root, "server"),
      poolClient: path.join(root, "shared", "mortal-pool-client.js"),
      model: path.join(root, "models", "mortal.pth"),
      botRoot: path.join(root, "bot"),
      engine: path.join(root, "engine", "python", "python.exe"),
      engineArgs: [path.join(root, "bot", "bot_pool.py")],
    };
  }

  return {
    webRoot: path.join(root, "game"),
    serverRoot: path.join(root, "server"),
    poolClient: path.join(root, "shared", "mortal-pool-client.js"),
    model: path.join(root, "models", "mortal.pth"),
    botRoot: path.join(root, "bot"),
    engine: path.join(root, "engine", "mortal-engine"),
    engineArgs: [],
  };
}

function validateResources(layout) {
  const required = [
    path.join(layout.webRoot, "netplay.html"),
    path.join(layout.serverRoot, "node_modules", "@kobalab", "majiang-server", "bin", "server.js"),
    path.join(layout.serverRoot, "node_modules", "@kobalab", "majiang-server", "bin", "bridge.js"),
    layout.poolClient,
    layout.model,
    layout.engine,
    ...layout.engineArgs,
  ];
  const missing = required.filter((file) => !fs.existsSync(file));
  if (missing.length) throw new Error(`安装包缺少运行文件：\n${missing.join("\n")}`);
}

function logsDirectory() {
  const directory = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function spawnLogged(command, args, logName, options = {}) {
  const logPath = path.join(logsDirectory(), logName);
  const descriptor = fs.openSync(logPath, "w");
  logDescriptors.push(descriptor);
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["ignore", descriptor, descriptor],
  });
  child.on("error", (error) => fs.appendFileSync(logPath, `\nprocess error: ${error.stack || error}\n`));
  return child;
}

function nodeEnvironment(layout) {
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    MORTAL_ELECTRON_NODE_CLIENT: "1",
    NODE_PATH: path.join(layout.serverRoot, "node_modules"),
  };
}

function engineEnvironment(layout) {
  const environment = {
    ...process.env,
    MORTAL_MODEL_PATH: layout.model,
    PYTHONUTF8: "1",
    PYTHONUNBUFFERED: "1",
  };

  if (process.platform === "win32") {
    const pythonRoot = path.dirname(layout.engine);
    const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === "path") || "Path";
    const runtimeDirectories = [
      pythonRoot,
      path.join(pythonRoot, "Lib", "site-packages", "torch", "lib"),
      path.join(pythonRoot, "Lib", "site-packages", "numpy.libs"),
    ];
    environment[pathKey] = [...runtimeDirectories, environment[pathKey] || ""].join(path.delimiter);
  }

  return environment;
}

function startServer(layout) {
  const script = path.join(layout.serverRoot, "node_modules", "@kobalab", "majiang-server", "bin", "server.js");
  const platform = process.platform === "win32" ? "windows" : "macos";
  const callback = `/netplay.html?local=1&autostart=1&renderer=electron&platform=${platform}`;
  serverProcess = spawnLogged(
    process.execPath,
    [script, "--port", String(port), "--docroot", layout.webRoot, "--callback", callback, "--status"],
    "server.log",
    { cwd: layout.serverRoot, env: nodeEnvironment(layout) },
  );
}

function canListen(portToCheck) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", () => resolve(false));
    probe.listen({ host: "127.0.0.1", port: portToCheck, exclusive: true }, () => {
      probe.close(() => resolve(true));
    });
  });
}

async function chooseAvailablePortSet() {
  // The table, shared bot pool, and recommendation service use these three
  // related ports. Checking all of them prevents a stale process from leaving
  // the game playable while the Mortal recommendation button stays disabled.
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const candidate = 47100 + Math.floor(Math.random() * 900);
    if (await canListen(candidate)
        && await canListen(candidate + 10000)
        && await canListen(candidate + 11000)) {
      return candidate;
    }
  }
  throw new Error("找不到可用的本地端口，请退出旧的 Mortal 麻将后重试。");
}

async function waitForServer() {
  const url = `http://127.0.0.1:${port}/netplay.html`;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (_) {
      // The local server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("本地牌桌没有在预期时间内启动，请查看应用日志。");
}

function recentLog(logName) {
  try {
    const contents = fs.readFileSync(path.join(logsDirectory(), logName), "utf8");
    return contents.slice(-6000).trim();
  } catch (_) {
    return "";
  }
}

async function waitForTcpServer(portToCheck, child, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      const details = recentLog("mortal-pool.log");
      throw new Error(details || `推理进程提前退出（代码 ${child.exitCode ?? child.signalCode}）`);
    }

    const ready = await new Promise((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port: portToCheck });
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(value);
      };
      socket.setTimeout(500, () => finish(false));
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
    });
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const details = recentLog("mortal-pool.log");
  throw new Error(details || "Mortal 推理服务在 90 秒内没有启动。");
}

async function authenticatePlayer() {
  const body = Buffer.from(`name=${encodeURIComponent("本地玩家")}&passwd=*`);
  await mainWindow.loadURL(`http://127.0.0.1:${port}/server/auth/`, {
    postData: [{ type: "rawData", bytes: body }],
    extraHeaders: "Content-Type: application/x-www-form-urlencoded; charset=utf-8\n",
  });
}

async function startBots(layout) {
  const poolPort = port + 10000;
  poolProcess = spawnLogged(
    layout.engine,
    [
      ...layout.engineArgs,
      "--port", String(poolPort),
      "--http-port", String(port + 11000),
    ],
    "mortal-pool.log",
    {
      cwd: layout.botRoot,
      env: engineEnvironment(layout),
    },
  );

  // On Windows, importing the bundled PyTorch runtime is substantially slower
  // than opening the game window.  Do not launch bridge clients until the
  // shared Mortal pool is actually accepting connections.
  await waitForTcpServer(poolPort, poolProcess);

  const bridge = path.join(layout.serverRoot, "node_modules", "@kobalab", "majiang-server", "bin", "bridge.js");
  const serverURL = `http://127.0.0.1:${port}/server`;
  for (let number = 1; number <= 3; number += 1) {
    bridgeProcesses.push(spawnLogged(
      process.execPath,
      [
        bridge,
        "--room", room,
        "--name", `Mortal-${number}`,
        serverURL,
        process.execPath,
        "--", layout.poolClient,
        "--pool-port", String(poolPort),
      ],
      `mortal-${number}.log`,
      { cwd: layout.serverRoot, env: nodeEnvironment(layout) },
    ));
  }
}

function localSeatMetadata(majiang, tenhou) {
  const playerName = "本地玩家";
  const tenhouNames = Array.isArray(tenhou?.name) ? tenhou.name : [];
  const majiangPlayers = Array.isArray(majiang?.player) ? majiang.player : [];
  const majiangPlayerID = majiangPlayers.indexOf(playerName);
  const qijia = Number.isInteger(majiang?.qijia) ? majiang.qijia : null;
  let targetPlayerID = tenhouNames.indexOf(playerName);
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

function showTransientTitle(message) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setTitle(`Mortal麻将 — ${message}`);
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle("Mortal麻将");
  }, 5000);
}

function savePaipu(payload) {
  if (!payload?.majiang || !payload?.tenhou) {
    showTransientTitle("牌谱导出失败：数据不完整");
    return;
  }
  try {
    const metadata = localSeatMetadata(payload.majiang, payload.tenhou);
    payload.majiang._mortal = metadata;
    payload.tenhou._mortal = metadata;
    const directory = path.join(app.getPath("documents"), "Mortal麻将牌谱");
    fs.mkdirSync(directory, { recursive: true });
    const stamp = new Date().toISOString().replace("T", "_").replace(/:/g, "-").replace(/\.\d+Z$/, "");
    const id = Number.isInteger(metadata.target_player_id) ? `_ID${metadata.target_player_id}` : "";
    const basename = `${stamp}_${room || "local"}${id}`;
    fs.writeFileSync(path.join(directory, `${basename}_Majiang.json`), `${JSON.stringify(payload.majiang, null, 2)}\n`);
    fs.writeFileSync(path.join(directory, `${basename}_Tenhou.json`), `${JSON.stringify(payload.tenhou, null, 2)}\n`);
    showTransientTitle("两份牌谱已保存");
  } catch (error) {
    showTransientTitle(`牌谱导出失败：${error.message}`);
  }
}

function openPaipuDirectory() {
  const directory = path.join(app.getPath("documents"), "Mortal麻将牌谱");
  fs.mkdirSync(directory, { recursive: true });
  shell.openPath(directory).then((error) => {
    if (error) showTransientTitle(`打开牌谱文件夹失败：${error}`);
  });
}

function terminateTree(child) {
  if (!child || child.killed || !child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
  } else {
    try { process.kill(-child.pid, "SIGTERM"); } catch (_) {
      try { child.kill("SIGTERM"); } catch (_) { /* already stopped */ }
    }
  }
}

function stopEverything() {
  if (stopping) return;
  stopping = true;
  for (const processHandle of bridgeProcesses.reverse()) terminateTree(processHandle);
  terminateTree(poolProcess);
  terminateTree(serverProcess);
  for (const descriptor of logDescriptors) {
    try { fs.closeSync(descriptor); } catch (_) { /* already closed */ }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 850,
    minWidth: 800,
    minHeight: 680,
    useContentSize: true,
    backgroundColor: "#123f34",
    title: "Mortal麻将",
    autoHideMenuBar: process.platform === "win32",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // The upstream page advertises itself as “電脳麻将: ネット対戦”.  Keep the
  // native application title stable across every navigation instead.
  mainWindow.webContents.on("page-title-updated", (event) => {
    event.preventDefault();
    mainWindow.setTitle("Mortal麻将");
  });
  mainWindow.setAspectRatio(800 / 680);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.loadFile(path.join(__dirname, "status.html"));
}

function installMenu() {
  const openLogs = { label: "打开日志文件夹", click: () => shell.openPath(logsDirectory()) };
  const template = process.platform === "darwin" ? [
    { label: app.name, submenu: [{ role: "about" }, { type: "separator" }, openLogs, { type: "separator" }, { role: "quit" }] },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ] : [
    { label: "文件", submenu: [openLogs, { type: "separator" }, { role: "quit" }] },
    { role: "viewMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.on("mortal-message", (event, payload) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || typeof payload !== "object") return;
  if (payload.type === "room-ready" && !botsStarted && /^[A-Z][0-9]{4}$/.test(payload.room || "")) {
    room = payload.room;
    botsStarted = true;
    startBots(resources()).catch((error) => {
      botsStarted = false;
      console.error("Mortal startup failed", error);
      showTransientTitle(`Mortal启动失败：${String(error.message || error).split("\n")[0]}`);
    });
  } else if (payload.type === "game-ended") {
    savePaipu(payload);
  } else if (payload.type === "open-paipu-directory") {
    openPaipuDirectory();
  }
});

app.whenReady().then(async () => {
  try {
    const layout = resources();
    validateResources(layout);
    installMenu();
    createWindow();
    port = await chooseAvailablePortSet();
    startServer(layout);
    await waitForServer();
    await authenticatePlayer();
  } catch (error) {
    if (!mainWindow) createWindow();
    const html = `<body style="background:#123f34;color:white;font-family:sans-serif;padding:40px"><h2>启动失败</h2><pre style="white-space:pre-wrap">${String(error.stack || error)}</pre></body>`;
    await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  }
});

app.on("before-quit", stopEverything);
app.on("window-all-closed", () => app.quit());
