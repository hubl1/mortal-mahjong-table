#!/usr/bin/env node

"use strict";

const path = require("path");

const root = path.resolve(process.env.MORTAL_ROOT || path.join(__dirname, ".."));
const { io } = require(path.join(root, "runtime", "node_modules", "socket.io-client"));
const origin = process.env.MORTAL_TEST_ORIGIN || "http://127.0.0.1:4614";

async function main() {
  const auth = await fetch(`${origin}/mortal/server/auth/`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ name: "本地玩家", passwd: "*" }),
  });
  const cookie = auth.headers.getSetCookie().find(value => value.startsWith("MAJIANG="));
  if (!cookie) throw new Error(`No MAJIANG cookie (HTTP ${auth.status})`);

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for three Mortal players")), 30000);
    let myuid;
    let done = false;
    const socket = io(origin, {
      path: "/mortal/server/socket.io/",
      extraHeaders: { Cookie: cookie },
    });
    socket.on("connect_error", reject);
    socket.on("ERROR", reject);
    socket.on("HELLO", user => {
      if (!user) return reject(new Error("Socket session was not authenticated"));
      if (done) return;
      myuid = user.uid;
      socket.emit("ROOM");
    });
    socket.on("ROOM", async room => {
      if (room.user.length === 1) {
        const response = await fetch(`${origin}/mortal/mortal-api/room-ready`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room: room.room_no }),
        });
        if (!response.ok) return reject(new Error(`room-ready HTTP ${response.status}`));
      }
      if (room.user.length === 4) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        console.log(JSON.stringify({ room: room.room_no, players: room.user.map(user => user.name) }));
        socket.emit("ROOM", room.room_no, myuid);
        setTimeout(() => {
          socket.close();
          resolve();
        }, 300);
      }
    });
  });
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
