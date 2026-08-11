/**
 * 룰 엔진 검증 — 테스트 프레임워크 없이 node 로 그대로 돌린다.
 *   node scripts/test-engine.js     (= npm run test:engine)
 */

import {
  createGame, apply, currentPlayerId, playerCard, revealedTokensOf,
  actorOf, narrowCandidates, MAX_ACCUSE_FAILS,
} from '../src/engine/engine.js';
import { DECK, questionById, evaluate } from '../data/deck.js';

let pass = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ✔ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  ✘ ${name}\n      ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? '단정 실패');
}
function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg ?? '값 불일치'} — 기대 ${JSON.stringify(expected)}, 실제 ${JSON.stringify(actual)}`);
  }
}
function throws(fn, msg) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  assert(threw, msg ?? '예외가 발생해야 한다');
}

/** 선공 A(토마스) · 후공 B(빅터) 로 고정한 판을 카드 확인까지 끝낸 상태로 만든다 */
function setup({ aCard = 'c01', bCard = 'c03' } = {}) {
  let s = createGame({
    players: [{ id: 'A', nick: 'KESTREL' }, { id: 'B', nick: 'MAGPIE' }],
    cards: { A: aCard, B: bCard },
  });
  s = apply(s, { type: 'ACK_CARD', playerId: 'A' });
  s = apply(s, { type: 'ACK_CARD', playerId: 'B' });
  return s;
}

/** A 가 질문 → B 가 진실 답변 → 턴 종료 */
function truthfulExchange(s, questionId) {
  s = apply(s, { type: 'OPEN_QUESTION' });
  s = apply(s, { type: 'ASK', questionId });
  s = apply(s, { type: 'ANSWER', usedCoin: false });
  return apply(s, { type: 'CONTINUE' });
}

console.log('\n배분 · 턴 진행');

check('카드 확인 전에는 DEALING, 양쪽 확인 후 ACTION_SELECT', () => {
  let s = createGame({
    players: [{ id: 'A', nick: 'A' }, { id: 'B', nick: 'B' }],
    cards: { A: 'c01', B: 'c03' },
  });
  eq(s.phase, 'DEALING');
  eq(actorOf(s), 'A', 'DEALING 의 행동 주체는 아직 확인하지 않은 플레이어');
  s = apply(s, { type: 'ACK_CARD', playerId: 'A' });
  eq(s.phase, 'DEALING');
  eq(actorOf(s), 'B');
  s = apply(s, { type: 'ACK_CARD', playerId: 'B' });
  eq(s.phase, 'ACTION_SELECT');
  eq(currentPlayerId(s), 'A', '선공은 좌석 0');
});

check('질문 한 번에 턴이 교대된다', () => {
  let s = setup();
  eq(s.turnNumber, 1);
  s = truthfulExchange(s, 'h175');
  eq(currentPlayerId(s), 'B', '답변자가 다음 턴의 주체');
  eq(s.turnNumber, 2);
  eq(s.phase, 'ACTION_SELECT');
});

check('액션은 상태 머신 밖에서 호출되면 거부된다', () => {
  const s = setup();
  throws(() => apply(s, { type: 'ASK', questionId: 'h175' }), 'ACTION_SELECT 에서 바로 ASK 는 불가');
  throws(() => apply(s, { type: 'ANSWER', usedCoin: false }), 'ACTION_SELECT 에서 ANSWER 는 불가');
  throws(() => apply(s, { type: 'REVEAL_TOKENS', slots: [0, 1] }), '페널티 단계가 아니면 토큰 공개 불가');
});

check('입력 상태는 변경되지 않는다 (순수성)', () => {
  const s = setup();
  const snapshot = JSON.stringify(s);
  apply(s, { type: 'OPEN_QUESTION' });
  eq(JSON.stringify(s), snapshot, 'apply 가 입력을 변경했다');
});

console.log('\n답변 — 진실 강제와 거짓말 코인 (D6)');

check('코인 미사용 답변은 엔진이 카드로 계산한다 (거짓말 불가능)', () => {
  let s = setup({ bCard: 'c03' }); // 빅터 168cm
  s = apply(s, { type: 'OPEN_QUESTION' });
  s = apply(s, { type: 'ASK', questionId: 'h175' });
  s = apply(s, { type: 'ANSWER', usedCoin: false, answer: 'Y' }); // Y 를 넘겨도 무시돼야 한다
  const entry = s.log.at(-1);
  eq(entry.answer, 'N', '빅터는 168cm 이므로 반드시 N');
  eq(entry.usedCoin, false);
  eq(entry.line, null);
  eq(s.players.B.coinsLeft, 2, '코인 소모 없음');
});

check('코인 사용 답변은 지정한 Y/N 과 대사를 그대로 기록한다', () => {
  let s = setup({ bCard: 'c03' });
  s = apply(s, { type: 'OPEN_QUESTION' });
  s = apply(s, { type: 'ASK', questionId: 'h175' });
  s = apply(s, { type: 'ANSWER', usedCoin: true, answer: 'Y', line: '제가 그렇게 작아 보입니까?' });
  const entry = s.log.at(-1);
  eq(entry.answer, 'Y', '진실(N)과 반대인 값이 그대로 들어가야 한다');
  eq(entry.usedCoin, true);
  eq(entry.line, '제가 그렇게 작아 보입니까?');
  eq(s.players.B.coinsLeft, 1);
});

check('코인을 쓰고 진실을 말하는 것도 유효하다', () => {
  let s = setup({ bCard: 'c03' });
  s = apply(s, { type: 'OPEN_QUESTION' });
  s = apply(s, { type: 'ASK', questionId: 'a36' }); // 빅터 39세 → 진실 Y
  s = apply(s, { type: 'ANSWER', usedCoin: true, answer: 'Y', line: '그 정도로 늙어 보이나?' });
  const entry = s.log.at(-1);
  eq(entry.answer, 'Y');
  eq(entry.usedCoin, true);
  eq(s.players.B.coinsLeft, 1, '진실을 말했어도 코인은 소모된다');
});

check('로그에 진실 여부 필드가 존재하지 않는다 (D6 — 저장하지 않는 것은 샐 수 없다)', () => {
  let s = setup();
  s = apply(s, { type: 'OPEN_QUESTION' });
  s = apply(s, { type: 'ASK', questionId: 'h175' });
  s = apply(s, { type: 'ANSWER', usedCoin: true, answer: 'Y', line: '글쎄' });
  const entry = s.log.at(-1);
  const keys = Object.keys(entry).sort().join(',');
  eq(keys, 'answer,askerId,at,line,questionId,seq,targetId,usedCoin');
  assert(!('wasLie' in entry), 'wasLie 필드가 있다');
  assert(!('truth' in entry), 'truth 필드가 있다');
});

check('코인 0개면 코인 답변이 거부된다', () => {
  let s = setup();
  for (let i = 0; i < 2; i += 1) {
    s = apply(s, { type: 'OPEN_QUESTION' });
    s = apply(s, { type: 'ASK', questionId: 'h175' });
    s = apply(s, { type: 'ANSWER', usedCoin: true, answer: 'Y', line: '' });
    s = apply(s, { type: 'CONTINUE' });
    // B 의 턴을 소모해 A 에게 턴을 되돌린다
    s = truthfulExchangeBy(s, 'h175');
  }
  eq(s.players.B.coinsLeft, 0);
  s = apply(s, { type: 'OPEN_QUESTION' });
  s = apply(s, { type: 'ASK', questionId: 'w65' });
  throws(() => apply(s, { type: 'ANSWER', usedCoin: true, answer: 'Y' }), '코인 0개인데 사용이 허용됐다');
  s = apply(s, { type: 'ANSWER', usedCoin: false });
  eq(s.log.at(-1).usedCoin, false);
});

check('대사는 40자로 자르고, 빈 대사는 null 이 된다', () => {
  let s = setup();
  s = apply(s, { type: 'OPEN_QUESTION' });
  s = apply(s, { type: 'ASK', questionId: 'h175' });
  const long = '가'.repeat(60);
  s = apply(s, { type: 'ANSWER', usedCoin: true, answer: 'N', line: long });
  eq(s.log.at(-1).line.length, 40);

  let t = setup();
  t = apply(t, { type: 'OPEN_QUESTION' });
  t = apply(t, { type: 'ASK', questionId: 'h175' });
  t = apply(t, { type: 'ANSWER', usedCoin: true, answer: 'N', line: '   ' });
  eq(t.log.at(-1).line, null, '공백만 입력하면 침묵(null)');
});

check('코인을 다 쓰면 coinExhausted 이벤트가 남는다', () => {
  let s = setup();
  s = apply(s, { type: 'OPEN_QUESTION' });
  s = apply(s, { type: 'ASK', questionId: 'h175' });
  s = apply(s, { type: 'ANSWER', usedCoin: true, answer: 'Y' });
  eq(s.events.filter((e) => e.type === 'coinExhausted').length, 0, '1개 남았으므로 아직 아님');
  s = apply(s, { type: 'CONTINUE' });
  s = truthfulExchangeBy(s, 'h175');
  s = apply(s, { type: 'OPEN_QUESTION' });
  s = apply(s, { type: 'ASK', questionId: 'w65' });
  s = apply(s, { type: 'ANSWER', usedCoin: true, answer: 'Y' });
  eq(s.events.filter((e) => e.type === 'coinExhausted').length, 1);
});

/** 현재 턴 플레이어가 질문하고 상대가 진실 답변 (턴을 한 칸 돌리는 용도) */
function truthfulExchangeBy(s, questionId) {
  let t = apply(s, { type: 'OPEN_QUESTION' });
  t = apply(t, { type: 'ASK', questionId });
  t = apply(t, { type: 'ANSWER', usedCoin: false });
  return apply(t, { type: 'CONTINUE' });
}

console.log('\n지목 · 페널티 (D2 · D3)');

check('후공의 지목 적중은 즉시 승리', () => {
  let s = setup({ aCard: 'c01', bCard: 'c03' });
  s = truthfulExchange(s, 'h175');       // A 턴 소모 → B 턴
  s = apply(s, { type: 'OPEN_ACCUSE' });
  s = apply(s, { type: 'ACCUSE', cardId: 'c01' }); // B 가 A(토마스) 를 맞힌다
  eq(s.phase, 'RESULT');
  eq(s.result.winner, 'B');
  eq(s.result.reason, 'accuse-hit');
});

check('지목 실패 → 토큰 2개 공개 후 턴 교대', () => {
  let s = setup({ aCard: 'c01', bCard: 'c03' }); // A 토마스: 총총언어담배돈
  s = apply(s, { type: 'OPEN_ACCUSE' });
  s = apply(s, { type: 'ACCUSE', cardId: 'c05' }); // 틀린 지목
  eq(s.phase, 'PENALTY_TOKEN_SELECT');
  eq(s.players.A.accuseFails, 1);
  throws(() => apply(s, { type: 'REVEAL_TOKENS', slots: [0] }), '1개만 골라도 통과했다');
  throws(() => apply(s, { type: 'REVEAL_TOKENS', slots: [0, 0] }), '같은 슬롯 중복이 통과했다');
  s = apply(s, { type: 'REVEAL_TOKENS', slots: [0, 1] });
  eq(s.phase, 'ACTION_SELECT');
  eq(currentPlayerId(s), 'B', '페널티 후 턴 교대');
  eq(revealedTokensOf(s, 'A').join(''), '총총', '토마스의 0·1번 슬롯은 총 두 개');
});

check('이미 공개한 토큰 슬롯은 다시 고를 수 없다', () => {
  let s = setup({ aCard: 'c01' });
  s = apply(s, { type: 'OPEN_ACCUSE' });
  s = apply(s, { type: 'ACCUSE', cardId: 'c05' });
  s = apply(s, { type: 'REVEAL_TOKENS', slots: [0, 1] });
  s = truthfulExchangeBy(s, 'h175'); // B 턴 소모 → A 턴
  s = apply(s, { type: 'OPEN_ACCUSE' });
  s = apply(s, { type: 'ACCUSE', cardId: 'c07' });
  eq(s.phase, 'PENALTY_TOKEN_SELECT');
  throws(() => apply(s, { type: 'REVEAL_TOKENS', slots: [0, 2] }), '공개된 슬롯 0 을 다시 골랐는데 통과했다');
  s = apply(s, { type: 'REVEAL_TOKENS', slots: [2, 3] });
  eq(s.players.A.revealedSlots.length, 4);
});

check(`지목 ${MAX_ACCUSE_FAILS}회 실패 시 즉시 패배 (토큰 공개 없음)`, () => {
  let s = setup({ aCard: 'c01', bCard: 'c03' });
  // 1회
  s = apply(s, { type: 'OPEN_ACCUSE' });
  s = apply(s, { type: 'ACCUSE', cardId: 'c05' });
  s = apply(s, { type: 'REVEAL_TOKENS', slots: [0, 1] });
  s = truthfulExchangeBy(s, 'h175');
  // 2회
  s = apply(s, { type: 'OPEN_ACCUSE' });
  s = apply(s, { type: 'ACCUSE', cardId: 'c07' });
  s = apply(s, { type: 'REVEAL_TOKENS', slots: [2, 3] });
  s = truthfulExchangeBy(s, 'h175');
  // 3회
  s = apply(s, { type: 'OPEN_ACCUSE' });
  s = apply(s, { type: 'ACCUSE', cardId: 'c08' });
  eq(s.phase, 'RESULT', '3회째는 토큰 공개 없이 종료');
  eq(s.players.A.accuseFails, 3);
  eq(s.result.winner, 'B');
  eq(s.result.reason, 'accuse-fail-limit');
});

console.log('\n선공 보정 — 반격 턴 (D4)');

check('선공 적중 → 즉시 종료하지 않고 후공에게 반격 턴', () => {
  let s = setup({ aCard: 'c01', bCard: 'c03' });
  s = apply(s, { type: 'OPEN_ACCUSE' });
  s = apply(s, { type: 'ACCUSE', cardId: 'c03' }); // A(선공)가 맞힌다
  eq(s.phase, 'ACTION_SELECT', '아직 끝나지 않는다');
  eq(s.counterAttack, true);
  eq(s.pendingWinner, 'A');
  eq(currentPlayerId(s), 'B', '반격 턴의 주체는 후공');
});

check('반격 턴에서 후공도 적중 → 무승부', () => {
  let s = setup({ aCard: 'c01', bCard: 'c03' });
  s = apply(s, { type: 'OPEN_ACCUSE' });
  s = apply(s, { type: 'ACCUSE', cardId: 'c03' });
  s = apply(s, { type: 'OPEN_ACCUSE' });
  s = apply(s, { type: 'ACCUSE', cardId: 'c01' });
  eq(s.phase, 'RESULT');
  eq(s.result.winner, 'draw');
  eq(s.result.reason, 'counter-attack-hit');
});

check('반격 턴에서 후공이 실패 → 선공 승리 (토큰 공개 없이 종료)', () => {
  let s = setup({ aCard: 'c01', bCard: 'c03' });
  s = apply(s, { type: 'OPEN_ACCUSE' });
  s = apply(s, { type: 'ACCUSE', cardId: 'c03' });
  s = apply(s, { type: 'OPEN_ACCUSE' });
  s = apply(s, { type: 'ACCUSE', cardId: 'c09' });
  eq(s.phase, 'RESULT');
  eq(s.result.winner, 'A');
  eq(s.result.reason, 'counter-attack-missed');
});

check('반격 턴을 질문으로 낭비하면 선공 승리', () => {
  let s = setup({ aCard: 'c01', bCard: 'c03' });
  s = apply(s, { type: 'OPEN_ACCUSE' });
  s = apply(s, { type: 'ACCUSE', cardId: 'c03' });
  s = apply(s, { type: 'OPEN_QUESTION' });
  s = apply(s, { type: 'ASK', questionId: 'h175' });
  s = apply(s, { type: 'ANSWER', usedCoin: false });
  s = apply(s, { type: 'CONTINUE' });
  eq(s.phase, 'RESULT');
  eq(s.result.winner, 'A');
  eq(s.result.reason, 'counter-attack-expired');
});

console.log('\n추리 — 단서 적용');

check('적용한 단서만으로 후보가 좁혀진다', () => {
  let s = setup({ aCard: 'c01', bCard: 'c03' }); // B = 빅터 (168cm, 62kg, 39세, 공군, 위스키)
  s = truthfulExchange(s, 'h175');   // N
  s = truthfulExchangeBy(s, 'h175'); // B 턴 소모
  s = truthfulExchange(s, 'w65');    // N
  s = truthfulExchangeBy(s, 'h175');
  s = truthfulExchange(s, 'a36');    // Y

  const applied = s.log.filter((e) => e.targetId === 'B').map((e) => e.seq);
  const cands = narrowCandidates(s, 'B', applied);
  const names = cands.map((c) => c.name).sort().join('/');
  eq(names, '노라/빅터/에드거', '키<175 · 몸무게<65 · 36세이상 → 삼인조만 남는다');
  eq(cands.length, 3);
});

check('단서를 적용하지 않으면 후보는 줄지 않는다', () => {
  let s = setup({ aCard: 'c01', bCard: 'c03' });
  s = truthfulExchange(s, 'h175');
  eq(narrowCandidates(s, 'B', []).length, 15);
});

check('내가 받은 질문의 답은 상대 추리에 쓰이지 않는다', () => {
  let s = setup({ aCard: 'c01', bCard: 'c03' });
  s = truthfulExchange(s, 'h175');    // A → B (B에 대한 단서)
  s = truthfulExchangeBy(s, 'w80');   // B → A (A에 대한 단서)
  const aboutB = s.log.filter((e) => e.targetId === 'B');
  eq(aboutB.length, 1, 'B 에 대한 단서는 1개뿐');
});

console.log('\n무작위 자동 플레이 — 규칙이 항상 종료로 수렴하는가');

check('무작위 1000판이 예외 없이 RESULT 로 끝난다', () => {
  let seed = 12345;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  const reasons = new Map();
  for (let game = 0; game < 1000; game += 1) {
    const ids = DECK.map((c) => c.id);
    const a = pick(ids);
    let b = pick(ids);
    while (b === a) b = pick(ids);
    let s = setup({ aCard: a, bCard: b });

    let guard = 0;
    while (s.phase !== 'RESULT') {
      guard += 1;
      if (guard > 400) throw new Error('400 스텝 안에 끝나지 않았다 — 무한 루프 가능성');

      const me = currentPlayerId(s);
      switch (s.phase) {
        case 'ACTION_SELECT': {
          // 대부분 질문, 가끔 지목
          if (rng() < 0.18) s = apply(s, { type: 'OPEN_ACCUSE' });
          else s = apply(s, { type: 'OPEN_QUESTION' });
          break;
        }
        case 'QUESTION_BUILD': {
          s = apply(s, { type: 'ASK', questionId: pick(['h175', 'h185', 'w65', 'w80', 'a28', 'a36', 'b0', 'b1', 'b2', 'd0', 'd1', 'd2']) });
          break;
        }
        case 'ANSWER_PENDING': {
          const answerer = s.players[s.pending.targetId];
          if (answerer.coinsLeft > 0 && rng() < 0.3) {
            s = apply(s, { type: 'ANSWER', usedCoin: true, answer: rng() < 0.5 ? 'Y' : 'N', line: '글쎄' });
          } else {
            s = apply(s, { type: 'ANSWER', usedCoin: false });
          }
          break;
        }
        case 'REVEAL': {
          s = apply(s, { type: 'CONTINUE' });
          break;
        }
        case 'ACCUSE_SELECT': {
          s = apply(s, { type: 'ACCUSE', cardId: pick(DECK).id });
          break;
        }
        case 'PENALTY_TOKEN_SELECT': {
          const free = [0, 1, 2, 3, 4].filter((i) => !s.players[me].revealedSlots.includes(i));
          s = apply(s, { type: 'REVEAL_TOKENS', slots: [free[0], free[1]] });
          break;
        }
        default:
          throw new Error(`예상 못한 phase: ${s.phase}`);
      }
    }

    // 종료 상태 불변식
    const r = s.result;
    assert(r, 'result 가 비었다');
    assert(r.winner === 'draw' || r.winner === 'A' || r.winner === 'B', `이상한 승자: ${r.winner}`);
    assert(s.players.A.accuseFails <= 3 && s.players.B.accuseFails <= 3, '지목 실패가 3을 넘었다');
    assert(s.players.A.coinsLeft >= 0 && s.players.B.coinsLeft >= 0, '코인이 음수');
    assert(s.players.A.revealedSlots.length <= 4, '토큰이 4슬롯 넘게 공개됐다');
    assert(new Set(s.players.A.revealedSlots).size === s.players.A.revealedSlots.length, '중복 공개된 슬롯');
    reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
  }

  console.log(`      종료 사유 분포: ${[...reasons.entries()].map(([k, v]) => `${k} ${v}`).join(' · ')}`);
});

check('코인 미사용 답변은 언제나 카드의 진실값과 일치한다 (전수 확인)', () => {
  for (const card of DECK) {
    for (const qid of ['h175', 'h185', 'w65', 'w80', 'a28', 'a36', 'b0', 'b1', 'b2', 'd0', 'd1', 'd2']) {
      let s = setup({ aCard: card.id === 'c01' ? 'c02' : 'c01', bCard: card.id });
      s = apply(s, { type: 'OPEN_QUESTION' });
      s = apply(s, { type: 'ASK', questionId: qid });
      s = apply(s, { type: 'ANSWER', usedCoin: false });
      const expected = evaluate(questionById(qid), card) ? 'Y' : 'N';
      eq(s.log.at(-1).answer, expected, `${card.name} / ${qid}`);
    }
  }
});

// ── 결론 ──────────────────────────────────────────────────────────────
console.log('');
if (failures.length === 0) {
  console.log(`엔진 검증 통과 — ${pass}건`);
  process.exit(0);
} else {
  console.log(`엔진 검증 실패 — ${failures.length}건 / 통과 ${pass}건`);
  process.exit(1);
}
