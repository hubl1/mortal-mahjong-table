/*
 * Mortal Mahjong for Android: in-process game + three on-device Mortal bots.
 */
"use strict";

const converter = require('../../../../runtime/node_modules/@kobalab/mjai-bot/lib/convert');
const logconv = require('@kobalab/tenhou-url-log');
const { hide, fadeIn, scale } = Majiang.UI.Util;

let loaded;
let fitFrame;

class AndroidHumanPlayer extends Majiang.UI.Player {
    select_dapai(lizhi) {
        const result = super.select_dapai(lizhi);

        // The stock touch selector focuses the last discard candidate whenever
        // a tile is drawn. Android WebView then scrolls the bottom-aligned hand
        // a few pixels into view. Drop that synthetic focus and pin the local
        // viewport; touch handlers remain attached and taps still work.
        const focused = document.activeElement;
        if (focused && focused.closest && focused.closest('#board')) {
            focused.blur();
        }
        window.scrollTo(0, 0);
        requestAnimationFrame(()=>window.scrollTo(0, 0));
        return result;
    }
}

function applyTileSkin() {
    $('#loaddata .pai').each(function(){
        const tile = this.dataset.pai;
        this.src = `img/skin-classic2d/${tile == '_' ? 'back' : tile}.png`;
    });
}

function fitBoard() {
    if (fitFrame) cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(()=>{
        fitFrame = null;
        const board = $('#board');
        // Majiang already switches to a compact 800 x 450 layout on short
        // landscape screens.  Scale from the active CSS layout instead of
        // always reserving the desktop-only 680 px height; otherwise phones
        // display the compact board at only about two thirds of the size it
        // can safely use.
        const baseWidth = Number.parseFloat(board.css('width')) || 800;
        const baseHeight = Number.parseFloat(board.css('height')) || 680;
        const ratio = Math.min(
            window.innerWidth / baseWidth,
            window.innerHeight / baseHeight
        );
        board.css({
            position: 'relative', left: '', top: '', margin: 0,
            zoom: ratio, transform: 'none', willChange: 'auto',
            backfaceVisibility: 'visible'
        });
        window.scrollTo(0, 0);
    });
}

class MortalPlayer {
    constructor(slot) {
        this._slot = slot;
        this._convmsg = converter.convmsg();
        this._convrep = converter.convrep();
        this._lizhi = null;
    }

    _react(req, canAct = true) {
        if (! req) return { type: 'none' };
        return JSON.parse(AndroidMortal.react(
            this._slot, JSON.stringify(req), canAct
        ));
    }

    action(msg, callback) {
        let reply = {};
        try {
            if (msg.qipai) {
                this._convrep = converter.convrep();
                this._lizhi = null;
            }
            const req = this._convmsg(msg);
            if (! req) {
                if (callback) callback({});
                return;
            }

            // @kobalab/mjai-bot intentionally leaves scores out of its
            // start_kyoku conversion.  Mortal's libriichi state treats them
            // as required, so restore the current absolute-seat scores from
            // the converter's board before passing the event to Rust.
            if (req.type == 'start_kyoku' && ! req.scores) {
                req.scores = this._convmsg().defen.concat();
            }

            if (msg.dapai && msg.dapai.p.slice(-1) == '*' && this._lizhi == null) {
                this._lizhi = req.actor;
                this._react({ type: 'reach', actor: req.actor }, false);
            }
            else if (this._lizhi != null && (msg.zimo || msg.fulou)) {
                const board = this._convmsg();
                const deltas = [0, 0, 0, 0];
                const scores = board.defen.concat();
                deltas[this._lizhi] = -1000;
                this._react({
                    type: 'reach_accepted', actor: this._lizhi,
                    deltas: deltas, scores: scores
                }, false);
                this._lizhi = null;
            }

            let result = this._react(req, true);
            reply = this._convrep(result);
            if (result.type == 'reach') {
                this._lizhi = result.actor;
                result = this._react(this._convmsg(reply), true);
                reply = this._convrep(result);
            }
            if (msg.hule || msg.pingju) {
                this._react({ type: 'end_kyoku' }, false);
            }
        }
        catch (error) {
            console.error(`Mortal-${this._slot} failed`, error);
            try { AndroidMortal.reportError(String(error.stack || error)); }
            catch (_) { /* bridge may already be unavailable */ }
            reply = {};
        }
        if (callback) callback(reply);
    }
}

function seatMetadata(paipu) {
    const playerName = '本地玩家';
    const playerID = paipu.player.indexOf(playerName);
    const targetID = playerID >= 0
        ? (playerID - paipu.qijia + 4) % 4
        : 0;
    return {
        format_version: 1,
        player_name: playerName,
        target_player_id: targetID,
        starting_seat_index: targetID,
        starting_seat: ['东家', '南家', '西家', '北家'][targetID],
        starting_seat_code: ['E', 'S', 'W', 'N'][targetID],
        majiang_player_id: playerID,
        initial_dealer_player_id: paipu.qijia
    };
}

$(function(){
    applyTileSkin();
    document.documentElement.classList.add('local-app', 'android-app');

    const pai = Majiang.UI.pai($('#loaddata'));
    const audio = Majiang.UI.audio($('#loaddata'));
    const analyzer = kaiju => {
        $('body').addClass('analyzer');
        return new Majiang.UI.Analyzer(
            $('#board > .analyzer'), kaiju, pai,
            ()=>$('body').removeClass('analyzer')
        );
    };
    const viewer = paipu => {
        $('#board .controller').addClass('paipu');
        $('body').attr('class', 'board');
        fitBoard();
        return new Majiang.UI.Paipu(
            $('#board'), paipu, pai, audio, 'Mortal.android.pref',
            ()=>fadeIn($('body').attr('class', 'file')), analyzer
        );
    };
    const stat = list => {
        fadeIn($('body').attr('class', 'stat'));
        return new Majiang.UI.PaipuStat(
            $('#stat'), list,
            ()=>fadeIn($('body').attr('class', 'file'))
        );
    };
    const file = new Majiang.UI.PaipuFile(
        $('#file'), 'Mortal.android.games', viewer, stat
    );
    let game;

    function start() {
        const players = [new AndroidHumanPlayer($('#board'), pai, audio)];
        for (let index = 1; index < 4; index++) players[index] = new MortalPlayer(index);
        game = new Majiang.Game(players, end, Majiang.rule(), 'Mortal 麻将');
        game.model.player = ['本地玩家', 'Mortal-1', 'Mortal-2', 'Mortal-3'];
        game.view = new Majiang.UI.Board($('#board .board'), pai, audio, game.model);
        game.speed = 2;

        $('#board .controller').removeClass('paipu');
        $('body').attr('class', 'board');
        fitBoard();
        new Majiang.UI.GameCtl($('#board'), 'Mortal.android.pref', game, game._view);
        // GameCtl hides player names for the original single-player demo.
        // This build has three meaningful Mortal seats, so keep the labels
        // visible when Board redraws at the beginning of every hand.
        game._view.no_player_name = false;
        game.kaiju();
    }

    function end(paipu) {
        if (paipu) {
            file.add(paipu, 20);
            const metadata = seatMetadata(paipu);
            paipu._mortal = metadata;
            const tenhou = logconv(paipu);
            tenhou._mortal = metadata;
            AndroidMortal.savePaipu(JSON.stringify({ majiang: paipu, tenhou: tenhou }));
        }
        fadeIn($('body').attr('class', 'file'));
        file.redraw();
    }

    $('#file .start').on('click', start);
    $(window).on('resize', fitBoard);
    $(window).on('load', ()=>{
        hide($('#title .loading'));
        start();
    });
    if (loaded) $(window).trigger('load');
});

$(window).on('load', ()=> loaded = true);
