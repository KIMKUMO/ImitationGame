/**
 * 연습용 봇 (MAGPIE)
 *
 * M1 의 목적은 규칙 검증이므로 봇도 「사람이 실제로 겪는 상황을 만들어 주는」 수준까지만 만든다.
 * 특히 D6 검증을 위해 봇은 **코인을 쓰고 진실을 말하는 선택(정직한 블러핑)도 실제로 한다.**
 *
 * 봇의 정보 원칙:
 *  - 코인이 쓰이지 않은 답변만 확정 단서로 쓴다 (검증 가능한 정보)
 *  - 코인이 쓰인 답변은 무효로 두고, 상대의 코인이 바닥나면 같은 질문을 다시 던져 검증한다
 */

import { DECK, QUESTIONS, questionById, evaluate, partitionKeyOf } from '../../data/deck.js';
import { filterByRevealedTokens, opponentIdOf, playerCard, revealedTokensOf } from './engine.js';

const LINES = [
  '글쎄, 기억이 안 나는군.',
  '제가 그렇게 보입니까?',
  '그런 걸 왜 묻나?',
  '한 잔 더 하고 나서 얘기하지.',
  '…그렇다고 해두죠.',
  '질문이 참 무례하군요.',
  '그 정도로 늙어 보이나?',
  '여기 조명이 어두워서 말이야.',
  '아니라고는 못 하겠군.',
  '담배 한 대 주면 말해주지.',
  '그건 기밀입니다.',
  '술이 좀 들어가서요.',
];

/** 봇이 상대 카드에 대해 확정적으로 아는 것만으로 좁힌 후보 */
export function botCandidates(state, botId) {
  const targetId = opponentIdOf(state, botId);
  const verified = state.log.filter((e) => e.targetId === targetId && !e.usedCoin);
  let cands = DECK.filter((c) =>
    verified.every((e) => evaluate(questionById(e.questionId), c) === (e.answer === 'Y')));
  cands = filterByRevealedTokens(cands, revealedTokensOf(state, targetId));
  return cands.length > 0 ? cands : DECK.slice();
}

/**
 * 아직 검증되지 않은(코인이 쓰인) 질문 목록.
 *
 * 표현이 아니라 「무엇을 가르는 질문인가」로 비교한다. 상대가 「175 이상」을 코인으로
 * 뭉갰더라도 나중에 「174 이하」에 진실로 답했다면 같은 사실이 확정된 것이다.
 */
function unverifiedQuestions(state, botId) {
  const targetId = opponentIdOf(state, botId);
  const mine = state.log.filter((e) => e.targetId === targetId);
  const keyOf = (e) => partitionKeyOf(questionById(e.questionId));
  const verified = new Set(mine.filter((e) => !e.usedCoin).map(keyOf));

  const out = new Map();
  for (const e of mine) {
    if (!e.usedCoin) continue;
    const key = keyOf(e);
    if (verified.has(key) || out.has(key)) continue;
    out.set(key, questionById(e.questionId));
  }
  return [...out.values()];
}

/**
 * 후보를 가장 균등하게 가르는 질문.
 *
 * 「175 이상」과 「174 이하」처럼 같은 자리를 가르는 짝은 점수가 같다.
 * 동점이면 무작위로 고른다 — 봇도 두 표현을 섞어 쓰는 편이 사람처럼 읽힌다.
 */
function bestQuestion(cands, allow = QUESTIONS, rng = Math.random) {
  let best = [];
  let bestScore = Infinity;
  for (const q of allow) {
    let yes = 0;
    for (const c of cands) if (evaluate(q, c)) yes += 1;
    const no = cands.length - yes;
    if (yes === 0 || no === 0) continue;      // 이미 아는 정보 — 무의미
    const score = Math.max(yes, no);
    if (score < bestScore) { bestScore = score; best = [q]; }
    else if (score === bestScore) best.push(q);
  }
  if (best.length === 0) return allow[0] ?? QUESTIONS[0];
  return best[Math.floor(rng() * best.length)];
}

/**
 * 봇의 턴 행동. 엔진 액션 배열을 돌려준다 (순서대로 apply).
 */
export function botTurnActions(state, botId, rng = Math.random) {
  const me = state.players[botId];
  const cands = botCandidates(state, botId);
  const targetId = opponentIdOf(state, botId);
  const opponentCoins = state.players[targetId].coinsLeft;

  // 후보가 하나로 확정 — 지른다
  if (cands.length === 1) {
    return [{ type: 'OPEN_ACCUSE' }, { type: 'ACCUSE', cardId: cands[0].id }];
  }

  // 반격 턴이면 무조건 지목해야 한다 (질문은 무의미)
  if (state.counterAttack) {
    const pick = cands[Math.floor(rng() * cands.length)];
    return [{ type: 'OPEN_ACCUSE' }, { type: 'ACCUSE', cardId: pick.id }];
  }

  // 2명까지 좁혔고 아직 실패가 없다면 가끔 도박을 한다
  if (cands.length === 2 && me.accuseFails === 0 && rng() < 0.35) {
    const pick = cands[Math.floor(rng() * 2)];
    return [{ type: 'OPEN_ACCUSE' }, { type: 'ACCUSE', cardId: pick.id }];
  }

  // 상대 코인이 바닥났다면, 코인으로 뭉갠 질문을 다시 물어 검증한다
  const unverified = unverifiedQuestions(state, botId);
  if (opponentCoins === 0 && unverified.length > 0) {
    const q = bestQuestion(cands, unverified, rng);
    return [{ type: 'OPEN_QUESTION' }, { type: 'ASK', questionId: q.id }];
  }

  const q = bestQuestion(cands, QUESTIONS, rng);
  return [{ type: 'OPEN_QUESTION' }, { type: 'ASK', questionId: q.id }];
}

/**
 * 봇의 답변. 코인 사용 여부와 Y/N·대사를 스스로 정한다.
 */
export function botAnswerAction(state, botId, rng = Math.random) {
  const { questionId } = state.pending;
  const q = questionById(questionId);
  const truth = evaluate(q, playerCard(state, botId));
  const coinsLeft = state.players[botId].coinsLeft;

  // 마지막 코인은 아껴 둔다. 둘 다 일찍 털면 이후 모든 답변이 진실로 확정되어
  // 종반이 통째로 불리해진다 (GDD D5 의 「후반 신뢰도의 압박」).
  const mayUseCoin = coinsLeft >= 2 || state.turnNumber >= 5;

  if (coinsLeft > 0 && mayUseCoin) {
    // 덱을 균등하게 가르는 질문일수록 진실을 넘기는 손해가 크다 → 코인을 쓸 확률을 올린다
    let yes = 0;
    for (const c of DECK) if (evaluate(q, c)) yes += 1;
    const balance = 1 - Math.abs(yes - (DECK.length - yes)) / DECK.length; // 0~1
    const chance = 0.10 + 0.18 * balance;

    if (rng() < chance) {
      // 60% 거짓, 40% 정직한 블러핑 — D6 이 실제로 작동하는지 사람이 겪어봐야 한다
      const lie = rng() < 0.6;
      const answer = (lie ? !truth : truth) ? 'Y' : 'N';
      // 직전에 쓴 대사는 피한다 — 같은 말을 반복하면 사람처럼 읽히지 않는다
      const lastLine = [...state.log].reverse().find((e) => e.targetId === botId && e.line)?.line;
      const pool = LINES.filter((l) => l !== lastLine);
      const line = pool[Math.floor(rng() * pool.length)];
      return { type: 'ANSWER', usedCoin: true, answer, line };
    }
  }

  return { type: 'ANSWER', usedCoin: false };
}

/** 지목 실패 페널티 — 정보 유출이 가장 적은 2개를 고른다 (중복 토큰 우선) */
export function botPenaltyAction(state, botId) {
  const card = playerCard(state, botId);
  const used = new Set(state.players[botId].revealedSlots);
  const free = [0, 1, 2, 3, 4].filter((i) => !used.has(i));

  let best = null;
  let bestSurvivors = -1;
  for (let a = 0; a < free.length; a += 1) {
    for (let b = a + 1; b < free.length; b += 1) {
      const pair = [card.tokens[free[a]], card.tokens[free[b]]];
      const survivors = filterByRevealedTokens(DECK, [...revealedTokensOf(state, botId), ...pair]).length;
      if (survivors > bestSurvivors) {
        bestSurvivors = survivors;
        best = [free[a], free[b]];
      }
    }
  }
  return { type: 'REVEAL_TOKENS', slots: best ?? [free[0], free[1]] };
}
