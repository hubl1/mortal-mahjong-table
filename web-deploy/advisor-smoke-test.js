#!/usr/bin/env node

"use strict";

const url = process.env.MORTAL_TEST_ADVISOR || "http://127.0.0.1:4614/mortal/mortal-api/react";
const session = `smoke-${Date.now()}`;
const unknown = Array(13).fill("?");
const events = [
  { type: "start_game", id: 0 },
  {
    type: "start_kyoku", bakaze: "E", kyoku: 1, honba: 0, kyotaku: 0,
    oya: 0, scores: [25000, 25000, 25000, 25000],
    tehais: [
      ["1m", "2m", "3m", "4m", "5m", "6m", "1p", "2p", "3p", "1s", "2s", "E", "E"],
      unknown, unknown, unknown,
    ],
    dora_marker: "4p",
  },
  { type: "tsumo", actor: 0, pai: "9s" },
];

async function react(batch) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session, events: batch }),
  });
  if (!response.ok) throw new Error(`advisor HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

react(events).then(async result => {
  console.log(JSON.stringify({
    type: result.type,
    pai: result.pai,
    q_values: result.meta?.q_values?.length || 0,
    device_test: "ok",
  }));
  await react([{ type: "end_game" }]);
}).catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
