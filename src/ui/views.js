/**
 * 화면 렌더러 — 전부 순수 함수 (상태 → HTML 문자열)
 *
 * GDD 7장의 화면 1~10 을 그대로 옮긴다.
 * 이벤트는 data-act 속성으로 표시하고 app.js 가 위임 처리한다.
 */

import {
  DECK, PAMPHLET, QUESTIONS, QUESTION_GROUPS, TOKEN_EMOJI, TOKEN_MEANING,
  questionById, cardById, evaluate, splitCount, ATTR_META, OPS, cutPointOf,
} from '../../data/deck.js';
import {
  currentPlayerId, opponentIdOf, playerCard, revealedTokensOf,
  actorOf, isFirstSeat, MAX_ACCUSE_FAILS, MAX_LINE_LENGTH, COINS_PER_PLAYER,
  RESULT_REASON_TEXT,
} from '../engine/engine.js';
import {
  pamphletRows, remainingCards, appliedClues, isApplied, MARK_SYMBOL, markOf,
} from './notes.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const tokenRow = (tokens) => tokens.map((t) => `<span class="tok" title="${esc(t)} — ${esc(TOKEN_MEANING[t])}">${TOKEN_EMOJI[t]}</span>`).join('');

const coinDots = (left, total = COINS_PER_PLAYER) =>
  Array.from({ length: total }, (_, i) => (i < left
    ? '<span class="coin coin-on">◉</span>'
    : '<span class="coin coin-off">◌</span>')).join('');

// ── 인사기록 파일 (캐릭터 카드) ───────────────────────────────────────

export function dossier(card, { compact = false, label = '기밀 · 인사기록' } = {}) {
  if (!card) return '';
  return `
    <div class="dossier${compact ? ' dossier-compact' : ''}">
      <div class="dossier-head"><span class="stamp">${esc(label)}</span></div>
      <div class="dossier-body">
        <div class="portrait" aria-hidden="true"><span>${esc(card.name.slice(0, 1))}</span></div>
        <div class="dossier-name">${esc(card.name)}</div>
        <dl class="dossier-fields">
          <dt>키</dt><dd>${card.heightCm} cm</dd>
          <dt>몸무게</dt><dd>${card.weightKg} kg</dd>
          <dt>나이</dt><dd>${card.age} 세</dd>
          <dt>소속</dt><dd>${esc(card.branch)}</dd>
          <dt>마신 술</dt><dd>${esc(card.drink)}</dd>
        </dl>
      </div>
      <div class="dossier-tokens">${tokenRow(card.tokens)}</div>
    </div>`;
}

// ── 화면 1. 타이틀 / 로비 ─────────────────────────────────────────────

export function renderLobby(ui) {
  return `
    <div class="screen screen-lobby">
      <div class="lobby-card">
        <h1 class="title">IMITATION<span> </span>GAME</h1>
        <div class="title-rule"></div>
        <p class="tagline">"날이 밝기 전에 알아내라"</p>

        <label class="field">
          <span class="field-label">${ui.mode === 'hotseat' ? '플레이어 1' : '닉네임'}</span>
          <input type="text" data-field="nick" maxlength="12" value="${esc(ui.nick)}" autocomplete="off" spellcheck="false">
        </label>
        ${ui.mode === 'hotseat' ? `
        <label class="field">
          <span class="field-label">플레이어 2</span>
          <input type="text" data-field="nick2" maxlength="12" value="${esc(ui.nick2)}" autocomplete="off" spellcheck="false">
        </label>` : ''}

        <div class="mode-list">
          <button class="mode${ui.mode === 'solo' ? ' mode-on' : ''}" data-act="set-mode" data-mode="solo">
            <span class="mode-name">연습 · 봇과 대전</span>
            <span class="mode-desc">MAGPIE 를 상대로 혼자 규칙을 익힌다</span>
          </button>
          <button class="mode${ui.mode === 'hotseat' ? ' mode-on' : ''}" data-act="set-mode" data-mode="hotseat">
            <span class="mode-name">2인 · 한 기기 번갈아</span>
            <span class="mode-desc">기기를 넘길 때마다 화면이 가려진다</span>
          </button>
          <button class="mode mode-off" disabled>
            <span class="mode-name">온라인 대전 <em>준비 중</em></span>
            <span class="mode-desc">Cloudflare Durable Objects — M2 에서 열린다</span>
          </button>
        </div>

        <button class="btn btn-primary btn-wide" data-act="start">문 을 밀 고 들 어 선 다</button>
        <button class="btn btn-ghost btn-wide" data-act="rules-open">규칙 보기</button>
      </div>
      <p class="footnote">1943년 · 연합국 스파이 교육 최종 시험</p>
    </div>`;
}

// ── 규칙 오버레이 ─────────────────────────────────────────────────────

const RULE_PAGES = [
  {
    title: '오늘 밤의 시험',
    body: `
      <p>당신은 위조된 신분증 한 장을 받아 쥐고 술집 문을 밀고 들어선다.
         카드 15장 중 <strong>1장</strong>이 당신이다. 상대도 마찬가지다.</p>
      <p>예/아니오 질문을 번갈아 던져 <strong>상대가 누구인지 먼저 알아맞히면 승리</strong>한다.
         동시에 <strong>당신이 누구인지는 끝까지 들키지 말아야</strong> 한다.</p>
      <p>15명 전원의 정보가 적힌 <strong>팜플렛</strong>은 양쪽 모두 언제나 볼 수 있다.
         수치는 구간으로만 적혀 있고, 소속·마신 술·고유 토큰은 사실 그대로 적혀 있다.</p>`,
  },
  {
    title: '질문',
    body: `
      <p>질문은 <strong>고정된 목록</strong>에서 고른다. 키·몸무게·나이·소속·술만 물을 수 있다.</p>
      <p>키·몸무게·나이는 <strong>이상과 이하 양쪽</strong>으로 물을 수 있다. 다만 임계값은
         <strong>구간 경계</strong>에만 놓인다 — 팜플렛에 구간만 적혀 있어서, 경계가 아닌 값으로 물으면
         답을 들어도 그 구간 안의 누구를 지울지 알 수 없기 때문이다.</p>
      <p><strong>이름과 고유 토큰은 물을 수 없다.</strong> 질문 목록에 항목 자체가 없다.</p>
      <p>한 턴에 질문은 한 번. <strong>이미 물었던 질문도 다시 물을 수 있다</strong> —
         상대가 코인을 쓴 답을 검증할 유일한 방법이다.</p>`,
  },
  {
    title: '거짓말 코인 — 이 게임의 심장',
    body: `
      <p>코인은 <strong>2개</strong>. 답변할 때만 쓴다.</p>
      <ul>
        <li>코인을 <strong>쓰지 않은 답은 반드시 진실</strong>이다. 시스템이 강제하므로 어길 방법이 없다.</li>
        <li>코인을 <strong>쓰면</strong> 대사를 직접 입력하고 Y/N 도 스스로 지정한다.
            거짓말을 해도 되고, <strong>그대로 진실을 말해도 된다.</strong></li>
        <li>코인 잔량은 <strong>상대에게 즉시 공개</strong>된다. 상대는 "코인을 썼다"는 사실은 알지만
            <strong>그 답이 거짓인지는 끝까지 알 수 없다.</strong></li>
      </ul>
      <p class="rule-emph">시스템은 코인을 쓴 답변의 진실 여부를 계산하지도, 저장하지도 않는다.
         "코인을 썼으니 거짓이겠지" 하고 뒤집어 읽으면, 진실을 말한 쪽이 이긴다.</p>`,
  },
  {
    title: '지목 — 그리고 대가',
    body: `
      <p>질문 대신 <strong>이름 지목</strong>을 할 수 있다. 맞히면 승리.</p>
      <p>틀리면 <strong>당신의 고유 토큰 5개 중 2개를 직접 골라 공개</strong>해야 한다.
         같은 토큰이 두 개 있다면 그것을 골라 정보 유출을 줄일 수 있다.</p>
      <p><strong>3회 실패하면 즉시 패배한다.</strong> 한 번은 떠볼 수 있고, 두 번째는 각오해야 하고, 세 번째는 없다.</p>
      <p>선공이 먼저 맞히면 후공에게 <strong>마지막 1턴</strong>이 주어진다.
         후공도 맞히면 <strong>무승부</strong>다.</p>`,
  },
];

export function renderRules(ui) {
  const page = RULE_PAGES[ui.rulePage] ?? RULE_PAGES[0];
  const dots = RULE_PAGES.map((_, i) =>
    `<button class="dot${i === ui.rulePage ? ' dot-on' : ''}" data-act="rules-page" data-page="${i}" aria-label="${i + 1}페이지"></button>`).join('');
  return `
    <div class="overlay" data-act="rules-close">
      <div class="modal modal-rules" data-stop>
        <header class="modal-head">
          <h2>${esc(page.title)}</h2>
          <button class="icon-btn" data-act="rules-close" aria-label="닫기">✕</button>
        </header>
        <div class="modal-body rule-body">${page.body}</div>
        <footer class="modal-foot rules-foot">
          <button class="btn btn-ghost" data-act="rules-page" data-page="${Math.max(0, ui.rulePage - 1)}"
            ${ui.rulePage === 0 ? 'disabled' : ''}>이전</button>
          <div class="dots">${dots}</div>
          ${ui.rulePage === RULE_PAGES.length - 1
            ? '<button class="btn btn-primary" data-act="rules-close">알겠다</button>'
            : `<button class="btn btn-primary" data-act="rules-page" data-page="${ui.rulePage + 1}">다음</button>`}
        </footer>
      </div>
    </div>`;
}

// ── 기기 넘기기 (핫시트 전용) ─────────────────────────────────────────

export function renderHandoff(state, toId) {
  const p = state.players[toId];
  return `
    <div class="screen screen-handoff">
      <div class="handoff">
        <p class="handoff-eyebrow">화면을 가렸습니다</p>
        <h2 class="handoff-name">${esc(p.nick)}</h2>
        <p class="handoff-desc">기기를 <strong>${esc(p.nick)}</strong> 에게 넘기세요.<br>
          다른 사람이 보지 않는지 확인한 뒤 누르십시오.</p>
        <button class="btn btn-primary btn-wide" data-act="handoff-ok">내가 ${esc(p.nick)} 입니다</button>
      </div>
    </div>`;
}

// ── 화면 3. 카드 배분 연출 ────────────────────────────────────────────

export function renderDealing(state, viewerId) {
  const card = playerCard(state, viewerId);
  const firstId = state.order[0];
  return `
    <div class="screen screen-dealing">
      <p class="deal-eyebrow">당신에게 배정된 신분</p>
      <div class="deal-card">${dossier(card)}</div>
      <p class="deal-warn">이 정보는 당신만 볼 수 있습니다.<br>상대가 알아내기 전에, 먼저 알아내세요.</p>
      <p class="deal-first">선공 · <strong>${esc(state.players[firstId].nick)}</strong></p>
      <button class="btn btn-primary btn-wide" data-act="ack-card">확 인 했 다</button>
    </div>`;
}

// ── 심문 기록 ─────────────────────────────────────────────────────────

function logEntry(state, e, viewerId, { flashSeq = null, replay = false } = {}) {
  const q = questionById(e.questionId);
  const mine = e.askerId === viewerId;
  const askerNick = mine ? '나' : state.players[e.askerId].nick;
  const targetNick = e.targetId === viewerId ? '나' : state.players[e.targetId].nick;
  const answeredByMe = e.targetId === viewerId;
  return `
    <li class="log-item${e.usedCoin ? ' log-coin' : ''}${e.seq === flashSeq ? ' log-flash' : ''}">
      <div class="log-head">
        <span class="log-no">[${e.seq}]</span>
        <span class="log-who">${esc(askerNick)} → ${esc(targetNick)}</span>
        ${e.usedCoin ? '<span class="log-coin-mark" title="거짓말 코인이 쓰인 답변">🪙</span>' : ''}
      </div>
      <div class="log-q">"${esc(q.text.replace(/^당신(의|은|이)\s*/, ''))}"</div>
      ${e.line ? `<div class="log-line">💬 "${esc(e.line)}"</div>` : ''}
      <div class="log-a">
        <span class="ans ans-${e.answer === 'Y' ? 'yes' : 'no'}">▸ ${e.answer === 'Y' ? 'YES' : 'NO'}</span>
        ${e.usedCoin ? '<span class="unverifiable">⚠ 검증 불가</span>' : ''}
        ${answeredByMe && !replay ? '<span class="log-mine">(내 답변)</span>' : ''}
      </div>
    </li>`;
}

export function renderLog(state, viewerId, opts = {}) {
  if (state.log.length === 0) {
    return '<p class="log-empty">아직 아무도 입을 열지 않았다.</p>';
  }
  return `<ul class="log-list">${state.log.map((e) => logEntry(state, e, viewerId, opts)).join('')}</ul>`;
}

// ── 화면 4. 메인 게임 보드 ────────────────────────────────────────────

const WAITING_TEXT = {
  ACTION_SELECT: (nick) => `${nick} 가 고민 중…`,
  QUESTION_BUILD: () => '질문을 고르는 중…',
  ANSWER_PENDING: () => '답변을 기다리는 중…',
  REVEAL: () => '답변이 도착했습니다',
  ACCUSE_SELECT: () => '⚠ 지목하려 합니다…',
  PENALTY_TOKEN_SELECT: () => '토큰을 고르는 중…',
};

export function renderBoard(state, ui) {
  const viewerId = ui.viewerId;
  const me = state.players[viewerId];
  const oppId = opponentIdOf(state, viewerId);
  const opp = state.players[oppId];
  const myCard = playerCard(state, viewerId);
  const myTurn = currentPlayerId(state) === viewerId;
  const actor = actorOf(state);
  const iAmActor = actor === viewerId;
  const remaining = remainingCards(ui.notes, state, viewerId);
  const revealed = revealedTokensOf(state, oppId);

  const banner = state.counterAttack
    ? `<div class="banner banner-alert">⚠ 마지막 기회 — ${esc(opp.nick)} 가 당신의 정체를 맞혔습니다.
        ${myTurn ? '지금 맞히면 <strong>무승부</strong>, 질문에 이 턴을 쓰면 그대로 <strong>패배</strong>합니다.' : ''}</div>`
    : '';

  const status = iAmActor
    ? '<span class="turn-on">● 당신의 차례</span>'
    : `<span class="turn-off">${esc((WAITING_TEXT[state.phase] ?? (() => '대기 중…'))(opp.nick))}</span>`;

  const oppTokenSlots = Array.from({ length: 5 }, (_, i) => (
    i < revealed.length
      ? `<span class="tok">${TOKEN_EMOJI[revealed[i]]}</span>`
      : '<span class="tok tok-hidden">▨</span>')).join('');

  const fails = Array.from({ length: MAX_ACCUSE_FAILS }, (_, i) =>
    (i < opp.accuseFails ? '<span class="fail fail-on">●</span>' : '<span class="fail">○</span>')).join('');

  const myFails = Array.from({ length: MAX_ACCUSE_FAILS }, (_, i) =>
    (i < me.accuseFails ? '<span class="fail fail-on">●</span>' : '<span class="fail">○</span>')).join('');

  return `
    <div class="screen screen-board">
      <header class="topbar">
        <span class="brand">이미테이션 게임</span>
        <span class="status">${status}</span>
        <span class="turn-no">턴 ${state.turnNumber}</span>
        <button class="icon-btn" data-act="settings-open" aria-label="설정">⚙</button>
      </header>

      ${banner}

      <div class="columns">
        <aside class="col col-left">
          <h3 class="col-title">내 신분</h3>
          ${dossier(myCard, { compact: true, label: `${esc(me.nick)} · 기밀` })}
          <div class="panel">
            <h4>거짓말 코인</h4>
            <div class="coins">${coinDots(me.coinsLeft)}</div>
            <p class="panel-note">${me.coinsLeft}개 남음</p>
          </div>
          <div class="panel">
            <h4>내 지목 실패</h4>
            <div class="fails">${myFails} <span class="panel-note">${me.accuseFails}/${MAX_ACCUSE_FAILS}</span></div>
          </div>
          <div class="panel">
            <h4>남은 후보</h4>
            <button class="remaining" data-act="open-pamphlet">
              <span class="remaining-n">${remaining.length}</span>
              <span class="remaining-of">/ ${DECK.length}</span>
            </button>
            <p class="panel-note">내 추리 노트 기준 · 상대에게 보이지 않음</p>
          </div>
        </aside>

        <section class="col col-mid">
          <h3 class="col-title">심 문 기 록</h3>
          <div class="log-scroll">${renderLog(state, viewerId, { flashSeq: ui.flashSeq })}</div>
        </section>

        <aside class="col col-right">
          <h3 class="col-title">상대 · ${esc(opp.nick)}</h3>
          <div class="unknown-card">
            <div class="unknown-mark">？</div>
            <p>미확인</p>
          </div>
          <div class="panel">
            <h4>거짓말 코인</h4>
            <div class="coins">${coinDots(opp.coinsLeft)}</div>
            <p class="panel-note">${opp.coinsLeft}개 남음</p>
          </div>
          <div class="panel">
            <h4>공개된 토큰</h4>
            <div class="tok-slots">${oppTokenSlots}</div>
            <p class="panel-note">${revealed.length === 0 ? '아직 없음' : '지목 실패로 유출됨'}</p>
          </div>
          <div class="panel">
            <h4>상대 지목 실패</h4>
            <div class="fails">${fails} <span class="panel-note">${opp.accuseFails}/${MAX_ACCUSE_FAILS}</span></div>
          </div>
        </aside>
      </div>

      <footer class="actionbar">
        <button class="btn btn-primary" data-act="open-question" ${myTurn && state.phase === 'ACTION_SELECT' ? '' : 'disabled'}>질 문 하 기</button>
        <button class="btn btn-danger" data-act="open-accuse" ${myTurn && state.phase === 'ACTION_SELECT' ? '' : 'disabled'}>이 름 지 목</button>
        <button class="btn btn-ghost" data-act="open-pamphlet">📋 팜플렛<span class="hide-narrow"> · 추리노트</span></button>
      </footer>
    </div>`;
}

// ── 화면 5. 질문 빌더 ─────────────────────────────────────────────────

/** 임계값을 갖는 수치 질문(키·몸무게·나이)인가 */
export const isNumericGroup = (options) => options.length > 0 && options[0].op !== 'eq';

/**
 * 수치 눈금자 — 사용자가 비교 방향과 임계값을 직접 집는다.
 *
 * 「이상」과 「이하」를 모두 열어두되, 임계값은 구간 경계에만 놓인다 (GDD D1).
 *   이상 → 구간의 아래쪽 경계 (175 · 185)
 *   이하 → 구간의 위쪽 경계   (174 · 184)
 * 팜플렛에는 구간(`175–184`)만 적혀 있으므로, 경계가 아닌 값(예: 180)으로 물으면
 * 답을 들어도 그 구간 안의 누구를 지울지 판단할 수 없다 —
 * 후보를 논리적으로 제거할 수 없는 질문은 질문이 아니다.
 *
 * 174 이하와 175 이상은 같은 자리를 가르는 뒤집힌 표현이라 손잡이가 같은 위치에 선다.
 * 그래서 이상↔이하를 전환해도 눈금자의 자리는 튀지 않는다.
 */
function numericPicker(allOptions, picked, remaining, op) {
  const meta = ATTR_META[allOptions[0].attr];
  const [lo, hi] = meta.range;
  const total = hi + 1 - lo;                 // 눈금자가 [lo, hi] 정수 전체를 덮도록
  const pct = (v) => ((v - lo) / total) * 100;

  const options = allOptions
    .filter((o) => o.op === op)
    .sort((a, b) => cutPointOf(a) - cutPointOf(b));
  const idx = picked ? options.findIndex((o) => o.id === picked.id) : -1;

  const opTabs = OPS.map((o) => `
    <button class="op${o.op === op ? ' op-on' : ''}" data-act="q-op" data-op="${o.op}">
      ${esc(o.label)}<span class="op-sym">${o.symbol}</span>
    </button>`).join('');

  // 구간 경계로 잘린 세 토막
  const cuts = [lo, ...options.map(cutPointOf), hi + 1];
  const cut = picked ? cutPointOf(picked) : null;
  const segments = meta.buckets.map((label, i) => {
    const width = ((cuts[i + 1] - cuts[i]) / total) * 100;
    const count = remaining.filter((c) => {
      const v = c[meta.key];
      return v >= cuts[i] && v < cuts[i + 1];
    }).length;
    const side = cut === null ? '' : ((picked.op === 'gte' ? cuts[i] >= cut : cuts[i] < cut) ? 'yes' : 'no');
    return `
      <div class="scale-seg${side ? ` scale-seg-${side}` : ''}" style="width:${width}%">
        <span class="scale-seg-label">${label}</span>
        <span class="scale-seg-count">${count}명</span>
      </div>`;
  }).join('');

  const handles = options.map((o) => `
    <button class="scale-handle${picked?.id === o.id ? ' scale-handle-on' : ''}"
      style="left:${pct(cutPointOf(o))}%" data-act="q-pick" data-qid="${o.id}"
      aria-label="${o.value}${meta.unit} ${op === 'gte' ? '이상' : '이하'} 로 가르기">
      <span class="scale-handle-flag">${o.value}</span>
      <span class="scale-handle-stem"></span>
    </button>`).join('');

  const opLabel = OPS.find((o) => o.op === op).label;

  return `
    <div class="num-picker">
      <div class="op-toggle" role="group" aria-label="비교 방향">${opTabs}</div>

      <div class="num-readout">
        <button class="num-step" data-act="q-step" data-dir="-1" ${idx <= 0 ? 'disabled' : ''} aria-label="더 작은 값">◀</button>
        <div class="num-value">
          ${picked ? picked.value : '—'}<span class="num-unit">${esc(meta.unit)}</span>
          <span class="num-suffix">${esc(opLabel)}</span>
        </div>
        <button class="num-step" data-act="q-step" data-dir="1" ${idx < 0 || idx >= options.length - 1 ? 'disabled' : ''} aria-label="더 큰 값">▶</button>
      </div>

      <div class="scale">
        <div class="scale-track">${segments}</div>
        <div class="scale-handles">${handles}</div>
        <div class="scale-ends"><span>${lo}</span><span>${hi}</span></div>
      </div>

      <p class="num-why">
        팜플렛에는 <strong>구간</strong>만 적혀 있습니다. 경계가 아닌 값으로 물으면
        답을 들어도 그 구간 안의 누구를 지울지 알 수 없어, 집을 수 있는 지점은 두 곳입니다.
        <br><span class="muted">「174 이하」와 「175 이상」은 같은 자리를 가르는 뒤집힌 표현입니다.</span>
      </p>
    </div>`;
}


export function renderQuestionModal(state, ui) {
  const group = ui.form.qGroup;
  const options = QUESTIONS.filter((q) => q.group === group);
  const picked = options.find((q) => q.id === ui.form.qId) ?? null;
  const remaining = remainingCards(ui.notes, state, ui.viewerId);

  const tabs = QUESTION_GROUPS.map((g) =>
    `<button class="tab${g === group ? ' tab-on' : ''}" data-act="q-group" data-group="${esc(g)}">${esc(g)}</button>`).join('');

  // 수치 질문(키·몸무게·나이)은 값을 직접 집어 고른다. 소속·술은 선택지가 이름뿐이다.
  const chooser = isNumericGroup(options)
    ? numericPicker(options, picked, remaining, ui.form.qOp)
    : options.map((q) => `
        <label class="choice${ui.form.qId === q.id ? ' choice-on' : ''}">
          <input type="radio" name="q" data-act="q-pick" data-qid="${q.id}" ${ui.form.qId === q.id ? 'checked' : ''}>
          <span class="radio">${ui.form.qId === q.id ? '●' : '○'}</span>
          <span>${esc(q.choice)}</span>
        </label>`).join('');

  let hint = '';
  if (picked && ui.settings.splitHint) {
    const { yes, no } = splitCount(remaining, picked);
    hint = (yes === 0 || no === 0)
      ? `<p class="q-hint q-hint-warn">남은 후보 ${remaining.length}명을 전혀 가르지 못합니다 — 이미 아는 정보입니다.</p>`
      : `<p class="q-hint">남은 후보 ${remaining.length}명을 <strong>${yes} : ${no}</strong> 으로 가릅니다.</p>`;
  }

  return `
    <div class="overlay">
      <div class="modal" data-stop>
        <header class="modal-head">
          <h2>무엇을 물어보시겠습니까?</h2>
          <button class="icon-btn" data-act="cancel" aria-label="닫기">✕</button>
        </header>
        <div class="modal-body">
          <div class="tabs">${tabs}</div>
          <div class="choices">${chooser}</div>
          <div class="q-preview">${picked ? `"${esc(picked.text)}"` : '<span class="muted">질문을 고르세요</span>'}</div>
          ${hint}
          <p class="q-note">이름과 고유 토큰은 물을 수 없습니다.</p>
        </div>
        <footer class="modal-foot">
          <button class="btn btn-primary btn-wide" data-act="q-submit" ${picked ? '' : 'disabled'}>질 문 한 다</button>
        </footer>
      </div>
    </div>`;
}

// ── 화면 6. 답변 모달 (답변자 전용) ───────────────────────────────────

export function renderAnswerModal(state, ui) {
  const { askerId, targetId, questionId } = state.pending;
  const q = questionById(questionId);
  const asker = state.players[askerId];
  const me = state.players[targetId];

  if (ui.form.coinStep === 1) {
    const truth = evaluate(q, playerCard(state, targetId)) ? 'Y' : 'N';
    const noCoins = me.coinsLeft <= 0;
    return `
      <div class="overlay">
        <div class="modal modal-answer" data-stop>
          <header class="modal-head"><h2>${esc(asker.nick)} 이(가) 물었습니다</h2></header>
          <div class="modal-body">
            <div class="asked">"${esc(q.text)}"</div>
            <p class="truth-line">당신의 카드 기준 진실 →
              <strong class="ans ans-${truth === 'Y' ? 'yes' : 'no'}">● ${truth === 'Y' ? 'YES' : 'NO'}</strong></p>
            <button class="btn btn-primary btn-wide btn-tall" data-act="ans-truth">
              진실대로 <strong>${truth === 'Y' ? 'Y E S' : 'N O'}</strong> 라고 답한다
              <em>코인 소모 없음</em>
            </button>
            <div class="or">또 는</div>
            <button class="btn btn-coin btn-wide btn-tall" data-act="ans-coin" ${noCoins ? 'disabled' : ''}>
              🪙 거짓말 코인을 쓴다 <span class="coin-left">(남은 ${me.coinsLeft})</span>
              <em>${noCoins ? '코인을 모두 사용했습니다' : '직접 답을 지어냅니다'}</em>
            </button>
          </div>
        </div>
      </div>`;
  }

  const len = [...ui.form.coinLine].length;
  const yn = ui.form.coinAnswer;
  return `
    <div class="overlay">
      <div class="modal modal-answer" data-stop>
        <header class="modal-head"><h2>${esc(q.text)}</h2></header>
        <div class="modal-body">
          <p class="coin-used">🪙 코인을 사용했습니다.<br>
            <span class="muted">이 답변은 누구도 검증할 수 없습니다. 진실을 말해도 됩니다.</span></p>

          <label class="field">
            <span class="field-label">대사 <span class="muted">(비워두면 침묵)</span></span>
            <textarea data-field="coinLine" maxlength="${MAX_LINE_LENGTH}" rows="2"
              placeholder="글쎄, 기억이 안 나는군…">${esc(ui.form.coinLine)}</textarea>
          </label>
          <p class="counter"><span id="line-count">${len}</span> / ${MAX_LINE_LENGTH}</p>

          <p class="yn-q">이 답은 Yes 입니까, No 입니까?</p>
          <div class="yn">
            <button class="btn btn-yn${yn === 'Y' ? ' btn-yn-on' : ''}" data-act="coin-yn" data-yn="Y">Y E S</button>
            <button class="btn btn-yn${yn === 'N' ? ' btn-yn-on' : ''}" data-act="coin-yn" data-yn="N">N O</button>
          </div>
          <p class="q-note">상대에게는 대사와 함께 이 값이 표시됩니다. 대사와 어긋나도 무방합니다.</p>
        </div>
        <footer class="modal-foot">
          <button class="btn btn-primary btn-wide" data-act="coin-submit" ${yn ? '' : 'disabled'}>답 변 한 다</button>
        </footer>
      </div>
    </div>`;
}

// ── 화면 7. 팜플렛 · 추리 노트 ────────────────────────────────────────

export function renderPamphlet(state, ui) {
  const viewerId = ui.viewerId;
  const oppId = opponentIdOf(state, viewerId);
  const rows = pamphletRows(ui.notes, state, viewerId);
  const remaining = rows.filter((r) => !r.out).length;
  const clues = appliedClues(ui.notes, state, viewerId);

  const body = rows.map(({ card, mark, bySelf, byClue, byToken, out }) => {
    const p = PAMPHLET.find((x) => x.id === card.id);
    const cls = [out ? 'row-out' : '', byClue ? 'row-clue' : '', byToken ? 'row-token' : '', bySelf ? 'row-self' : ''].filter(Boolean).join(' ');
    return `
      <tr class="${cls}">
        <td class="c-mark">
          ${bySelf
            ? '<span class="mark mark-self" title="당신의 카드입니다 — 상대일 수 없습니다">나</span>'
            : `<button class="mark mark-${mark}" data-act="mark" data-card="${card.id}"
                 title="○ 미판정 → ✕ 제외 → ● 유력">${MARK_SYMBOL[mark]}</button>`}
        </td>
        <td class="c-name">${esc(card.name)}${byToken ? '<span class="row-why" title="공개된 토큰과 맞지 않음">🪙</span>' : ''}</td>
        <td>${p.heightLabel}</td>
        <td>${p.weightLabel}</td>
        <td>${p.ageLabel}</td>
        <td>${esc(p.branch)}</td>
        <td>${esc(p.drink)}</td>
        <td class="c-tokens">${tokenRow(p.tokens)}</td>
      </tr>`;
  }).join('');

  const clueChips = state.log
    .filter((e) => e.targetId === oppId)
    .map((e) => {
      const q = questionById(e.questionId);
      const on = isApplied(ui.notes, viewerId, oppId, e.seq);
      const label = `${q.short} ${e.answer === 'Y' ? 'YES' : 'NO'}`;
      return `
        <button class="chip${on ? ' chip-on' : ''}${e.usedCoin ? ' chip-coin' : ''}"
          data-act="clue-toggle" data-seq="${e.seq}"
          title="${on ? '클릭하면 해제됩니다' : '클릭하면 적용됩니다'}">
          <span class="chip-no">[${e.seq}]</span> ${esc(label)}${e.usedCoin ? ' 🪙' : ''}
        </button>`;
    }).join('');

  const coinWarn = state.log.filter((e) => e.targetId === oppId && e.usedCoin);

  return `
    <div class="overlay overlay-wide">
      <div class="modal modal-pamphlet" data-stop>
        <header class="modal-head">
          <h2>📋 술집 참가자 명단 — 기밀</h2>
          <span class="remaining-badge">남은 후보 ${remaining} / ${DECK.length}</span>
          <button class="icon-btn" data-act="close-overlay" aria-label="닫기">✕</button>
        </header>
        <div class="modal-body pamphlet-body">
          <table class="pamphlet">
            <thead>
              <tr>
                <th>후보</th><th>이름</th>
                <th>키 <span class="unit">cm</span></th>
                <th>몸무게 <span class="unit">kg</span></th>
                <th>나이 <span class="unit">세</span></th>
                <th>소속</th><th>술</th><th>고유 토큰</th>
              </tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>
        <footer class="modal-foot pamphlet-foot">
          <div class="clues">
            <h4>단서 <span class="muted">— 클릭하면 적용/해제</span></h4>
            <div class="chips">${clueChips || '<span class="muted">아직 단서가 없습니다.</span>'}</div>
          </div>
          ${coinWarn.length > 0 ? `<p class="pamphlet-warn">⚠ ${coinWarn.map((e) => `[${e.seq}]`).join(' ')}번 답변에는 코인이 쓰였습니다. 진실일 수도, 거짓일 수도 있습니다 — 적용은 직접 판단하세요.</p>` : ''}
        </footer>
      </div>
    </div>`;
}

// ── 화면 8. 지목 모달 ─────────────────────────────────────────────────

export function renderAccuseModal(state, ui) {
  const viewerId = ui.viewerId;
  const oppId = opponentIdOf(state, viewerId);
  const opp = state.players[oppId];
  const me = state.players[viewerId];
  const rows = pamphletRows(ui.notes, state, viewerId);
  const picked = ui.form.accuseCardId;
  const pickedCard = picked ? cardById(picked) : null;

  const grid = rows.map(({ card, out, mark, bySelf }) => `
    <button class="name-card${out ? ' name-out' : ''}${picked === card.id ? ' name-on' : ''}"
      data-act="accuse-pick" data-card="${card.id}" ${bySelf ? 'disabled title="당신의 카드입니다"' : ''}>
      <span class="name-card-name">${esc(card.name)}</span>
      <span class="name-card-mark">${bySelf ? '나' : (picked === card.id ? '● 선택' : MARK_SYMBOL[mark])}</span>
    </button>`).join('');

  const last = me.accuseFails === MAX_ACCUSE_FAILS - 1;

  return `
    <div class="overlay overlay-wide">
      <div class="modal modal-accuse" data-stop>
        <header class="modal-head">
          <h2>${esc(opp.nick)} 의 정체를 지목합니다</h2>
          <button class="icon-btn" data-act="cancel" aria-label="닫기">✕</button>
        </header>
        <div class="modal-body">
          <div class="name-grid">${grid}</div>
          <p class="accuse-warn${last ? ' accuse-warn-last' : ''}">
            ⚠ 실패하면 당신의 고유 토큰 2개를 공개해야 합니다.
            현재 실패 <strong>${me.accuseFails} / ${MAX_ACCUSE_FAILS}</strong>
            ${last ? '— <strong>이번에 틀리면 패배합니다.</strong>' : `— ${MAX_ACCUSE_FAILS}회째엔 패배.`}
          </p>
          ${state.counterAttack ? '<p class="accuse-warn accuse-warn-last">이것은 반격 턴입니다. 맞히면 무승부, 틀리면 패배합니다.</p>' : ''}
        </div>
        <footer class="modal-foot modal-foot-2">
          <button class="btn btn-ghost" data-act="cancel">취소</button>
          <button class="btn btn-danger" data-act="accuse-submit" ${picked ? '' : 'disabled'}>
            ${pickedCard ? `${esc(pickedCard.name)} 라고 지목` : '지목한다'}
          </button>
        </footer>
      </div>
    </div>`;
}

// ── 화면 9. 토큰 공개 모달 ────────────────────────────────────────────

export function renderPenaltyModal(state, ui) {
  const viewerId = ui.viewerId;
  const card = playerCard(state, viewerId);
  const already = state.players[viewerId].revealedSlots;
  const picked = ui.form.tokenSlots;

  const slots = card.tokens.map((t, i) => {
    const done = already.includes(i);
    const on = picked.includes(i);
    return `
      <button class="tok-slot${on ? ' tok-on' : ''}${done ? ' tok-done' : ''}"
        data-act="token-pick" data-slot="${i}" ${done ? 'disabled' : ''}>
        <span class="tok-face">${TOKEN_EMOJI[t]}</span>
        <span class="tok-state">${done ? '공개됨' : (on ? '선택' : '')}</span>
      </button>`;
  }).join('');

  return `
    <div class="overlay">
      <div class="modal" data-stop>
        <header class="modal-head"><h2>지목에 실패했습니다</h2></header>
        <div class="modal-body">
          <p class="penalty-desc">고유 토큰 <strong>2개</strong>를 공개해야 합니다.</p>
          <div class="tok-slot-row">${slots}</div>
          <p class="penalty-hint">💡 같은 토큰 2개를 고르면 상대에게 주는 정보를 줄일 수 있습니다.</p>
        </div>
        <footer class="modal-foot">
          <button class="btn btn-primary btn-wide" data-act="token-submit" ${picked.length === 2 ? '' : 'disabled'}>
            2개 공개한다 ${picked.length > 0 ? `(${picked.length}/2)` : ''}
          </button>
        </footer>
      </div>
    </div>`;
}

// ── 화면 10. 결과 ─────────────────────────────────────────────────────

export function renderResult(state, ui) {
  const viewerId = ui.viewerId;
  const oppId = opponentIdOf(state, viewerId);
  const r = state.result;
  const myCard = cardById(r.cards[viewerId]);
  const oppCard = cardById(r.cards[oppId]);
  const opp = state.players[oppId];
  const me = state.players[viewerId];

  const headline = r.winner === 'draw' ? '무 승 부' : (r.winner === viewerId ? '승      리' : '패      배');
  const cls = r.winner === 'draw' ? 'draw' : (r.winner === viewerId ? 'win' : 'lose');

  const coinSummary = [me, opp].map((p) => {
    const used = COINS_PER_PLAYER - p.coinsLeft;
    return `<li>${esc(p.nick)} — 코인 ${used === 0 ? '한 개도 쓰지 않았습니다' : `${used}개 사용`}</li>`;
  }).join('');

  return `
    <div class="screen screen-result">
      <header class="result-head result-${cls}">
        <h1>${headline}</h1>
        <p>${esc(opp.nick)} 의 정체는 <strong>${esc(oppCard.name)}</strong> 였습니다</p>
        <p class="result-reason">${esc(RESULT_REASON_TEXT[r.reason] ?? r.reason)} · 총 ${r.turns}턴</p>
      </header>

      <div class="result-cards">
        <div class="result-card">
          <h3>${esc(me.nick)} <span class="muted">(나)</span></h3>
          ${dossier(myCard, { compact: true, label: '나' })}
        </div>
        <div class="result-card">
          <h3>${esc(opp.nick)}</h3>
          ${dossier(oppCard, { compact: true, label: '상대' })}
        </div>
      </div>

      <section class="replay">
        <h3>심문 기록 복기 <span class="muted">↑ 위 카드와 대조해 직접 확인하세요</span></h3>
        <p class="replay-note">
          코인이 쓰인 답변에는 <strong>진실/거짓 라벨이 붙지 않습니다.</strong>
          시스템이 애초에 판정하지 않았기 때문입니다 — 카드와 대조해 직접 알아내십시오.
        </p>
        <div class="replay-log">${renderLog(state, viewerId, { replay: true })}</div>
        <ul class="coin-summary">${coinSummary}</ul>
      </section>

      <footer class="result-foot">
        <button class="btn btn-primary" data-act="again">한 판 더</button>
        <button class="btn btn-ghost" data-act="to-lobby">로비로</button>
      </footer>
    </div>`;
}

// ── 설정 ──────────────────────────────────────────────────────────────

export function renderSettings(ui) {
  const row = (key, label, desc) => `
    <button class="setting" data-act="settings-toggle" data-key="${key}">
      <span class="setting-box">${ui.settings[key] ? '☑' : '☐'}</span>
      <span><strong>${esc(label)}</strong><em>${esc(desc)}</em></span>
    </button>`;
  return `
    <div class="overlay" data-act="close-overlay">
      <div class="modal modal-narrow" data-stop>
        <header class="modal-head">
          <h2>설정</h2>
          <button class="icon-btn" data-act="close-overlay" aria-label="닫기">✕</button>
        </header>
        <div class="modal-body">
          ${row('splitHint', '질문 분할 안내', '질문이 남은 후보를 몇:몇으로 가르는지 미리 보여준다')}
          ${row('reduceMotion', '연출 줄이기', '담배 연기와 전환 애니메이션을 끈다')}
        </div>
        <footer class="modal-foot">
          <button class="btn btn-ghost btn-wide" data-act="rules-open">규칙 다시 보기</button>
        </footer>
      </div>
    </div>`;
}
