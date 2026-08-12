/**
 * 앱 셸 — 화면 전환 · 이벤트 위임 · 기기 넘기기 가드 · 봇 구동
 *
 * 엔진은 순수하고, 이 파일이 「누가 지금 화면을 보고 있는가」를 관리한다.
 * 핫시트에서 상대의 카드가 새지 않게 막는 책임이 전부 여기 있다.
 */

import { QUESTIONS, cutPointOf } from '../../data/deck.js';
import { LocalTransport } from '../net/transport.js';
import { CloudflareTransport } from '../net/cloudflare.js';
import {
  actorOf, currentPlayerId, dealCards, opponentIdOf, opponentsOf, isGameOver,
} from '../engine/engine.js';
import { botTurnActions, botAnswerAction, botPenaltyAction } from '../engine/bot.js';
import { createNotes, syncAutoApply, cycleMark, toggleClue } from './notes.js';
import * as V from './views.js';

const STORE_KEY = 'imitation-game/prefs';

const DEFAULT_FORM = {
  qGroup: '키',
  qOp: 'gte',          // 수치 질문의 비교 방향 — 이상(gte) / 이하(lte)
  qId: null,
  qTarget: null,       // 3인 이상 — 누구에게 물을 것인가
  coinStep: 1,
  coinLine: '',
  coinAnswer: null,
  accuseTarget: null,  // 3인 이상 — 누구를 지목할 것인가
  accuseCardId: null,
  noteTarget: null,    // 팜플렛에서 지금 보고 있는 상대
  tokenSlots: [],
};

export function createApp(root) {
  const local = new LocalTransport();
  /** 지금 쓰고 있는 전송 계층. 온라인이면 CloudflareTransport 로 바뀐다. */
  let net = local;
  let online = null;
  let unsubscribe = null;

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
    online: { busy: null, codeInput: '', error: null, room: null, connection: null },
  };

  const isOnline = () => ui.mode === 'online' && online !== null;

  let lastPhase = null;
  let lastRoomSeq = null;
  let botTimer = null;
  let revealTimer = null;
  let botQueue = [];

  // ── 렌더 ────────────────────────────────────────────────────────────

  function render() {
    const state = net.state;
    document.body.classList.toggle('reduce-motion', ui.settings.reduceMotion);

    // ── 온라인: 방에 들어와 있지만 아직 게임 전이면 대기실 ────────────
    if (isOnline()) {
      const room = ui.online.room;
      if (!room) {
        root.innerHTML = V.renderWaitingFor('방에 연결하는 중입니다…');
        return;
      }
      if (!state) {
        root.innerHTML = V.renderWaitingRoom(ui, room, ui.viewerId, ui.online.connection)
          + (ui.overlay === 'rules' ? V.renderRules(ui) : '');
        return;
      }
    }

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

    // 온라인: 내 카드 확인이 끝났는데 상대가 아직이면 기다린다
    if (isOnline() && state.phase === 'DEALING' && state.players[ui.viewerId]?.ackedCard) {
      root.innerHTML = V.renderWaitingFor('상대가 카드를 확인하는 중입니다…');
      return;
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
    if (isOnline()) {
      // 온라인에서는 서버가 정해 준 내 자리가 곧 시점이다. 가림막은 필요 없다 —
      // 애초에 상대 카드가 이 브라우저로 내려오지 않는다.
      ui.viewerId = online.playerId;
      return;
    }
    if (ui.mode === 'solo') {
      ui.viewerId = ui.humanId;
      return;
    }
    // 핫시트에서는 viewerId 를 자동으로 정하지 않는다.
    // 선공은 무작위라 기기를 든 사람과 첫 행동 주체가 다를 수 있으므로,
    // 첫 카드가 열리기 전에 반드시 「내가 누구입니다」 확인을 거치게 한다.
    if (ui.viewerId === null && isGameOver(state)) ui.viewerId = state.order[0];
  }

  /** 지금 화면에서 기본으로 고를 상대 (좌석 순서상 첫 생존자) */
  function defaultTarget() {
    const state = net.state;
    if (!state) return null;
    return opponentsOf(state, ui.viewerId)[0] ?? null;
  }

  /** 팜플렛에서 지금 보고 있는 상대 */
  function noteTargetOf(state) {
    const foes = opponentsOf(state, ui.viewerId);
    return foes.includes(ui.form.noteTarget) ? ui.form.noteTarget : (foes[0] ?? opponentIdOf(state, ui.viewerId));
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
    // 온라인은 서버가 판정한다. 결과는 sync 메시지로 돌아오므로 여기서 기다리지 않는다.
    if (isOnline()) {
      await net.dispatch(action);
      return;
    }

    const before = net.state?.phase;
    await net.dispatch(action);
    const state = net.state;

    if (state.phase !== before) onPhaseEnter(state.phase, before);

    render();
    scheduleReveal();
    scheduleBot();
  }

  function onPhaseEnter(phase) {
    switch (phase) {
      case 'QUESTION_BUILD':
        ui.form.qGroup = '키';
        ui.form.qOp = 'gte';
        ui.form.qId = defaultQuestionOf('키', 'gte');
        ui.form.qTarget = defaultTarget();
        break;
      case 'ANSWER_PENDING':
        ui.form.coinStep = 1;
        ui.form.coinLine = '';
        ui.form.coinAnswer = null;
        break;
      case 'ACCUSE_SELECT':
        ui.form.accuseCardId = null;
        ui.form.accuseTarget = defaultTarget();
        break;
      case 'PENALTY_TOKEN_SELECT':
        ui.form.tokenSlots = [];
        break;
      default:
        break;
    }
    ui.flashSeq = phase === 'REVEAL' ? (net.state?.log.at(-1)?.seq ?? null) : null;
    // 핫시트: 다음 행동 주체가 바뀌면 다시 기기를 넘겨야 한다
    if (ui.mode === 'hotseat') {
      const expected = actorOf(net.state);
      if (expected && expected !== ui.viewerId) ui.overlay = null;
    }
  }

  // ── 온라인 — 서버가 밀어 준 상태 반영 ───────────────────────────────

  function onRemoteSync() {
    ui.online.room = online.room;
    ui.online.connection = online.status;
    if (online.error) ui.online.error = online.error;

    // 게임이 시작되기 전에도 내가 누구인지는 정해져 있어야 한다.
    // 대기실에서 방장 여부를 판단하는 데 쓴다.
    if (online.playerId) ui.viewerId = online.playerId;

    const state = online.state;

    // 새 판이 시작되면 추리 노트를 새로 연다 (방의 seq 가 판마다 올라간다)
    const seq = online.room?.seq ?? null;
    if (state && seq !== lastRoomSeq) {
      lastRoomSeq = seq;
      ui.notes = createNotes(state.order);
      ui.viewerId = online.playerId;
      ui.overlay = null;
      ui.form = { ...DEFAULT_FORM };
      lastPhase = null;
    }

    if (state && state.phase !== lastPhase) {
      lastPhase = state.phase;
      onPhaseEnter(state.phase);
    }

    render();
  }

  // ── 온라인 — 방 만들기 · 입장 · 나가기 ──────────────────────────────

  function attachOnline() {
    online = new CloudflareTransport();
    net = online;
    unsubscribe?.();
    unsubscribe = online.subscribe(onRemoteSync);
  }

  function detachOnline() {
    unsubscribe?.();
    unsubscribe = null;
    online?.close();
    online = null;
    net = local;
    lastRoomSeq = null;
    lastPhase = null;
    ui.online = { busy: null, codeInput: '', error: null, room: null, connection: null };
  }

  async function withRoom(kind, fn) {
    ui.online.busy = kind;
    ui.online.error = null;
    render();
    try {
      attachOnline();
      await fn();
      savePrefs();
    } catch (err) {
      detachOnline();
      ui.online.error = err.message ?? '연결에 실패했습니다';
    } finally {
      ui.online.busy = null;
      render();
    }
  }

  // ── 답변 공개 자동 진행 ─────────────────────────────────────────────

  function scheduleReveal() {
    clearTimeout(revealTimer);
    const state = net.state;
    if (!state || state.phase !== 'REVEAL') return;
    revealTimer = setTimeout(() => { dispatch({ type: 'CONTINUE' }); }, ui.settings.reduceMotion ? 350 : 1500);
  }

  // ── 봇 구동 ─────────────────────────────────────────────────────────

  function scheduleBot() {
    clearTimeout(botTimer);
    const state = net.state;
    if (!state || isGameOver(state) || state.phase === 'REVEAL') return;
    const actor = actorOf(state);
    if (!actor || state.players[actor].kind !== 'bot') return;
    botTimer = setTimeout(runBotStep, ui.settings.reduceMotion ? 150 : 800);
  }

  function runBotStep() {
    const state = net.state;
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

    await local.start({ players, cards, firstIndex: 0 });

    // 봇은 카드 확인을 즉시 끝낸다 (사람의 배분 화면이 가려지지 않도록)
    if (other.kind === 'bot') await local.dispatch({ type: 'ACK_CARD', playerId: other.id });

    savePrefs();
    render();
    scheduleBot();
  }

  function toLobby() {
    clearTimeout(botTimer);
    clearTimeout(revealTimer);
    botQueue = [];
    detachOnline();
    local.reset();
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
    const state = net.state;

    switch (act) {
      case 'set-mode':
        if (ui.mode !== el.dataset.mode) detachOnline();
        ui.mode = el.dataset.mode;
        savePrefs();
        render();
        break;

      case 'start':
        startGame();
        break;

      // ── 온라인 ──────────────────────────────────────────────────────
      case 'room-create':
        withRoom('create', () => online.createRoom(ui.nick));
        break;
      case 'room-join':
        withRoom('join', () => online.joinRoom(ui.online.codeInput, ui.nick));
        break;
      case 'room-ready':
        ui.online.error = null;
        online?.setReady(el.dataset.ready === 'on');
        break;
      case 'room-start':
        ui.online.error = null;
        online?.startGame();
        break;
      case 'room-leave':
        toLobby();
        break;
      case 'copy-code': {
        const code = el.dataset.code ?? '';
        navigator.clipboard?.writeText(code).then(
          () => { el.textContent = '복사됨'; },
          () => { el.textContent = code; },
        );
        break;
      }

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
        ui.form.qId = defaultQuestionOf(ui.form.qGroup, ui.form.qOp);
        render();
        break;
      case 'q-pick':
        ui.form.qId = el.dataset.qid;
        render();
        break;
      case 'q-op': {
        // 이상 ↔ 이하 전환. 같은 자리를 가르는 짝으로 옮겨 손잡이 위치를 유지한다
        const nextOp = el.dataset.op;
        const cur = QUESTIONS.find((q) => q.id === ui.form.qId);
        const opts = numericOptions(ui.form.qGroup, nextOp);
        ui.form.qOp = nextOp;
        ui.form.qId = (cur && opts.find((o) => cutPointOf(o) === cutPointOf(cur)))?.id ?? opts[0]?.id ?? null;
        render();
        break;
      }
      case 'q-step': {
        // 수치 눈금자의 ◀ ▶ — 고를 수 있는 임계값 사이를 옮겨 다닌다
        const opts = numericOptions(ui.form.qGroup, ui.form.qOp);
        if (opts.length === 0) break;
        const dir = Number(el.dataset.dir);
        const i = opts.findIndex((o) => o.id === ui.form.qId);
        const next = i < 0
          ? (dir > 0 ? 0 : opts.length - 1)
          : Math.min(opts.length - 1, Math.max(0, i + dir));
        ui.form.qId = opts[next].id;
        render();
        break;
      }
      case 'q-target':
        ui.form.qTarget = el.dataset.target;
        render();
        break;
      case 'q-submit':
        if (ui.form.qId) {
          dispatch({
            type: 'ASK',
            questionId: ui.form.qId,
            targetId: ui.form.qTarget ?? opponentIdOf(state, currentPlayerId(state)),
          });
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

      case 'accuse-target':
        // 대상이 바뀌면 고른 카드는 의미가 없으므로 비운다
        ui.form.accuseTarget = el.dataset.target;
        ui.form.accuseCardId = null;
        render();
        break;
      case 'accuse-pick':
        ui.form.accuseCardId = el.dataset.card;
        render();
        break;
      case 'accuse-submit':
        if (ui.form.accuseCardId) {
          dispatch({
            type: 'ACCUSE',
            cardId: ui.form.accuseCardId,
            targetId: ui.form.accuseTarget ?? opponentIdOf(state, currentPlayerId(state)),
          });
        }
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
        // 보드의 상대 패널에서 바로 그 사람의 노트를 열 수 있다
        if (el.dataset.target) ui.form.noteTarget = el.dataset.target;
        ui.overlay = 'pamphlet';
        render();
        break;
      case 'note-target':
        ui.form.noteTarget = el.dataset.target;
        render();
        break;
      case 'mark':
        cycleMark(ui.notes, ui.viewerId, noteTargetOf(state), el.dataset.card);
        render();
        break;
      case 'clue-toggle':
        toggleClue(ui.notes, ui.viewerId, noteTargetOf(state), Number(el.dataset.seq));
        render();
        break;

      case 'again':
        if (isOnline()) { ui.online.error = null; online.again(); }
        else startGame();
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
    if (field === 'roomCode') {
      // 사람이 부른 코드를 관대하게 받는다 (소문자·공백·하이픈)
      const code = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
      ui.online.codeInput = code;
      if (event.target.value !== code) event.target.value = code;
      const btn = root.querySelector('[data-act="room-join"]');
      if (btn) btn.disabled = code.length < 4;
      return;
    }
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

const questionsOf = (group) => QUESTIONS.filter((q) => q.group === group);

/** 한 그룹의 수치 질문을, 눈금자에서 가르는 자리 순으로 */
const numericOptions = (group, op) =>
  questionsOf(group).filter((q) => q.op === op).sort((a, b) => cutPointOf(a) - cutPointOf(b));

/**
 * 탭을 열었을 때의 기본 선택.
 * 수치 질문은 눈금자에 값이 하나 집혀 있어야 읽히므로 첫 임계값을 미리 집어둔다.
 * 소속·술은 선택지가 이름뿐이라 고르지 않은 상태로 시작한다.
 */
function defaultQuestionOf(group, op) {
  const opts = questionsOf(group);
  if (opts.length === 0 || opts[0].op === 'eq') return null;
  return numericOptions(group, op)[0]?.id ?? null;
}

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}
