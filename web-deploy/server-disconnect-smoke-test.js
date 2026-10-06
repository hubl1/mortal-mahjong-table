#!/usr/bin/env node

"use strict";

const assert = require("assert");
const Game = require("../runtime/node_modules/@kobalab/majiang-server/lib/game");

class FakeSocket {
  constructor(uid) {
    this.request = { user: { uid, name: uid } };
    this.events = [];
    this.handlers = {};
  }
  emit(name, payload) { this.events.push({ name, payload }); }
  on(name, handler) { this.handlers[name] = handler; }
  removeAllListeners(name) { delete this.handlers[name]; }
}

const sockets = [0, 1, 2, 3].map(index => new FakeSocket(`player-${index}`));
const game = new Game(sockets, () => {});
game._seq = 9;
game._model.player_id = [1, 2, 3, 0];
game._paipu = {
  qijia: 0,
  log: [[
    { qipai: { jushu: 1, shoupai: ["m123", "m456", "m789", "p123"] } },
    { zimo: { l: 3, p: "m4" } },
  ]],
};
const seatMessages = [0, 1, 2, 3].map(seat => ({
  zimo: { l: 3, p: seat === 3 ? "m4" : "" },
}));
game.call_players("zimo", seatMessages, 60_000);
clearTimeout(game._timeout_id);
game._timeout_id = null;
assert.strictEqual(game._pending_msg[0], seatMessages[3],
  "pending requests must be indexed by fixed player id, not wind/seat");

game.disconnect(sockets[0]);
assert.strictEqual(game._reply[0], undefined, "disconnect must not auto-reply");

const replacement = new FakeSocket("player-0");
game.connect(replacement);
const messages = replacement.events.filter(event => event.name === "GAME");
assert.ok(messages[0].payload.kaiju, "reconnect must receive game history");
assert.strictEqual(messages[0].payload.kaiju.log[0].length, 1,
  "pending event must be removed from replay history");
assert.deepStrictEqual(messages[1].payload, game._pending_msg[0],
  "reconnect must receive the unanswered request with its sequence number");

console.log(JSON.stringify({ pause_on_disconnect: true, resume_on_reconnect: true }));
