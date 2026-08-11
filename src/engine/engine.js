/**
 * 이미테이션 게임 — 룰 엔진 (순수 함수)
 *
 * DOM·네트워크·타이머에 일절 의존하지 않는다. 상태 + 액션 → 새 상태.
 * 로컬 핫시트, 봇 연습, (내일 붙일) Firebase 모두 이 엔진을 그대로 공유한다.
 *
 * ★ D6 — 코인을 쓴 답변에 대해 이 엔진은 진실값을 계산하지도, 저장하지도 않는다.
 *   log 항목에 wasLie 같은 필드는 존재하지 않는다. 저장하지 않는 것은 샐 수 없다.
 */

import { DECK, cardById, questionById, evaluate } from '../../data/deck.js';

export const PHASES = [
  'DEALING',
  'ACTION_SELECT',
  'QUESTION_BUILD',
  'ANSWER_PENDING',
  'REVEAL',
  'ACCUSE_SELECT',
  'PENALTY_TOKEN_SELECT',
  'RESULT',
];

export const COINS_PER_PLAYER = 2;
export const MAX_ACCUSE_FAILS = 3;
export const TOKENS_PER_PENALTY = 2;
export const MAX_LINE_LENGTH = 40;

const clone = (o) => JSON.parse(JSON.stringify(o));

// ── 조회 헬퍼 ─────────────────────────────────────────────────────────

export const currentPlayerId = (s) => s.order[s.currentIndex];
export const currentPlayer = (s) => s.players[currentPlayerId(s)];
export const opponentIdOf = (s, id) => s.order.find((p) => p !== id);
export const playerCard = (s, id) => cardById(s.players[id].cardId);
/** 선공 = 좌석 0 */
export const isFirstSeat = (s, id) => s.order[0] === id;

/** 지목 실패로 실제 공개된 토큰 목록 (슬롯 인덱스 → 토큰) */
export function revealedTokensOf(s, id) {
  const card = playerCard(s, id);
  if (!card) return [];
  return s.players[id].revealedSlots.map((i) => card.tokens[i]);
}

/** 무작위 서로 다른 카드 배분. rng 를 주입받아 테스트에서 고정할 수 있다. */
export function dealCards(playerIds, rng = Math.random) {
  const pool = DECK.map((c) => c.id);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const out = {};
  playerIds.forEach((id, i) => { out[id] = pool[i]; });
  return out;
}

// ── 생성 ──────────────────────────────────────────────────────────────

/**
 * @param {{ players: {id:string,nick:string,kind?:'human'|'bot'}[], cards: Record<string,string>, firstIndex?: number }} opts
 */
export function createGame({ players, cards, firstIndex = 0 }) {
  if (players.length < 2) throw new Error('2인 이상 필요');
  return {
    rulesetVersion: '0.3',
    deckId: 'deck-v1',
    phase: 'DEALING',
    order: players.map((p) => p.id),
    currentIndex: firstIndex,
    turnNumber: 1,
    counterAttack: false,
    pendingWinner: null,
    players: Object.fromEntries(players.map((p, i) => [p.id, {
      id: p.id,
      nick: p.nick,
      kind: p.kind ?? 'human',
      seat: i,
      cardId: cards[p.id],
      coinsLeft: COINS_PER_PLAYER,
      revealedSlots: [],
      accuseFails: 0,
      ackedCard: false,
    }])),
    pending: null,
    log: [],
    events: [],
    result: null,
    seq: 0,
  };
}

// ── 액션 ──────────────────────────────────────────────────────────────

/**
 * @param {object} state
 * @param {{type:string} & Record<string, any>} action
 * @returns {object} 새 상태 (입력은 변경하지 않는다)
 */
export function apply(state, action) {
  const s = clone(state);
  switch (action.type) {
    case 'ACK_CARD':      return ackCard(s, action);
    case 'OPEN_QUESTION': return openQuestion(s);
    case 'OPEN_ACCUSE':   return openAccuse(s);
    case 'CANCEL':        return cancel(s);
    case 'ASK':           return ask(s, action);
    case 'ANSWER':        return answer(s, action);
    case 'CONTINUE':      return continueAfterReveal(s);
    case 'ACCUSE':        return accuse(s, action);
    case 'REVEAL_TOKENS': return revealTokens(s, action);
    default: throw new Error(`unknown action: ${action.type}`);
  }
}

function expect(s, ...phases) {
  if (!phases.includes(s.phase)) {
    throw new Error(`phase ${s.phase} 에서는 허용되지 않는 액션 (기대: ${phases.join('|')})`);
  }
}

function ackCard(s, { playerId }) {
  expect(s, 'DEALING');
  s.players[playerId].ackedCard = true;
  if (s.order.every((id) => s.players[id].ackedCard)) s.phase = 'ACTION_SELECT';
  return s;
}

function openQuestion(s) {
  expect(s, 'ACTION_SELECT');
  s.phase = 'QUESTION_BUILD';
  return s;
}

function openAccuse(s) {
  expect(s, 'ACTION_SELECT');
  s.phase = 'ACCUSE_SELECT';
  return s;
}

function cancel(s) {
  expect(s, 'QUESTION_BUILD', 'ACCUSE_SELECT');
  s.phase = 'ACTION_SELECT';
  return s;
}

function ask(s, { questionId, targetId }) {
  expect(s, 'QUESTION_BUILD');
  const q = questionById(questionId);
  if (!q) throw new Error(`unknown question: ${questionId}`);
  const askerId = currentPlayerId(s);
  const target = targetId ?? opponentIdOf(s, askerId);
  if (target === askerId) throw new Error('자기 자신에게는 질문할 수 없다');
  s.pending = { askerId, targetId: target, questionId };
  s.phase = 'ANSWER_PENDING';
  return s;
}

/**
 * 답변. 두 갈래로 완전히 분리된다 (D6).
 *  - usedCoin=false : 엔진이 답변자 카드로 진실값을 계산한다. 거짓말이 불가능하다.
 *  - usedCoin=true  : 답변자가 지정한 Y/N 과 대사를 그대로 기록한다.
 *                     진실값은 계산조차 하지 않는다.
 */
function answer(s, { usedCoin = false, answer: given, line = null }) {
  expect(s, 'ANSWER_PENDING');
  const { askerId, targetId, questionId } = s.pending;
  const answerer = s.players[targetId];
  const q = questionById(questionId);

  let value;
  let savedLine = null;

  if (usedCoin) {
    if (answerer.coinsLeft <= 0) throw new Error('거짓말 코인이 없다');
    if (given !== 'Y' && given !== 'N') throw new Error('코인 사용 시 Y/N 을 직접 지정해야 한다');
    answerer.coinsLeft -= 1;
    value = given;
    const trimmed = String(line ?? '').trim().slice(0, MAX_LINE_LENGTH);
    savedLine = trimmed.length > 0 ? trimmed : null;
  } else {
    // 코인 미사용 답변은 시스템이 진실을 강제한다 (GDD 4-2 부수 효과)
    value = evaluate(q, playerCard(s, targetId)) ? 'Y' : 'N';
  }

  s.seq += 1;
  s.log.push({
    seq: s.seq,
    askerId,
    targetId,
    questionId,
    answer: value,
    usedCoin,
    line: savedLine,
    at: s.turnNumber,
  });

  if (usedCoin && answerer.coinsLeft === 0) {
    s.events.push({ type: 'coinExhausted', actorId: targetId, payload: {}, at: s.turnNumber });
  }

  s.phase = 'REVEAL';
  return s;
}

function continueAfterReveal(s) {
  expect(s, 'REVEAL');
  s.pending = null;
  return endTurn(s);
}

function accuse(s, { cardId }) {
  expect(s, 'ACCUSE_SELECT');
  const accuserId = currentPlayerId(s);
  const targetId = opponentIdOf(s, accuserId);
  const hit = s.players[targetId].cardId === cardId;
  const wasCounterAttack = s.counterAttack;

  s.events.push({
    type: 'accuse',
    actorId: accuserId,
    payload: { cardId, hit, counterAttack: wasCounterAttack },
    at: s.turnNumber,
  });

  if (hit) {
    if (wasCounterAttack) {
      // 반격 턴에서 후공도 맞혔다 → 무승부 (D4)
      return finish(s, 'draw', 'counter-attack-hit');
    }
    if (isFirstSeat(s, accuserId)) {
      // 선공이 맞혔다 → 후공에게 마지막 1턴 (D4)
      s.pendingWinner = accuserId;
      s.counterAttack = true;
      s.currentIndex = s.order.indexOf(targetId);
      s.turnNumber += 1;
      s.phase = 'ACTION_SELECT';
      return s;
    }
    return finish(s, accuserId, 'accuse-hit');
  }

  // 실패
  s.players[accuserId].accuseFails += 1;

  if (wasCounterAttack) {
    // 후공이 반격 턴을 날렸다 → 선공 승리
    return finish(s, s.pendingWinner, 'counter-attack-missed');
  }
  if (s.players[accuserId].accuseFails >= MAX_ACCUSE_FAILS) {
    return finish(s, targetId, 'accuse-fail-limit');
  }

  s.phase = 'PENALTY_TOKEN_SELECT';
  return s;
}

function revealTokens(s, { slots }) {
  expect(s, 'PENALTY_TOKEN_SELECT');
  const actorId = currentPlayerId(s);
  const player = s.players[actorId];
  const picked = [...new Set(slots)];

  if (picked.length !== TOKENS_PER_PENALTY) {
    throw new Error(`토큰 ${TOKENS_PER_PENALTY}개를 골라야 한다`);
  }
  for (const i of picked) {
    if (!Number.isInteger(i) || i < 0 || i > 4) throw new Error(`잘못된 토큰 슬롯: ${i}`);
    if (player.revealedSlots.includes(i)) throw new Error('이미 공개한 토큰은 다시 고를 수 없다');
  }

  player.revealedSlots.push(...picked);
  const card = playerCard(s, actorId);
  s.events.push({
    type: 'penalty',
    actorId,
    payload: { slots: picked, tokens: picked.map((i) => card.tokens[i]) },
    at: s.turnNumber,
  });

  return endTurn(s);
}

// ── 턴 진행 ───────────────────────────────────────────────────────────

function endTurn(s) {
  if (s.counterAttack) {
    // 후공의 반격 턴이 지목 성공 없이 끝났다 → 선공 승리
    return finish(s, s.pendingWinner, 'counter-attack-expired');
  }
  s.currentIndex = (s.currentIndex + 1) % s.order.length;
  s.turnNumber += 1;
  s.phase = 'ACTION_SELECT';
  s.pending = null;
  return s;
}

function finish(s, winner, reason) {
  s.phase = 'RESULT';
  s.pending = null;
  s.result = {
    winner,
    reason,
    cards: Object.fromEntries(s.order.map((id) => [id, s.players[id].cardId])),
    turns: s.turnNumber,
  };
  return s;
}

// ── 파생 조회 (UI·봇 공용) ────────────────────────────────────────────

/** 지금 행동해야 하는 플레이어. DEALING 은 아직 확인하지 않은 첫 플레이어. */
export function actorOf(s) {
  if (s.phase === 'RESULT') return null;
  if (s.phase === 'DEALING') return s.order.find((id) => !s.players[id].ackedCard) ?? null;
  if (s.phase === 'ANSWER_PENDING') return s.pending.targetId;
  if (s.phase === 'REVEAL') return s.pending ? s.pending.targetId : currentPlayerId(s);
  return currentPlayerId(s);
}

/** viewerId 관점에서 상대 카드에 대한 단서가 되는 로그 항목만 */
export function cluesAbout(s, targetId) {
  return s.log.filter((e) => e.targetId === targetId);
}

/**
 * 단서 집합으로 후보를 좁힌다.
 * @param {number[]} appliedSeqs 플레이어가 「적용」한 로그 seq 목록
 */
export function narrowCandidates(s, targetId, appliedSeqs) {
  const applied = new Set(appliedSeqs);
  const clues = cluesAbout(s, targetId).filter((e) => applied.has(e.seq));
  return DECK.filter((c) => clues.every((e) => evaluate(questionById(e.questionId), c) === (e.answer === 'Y')));
}

/** 상대가 공개한 토큰으로 걸러진 후보 (토큰 필터는 항상 참인 정보다) */
export function filterByRevealedTokens(cards, revealed) {
  if (revealed.length === 0) return cards;
  return cards.filter((c) => {
    const pool = [...c.tokens];
    for (const t of revealed) {
      const i = pool.indexOf(t);
      if (i === -1) return false;
      pool.splice(i, 1);
    }
    return true;
  });
}

export function isGameOver(s) {
  return s.phase === 'RESULT';
}

/** 결과 문구 */
export function resultHeadline(s, viewerId) {
  const r = s.result;
  if (!r) return '';
  if (r.winner === 'draw') return '무 승 부';
  return r.winner === viewerId ? '승      리' : '패      배';
}

export const RESULT_REASON_TEXT = {
  'accuse-hit': '지목 적중',
  'counter-attack-hit': '반격 턴에서 후공도 적중 — 무승부',
  'counter-attack-missed': '후공이 반격 턴 지목에 실패',
  'counter-attack-expired': '후공이 반격 턴을 지목에 쓰지 않았다',
  'accuse-fail-limit': `지목 ${MAX_ACCUSE_FAILS}회 실패`,
};
