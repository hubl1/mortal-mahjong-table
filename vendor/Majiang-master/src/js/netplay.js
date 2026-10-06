/*!
 *  電脳麻将: ネット対戦 v2.5.4
 *
 *  Copyright(C) 2017 Satoshi Kobayashi
 *  Released under the MIT license
 *  https://github.com/kobalab/Majiang/blob/master/LICENSE
 */
"use strict";

const { hide, show, fadeIn, scale,
        setSelector, clearSelector  } = Majiang.UI.Util;

const preset = require('./conf/rule.json');
const logconv = require('@kobalab/tenhou-url-log');
const converter = require('../../../../runtime/node_modules/@kobalab/mjai-bot/lib/convert');
const { MortalDangerTracker } = require('./mortal-danger');

const base = location.pathname.replace(/\/[^\/]*?$/,'');
const localParams = new URLSearchParams(location.search);
const localMode = localParams.get('local') == '1';
const localAutostart = localParams.get('autostart') == '1';
const localRule = localParams.get('rule') || 'Mリーグルール';
const localPlatform = localParams.get('platform') || '';
const remoteWebMode = localMode && localParams.get('renderer') == 'web';
const windowsDesktop = localMode && localPlatform == 'windows';
const touchWebMode = remoteWebMode
                  && window.matchMedia?.('(pointer: coarse)').matches;
const tabletWebMode = touchWebMode
                   && navigator.maxTouchPoints > 0
                   && Math.min(screen.width, screen.height) >= 600;
if (localMode) {
    // The native macOS table intentionally has its own compact landscape UI.
    // Android uses mortal-android.js and keeps the phone-specific layout.
    document.documentElement.classList.add('local-app', 'desktop-app');
    if (localParams.get('renderer') == 'electron') {
        document.documentElement.classList.add('electron-app');
    }
    if (windowsDesktop) {
        document.documentElement.classList.add('windows-app');
    }
    if (tabletWebMode) {
        document.documentElement.classList.add('tablet-web');
    }
    if (touchWebMode) {
        document.documentElement.classList.add('touch-web');
    }
}

let loaded;
let fitFrame;
let remotePaipuSavePromise = null;
let remotePaipuFiles = [];
let localReviewPlayerID = 0;
let localPlayerName = '本地玩家';

function normalizeLocalPlayerName(value) {
    return String(value || '')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, 20);
}

function requestRemotePlayerName() {
    if (! remoteWebMode) return Promise.resolve(localPlayerName);

    const saved = normalizeLocalPlayerName(
        localStorage.getItem('Mortal.playerName')
    );
    if (saved) {
        localPlayerName = saved;
        return Promise.resolve(saved);
    }

    return new Promise(resolve=>{
        $('body').append(`
          <div id="mortal-name-panel">
            <form class="name-card" autocomplete="off">
              <h1>Mortal 麻将</h1>
              <p>请输入你的名字</p>
              <input name="player-name" maxlength="20" placeholder="玩家名称" autofocus>
              <div class="name-error" aria-live="polite"></div>
              <button type="submit">进入牌桌</button>
              <small>该名字将显示在牌桌和保存的牌谱中</small>
              <div class="source-offer">
                <strong>本项目开源</strong>
                <a href="https://github.com/hubl1/mortal-mahjong-table"
                   target="_blank" rel="noopener noreferrer">查看源代码与许可证 →</a>
              </div>
            </form>
          </div>`);
        const panel = $('#mortal-name-panel');
        const form = $('form', panel);
        const input = $('input[name="player-name"]', form);
        form.on('submit', event=>{
            event.preventDefault();
            const name = normalizeLocalPlayerName(input.val());
            if (! name) {
                $('.name-error', form).text('请输入至少一个字符');
                input.trigger('focus');
                return;
            }
            localPlayerName = name;
            localStorage.setItem('Mortal.playerName', name);
            panel.remove();
            resolve(name);
        });
        setTimeout(()=>input.trigger('focus'), 0);
    });
}

function pinLocalViewport() {
    if (! localMode) return;
    document.documentElement.scrollTop = 0;
    document.documentElement.scrollLeft = 0;
    document.body.scrollTop = 0;
    document.body.scrollLeft = 0;
    window.scrollTo(0, 0);
}

function installTabletFullscreen() {
    if (! tabletWebMode || $('#tablet-fullscreen').length) return;
    $('body').append('<button id="tablet-fullscreen" type="button">全屏显示</button>');
    const button = $('#tablet-fullscreen');
    button.on('click', async ()=>{
        try {
            await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
            try { await screen.orientation?.lock?.('landscape'); }
            catch (_) {}
        }
        catch (error) {
            console.warn('无法进入全屏', error);
        }
        setTimeout(fitBoard, 50);
    });
    document.addEventListener('fullscreenchange', ()=>setTimeout(fitBoard, 50));
}

class LocalHumanPlayer extends Majiang.UI.Player {
    bind_touch_action(list) {
        if (! touchWebMode) return;
        list.off('.mortal-touch').on('touchend.mortal-touch', event=>{
            // A synthetic click on Android can be lost when focus changes or
            // can bubble to the board-wide "skip" handler.  Resolve the touch
            // directly on the intended control and suppress that later click.
            event.preventDefault();
            event.stopImmediatePropagation();
            $(event.currentTarget).triggerHandler('click');
        });
    }

    clear_button() {
        $('.button', this._node.button).off('.mortal-touch');
        super.clear_button();
    }

    // The upstream selector automatically focuses the last legal tile/action.
    // WKWebView responds by panning its visual viewport to keep that element in
    // view.  Build the same selectors without an initial focus, so the layout
    // never moves and keyboard navigation still begins normally on first use.
    select_dapai(lizhi) {
        if (lizhi) this._default_reply = { dapai: lizhi[0] + '*' };

        for (let p of lizhi || this.get_dapai(this.shoupai)) {
            let tile = $(p.slice(-1) == '_'
                ? `.zimo .pai[data-pai="${p.slice(0,2)}"]`
                : `> .pai[data-pai="${p}"]`, this._node.dapai);
            if (lizhi) {
                tile.addClass('blink');
                p += '*';
            }
            tile.attr('tabindex', 0).attr('role', 'button')
                .on('click.dapai', event=>{
                    $(event.target).addClass('dapai');
                    this.callback({ dapai: p });
                });
        }

        setSelector($('.pai[tabindex]', this._node.dapai),
                    'dapai', { focus: null });
        pinLocalViewport();
    }

    show_button(callback = ()=>{}) {
        this.show_timer();
        if (! this._show_button) return callback();
        const handler = ()=>{ this.clear_button(); callback(); };
        this.set_button('cansel', handler);
        this._node.root.on('click.button', handler);

        show(this._node.button.width($(this._node.dapai).width()));
        setSelector($('.button[tabindex]', this._node.button),
                    'button', { focus: null, touch: false });
        this.bind_touch_action($('.button[tabindex]', this._node.button));
        pinLocalViewport();
    }

    select_mianzi(mianzi) {
        const result = super.select_mianzi(mianzi);
        this.bind_touch_action($('.mianzi', this._node.mianzi));
        return result;
    }
}

const ADVICE_ACTIONS = [
    '1m','2m','3m','4m','5m','6m','7m','8m','9m',
    '1p','2p','3p','4p','5p','6p','7p','8p','9p',
    '1s','2s','3s','4s','5s','6s','7s','8s','9s',
    'E','S','W','N','P','F','C','5mr','5pr','5sr',
    'reach','chi_low','chi_mid','chi_high','pon','kan','hora','ryukyoku','none'
];

function adviceSoftmax(values, temperature = 0.3) {
    if (! values.length) return [];
    const peak = Math.max(...values);
    const exps = values.map(value => Math.exp((value - peak) / temperature));
    const total = exps.reduce((sum, value)=>sum + value, 0) || 1;
    return exps.map(value=>value / total);
}

function adviceTileCode(tile) {
    if (! tile) return null;
    const honors = { E:'z1', S:'z2', W:'z3', N:'z4', P:'z5', F:'z6', C:'z7' };
    if (honors[tile]) return honors[tile];
    const match = tile.match(/^([1-9])([mps])(r?)$/);
    if (! match) return null;
    return `${match[2]}${match[3] ? 0 : match[1]}`;
}

function adviceTileHTML(tile) {
    const code = adviceTileCode(tile);
    return code ? `<img class="pai" src="img/skin-classic2d/${code}.png" alt="${tile}">` : '';
}

function adviceActionName(action, result) {
    if (/^[1-9][mps]r?$/.test(action) || /^[ESWNPFC]$/.test(action)) {
        // The tile image already makes a discard unambiguous.  Omitting the
        // repeated "切" keeps the recommendation list compact and natural.
        return '';
    }
    const labels = {
        reach: '立直', chi_low: '吃（低）', chi_mid: '吃（中）',
        chi_high: '吃（高）', pon: '碰', kan: '杠', hora: '和牌',
        ryukyoku: '九种九牌', none: '跳过'
    };
    let label = labels[action] || action;
    return label;
}

function adviceDangerForTile(danger, tile) {
    if (! tile || ! danger?.opponents?.length) return [];
    const normalized = tile.replace(/^5([mps])r$/, '5$1');
    return danger.opponents.map(opponent=>({
        seat: opponent.seat,
        label: opponent.label,
        rate: Number(opponent.rates?.[normalized] || 0),
        barMax: Number(danger.barMax || 15),
    }));
}

function adviceDangerHTML(risks) {
    if (! risks?.length) return '<span class="advice-risk-empty">—</span>';
    return `<span class="advice-risk">${risks.map(risk=>{
        const width = Math.max(0, Math.min(100, risk.rate / risk.barMax * 100));
        return `<span class="advice-risk-lane" title="${risk.label}铳率估算 ${risk.rate.toFixed(1)}%">
          <span class="advice-risk-seat ${risk.seat}">${risk.label.slice(0, 1)}</span>
          <span class="advice-risk-track"><span class="advice-risk-fill ${risk.seat}" style="width:${width.toFixed(1)}%"></span></span>
          <span class="advice-risk-value">${risk.rate.toFixed(1)}%</span>
        </span>`;
    }).join('')}</span>`;
}

function installAdviceUI() {
    $('body').append(`
      <button id="mortal-advice-button" type="button">Mortal 推荐</button>
      <div id="mortal-advice-panel" class="hide" aria-hidden="true">
        <div class="advice-card" role="dialog" aria-modal="true" aria-label="Mortal 推荐">
          <div class="advice-title"><span>Mortal 推荐</span><button class="advice-close" type="button">×</button></div>
          <div class="advice-best"><span class="label">首选</span><span class="action">正在计算…</span></div>
          <div class="advice-list"></div>
        </div>
      </div>`);

    const button = $('#mortal-advice-button');
    const panel = $('#mortal-advice-panel');
    let latest = null;
    let status = 'waiting';
    let current = false;

    function close() {
        panel.addClass('hide').attr('aria-hidden', 'true');
    }
    function statusText() {
        if (status == 'pending') return '正在分析当前局面…';
        if (status == 'error') return '推荐服务暂时没有响应，请继续打牌后再试';
        return '轮到你操作时会生成推荐';
    }
    function render() {
        if (! latest) {
            $('.advice-title > span', panel).text('Mortal 推荐');
            $('.advice-best .label', panel).text('状态');
            $('.advice-best .action', panel).text(statusText());
            $('.advice-list', panel).html(
                '<div class="advice-empty">摸牌或需要吃、碰、杠、和牌时，Mortal 会在这里显示各个选择。</div>'
            );
            return;
        }

        const { result, rows } = latest;
        let bestAction = result.type == 'dahai' ? result.pai : result.type;
        if (result.type == 'reach') bestAction = 'reach';
        $('.advice-title > span', panel).text(current ? 'Mortal 推荐' : 'Mortal 推荐（上次决策）');
        $('.advice-best .label', panel).text('首选');
        $('.advice-best .action', panel).html(
            `${adviceTileHTML(result.type == 'dahai' ? result.pai : result.type == 'reach' ? result.pai : null)}`
            + `<span>${adviceActionName(bestAction, result)}</span>`
        );
        $('.advice-list', panel).html(`
          <div class="advice-head"><span>操作</span><span class="advice-number">Q</span><span class="advice-number">概率</span><span class="advice-risk-heading">铳率估算</span></div>
          ${rows.map((row, index)=>`
            <div class="advice-row${index ? '' : ' recommended'}">
              <span class="advice-action">${adviceTileHTML(row.tile)}<span>${row.name}</span></span>
              <span class="advice-number">${row.q.toFixed(2)}</span>
              <span class="advice-number">${(row.probability * 100).toFixed(2)}%</span>
              ${adviceDangerHTML(row.risks)}
            </div>`).join('')}
          <div class="advice-risk-note">铳率沿用离线复盘的立直家启发式估算；无立直时不显示。</div>
        `);
    }
    function refreshOpenPanel() {
        if (! panel.hasClass('hide')) render();
    }
    $('.advice-close', panel).on('click', close);
    panel.on('click', event=>{ if (event.target == panel[0]) close(); });
    button.on('click', ()=>{
        render();
        panel.removeClass('hide').attr('aria-hidden', 'false');
    });

    return {
        reset() {
            latest = null;
            status = 'waiting';
            current = false;
            button.prop('disabled', false).text('Mortal 推荐');
            close();
        },
        pending() {
            status = 'pending';
            current = false;
            // Calculations happen after almost every table event.  Keeping the
            // button label stable avoids a distracting flicker in peripheral
            // vision while the user is deciding what to discard.
            button.prop('disabled', false).text('Mortal 推荐');
            refreshOpenPanel();
        },
        stale() {
            status = 'waiting';
            current = false;
            button.prop('disabled', false).text('Mortal 推荐');
            refreshOpenPanel();
        },
        fail() {
            status = 'error';
            current = false;
            button.prop('disabled', false).text('Mortal 推荐');
            refreshOpenPanel();
        },
        update(result, danger) {
            const meta = result?.meta;
            if (! meta || ! Array.isArray(meta.q_values) || meta.mask_bits == null) {
                this.stale();
                return;
            }
            const qValues = meta.q_values.map(Number);
            const probabilities = adviceSoftmax(qValues);
            const bits = BigInt(meta.mask_bits);
            const rows = [];
            let qIndex = 0;
            ADVICE_ACTIONS.forEach((action, index)=>{
                if ((bits & (1n << BigInt(index))) == 0n || qIndex >= qValues.length) return;
                const tile = adviceTileCode(action) ? action
                    : action == 'reach' && result.type == 'reach' ? result.pai
                    : null;
                rows.push({
                    action, tile, name: adviceActionName(action, result),
                    q: qValues[qIndex], probability: probabilities[qIndex],
                    risks: adviceDangerForTile(danger, tile)
                });
                qIndex++;
            });
            rows.sort((left, right)=>right.probability - left.probability);
            latest = { result, rows };
            status = 'ready';
            current = true;
            button.prop('disabled', false).text('Mortal 推荐');
            refreshOpenPanel();
        }
    };
}

function installLocalVolumeControl(gameCtl, ...views) {
    if (! localMode) return;
    const controller = $('#board > .controller').addClass('local-volume');
    const storageKey = 'Mortal.volume';
    let level = Math.max(1, Math.min(5,
        Number(localStorage.getItem(storageKey) || 5)));

    const audioNodes = [];
    const appendAudio = value=>{
        if (! value) return;
        if (value instanceof HTMLMediaElement) audioNodes.push(value);
        else if (Array.isArray(value)) value.forEach(appendAudio);
        else if (typeof value == 'object') Object.values(value).forEach(appendAudio);
    };
    views.forEach(view=>appendAudio(view?._audio));

    function applyVolume() {
        const scale = level / 5;
        audioNodes.forEach(node=>{
            const base = Number(node.getAttribute('volume') || 1);
            node.volume = Math.max(0, Math.min(1, base * scale));
            if (! node._mortalVolumeListener) {
                node._mortalVolumeListener = true;
                node.addEventListener('canplaythrough', ()=>{
                    const currentLevel = Math.max(1, Math.min(5,
                        Number(localStorage.getItem(storageKey) || 5)));
                    node.volume = Math.max(0, Math.min(1,
                        Number(node.getAttribute('volume') || 1) * currentLevel / 5));
                });
            }
        });
        $('.speed span', controller).each((index, node)=>{
            $(node).toggleClass('active', index < level)
                   .attr('title', `音量 ${index + 1}`);
        });
        localStorage.setItem(storageKey, String(level));
    }
    function setLevel(next) {
        level = Math.max(1, Math.min(5, next));
        if (! gameCtl._pref.sound_on) gameCtl.sound(true);
        applyVolume();
        return false;
    }

    $('.sound.on', controller).attr('title', '静音 [a]');
    $('.sound.off', controller).attr('title', '恢复声音 [a]');
    $('.minus', controller).attr('title', '音量减小');
    $('.plus', controller).attr('title', '音量增大');
    $('.minus, .plus', controller).off('click');
    $('.minus', controller).on('click', ()=>setLevel(level - 1));
    $('.plus', controller).on('click', ()=>setLevel(level + 1));
    $('.speed span', controller).off('click').on('click', event=>{
        setLevel($('.speed span', controller).index(event.currentTarget) + 1);
    });
    applyVolume();
}

class MortalAdvisor {
    constructor(ui) {
        this._ui = ui;
        this._convmsg = converter.convmsg();
        this._danger = new MortalDangerTracker();
        this._lizhi = null;
        this._queue = Promise.resolve();
        this._generation = 0;
        this._session = `desktop-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        this._url = remoteWebMode
            ? `${base}/mortal-api/react`
            : `http://127.0.0.1:${Number(location.port) + 11000}/react`;
    }

    _react(event) {
        return fetch(this._url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session: this._session, events: [event] })
        }).then(response=>{
            if (! response.ok) throw new Error(`advisor HTTP ${response.status}`);
            return response.json();
        });
    }

    observe(msg) {
        const generation = ++this._generation;
        if (msg.qipai) this._ui.reset();
        else this._ui.pending();
        this._queue = this._queue.then(async ()=>{
            if (msg.qipai) this._lizhi = null;
            const req = this._convmsg(msg);
            if (! req) return null;
            if (req.type == 'start_kyoku' && ! req.scores) {
                req.scores = this._convmsg().defen.concat();
            }
            if (msg.dapai && msg.dapai.p.slice(-1) == '*' && this._lizhi == null) {
                this._lizhi = req.actor;
                const reach = { type: 'reach', actor: req.actor };
                this._danger.observe(reach);
                await this._react(reach);
            }
            else if (this._lizhi != null && (msg.zimo || msg.fulou)) {
                const board = this._convmsg();
                const deltas = [0, 0, 0, 0];
                const scores = board.defen.concat();
                deltas[this._lizhi] = -1000;
                const accepted = {
                    type: 'reach_accepted', actor: this._lizhi,
                    deltas: deltas, scores: scores
                };
                this._danger.observe(accepted);
                await this._react(accepted);
                this._lizhi = null;
            }
            this._danger.observe(req);
            const result = await this._react(req);
            const danger = this._danger.snapshot();
            if (msg.hule || msg.pingju) {
                const end = { type: 'end_kyoku' };
                this._danger.observe(end);
                await this._react(end);
            }
            return { result, request: req, danger };
        }).then(packet=>{
            const result = packet?.result;
            if (generation != this._generation) return packet;
            if (result?.meta?.q_values) this._ui.update(result, packet.danger);
            else this._ui.stale();
            return packet;
        }).catch(error=>{
            console.error('Mortal advisor failed', error);
            if (generation == this._generation) this._ui.fail();
            return null;
        });
        return this._queue;
    }

    dismiss() {
        this._generation++;
        this._ui.stale();
    }
}

function reviewTileToMajiang(tile) {
    if (! tile || tile == '?') return '';
    if (tile.length == 1) {
        return 'z' + ({ E:1, S:2, W:3, N:4, P:5, F:6, C:7 })[tile];
    }
    return tile[1] + (tile.endsWith('r') ? '0' : tile[0]);
}

function reviewCanonical(reply) {
    if (! reply || ! Object.keys(reply).length) return '跳过';
    if (reply.dapai) {
        const riichi = reply.dapai.endsWith('*');
        return `${riichi ? '立直切' : '切'} ${reply.dapai.slice(0, 2)}`;
    }
    if (reply.fulou) return `鸣牌 ${reply.fulou}`;
    if (reply.gang) return `杠 ${reply.gang}`;
    if (reply.hule) return '和牌';
    if (reply.daopai) return '九种九牌';
    return JSON.stringify(reply);
}

function reviewRoundName(player) {
    const model = player.model;
    if (model?.zhuangfeng == null || model?.jushu == null) return '开局';
    return `${['东','南','西','北'][model.zhuangfeng]}${['一','二','三','四'][model.jushu]}局${model.changbang || 0}本场`;
}

function reviewSnapshot(player, incoming) {
    const model = player.model;
    let hand = '';
    try { hand = player.shoupai.toString(); }
    catch (_) {}
    let rivers = [];
    try { rivers = model.he.map(he=>he._pai.concat()); }
    catch (_) {}
    let melds = [];
    try { melds = model.shoupai.map(shoupai=>shoupai._fulou.concat()); }
    catch (_) {}
    return {
        round: reviewRoundName(player), hand, seat: player._menfeng,
        scores: model?.defen?.concat?.() || [],
        doraIndicators: model?.shan?.baopai?.concat?.() || [],
        tilesLeft: model?.shan?.paishu,
        rivers, melds, incoming
    };
}

function reviewEventName(msg) {
    if (msg.zimo) return `摸 ${msg.zimo.p}`;
    if (msg.gangzimo) return `岭上摸 ${msg.gangzimo.p}`;
    if (msg.dapai) return `对手切 ${msg.dapai.p}`;
    if (msg.fulou) return `鸣牌后 ${msg.fulou.m}`;
    if (msg.gang) return `杠 ${msg.gang.m}`;
    return Object.keys(msg).filter(key=>key != 'seq').join('/');
}

function applyLocalTileSkin() {
    $('#loaddata .pai').each(function(){
        const tile = this.dataset.pai;
        const filename = tile == '_' ? 'back' : tile;
        this.src = `img/skin-classic2d/${filename}.png`;
    });
}

function resultText(value) {
    return String(value ?? '').replace(/[&<>"']/g, character=>({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

function resultScore(value) {
    const number = Number(value || 0);
    return number.toLocaleString('zh-CN');
}

function resultPoint(value) {
    const number = Number(value || 0);
    return `${number > 0 ? '+' : ''}${Number.isInteger(number) ? number : number.toFixed(1)}`;
}

function renderLocalResult(paipu, playerID) {
    if (! localMode || ! paipu) return;

    let localID = Array.isArray(paipu.player)
        ? paipu.player.findIndex(name=>String(name).replace(/\n.*$/, '') == localPlayerName)
        : -1;
    if (localID < 0 && Number.isInteger(playerID)) localID = playerID;
    if (localID < 0) localID = 0;
    localReviewPlayerID = (localID - Number(paipu.qijia || 0) + 4) % 4;

    const players = (paipu.player || []).map((name, id)=>({
        id,
        name: String(name).replace(/\n.*$/, ''),
        rank: Number(paipu.rank?.[id] || 4),
        score: Number(paipu.defen?.[id] || 0),
        point: Number(paipu.point?.[id] || 0),
    })).sort((left, right)=>left.rank - right.rank || right.score - left.score);
    const local = players.find(player=>player.id == localID) || players[0];
    const rankNames = ['第一名', '第二名', '第三名', '第四名'];
    const headline = local?.rank == 1 ? '胜利' : rankNames[(local?.rank || 4) - 1];

    const rows = players.map(player=>`
      <div class="result-row rank-${player.rank}${player.id == localID ? ' local-player' : ''}">
        <span class="result-rank">${player.rank}</span>
        <span class="result-player">
          <strong>${resultText(player.name)}</strong>
          ${player.id == localID ? '<small>你</small>' : ''}
        </span>
        <span class="result-score"><strong>${resultScore(player.score)}</strong><small>点</small></span>
        <span class="result-point ${player.point >= 0 ? 'positive' : 'negative'}">${resultPoint(player.point)}</span>
      </div>`).join('');

    const summary = $('#board > .board > .summary');
    const content = $('> div > div', summary);
    $('table', content).hide();
    $('.mortal-result', content).remove();
    content.append(`
      <section class="mortal-result" aria-label="对局结果">
        <header class="result-header">
          <div class="result-kicker">半庄结束</div>
          <h1>${headline}</h1>
          <div class="result-local-score">${resultScore(local?.score)} 点 <span>${resultPoint(local?.point)} pt</span></div>
        </header>
        <div class="result-standings">${rows}</div>
        <div class="result-actions" aria-label="终局操作">
          <button class="result-new-game" type="button">再来一局</button>
          <button class="result-replay" type="button">回放本局</button>
          <button class="result-online-review" type="button">Mortal复盘</button>
          <button class="result-folder" type="button">打开牌谱文件夹</button>
        </div>
        <div class="result-saved">两份牌谱已自动保存</div>
      </section>`);
    summary.addClass('mortal-summary');
    $('body').addClass('showing-mortal-result');
}

function clearLocalResult() {
    const summary = $('#board > .board > .summary');
    summary.removeClass('mortal-summary result-ready');
    $('.mortal-result', summary).remove();
    $('table', summary).show();
    $('body').removeClass('showing-mortal-result');
}

function fitBoard() {
    if (! localMode) {
        scale($('#board'), $('#space'));
        return;
    }

    if (fitFrame) cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(()=>{
        fitFrame = null;
        const board = $('#board');
        // A normal macOS window uses the original 800 x 680 near-square board.
        // Native full screen becomes wide enough to switch to the 800 x 450
        // compact landscape board.  Only an actual resize changes this scale;
        // turns and focused tiles do not.
        const viewport = remoteWebMode ? window.visualViewport : null;
        const width = viewport?.width || document.documentElement.clientWidth || 800;
        const height = viewport?.height || document.documentElement.clientHeight || 680;
        if (remoteWebMode) {
            // Chrome on tablets reports 100vh using the larger layout viewport,
            // which includes space hidden behind its tab/address bars.  Size the
            // fixed board container to the actually visible area instead.
            document.body.style.width = `${width}px`;
            document.body.style.height = `${height}px`;
        }
        const baseHeight = width / height >= 1.5 ? 450 : 680;
        const ratio = Math.min(width / 800, height / baseHeight);

        // A freely resized Windows window does not always preserve Electron's
        // requested content aspect ratio (snap layouts and DPI scaling are the
        // common cases).  Fill the complete window in the classic layout so
        // no outer strip of unused felt remains.  Maximized/wide windows keep
        // the existing uniform 800 x 450 landscape layout.
        if (windowsDesktop && baseHeight == 680) {
            board.css({
                position: 'fixed',
                left: 0,
                top: 0,
                margin: 0,
                zoom: 1,
                transformOrigin: '0 0',
                transform: `scale(${width / 800}, ${height / 680})`,
                willChange: 'transform',
                backfaceVisibility: 'hidden',
            });
            pinLocalViewport();
            return;
        }
        board.css({
            position: 'relative',
            left: '',
            top: '',
            margin: 0,
            zoom: ratio,
            transform: 'none',
            willChange: 'auto',
            backfaceVisibility: 'visible',
        });
        pinLocalViewport();
    });
}

$(function(){

    if (localMode) applyLocalTileSkin();
    installTabletFullscreen();

    const pai   = Majiang.UI.pai($('#loaddata'));
    const audio = Majiang.UI.audio($('#loaddata'));
    const adviceUI = localMode ? installAdviceUI() : null;

    const analyzer = (kaiju)=>{
        $('body').addClass('analyzer');
        return new Majiang.UI.Analyzer($('#board > .analyzer'), kaiju, pai,
                                        ()=>$('body').removeClass('analyzer'));
    };
    const viewer = (paipu)=>{
        $('#board .controller').addClass('paipu')
        $('body').attr('class','board');
        fitBoard();
        return new Majiang.UI.Paipu(
                        $('#board'), paipu, pai, audio, 'Majiang.pref',
                        ()=>fadeIn($('body').attr('class','file')),
                        analyzer);
    };
    const stat = (paipu_list)=>{
        fadeIn($('body').attr('class','stat'));
        return new Majiang.UI.PaipuStat($('#stat'), paipu_list,
                        ()=>fadeIn($('body').attr('class','file')));
    };
    const file = new Majiang.UI.PaipuFile($('#file'), 'Majiang.netplay',
                                            viewer, stat);
    let sock, myuid;
    let localRoomReady = false;
    let localRoomNo = '';
    let localGameStarted = false;
    let localPaipuExported = false;
    let remoteLoginPending = false;
    let localReviewDecisions = [];
    let localReviewJobs = [];
    let localReviewEventIndex = 0;
    let localReviewDecisionIndex = 0;
    let localReviewConvrep = converter.convrep();

    function postMortalDesktopMessage(message) {
        if (window.mortalDesktop?.postMessage) {
            window.mortalDesktop.postMessage(message);
            return true;
        }
        if (window.webkit?.messageHandlers?.mortalTable?.postMessage) {
            window.webkit.messageHandlers.mortalTable.postMessage(message);
            return true;
        }
        return false;
    }

    function exportLocalPaipu(paipu, reviewReady = Promise.resolve([])) {
        if (! localMode || localPaipuExported || ! paipu) return;
        localPaipuExported = true;
        remotePaipuSavePromise = Promise.resolve(reviewReady).then(decisions=>{
            const payload = {
                type: 'game-ended',
                player_name: localPlayerName,
                majiang: paipu,
                tenhou: logconv(paipu),
                review_decisions: decisions,
            };
            if (postMortalDesktopMessage(payload) || ! remoteWebMode) return [];
            return fetch(`${base}/mortal-api/save-paipu`, {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                }).then(response=>{
                    if (! response.ok) throw new Error(`服务器牌谱保存失败：${response.status}`);
                    return response.json();
                }).then(result=>{
                    remotePaipuFiles = Array.isArray(result.files) ? result.files : [];
                    return remotePaipuFiles;
                }).catch(error=>{
                    console.error('服务器牌谱保存失败', error);
                    throw error;
                });
        }).catch(error=>{
            localPaipuExported = false;
            console.error('牌谱导出失败', error);
            throw error;
        });
        return remotePaipuSavePromise;
    }

    function init() {

        sock = io('/', { path: `${base}/server/socket.io/`});

        $(window).on('pagehide', ()=>sock.disconnect());
        $(window).on('pageshow', ()=>sock.connect());

        sock.on('HELLO', hello);
        sock.on('ROOM', room);
        sock.on('START', start);
        sock.on('END', end);
        sock.on('ERROR', file.error);
        sock.on('disconnect', ()=>hide($('#file .netplay form.room')));

        hide($('#title .loading'));
    }

    function hello(user) {
        if (! user) {
            if (remoteWebMode && ! remoteLoginPending) {
                remoteLoginPending = true;
                fetch(`${base}/server/auth/`, {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
                    },
                    body: new URLSearchParams({ name: localPlayerName, passwd: '*' }),
                }).then(response=>{
                    if (! response.ok) throw new Error(`自动登录失败：${response.status}`);
                    location.reload();
                }).catch(error=>{
                    remoteLoginPending = false;
                    console.error(error);
                    $('body').attr('class','title');
                    show($('#title .login'));
                });
                return;
            }
            $('body').attr('class','title');
            show($('#title .login'));
            return;
        }
        if (remoteWebMode
                && normalizeLocalPlayerName(user.name) != localPlayerName
                && ! remoteLoginPending) {
            remoteLoginPending = true;
            fetch(`${base}/server/logout`, {
                method: 'POST', credentials: 'same-origin'
            }).then(response=>{
                if (! response.ok) throw new Error(`退出旧用户名失败：${response.status}`);
                return fetch(`${base}/server/auth/`, {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
                    },
                    body: new URLSearchParams({ name: localPlayerName, passwd: '*' }),
                });
            }).then(response=>{
                if (! response.ok) throw new Error(`用户名登录失败：${response.status}`);
                location.reload();
            }).catch(error=>{
                remoteLoginPending = false;
                console.error(error);
            });
            return;
        }
        localPlayerName = normalizeLocalPlayerName(user.name) || localPlayerName;
        myuid = user.uid;
        show($('#file .netplay form'));
        fadeIn($('body').attr('class','file'));
        if (user.icon)
            $('#file .netplay img').attr('src', user.icon)
                                   .attr('title', user.uid);
        $('#file .netplay .name').text(user.name);
        file.redraw();
        if (localMode) sock.emit('ROOM');
    }

    let row, src;

    function room(msg) {
        localRoomNo = msg.room_no || localRoomNo;
        if (! row) {
            row = $('#room .user').eq(0);
            src = $('img', row).attr('src');
        }
        $('body').attr('class','room');
        $('#room input[name="room_no"]').val(msg.room_no);
        $('#room .room').empty();
        for (let user of msg.user) {
            let r = row.clone();
            if (user.icon) $('img', r).attr('src', user.icon)
                                      .attr('title', user.uid);
            else           $('img', r).attr('src', src);
            $('.name', r).text(user.name);
            if (msg.user[0].uid == myuid || user.uid == myuid )
                show($('input[name="quit"]', r).on('click', ()=> {
                        sock.emit('ROOM', msg.room_no, user.uid);
                        return false;
                    }));
            if (user.offline) r.addClass('offline');
            else              r.removeClass('offline');
            $('#room .room').append(r);
        }
        if (msg.user[0].uid == myuid) {
            show($('#room select[name="rule"]'));
            show($('#room input[name="timer"]'));
            show($('#room input[type="submit"]'));
        }
        else {
            hide($('#room select[name="rule"]'));
            hide($('#room input[name="timer"]'));
            hide($('#room input[type="submit"]'));
        }

        if (localMode && msg.user[0].uid == myuid)
        {
            if (! localRoomReady) {
                localRoomReady = true;
                const message = {
                    type: 'room-ready', room: msg.room_no
                };
                if (! postMortalDesktopMessage(message) && remoteWebMode) {
                    fetch(`${base}/mortal-api/room-ready`, {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(message),
                    }).catch(error=>console.error('Mortal 加入房间失败', error));
                }
            }
            if (localAutostart && msg.user.length == 4 && ! localGameStarted) {
                localGameStarted = true;
                let rule = Majiang.rule(preset[localRule] || {});
                setTimeout(()=>sock.emit('START', msg.room_no, rule, null), 100);
            }
        }
    }

    function start() {

        localPaipuExported = false;
        remotePaipuSavePromise = null;
        remotePaipuFiles = [];
        localReviewJobs = [];
        localReviewEventIndex = 0;
        localReviewConvrep = converter.convrep();
        try {
            localReviewDecisions = JSON.parse(
                localStorage.getItem(`Mortal.review.${localRoomNo}`) || '[]'
            );
        }
        catch (_) {
            localReviewDecisions = [];
        }
        localReviewDecisionIndex = localReviewDecisions.reduce(
            (max, decision)=>Math.max(max, Number(decision.decision) || 0), 0
        );

        // Use the original player interaction. The local selector already
        // prevents focus scrolling, so hover can lift tiles without panning
        // the WKWebView.
        const player = touchWebMode
            ? new LocalHumanPlayer($('#board'), pai, audio)
            : new Majiang.UI.Player($('#board'), pai, audio);
        const advisor = localMode ? new MortalAdvisor(adviceUI) : null;
        player.view  = new Majiang.UI.Board($('#board .board'), pai, audio,
                                                player.model);

        const gameCtl = new Majiang.UI.GameCtl($('#board'), 'Majiang.pref',
                                                null, player, player._view);
        gameCtl._view.no_player_name = false;
        installLocalVolumeControl(gameCtl, player, player._view);

        let players = [];

        $('#board .controller').removeClass('paipu')
        $('body').attr('class','board');
        fitBoard();
        let seq = 0;

        function recordReviewDecision(msg, reply, advicePromise, eventIndex) {
            if (! advisor || ! advicePromise || msg.jieju) return;
            const actual = JSON.parse(JSON.stringify(reply || {}));
            const snapshot = reviewSnapshot(player, msg);
            const job = advicePromise.then(packet=>{
                const raw = packet?.result;
                const possible = packet?.request?.possible_actions || [];
                if (! raw?.meta?.q_values) return;
                let mortalAction;
                if (raw.type == 'reach') {
                    mortalAction = { dapai: reviewTileToMajiang(raw.pai) + '*' };
                }
                else {
                    mortalAction = localReviewConvrep(raw);
                }
                const hasChoice = possible.length > 1
                    || Object.keys(actual).length
                    || Object.keys(mortalAction).length;
                if (! hasChoice) return;
                const record = {
                    decision: ++localReviewDecisionIndex,
                    eventIndex,
                    event: reviewEventName(msg),
                    originalAction: reviewCanonical(actual),
                    mortalAction: reviewCanonical(mortalAction),
                    same: reviewCanonical(actual) == reviewCanonical(mortalAction),
                    snapshot,
                    originalRaw: actual,
                    mortalRaw: raw,
                    mortalTop: raw.meta?.show?.items || [],
                    originalTop: [],
                    possibleActions: possible,
                };
                localReviewDecisions.push(record);
                localReviewDecisions.sort((left, right)=>left.eventIndex - right.eventIndex);
                try {
                    localStorage.setItem(
                        `Mortal.review.${localRoomNo}`,
                        JSON.stringify(localReviewDecisions)
                    );
                }
                catch (_) {}
            }).catch(error=>console.error('Mortal复盘记录失败', error));
            localReviewJobs.push(job);
        }

        sock.removeAllListeners('GAME');
        sock.on('GAME', (msg)=>{
            if (msg.players) {
                players = msg.players;
            }
            else if (msg.say) {
                player._view.say(msg.say.name, msg.say.l);
            }
            else if (msg.seq) {
                const reviewIndex = ++localReviewEventIndex;
                if (msg.qipai) localReviewConvrep = converter.convrep();
                if (seq && msg.seq != seq) location.reload();
                const advicePromise = advisor ? advisor.observe(msg) : null;
                player.action(msg, (reply = {})=>{
                    recordReviewDecision(msg, reply, advicePromise, reviewIndex);
                    if (advisor) advisor.dismiss();
                    reply.seq = msg.seq;
                    sock.emit('GAME', reply);
                    seq = msg.seq + 1;
                });
                if (msg.jieju) {
                    file.add(msg.jieju, 10);
                    const reviewReady = Promise.allSettled(localReviewJobs).then(()=>{
                        localStorage.removeItem(`Mortal.review.${localRoomNo}`);
                        return localReviewDecisions;
                    });
                    exportLocalPaipu(msg.jieju, reviewReady);
                    if (localMode) {
                        // The server expects an acknowledgement before it can
                        // close the room.  Acknowledge immediately and keep our
                        // purpose-built result screen visible instead of
                        // requiring a click through the upstream Japanese table.
                        player.callback();
                        renderLocalResult(msg.jieju, player._id);
                    }
                }
            }
            else {
                localReviewEventIndex++;
                if (msg.qipai) localReviewConvrep = converter.convrep();
                if (advisor) advisor.observe(msg);
                player.action(msg);
                if (msg.kaiju && msg.kaiju.log) {
                    const historyCount = msg.kaiju.log.reduce(
                        (count, round)=>count + round.length, 0
                    );
                    let log = msg.kaiju.log.pop();
                    localReviewEventIndex += historyCount - log.length;
                    for (let data of log) {
                        localReviewEventIndex++;
                        if (data.qipai) localReviewConvrep = converter.convrep();
                        // Rebuild the advisor's private board after a browser
                        // refresh/reconnect, just as the visible board is
                        // rebuilt from the server's game log below.
                        if (advisor) advisor.observe(data);
                        player.action(data);
                    }
                }
            }
            if (localAutostart && msg.kaiju) {
                setTimeout(()=>$('#board .kaiju').trigger('click'), 100);
            }
            player._view.players(players);
        });
    }

    function end(paipu) {
        sock.removeAllListeners('GAME');
        if (localMode) {
            renderLocalResult(paipu);
            const summary = $('#board > .board > .summary').addClass('result-ready');
            if (remoteWebMode) {
                $('.result-folder', summary).text('下载牌谱');
                $('.result-saved', summary).text('牌谱与110万步模型评估正在保存');
            }
            else $('.result-online-review', summary).hide();
            $('.result-new-game', summary).off('click').on('click', event=>{
                event.stopPropagation();
                location.reload();
            });
            $('.result-replay', summary).off('click').on('click', event=>{
                event.stopPropagation();
                clearLocalResult();
                gameCtl.clear_handler();
                const replay = viewer(paipu);
                // Creating a Paipu object does not start it.  Open directly at
                // the first hand from the local player's viewpoint so the
                // result-screen button immediately produces a usable replay.
                replay.start(Number.isInteger(player._id) ? player._id : 0,
                             0, 0);
            });
            $('.result-online-review', summary).off('click').on('click', async event=>{
                event.stopPropagation();
                const reviewWindow = window.open('', '_blank');
                $('.result-saved', summary).text('正在生成本地Mortal评估报告…');
                try {
                    if (remotePaipuSavePromise) await remotePaipuSavePromise;
                    const report = remotePaipuFiles.find(name=>name.endsWith('_Review.json'));
                    if (! report) throw new Error('没有找到 Mortal 评估报告');
                    const data = `${base}/mortal-api/files/${encodeURIComponent(report)}`;
                    const url = `${base}/mortal-reviewer/?data=${encodeURIComponent(data)}&showMortal=1`;
                    if (reviewWindow) reviewWindow.location.href = url;
                    else window.location.href = url;
                    $('.result-saved', summary).text('评估报告使用本地110万步模型生成');
                }
                catch (error) {
                    if (reviewWindow) reviewWindow.close();
                    console.error('打开Mortal复盘失败', error);
                    $('.result-saved', summary).text(
                        `Mortal评估报告生成失败：${error.message}`
                    );
                }
            });
            $('.result-folder', summary).off('click').on('click', event=>{
                event.stopPropagation();
                if (remoteWebMode) window.open(`${base}/mortal-api/paipu`, '_blank');
                else postMortalDesktopMessage({ type: 'open-paipu-directory' });
            });
            $('body').attr('class', 'board showing-mortal-result');
            show($('#board'));
            fitBoard();
            return;
        }
        fadeIn($('body').attr('class','file'));
        file.redraw();
        $('#file input[name="room_no"]').val('');
    }

    for (let key of Object.keys(preset)) {
        $('select[name="rule"]').append($('<option>').val(key).text(key));
    }
    if (localStorage.getItem('Majiang.rule')) {
        $('select[name="rule"]').append($('<option>')
                                .val('-').text('カスタムルール'));
    }

    $('#file form.room').on('submit', (ev)=>{
        let room = $('input[name="room_no"]', $(ev.target)).val();
        sock.emit('ROOM', room);
        return false;
    });

    if (localMode) {
        $(window).on('scroll', pinLocalViewport);
        window.visualViewport?.addEventListener('scroll', pinLocalViewport);
        window.visualViewport?.addEventListener('resize', fitBoard);
    }
    $('#room form').on('submit', (ev)=>{
        let room = $('input[name="room_no"]', $(ev.target)).val();

        let rule = $('select[name="rule"]', $(ev.target)).val();
        rule = ! rule      ? {}
             : rule == '-' ? JSON.parse(
                                localStorage.getItem('Majiang.rule')||'{}')
             :               preset[rule];
        rule = Majiang.rule(rule);

        let timer = $('input[name="timer"]', $(ev.target)).val();
        timer = timer.match(/(\d+)/g);
        if (timer) timer = timer.map(t=>+t);

        sock.emit('START', room, rule, timer);
        return false;
    });

    $(window).on('resize', fitBoard);

    $(window).on('load', ()=>setTimeout(()=>{
        requestRemotePlayerName().then(init);
    }, 500));
    if (loaded) $(window).trigger('load');

    $('#title .login form').each(function(){
        let method = $(this).attr('method')
        let url    = $(this).attr('action');
        fetch(url, { method: method, redirect: 'manual' }).then(res =>{
            if (res.status == 404) hide($(this));
        });
    });
});
$(window).on('load', ()=> loaded = true);
