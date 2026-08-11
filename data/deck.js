/**
 * 이미테이션 게임 — 캐릭터 덱 v1 (확정)
 *
 * GDD 6-1 ~ 6-4 의 데이터를 그대로 옮긴 단일 원본(single source of truth)이다.
 * 브라우저와 Node 양쪽에서 그대로 import 한다 (package.json 의 "type": "module").
 *
 * ⚠ DECK 배열을 고치면 반드시 `npm run validate` 로 C1~C4 를 재검증할 것.
 *   특히 C1 이 깨지면 게임이 논리적으로 성립하지 않는다.
 */

export const BRANCHES = ['육군', '공군', '해군'];
export const DRINKS = ['위스키', '맥주', '칵테일'];
export const TOKENS = ['총', '술', '언어', '담배', '돈'];

export const TOKEN_EMOJI = {
  총: '🔫',
  술: '🍺',
  언어: '🗣',
  담배: '🚬',
  돈: '💰',
};

/** 토큰 함의 — M3 캐릭터 설정 집필의 출발점 (DECK.md 6-2) */
export const TOKEN_MEANING = {
  총: '실전 경험 · 저격수 · 무기 담당',
  술: '술고래 · 술집 정보원',
  언어: '통역 · 암호 해독 · 다국어',
  담배: '골초 · 담배로 주고받는 신호',
  돈: '자금 담당 · 매수 · 부유한 출신',
};

// ── 구간 체계 (GDD D1) ────────────────────────────────────────────────
export const HEIGHT_BOUNDS = [175, 185];
export const WEIGHT_BOUNDS = [65, 80];
export const AGE_BOUNDS = [28, 36];

export const ATTR_META = {
  height: {
    key: 'heightCm',
    label: '키',
    unit: 'cm',
    bounds: HEIGHT_BOUNDS,
    range: [163, 194],
    buckets: ['163–174', '175–184', '185–194'],
  },
  weight: {
    key: 'weightKg',
    label: '몸무게',
    unit: 'kg',
    bounds: WEIGHT_BOUNDS,
    range: [50, 94],
    buckets: ['50–64', '65–79', '80–94'],
  },
  age: {
    key: 'age',
    label: '나이',
    unit: '세',
    bounds: AGE_BOUNDS,
    range: [20, 43],
    buckets: ['20–27', '28–35', '36–43'],
  },
};

/** 실수치 → 구간(1|2|3) */
export const toBucket = (v, bounds) => (v >= bounds[1] ? 3 : v >= bounds[0] ? 2 : 1);

export const heightBucket = (c) => toBucket(c.heightCm, HEIGHT_BOUNDS);
export const weightBucket = (c) => toBucket(c.weightKg, WEIGHT_BOUNDS);
export const ageBucket = (c) => toBucket(c.age, AGE_BOUNDS);

// ── 덱 15장 ───────────────────────────────────────────────────────────
export const DECK = [
  { id: 'c01', name: '토마스',   heightCm: 187, weightKg: 79, age: 26, branch: '육군', drink: '칵테일', tokens: ['총', '총', '언어', '담배', '돈'] },
  { id: 'c02', name: '제인',     heightCm: 175, weightKg: 55, age: 32, branch: '해군', drink: '맥주',   tokens: ['술', '술', '언어', '돈', '돈'] },
  { id: 'c03', name: '빅터',     heightCm: 168, weightKg: 62, age: 39, branch: '공군', drink: '위스키', tokens: ['총', '언어', '언어', '담배', '담배'] },
  { id: 'c04', name: '에드거',   heightCm: 171, weightKg: 58, age: 41, branch: '육군', drink: '맥주',   tokens: ['총', '총', '술', '언어', '담배'] },
  { id: 'c05', name: '노라',     heightCm: 164, weightKg: 51, age: 37, branch: '해군', drink: '칵테일', tokens: ['술', '술', '담배', '돈', '돈'] },
  { id: 'c06', name: '사이먼',   heightCm: 173, weightKg: 70, age: 23, branch: '공군', drink: '맥주',   tokens: ['총', '언어', '담배', '담배', '돈'] },
  { id: 'c07', name: '클라라',   heightCm: 166, weightKg: 82, age: 30, branch: '육군', drink: '위스키', tokens: ['총', '술', '언어', '언어', '돈'] },
  { id: 'c08', name: '밀로',     heightCm: 170, weightKg: 60, age: 28, branch: '해군', drink: '위스키', tokens: ['총', '총', '담배', '돈', '돈'] },
  { id: 'c09', name: '아그네스', heightCm: 174, weightKg: 88, age: 43, branch: '공군', drink: '칵테일', tokens: ['술', '술', '언어', '담배', '담배'] },
  { id: 'c10', name: '루퍼트',   heightCm: 181, weightKg: 64, age: 36, branch: '육군', drink: '위스키', tokens: ['총', '술', '언어', '언어', '담배'] },
  { id: 'c11', name: '이본',     heightCm: 177, weightKg: 67, age: 21, branch: '공군', drink: '칵테일', tokens: ['총', '총', '술', '술', '언어'] },
  { id: 'c12', name: '하워드',   heightCm: 184, weightKg: 91, age: 40, branch: '해군', drink: '맥주',   tokens: ['총', '술', '담배', '담배', '돈'] },
  { id: 'c13', name: '마르타',   heightCm: 186, weightKg: 63, age: 24, branch: '공군', drink: '맥주',   tokens: ['총', '언어', '언어', '돈', '돈'] },
  { id: 'c14', name: '오웬',     heightCm: 193, weightKg: 94, age: 34, branch: '해군', drink: '칵테일', tokens: ['술', '언어', '담배', '담배', '돈'] },
  { id: 'c15', name: '델피네',   heightCm: 189, weightKg: 72, age: 38, branch: '육군', drink: '위스키', tokens: ['총', '총', '언어', '돈', '돈'] },
];

const BY_ID = new Map(DECK.map((c) => [c.id, c]));
/** @returns {typeof DECK[number]} */
export const cardById = (id) => BY_ID.get(id);

// ── 질문 문법 (GDD 6-4) — 빌더가 생성 가능한 전량 12종 ────────────────
export const QUESTIONS = [
  { id: 'h175', group: '키',     attr: 'height', op: 'gte', value: 175,      text: '당신의 키는 175cm 이상입니까?',   choice: '175 cm 이상입니까?', short: '키 ≥ 175cm' },
  { id: 'h185', group: '키',     attr: 'height', op: 'gte', value: 185,      text: '당신의 키는 185cm 이상입니까?',   choice: '185 cm 이상입니까?', short: '키 ≥ 185cm' },
  { id: 'w65',  group: '몸무게', attr: 'weight', op: 'gte', value: 65,       text: '당신의 몸무게는 65kg 이상입니까?', choice: '65 kg 이상입니까?',  short: '몸무게 ≥ 65kg' },
  { id: 'w80',  group: '몸무게', attr: 'weight', op: 'gte', value: 80,       text: '당신의 몸무게는 80kg 이상입니까?', choice: '80 kg 이상입니까?',  short: '몸무게 ≥ 80kg' },
  { id: 'a28',  group: '나이',   attr: 'age',    op: 'gte', value: 28,       text: '당신은 28세 이상입니까?',          choice: '28세 이상입니까?',   short: '28세 이상' },
  { id: 'a36',  group: '나이',   attr: 'age',    op: 'gte', value: 36,       text: '당신은 36세 이상입니까?',          choice: '36세 이상입니까?',   short: '36세 이상' },
  { id: 'b0',   group: '소속',   attr: 'branch', op: 'eq',  value: '육군',   text: '당신은 육군 소속입니까?',          choice: '육군 소속입니까?',   short: '육군?' },
  { id: 'b1',   group: '소속',   attr: 'branch', op: 'eq',  value: '공군',   text: '당신은 공군 소속입니까?',          choice: '공군 소속입니까?',   short: '공군?' },
  { id: 'b2',   group: '소속',   attr: 'branch', op: 'eq',  value: '해군',   text: '당신은 해군 소속입니까?',          choice: '해군 소속입니까?',   short: '해군?' },
  { id: 'd0',   group: '술',     attr: 'drink',  op: 'eq',  value: '위스키', text: '당신이 마신 술은 위스키입니까?',   choice: '위스키입니까?',      short: '위스키?' },
  { id: 'd1',   group: '술',     attr: 'drink',  op: 'eq',  value: '맥주',   text: '당신이 마신 술은 맥주입니까?',     choice: '맥주입니까?',        short: '맥주?' },
  { id: 'd2',   group: '술',     attr: 'drink',  op: 'eq',  value: '칵테일', text: '당신이 마신 술은 칵테일입니까?',   choice: '칵테일입니까?',      short: '칵테일?' },
];

export const QUESTION_GROUPS = ['키', '몸무게', '나이', '소속', '술'];

const BY_QID = new Map(QUESTIONS.map((q) => [q.id, q]));
export const questionById = (id) => BY_QID.get(id);

/** 질문 q 에 대한 캐릭터 c 의 진실값 */
export function evaluate(q, c) {
  switch (q.attr) {
    case 'height': return c.heightCm >= q.value;
    case 'weight': return c.weightKg >= q.value;
    case 'age':    return c.age >= q.value;
    case 'branch': return c.branch === q.value;
    case 'drink':  return c.drink === q.value;
    default: throw new Error(`unknown attr: ${q.attr}`);
  }
}

// ── 팜플렛 (플레이어에게 공개되는 형태) ───────────────────────────────

/** 팜플렛 한 줄. 수치는 구간으로, 소속·술·토큰은 사실 그대로. */
export function pamphletRow(c) {
  return {
    id: c.id,
    name: c.name,
    heightBucket: heightBucket(c),
    weightBucket: weightBucket(c),
    ageBucket: ageBucket(c),
    heightLabel: ATTR_META.height.buckets[heightBucket(c) - 1],
    weightLabel: ATTR_META.weight.buckets[weightBucket(c) - 1],
    ageLabel: ATTR_META.age.buckets[ageBucket(c) - 1],
    branch: c.branch,
    drink: c.drink,
    tokens: c.tokens,
  };
}

export const PAMPHLET = DECK.map(pamphletRow);

/** 추리의 식별 단위 — C1 은 이 값 15개가 전부 상이해야 한다는 제약 */
export const pamphletVector = (c) =>
  `${heightBucket(c)}${weightBucket(c)}${ageBucket(c)}${c.branch}${c.drink}`;

/** 토큰 multiset 을 정렬 문자열로 — C2 비교용 */
export const tokenKey = (tokens) =>
  [...tokens].sort((a, b) => TOKENS.indexOf(a) - TOKENS.indexOf(b)).join('');

/** 토큰 multiset 포함 관계: haystack 이 needle 을 전부 담고 있는가 */
export function containsTokens(haystack, needle) {
  const pool = [...haystack];
  for (const t of needle) {
    const i = pool.indexOf(t);
    if (i === -1) return false;
    pool.splice(i, 1);
  }
  return true;
}

// ── 추리 유틸 ─────────────────────────────────────────────────────────

/** 단서(질문 + 답) 하나로 후보를 걸러낸다 */
export function matchesClue(card, questionId, answerIsYes) {
  return evaluate(questionById(questionId), card) === answerIsYes;
}

/** 후보 배열을 질문으로 갈랐을 때의 YES : NO */
export function splitCount(cards, q) {
  let yes = 0;
  for (const c of cards) if (evaluate(q, c)) yes += 1;
  return { yes, no: cards.length - yes };
}
