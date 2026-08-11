/**
 * 앱 셸 — 화면 전환 · 이벤트 위임 · 기기 넘기기 가드 · 봇 구동
 *
 * 엔진은 순수하고, 이 파일이 「누가 지금 화면을 보고 있는가」를 관리한다.
 * 핫시트에서 상대의 카드가 새지 않게 막는 책임이 전부 여기 있다.
 */

import { LocalTransport } from '../net/transport.js';
import {
  actorOf, currentPlayerId, dealCards, opponentIdOf, isGameOver,
} from '../engine/engine.js';
import { botTurnActions, botAnswerAction, botPenaltyAction } from '../engine/bot.js';
import { createNotes, syncAutoApply, cycleMark, toggleClue } from './notes.js';
import * as V from './views.js';

const STORE_KEY = 'imitation-game/prefs';

const DEFAULT_FORM = {
  qGroup: '키',
  qId: null,
  coinStep: 1,
  coinLine: '',
  coinAnswer: null,
  accuseCardId: null,
  tokenSlots: [],
};

export function createApp(root) {
  const transport = new LocalTransport();

  const prefs = loadPrefs();
  const ui = {
    mode: prefs.mode ?? 'solo',
    nick: prefs.nick ?? 'KESTREL',
    nick2: prefs.nick2 ?? 'MAGPIE',
    humanId: 'p1',
    viewerId: null,
    overlay: null,
    rulePage: 0,
    flashSeq: null,
    form: { ...DEFAULT_FORM },
    settings: { splitHint: true, reduceMotion: false, ...(prefs.settings ?? {}) },
    notes: {},
  };

  let lastPhase = null;
  let botTimer = null;
  let revealTimer = null;
  let botQueue = [];

  // ── 렌더 ────────────────────────────────────────────────────────────

  function render() {
    const state = transport.state;
    document.body.classList.toggle('reduce-motion', ui.settings.reduceMotion);

    if (!state) {
      root.innerHTML = V.renderLobby(ui) + (ui.overlay === 'rules' ? V.renderRules(ui) : '');
      return;
    }

    resolveViewer(state);

    // 핫시트: 지금 화면을 봐야 할 사람이 아니면 전부 가린다
    if (ui.mode === 'hotseat' && !isGameOver(state)) {
      const expected = actorOf(state);
      if (expected && expected !== ui.viewerId) {
        root.innerHTML = V.renderHandoff(state, expected);
        return;
      }
    }

    syncAutoApply(ui.notes, state, ui.viewerId);

    let html;
    if (isGameOver(state)) {
      html = V.renderResult(state, ui);
    } else if (state.phase === 'DEALING') {
      html = V.renderDealing(state, ui.viewerId);
    } else {
      html = V.renderBoard(state, ui) + phaseModal(state);
    }

    if (ui.overlay === 'pamphlet' && !isGameOver(state)) html += V.renderPamphlet(state, ui);
    if (ui.overlay === 'settings') html += V.renderSettings(ui);
    if (ui.overlay === 'rules') html += V.renderRules(ui);

    root.innerHTML = html;
    restoreFocus();
  }

  /** phase 에 대응하는 모달 — 행동 주체 본인에게만 보여준다 */
  function phaseModal(state) {
    const viewer = ui.viewerId;
    const iAmCurrent = currentPlayerId(state) === viewer;
    switch (state.phase) {
      case 'QUESTION_BUILD':
        return iAmCurrent ? V.renderQuestionModal(state, ui) : '';
      case 'ANSWER_PENDING':
        return state.pending?.targetId === viewer ? V.renderAnswerModal(state, ui) : '';
      case 'ACCUSE_SELECT':
        return iAmCurrent ? V.renderAccuseModal(state, ui) : '';
      case 'PENALTY_TOKEN_SELECT':
        return iAmCurrent ? V.renderPenaltyModal(state, ui) : '';
      default:
        return '';
    }
  }

  function resolveViewer(state) {
    if (ui.mode === 'solo') {
      ui.viewerId = ui.humanId;
      return;
    }
    // 핫시트에서는 viewerId 를 자동으로 정하지 않는다.
    // 선공은 무작위라 기기를 든 사람과 첫 행동 주체가 다를 수 있으므로,
    // 첫 카드가 열리기 전에 반드시 「내가 누구입니다」 확인을 거치게 한다.
    if (ui.viewerId === null && isGameOver(state)) ui.viewerId = state.order[0];
  }

  function restoreFocus() {
    const ta = root.querySelector('textarea[data-field="coinLine"]');
    if (ta && document.activeElement !== ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }

  // ── 액션 ────────────────────────────────────────────────────────────

  async function dispatch(action) {
    const before = transport.state?.phase;
    await transport.dispatch(action);
    const state = transport.state;

    if (state.phase !== before) onPhaseEnter(state.phase, before);

    render();
    scheduleReveal();
    scheduleBot();
  }

  function onPhaseEnter(phase, from) {
    lastPhase = from;
    switch (phase) {
      case 'QUESTION_BUILD':
        ui.form.qId = null;
        ui.form.qGroup = '키';
        break;
      case 'ANSWER_PENDING':
        ui.form.coinStep = 1;
        ui.form.coinLine = '';
        ui.form.coinAnswer = null;
        break;
      case 'ACCUSE_SELECT':
        ui.form.accuseCardId = null;
        break;
      case 'PENALTY_TOKEN_SELECT':
        ui.form.tokenSlots = [];
        break;
      default:
        break;
    }
    ui.flashSeq = phase === 'REVEAL' ? (transport.state.log.at(-1)?.seq ?? null) : null;
    // 핫시트: 다음 행동 주체가 바뀌면 다시 기기를 넘겨야 한다
    if (ui.mode === 'hotseat') {
      const expected = actorOf(transport.state);
      if (expected && expected !== ui.viewerId) ui.overlay = null;
    }
  }

  // ── 답변 공개 자동 진행 ─────────────────────────────────────────────

  function scheduleReveal() {
    clearTimeout(revealTimer);
    const state = transport.state;
    if (!state || state.phase !== 'REVEAL') return;
    revealTimer = setTimeout(() => { dispatch({ type: 'CONTINUE' }); }, ui.settings.reduceMotion ? 350 : 1500);
  }

  // ── 봇 구동 ─────────────────────────────────────────────────────────

  function scheduleBot() {
    clearTimeout(botTimer);
    const state = transport.state;
    if (!state || isGameOver(state) || state.phase === 'REVEAL') return;
    const actor = actorOf(state);
    if (!actor || state.players[actor].kind !== 'bot') return;
    botTimer = setTimeout(runBotStep, ui.settings.reduceMotion ? 150 : 800);
  }

  function runBotStep() {
    const state = transport.state;
    if (!state || isGameOver(state)) return;
    const actor = actorOf(state);
    if (!actor || state.players[actor].kind !== 'bot') return;

    if (botQueue.length > 0) {
      dispatch(botQueue.shift());
      return;
    }

    switch (state.phase) {
      case 'DEALING':
        dispatch({ type: 'ACK_CARD', playerId: actor });
        break;
      case 'ACTION_SELECT': {
        botQueue = botTurnActions(state, actor);
        dispatch(botQueue.shift());
        break;
      }
      case 'ANSWER_PENDING':
        dispatch(botAnswerAction(state, actor));
        break;
      case 'PENALTY_TOKEN_SELECT':
        dispatch(botPenaltyAction(state, actor));
        break;
      default:
        break;
    }
  }

  // ── 게임 시작 / 종료 ────────────────────────────────────────────────

  async function startGame() {
    const human = { id: 'p1', nick: (ui.nick || 'KESTREL').slice(0, 12), kind: 'human' };
    const other = ui.mode === 'solo'
      ? { id: 'p2', nick: 'MAGPIE', kind: 'bot' }
      : { id: 'p2', nick: (ui.nick2 || 'MAGPIE').slice(0, 12), kind: 'human' };

    // 선공은 시스템 무작위 (GDD 3-1)
    const players = Math.random() < 0.5 ? [human, other] : [other, human];
    const cards = dealCards(players.map((p) => p.id));

    ui.notes = createNotes([human.id, other.id]);
    ui.viewerId = ui.mode === 'solo' ? human.id : null;
    ui.overlay = null;
    ui.form = { ...DEFAULT_FORM };
    botQueue = [];

    await transport.start({ players, cards, firstIndex: 0 });

    // 봇은 카드 확인을 즉시 끝낸다 (사람의 배분 화면이 가려지지 않도록)
    if (other.kind === 'bot') await transport.dispatch({ type: 'ACK_CARD', playerId: other.id });

    savePrefs();
    render();
    scheduleBot();
  }

  function toLobby() {
    clearTimeout(botTimer);
    clearTimeout(revealTimer);
    botQueue = [];
    transport.reset();
    ui.viewerId = null;
    ui.overlay = null;
    render();
  }

  // ── 이벤트 위임 ─────────────────────────────────────────────────────

  root.addEventListener('click', (event) => {
    const stop = event.target.closest('[data-stop]');
    const el = event.target.closest('[data-act]');
    if (!el) return;
    // 모달 내부 클릭이 배경(오버레이)의 닫기 액션으로 새는 것을 막는다
    if (stop && !stop.contains(el)) return;

    const act = el.dataset.act;
    const state = transport.state;

    switch (act) {
      case 'set-mode':
        ui.mode = el.dataset.mode;
        savePrefs();
        render();
        break;

      case 'start':
        startGame();
        break;

      case 'rules-open':
        ui.overlay = 'rules';
        ui.rulePage = 0;
        render();
        break;
      case 'rules-page':
        ui.rulePage = Number(el.dataset.page);
        render();
        break;
      case 'rules-close':
        ui.overlay = null;
        render();
        break;

      case 'settings-open':
        ui.overlay = 'settings';
        render();
        break;
      case 'settings-toggle':
        ui.settings[el.dataset.key] = !ui.settings[el.dataset.key];
        savePrefs();
        render();
        break;
      case 'close-overlay':
        ui.overlay = null;
        render();
        break;

      case 'handoff-ok':
        ui.viewerId = actorOf(state);
        ui.overlay = null;
        render();
        break;

      case 'ack-card':
        dispatch({ type: 'ACK_CARD', playerId: ui.viewerId });
        break;

      case 'open-question':
        dispatch({ type: 'OPEN_QUESTION' });
        break;
      case 'open-accuse':
        dispatch({ type: 'OPEN_ACCUSE' });
        break;
      case 'cancel':
        dispatch({ type: 'CANCEL' });
        break;

      case 'q-group':
        ui.form.qGroup = el.dataset.group;
        ui.form.qId = null;
        render();
        break;
      case 'q-pick':
        ui.form.qId = el.dataset.qid;
        render();
        break;
      case 'q-submit':
        if (ui.form.qId) {
          dispatch({ type: 'ASK', questionId: ui.form.qId, targetId: opponentIdOf(state, currentPlayerId(state)) });
        }
        break;

      case 'ans-truth':
        dispatch({ type: 'ANSWER', usedCoin: false });
        break;
      case 'ans-coin':
        ui.form.coinStep = 2;
        render();
        break;
      case 'coin-yn':
        ui.form.coinAnswer = el.dataset.yn;
        render();
        break;
      case 'coin-submit':
        if (ui.form.coinAnswer) {
          dispatch({
            type: 'ANSWER',
            usedCoin: true,
            answer: ui.form.coinAnswer,
            line: ui.form.coinLine,
          });
        }
        break;

      case 'accuse-pick':
        ui.form.accuseCardId = el.dataset.card;
        render();
        break;
      case 'accuse-submit':
        if (ui.form.accuseCardId) dispatch({ type: 'ACCUSE', cardId: ui.form.accuseCardId });
        break;

      case 'token-pick': {
        const slot = Number(el.dataset.slot);
        const picked = ui.form.tokenSlots;
        const i = picked.indexOf(slot);
        if (i >= 0) picked.splice(i, 1);
        else if (picked.length < 2) picked.push(slot);
        render();
        break;
      }
      case 'token-submit':
        if (ui.form.tokenSlots.length === 2) {
          dispatch({ type: 'REVEAL_TOKENS', slots: [...ui.form.tokenSlots] });
        }
        break;

      case 'open-pamphlet':
        ui.overlay = 'pamphlet';
        render();
        break;
      case 'mark':
        cycleMark(ui.notes, ui.viewerId, opponentIdOf(state, ui.viewerId), el.dataset.card);
        render();
        break;
      case 'clue-toggle':
        toggleClue(ui.notes, ui.viewerId, opponentIdOf(state, ui.viewerId), Number(el.dataset.seq));
        render();
        break;

      case 'again':
        startGame();
        break;
      case 'to-lobby':
        toLobby();
        break;

      default:
        break;
    }
  });

  // 텍스트 입력은 전체 재렌더 없이 처리한다 (커서·조합 중인 글자를 잃지 않도록)
  root.addEventListener('input', (event) => {
    const field = event.target.dataset?.field;
    if (!field) return;
    const value = event.target.value;

    if (field === 'nick') { ui.nick = value; savePrefs(); return; }
    if (field === 'nick2') { ui.nick2 = value; savePrefs(); return; }
    if (field === 'coinLine') {
      ui.form.coinLine = value;
      const counter = root.querySelector('#line-count');
      if (counter) counter.textContent = String([...value].length);
    }
  });

  // ── 저장 ────────────────────────────────────────────────────────────

  function savePrefs() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        nick: ui.nick, nick2: ui.nick2, mode: ui.mode, settings: ui.settings,
      }));
    } catch { /* 프라이빗 모드 등 — 무시 */ }
  }

  return { render, startGame };
}

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}
