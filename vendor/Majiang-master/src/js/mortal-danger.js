"use strict";

// This is the same lightweight danger model used by killer-reviewer.  It is
// intentionally kept separate from Mortal's Q values: the model estimates how
// likely a tile is to deal into each riichi opponent, not how costly that deal
// in would be.
const WEIGHTS = Object.freeze({
    ryanmen: 3.5,
    honorTankiShanpon: 1.7,
    nonHonorTankiShanpon: 1.0,
    kanchan: 0.21,
    kanchanRiichiSujiTrap: 2.6,
    uraSuji: 1.3,
    matagiSujiEarly: 0.6,
    matagiSujiRiichi: 1.2,
    doraGreed: 1.2,
    akaDiscard: 0.14,
});

const WAIT_TYPE = Object.freeze({
    ryanmen: 0, kanchan: 1, penchan: 2, tanki: 3, shanpon: 4,
});

const RISK_BAR_MAX = 15;

function tileToInt(tile) {
    if (! tile || tile == '?') return null;
    const honors = { E:41, S:42, W:43, N:44, P:45, F:46, C:47 };
    if (honors[tile]) return honors[tile];
    const match = String(tile).match(/^([1-9])([mps])(r?)$/);
    if (! match) return null;
    const suit = { m:1, p:2, s:3 }[match[2]];
    return match[3] ? 50 + suit : suit * 10 + Number(match[1]);
}

function normalizeRedFive(tile) {
    if (tile == 51) return 15;
    if (tile == 52) return 25;
    if (tile == 53) return 35;
    return tile;
}

function intToTile(tile) {
    const honors = { 41:'E', 42:'S', 43:'W', 44:'N', 45:'P', 46:'F', 47:'C' };
    if (honors[tile]) return honors[tile];
    const suit = { 1:'m', 2:'p', 3:'s' }[Math.floor(tile / 10)];
    return suit ? `${tile % 10}${suit}` : null;
}

function doraIndicatorToDora(indicator) {
    indicator = normalizeRedFive(indicator);
    if (indicator == null) return null;
    if (indicator % 10 == 9) return indicator - 8;
    if (indicator == 44) return 41;
    if (indicator == 47) return 45;
    return indicator + 1;
}

function generateWaits() {
    const waits = [];
    for (const shape of [[2,3],[3,4],[4,5],[5,6],[6,7],[7,8]]) {
        for (let suit = 1; suit <= 3; suit++) {
            waits.push({
                tiles: shape.map(rank=>suit * 10 + rank),
                waitsOn: [suit * 10 + shape[0] - 1, suit * 10 + shape[1] + 1],
                type: WAIT_TYPE.ryanmen,
            });
        }
    }
    for (const shape of [[1,3],[2,4],[3,5],[4,6],[5,7],[6,8],[7,9]]) {
        for (let suit = 1; suit <= 3; suit++) {
            waits.push({
                tiles: shape.map(rank=>suit * 10 + rank),
                waitsOn: [suit * 10 + shape[0] + 1],
                type: WAIT_TYPE.kanchan,
            });
        }
    }
    for (const shape of [[1,2,3],[8,9,7]]) {
        for (let suit = 1; suit <= 3; suit++) {
            waits.push({
                tiles: [suit * 10 + shape[0], suit * 10 + shape[1]],
                waitsOn: [suit * 10 + shape[2]],
                type: WAIT_TYPE.penchan,
            });
        }
    }
    for (let rank = 1; rank <= 9; rank++) {
        for (const type of [WAIT_TYPE.tanki, WAIT_TYPE.shanpon]) {
            for (let suit = 1; suit <= 4; suit++) {
                if (suit == 4 && rank > 7) continue;
                waits.push({
                    tiles: Array(type == WAIT_TYPE.tanki ? 1 : 2).fill(suit * 10 + rank),
                    waitsOn: [suit * 10 + rank], type,
                });
            }
        }
    }
    return waits;
}

const WAITS = generateWaits();

function calculateDangerRates(genbutsu, discardsToRiichi, unseenTiles, dora) {
    const normalizedDiscards = discardsToRiichi.map(normalizeRedFive);
    const riichiTile = normalizedDiscards[normalizedDiscards.length - 1];
    const combos = { all: 0 };

    for (const wait of WAITS) {
        if (wait.waitsOn.some(tile=>genbutsu.has(tile))) continue;

        const involvedTiles = wait.tiles.concat(wait.waitsOn);
        let waitCombos = 1;
        wait.tiles.forEach((tile, index)=>{
            const remaining = Math.max(0, Number(unseenTiles[tile] || 0)
                - (index > 0 && wait.type == WAIT_TYPE.shanpon ? 1 : 0));
            waitCombos *= remaining;
        });
        if (wait.type == WAIT_TYPE.shanpon) waitCombos /= wait.tiles.length;

        const tankiOrShanpon = [WAIT_TYPE.tanki, WAIT_TYPE.shanpon].includes(wait.type);
        if (wait.type == WAIT_TYPE.ryanmen) {
            let uraSuji = false;
            let matagiSujiEarly = false;
            let matagiSujiRiichi = false;
            for (const discard of normalizedDiscards) {
                if (wait.tiles.includes(discard)) continue;
                if (wait.tiles.some(tile=>discard % 10 >= 4 && discard % 10 <= 6
                                      && Math.abs(discard - tile) == 2)) uraSuji = true;
            }
            for (const discard of normalizedDiscards) {
                if (! wait.tiles.includes(discard)) continue;
                if (discard == riichiTile) matagiSujiRiichi = true;
                else matagiSujiEarly = true;
            }
            waitCombos *= WEIGHTS.ryanmen;
            if (uraSuji) waitCombos *= WEIGHTS.uraSuji;
            if (matagiSujiEarly) waitCombos *= WEIGHTS.matagiSujiEarly;
            if (matagiSujiRiichi) waitCombos *= WEIGHTS.matagiSujiRiichi;
        }
        else if (tankiOrShanpon && wait.tiles[0] > 40) {
            waitCombos *= WEIGHTS.honorTankiShanpon;
        }
        else if (tankiOrShanpon) {
            waitCombos *= WEIGHTS.nonHonorTankiShanpon;
        }
        else if (wait.type == WAIT_TYPE.kanchan) {
            const isRiichiTrap = riichiTile != null && riichiTile % 10 >= 4
                && riichiTile % 10 <= 6 && Math.abs(wait.waitsOn[0] - riichiTile) == 3;
            waitCombos *= isRiichiTrap
                ? WEIGHTS.kanchanRiichiSujiTrap : WEIGHTS.kanchan;
        }

        if (involvedTiles.includes(dora)) waitCombos *= WEIGHTS.doraGreed;
        const akaInvolved = discardsToRiichi.some(discard=>discard > 50
            && involvedTiles.includes(normalizeRedFive(discard)));
        if (akaInvolved) waitCombos *= WEIGHTS.akaDiscard;

        combos.all += waitCombos;
        const winningCombos = wait.type == WAIT_TYPE.shanpon ? waitCombos * 2 : waitCombos;
        for (const tile of wait.waitsOn) combos[tile] = (combos[tile] || 0) + winningCombos;
    }

    const rates = {};
    for (let suit = 1; suit <= 4; suit++) {
        const maxRank = suit == 4 ? 7 : 9;
        for (let rank = 1; rank <= maxRank; rank++) {
            const tile = suit * 10 + rank;
            rates[intToTile(tile)] = combos.all ? (combos[tile] || 0) / combos.all * 100 : 0;
        }
    }
    return rates;
}

function freshUnseenTiles() {
    const unseen = {};
    for (let suit = 1; suit <= 4; suit++) {
        const maxRank = suit == 4 ? 7 : 9;
        for (let rank = 1; rank <= maxRank; rank++) unseen[suit * 10 + rank] = 4;
    }
    return unseen;
}

class MortalDangerTracker {
    constructor() {
        this.playerID = null;
        this.round = null;
    }

    _see(tile) {
        const value = normalizeRedFive(tileToInt(tile));
        if (value == null || ! this.round) return;
        this.round.unseen[value] = Math.max(0, Number(this.round.unseen[value] || 0) - 1);
    }

    observe(event) {
        if (! event) return;
        if (event.type == 'start_game') {
            this.playerID = Number(event.id);
            return;
        }
        if (event.type == 'start_kyoku') {
            const unseen = freshUnseenTiles();
            const fallbackID = Array.isArray(event.tehais)
                ? event.tehais.findIndex(hand=>Array.isArray(hand) && hand.some(tile=>tile != '?')) : 0;
            if (! Number.isInteger(this.playerID) || this.playerID < 0) this.playerID = Math.max(0, fallbackID);
            this.round = {
                unseen,
                dora: doraIndicatorToDora(tileToInt(event.dora_marker)),
                opponents: Array.from({ length: 4 }, ()=>({
                    genbutsu: new Set(), discardsToRiichi: [], reachAccepted: false,
                })),
            };
            for (const tile of event.tehais?.[this.playerID] || []) this._see(tile);
            this._see(event.dora_marker);
            return;
        }
        if (! this.round) return;

        if (event.type == 'tsumo') {
            if (event.actor == this.playerID) this._see(event.pai);
        }
        else if (event.type == 'dahai') {
            const actor = Number(event.actor);
            const rawTile = tileToInt(event.pai);
            const tile = normalizeRedFive(rawTile);
            if (actor != this.playerID) this._see(event.pai);
            this.round.opponents.forEach((opponent, player)=>{
                if (player == this.playerID || tile == null) return;
                if (player == actor || opponent.reachAccepted) opponent.genbutsu.add(tile);
            });
            const opponent = this.round.opponents[actor];
            if (actor != this.playerID && opponent && ! opponent.reachAccepted && rawTile != null) {
                opponent.discardsToRiichi.push(rawTile);
            }
        }
        else if (['chi','pon','daiminkan','ankan'].includes(event.type)) {
            if (event.actor != this.playerID) {
                for (const tile of event.consumed || []) this._see(tile);
            }
        }
        else if (event.type == 'kakan') {
            // The three pon tiles in `consumed` were already visible.  Only the
            // newly added fourth tile leaves the opponent's concealed hand.
            if (event.actor != this.playerID) this._see(event.pai);
        }
        else if (event.type == 'dora') {
            this._see(event.dora_marker);
        }
        else if (event.type == 'reach_accepted') {
            const opponent = this.round.opponents[Number(event.actor)];
            if (opponent) opponent.reachAccepted = true;
        }
        else if (event.type == 'end_kyoku') {
            this.round = null;
        }
    }

    snapshot() {
        if (! this.round || ! Number.isInteger(this.playerID)) {
            return { opponents: [], barMax: RISK_BAR_MAX };
        }
        const relative = {
            1: { key:'shimo', label:'下家' },
            2: { key:'toimen', label:'对面' },
            3: { key:'kami', label:'上家' },
        };
        const opponents = [];
        this.round.opponents.forEach((opponent, actor)=>{
            if (actor == this.playerID || ! opponent.reachAccepted) return;
            const seat = relative[(actor - this.playerID + 4) % 4];
            if (! seat) return;
            opponents.push({
                actor, seat: seat.key, label: seat.label,
                rates: calculateDangerRates(opponent.genbutsu,
                    opponent.discardsToRiichi, this.round.unseen, this.round.dora),
            });
        });
        return { opponents, barMax: RISK_BAR_MAX };
    }
}

module.exports = {
    MortalDangerTracker, calculateDangerRates, tileToInt, normalizeRedFive,
    doraIndicatorToDora, RISK_BAR_MAX,
};
