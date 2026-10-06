#!/usr/bin/env node
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.MORTAL_REVIEWER_PORT || 4616);
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon"
};

const server = http.createServer((request, response) => {
  const raw = decodeURIComponent((request.url || "/").split("?")[0]);
  const relative = raw === "/" ? "reviewer/index.html" : raw.replace(/^\/+/, "");
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) {
    response.writeHead(403); response.end("Forbidden"); return;
  }
  fs.stat(target, (statError, stat) => {
    let file = target;
    if (!statError && stat.isDirectory()) file = path.join(target, "index.html");
    fs.readFile(file, (error, data) => {
      if (error) { response.writeHead(error.code === "ENOENT" ? 404 : 500); response.end("Not found"); return; }
      response.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
      response.end(data);
    });
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Mortal Reviewer: http://127.0.0.1:${port}/reviewer/`);
});
