/**
 * 추리 노트 — 순수 클라이언트 상태 (화면 7)
 *
 * 이 데이터는 플레이어 개인 메모이며 상대에게 절대 노출되지 않는다.
 * Firebase 로도 올라가지 않는다 (M2 에서도 로컬 유지).
 *
 * 4인 확장 대비로 상대별로 분리 저장한다 (GDD 8장):
 *   notes[myId][targetId] = { marks, applied, released }
 */

import { DECK, questionById, evaluate } from '../../data/deck.js';
import { revealedTokensOf, filterByRevealedTokens, opponentIdOf } from '../engine/engine.js';

export const MARKS = ['unknown', 'out', 'likely'];
export const MARK_SYMBOL = { unknown: '○', out: '✕', likely: '●' };

export function createNotes(playerIds) {
  const notes = {};
  for (const me of playerIds) {
    notes[me] = {};
    for (const other of playerIds) {
      if (other === me) continue;
      notes[me][other] = { marks: {}, applied: [], released: [] };
    }
  }
  return notes;
}

function slot(notes, myId, targetId) {
  if (!notes[myId]) notes[myId] = {};
  if (!notes[myId][targetId]) notes[myId][targetId] = { marks: {}, applied: [], released: [] };
  return notes[myId][targetId];
}

export function markOf(notes, myId, targetId, cardId) {
  return slot(notes, myId, targetId).marks[cardId] ?? 'unknown';
}

export function cycleMark(notes, myId, targetId, cardId) {
  const s = slot(notes, myId, targetId);
  const cur = s.marks[cardId] ?? 'unknown';
  s.marks[cardId] = MARKS[(MARKS.indexOf(cur) + 1) % MARKS.length];
}

/**
 * 새로 들어온 단서를 자동 적용한다.
 *
 * 코인이 쓰이지 않은 답변은 시스템이 진실을 강제하므로 거짓일 수가 없다 → 자동 적용.
 * 코인이 쓰인 답변은 진실 여부를 아무도 모르므로 **절대 자동 적용하지 않는다** (GDD 화면 7).
 * 플레이어가 직접 해제한(released) 단서는 다시 적용하지 않는다.
 */
export function syncAutoApply(notes, state, myId) {
  const targetId = opponentIdOf(state, myId);
  const s = slot(notes, myId, targetId);
  for (const e of state.log) {
    if (e.targetId !== targetId) continue;
    if (e.usedCoin) continue;
    if (s.applied.includes(e.seq) || s.released.includes(e.seq)) continue;
    s.applied.push(e.seq);
  }
}

export function isApplied(notes, myId, targetId, seq) {
  return slot(notes, myId, targetId).applied.includes(seq);
}

export function toggleClue(notes, myId, targetId, seq) {
  const s = slot(notes, myId, targetId);
  const i = s.applied.indexOf(seq);
  if (i >= 0) {
    s.applied.splice(i, 1);
    if (!s.released.includes(seq)) s.released.push(seq);
  } else {
    s.applied.push(seq);
    const r = s.released.indexOf(seq);
    if (r >= 0) s.released.splice(r, 1);
  }
}

/** 적용된 단서 목록 (로그 항목 그대로) */
export function appliedClues(notes, state, myId) {
  const targetId = opponentIdOf(state, myId);
  const s = slot(notes, myId, targetId);
  return state.log.filter((e) => e.targetId === targetId && s.applied.includes(e.seq));
}

/** 이 카드가 적용된 단서와 모순되는가 */
export function contradictsClues(card, clues) {
  return !clues.every((e) => evaluate(questionById(e.questionId), card) === (e.answer === 'Y'));
}

/**
 * 화면 7 의 한 행에 필요한 판정을 전부 계산한다.
 *
 * 자동으로 걸러지는 것은 「거짓일 수 없는 정보」뿐이다:
 *   bySelf  — 카드는 중복 배분되지 않으므로 상대가 내 카드일 수는 없다
 *   byToken — 지목 실패로 공개된 토큰은 사실이다
 *   byClue  — 플레이어가 직접 적용한 단서 (코인 답변은 자동 적용되지 않는다)
 *
 * @returns {{card, mark, bySelf:boolean, byClue:boolean, byToken:boolean, out:boolean}[]}
 */
export function pamphletRows(notes, state, myId) {
  const targetId = opponentIdOf(state, myId);
  const clues = appliedClues(notes, state, myId);
  const revealed = revealedTokensOf(state, targetId);
  const tokenSurvivors = new Set(filterByRevealedTokens(DECK, revealed).map((c) => c.id));
  const myCardId = state.players[myId].cardId;

  return DECK.map((card) => {
    const mark = markOf(notes, myId, targetId, card.id);
    const bySelf = card.id === myCardId;
    const byClue = contradictsClues(card, clues);
    const byToken = !tokenSurvivors.has(card.id);
    return { card, mark, bySelf, byClue, byToken, out: mark === 'out' || bySelf || byClue || byToken };
  });
}

/** 남은 후보 수 (화면 4 좌측 · 화면 5 분할 안내의 기준) */
export function remainingCards(notes, state, myId) {
  return pamphletRows(notes, state, myId).filter((r) => !r.out).map((r) => r.card);
}

/** 코인이 쓰였지만 아직 적용하지 않은 단서 — 「검증 불가」 배지를 달아 직접 고르게 한다 */
export function unappliedCoinClues(notes, state, myId) {
  const targetId = opponentIdOf(state, myId);
  const s = slot(notes, myId, targetId);
  return state.log.filter((e) => e.targetId === targetId && e.usedCoin && !s.applied.includes(e.seq));
}
