/**
 * 덱 검증 — GDD 6-2 의 제약 C0 ~ C4, 질문 임계값 C5, 추리 완결성 완전 탐색
 *
 *   node data/validate-deck.js     (= npm run validate)
 *
 * 제약이 하나라도 깨지면 exit code 1 로 종료한다. CI 에서 그대로 쓸 수 있다.
 */

import {
  DECK, BRANCHES, DRINKS, TOKENS, QUESTIONS, ATTR_META,
  evaluate, pamphletVector, tokenKey, containsTokens,
  heightBucket, weightBucket, ageBucket,
} from './deck.js';

const problems = [];
const ok = (msg) => console.log(`  ✔ ${msg}`);
const bad = (msg) => { problems.push(msg); console.log(`  ✘ ${msg}`); };
const section = (title) => console.log(`\n${title}`);

// ── C0. 기본 무결성 ───────────────────────────────────────────────────
section('C0. 기본 무결성');

DECK.length === 15 ? ok(`덱 크기 ${DECK.length}장`) : bad(`덱 크기가 15가 아니다 (${DECK.length})`);

const dupIds = DECK.map((c) => c.id).filter((v, i, a) => a.indexOf(v) !== i);
dupIds.length === 0 ? ok('id 중복 없음') : bad(`id 중복: ${dupIds.join(', ')}`);

const dupNames = DECK.map((c) => c.name).filter((v, i, a) => a.indexOf(v) !== i);
dupNames.length === 0 ? ok('이름 중복 없음') : bad(`이름 중복: ${dupNames.join(', ')}`);

const outOfRange = [];
for (const c of DECK) {
  for (const [attr, meta] of Object.entries(ATTR_META)) {
    const v = c[meta.key];
    if (!Number.isInteger(v) || v < meta.range[0] || v > meta.range[1]) {
      outOfRange.push(`${c.name} ${attr}=${v}`);
    }
  }
}
outOfRange.length === 0
  ? ok('모든 수치가 구간 전체 범위 안에 있음')
  : bad(`범위 밖 수치: ${outOfRange.join(', ')}`);

const badFields = [];
for (const c of DECK) {
  if (c.tokens.length !== 5) badFields.push(`${c.name} 토큰 ${c.tokens.length}개`);
  if (c.tokens.some((t) => !TOKENS.includes(t))) badFields.push(`${c.name} 알 수 없는 토큰`);
  if (!BRANCHES.includes(c.branch)) badFields.push(`${c.name} 소속 '${c.branch}'`);
  if (!DRINKS.includes(c.drink)) badFields.push(`${c.name} 술 '${c.drink}'`);
}
badFields.length === 0
  ? ok('토큰 5슬롯 · 소속 · 술 값 모두 유효')
  : bad(`잘못된 필드: ${badFields.join(', ')}`);

// ── C1. 팜플렛 벡터 유일성 ────────────────────────────────────────────
section('C1. 팜플렛 벡터 유일성 — 팜플렛만으로 추리가 완결되는가');

const vectors = new Map();
for (const c of DECK) {
  const v = pamphletVector(c);
  if (!vectors.has(v)) vectors.set(v, []);
  vectors.get(v).push(c.name);
}
const collisions = [...vectors.entries()].filter(([, names]) => names.length > 1);
const combos = 3 * 3 * 3 * BRANCHES.length * DRINKS.length;
collisions.length === 0
  ? ok(`${DECK.length}개 벡터 전부 상이 (${combos}개 조합 중 ${DECK.length}개 사용)`)
  : bad(`벡터 충돌: ${collisions.map(([v, n]) => `${v} → ${n.join('/')}`).join(' · ')}`);

// ── C2. 토큰 유일성 ───────────────────────────────────────────────────
section('C2. 토큰 유일성 — 토큰 5개가 캐릭터를 특정하는가');

const tokenKeys = new Map();
for (const c of DECK) {
  const k = tokenKey(c.tokens);
  if (!tokenKeys.has(k)) tokenKeys.set(k, []);
  tokenKeys.get(k).push(c.name);
}
const tokenCollisions = [...tokenKeys.entries()].filter(([, n]) => n.length > 1);
tokenCollisions.length === 0
  ? ok(`${DECK.length}개 토큰 구성 전부 상이`)
  : bad(`토큰 충돌: ${tokenCollisions.map(([, n]) => n.join('/')).join(' · ')}`);

// ── C3. 구간 분포 ─────────────────────────────────────────────────────
section('C3. 구간 분포 — 각 구간 3~7장 (낭비 질문 방지)');

const distribution = (label, keys, counter) => {
  const counts = keys.map(counter);
  const inRange = counts.every((n) => n >= 3 && n <= 7);
  const line = `${label.padEnd(4, ' ')} ${counts.join(' / ')}`;
  inRange ? ok(line) : bad(`${line}  ← 3~7장 범위를 벗어난 구간이 있다`);
  return counts;
};

const heightDist = distribution('키', [1, 2, 3], (b) => DECK.filter((c) => heightBucket(c) === b).length);
const weightDist = distribution('몸무게', [1, 2, 3], (b) => DECK.filter((c) => weightBucket(c) === b).length);
const ageDist = distribution('나이', [1, 2, 3], (b) => DECK.filter((c) => ageBucket(c) === b).length);
distribution('소속', BRANCHES, (b) => DECK.filter((c) => c.branch === b).length);
distribution('술', DRINKS, (d) => DECK.filter((c) => c.drink === d).length);

// ── C4. 페널티 안전성 ─────────────────────────────────────────────────
section('C4. 페널티 안전성 — 토큰 2개를 공개해도 자신이 확정되지 않는 조합 보유');

let weakest = null;
const unsafe = [];
for (const c of DECK) {
  let best = 0;
  const seen = new Set();
  for (let i = 0; i < 5; i += 1) {
    for (let j = i + 1; j < 5; j += 1) {
      const pair = [c.tokens[i], c.tokens[j]];
      const key = tokenKey(pair);
      if (seen.has(key)) continue;
      seen.add(key);
      const survivors = DECK.filter((o) => containsTokens(o.tokens, pair)).length;
      if (survivors > best) best = survivors;
    }
  }
  if (best < 2) unsafe.push(c.name);
  if (weakest === null || best < weakest.best) weakest = { name: c.name, best };
}
unsafe.length === 0
  ? ok(`전원 안전. 최소 보장 캐릭터 = ${weakest.name} (최선의 2개 공개 시 후보 ${weakest.best}명 잔존)`)
  : bad(`2개 공개로 즉시 확정되는 캐릭터: ${unsafe.join(', ')}`);

// ── C5. 질문 임계값이 구간 경계에 놓여 있는가 (GDD D1) ────────────────
section('C5. 질문 임계값 — 구간을 쪼개는 질문이 없는가');

const bucketOf = { height: heightBucket, weight: weightBucket, age: ageBucket };
const splitsBucket = [];
for (const q of QUESTIONS) {
  if (q.op === 'eq') continue;
  const toBucketFn = bucketOf[q.attr];
  for (let b = 1; b <= 3; b += 1) {
    const inBucket = DECK.filter((c) => toBucketFn(c) === b);
    if (inBucket.length === 0) continue;
    const first = evaluate(q, inBucket[0]);
    const odd = inBucket.find((c) => evaluate(q, c) !== first);
    if (odd) {
      splitsBucket.push(`${q.short} 가 구간 ${b} 안의 ${inBucket[0].name}/${odd.name} 를 갈라놓는다`);
    }
  }
}
splitsBucket.length === 0
  ? ok(`수치 질문 ${QUESTIONS.filter((q) => q.op !== 'eq').length}종 모두 구간 경계에서만 가른다`)
  : bad(`구간 내부를 쪼개는 질문: ${splitsBucket.join(' · ')}  ← 답을 들어도 후보를 지울 수 없다 (D1 위반)`);

// 이상/이하가 서로의 뒤집힌 표현으로 정확히 짝지어지는가
const cutMap = new Map();
for (const q of QUESTIONS) {
  if (q.op === 'eq') continue;
  const key = `${q.attr}@${q.op === 'lte' ? q.value + 1 : q.value}`;
  if (!cutMap.has(key)) cutMap.set(key, []);
  cutMap.get(key).push(q);
}
const unpaired = [...cutMap.entries()].filter(([, qs]) => qs.length !== 2);
unpaired.length === 0
  ? ok(`이상/이하가 ${cutMap.size}개 지점에서 정확히 짝을 이룬다`)
  : bad(`짝이 없는 임계값: ${unpaired.map(([k, qs]) => `${k} (${qs.map((q) => q.short).join(',')})`).join(' · ')}`);

// 짝지어진 두 질문이 실제로 정반대 답을 내는가
const mismatched = [];
for (const [key, qs] of cutMap) {
  if (qs.length !== 2) continue;
  const [a, b] = qs;
  for (const c of DECK) {
    if (evaluate(a, c) === evaluate(b, c)) {
      mismatched.push(`${key}: ${c.name} 에서 ${a.short} 와 ${b.short} 의 답이 같다`);
      break;
    }
  }
}
mismatched.length === 0
  ? ok('짝지어진 이상/이하 질문은 15장 전원에서 정확히 반대 답을 낸다')
  : bad(mismatched.join(' · '));

// ── 질문 효율 ─────────────────────────────────────────────────────────
section(`질문 효율 — ${QUESTIONS.length}종 질문의 분할비`);

for (const q of QUESTIONS) {
  const yes = DECK.filter((c) => evaluate(q, c)).length;
  const no = DECK.length - yes;
  const mark = Math.abs(yes - no) <= 1 ? ' ★ 고효율' : '';
  console.log(`  ${q.short.padEnd(12, ' ')} ${String(yes).padStart(2)} : ${String(no).padStart(2)}${mark}`);
}

// ── 추리 완결성 — 최적 결정 트리 완전 탐색 ────────────────────────────
section('추리 완결성 — 최적 결정 트리 완전 탐색');

const N = DECK.length;
const FULL = (1 << N) - 1;

// 질문별 YES 비트마스크
const yesMask = QUESTIONS.map((q) => {
  let m = 0;
  DECK.forEach((c, i) => { if (evaluate(q, c)) m |= 1 << i; });
  return m;
});

const popcount = (m) => { let n = 0; while (m) { m &= m - 1; n += 1; } return n; };

// 진부분집합은 항상 수치상 더 작으므로 mask 를 0..FULL 오름차순으로 훑으면 된다.
const worst = new Int32Array(FULL + 1);   // 최악의 경우 질문 수를 최소화
const total = new Int32Array(FULL + 1);   // 전체 질문 수 합(=평균)을 최소화
const worstOfTotalTree = new Int32Array(FULL + 1); // total 최적 트리의 깊이

let unsolvable = null;
for (let mask = 1; mask <= FULL; mask += 1) {
  const pop = popcount(mask);
  if (pop <= 1) continue;

  let bestWorst = Infinity;
  let bestTotal = Infinity;
  let bestTotalDepth = Infinity;

  for (let qi = 0; qi < QUESTIONS.length; qi += 1) {
    const y = mask & yesMask[qi];
    const n = mask & ~yesMask[qi];
    if (y === 0 || n === 0) continue; // 후보를 가르지 못하는 질문은 무의미

    const w = 1 + Math.max(worst[y], worst[n]);
    if (w < bestWorst) bestWorst = w;

    const t = pop + total[y] + total[n];
    const d = 1 + Math.max(worstOfTotalTree[y], worstOfTotalTree[n]);
    if (t < bestTotal || (t === bestTotal && d < bestTotalDepth)) {
      bestTotal = t;
      bestTotalDepth = d;
    }
  }

  if (bestWorst === Infinity) {
    if (!unsolvable) {
      const names = DECK.filter((_, i) => mask & (1 << i)).map((c) => c.name);
      unsolvable = names;
    }
    worst[mask] = 999;
    total[mask] = 999;
    worstOfTotalTree[mask] = 999;
  } else {
    worst[mask] = bestWorst;
    total[mask] = bestTotal;
    worstOfTotalTree[mask] = bestTotalDepth;
  }
}

if (unsolvable) {
  bad(`질문만으로 갈라낼 수 없는 후보 덩어리가 있다: ${unsolvable.join(', ')} (C1 위반의 결과)`);
} else {
  const avg = total[FULL] / N;
  const lowerBound = Math.ceil(Math.log2(N));
  ok(`최악의 경우      ${worst[FULL]} 질문`);
  ok(`평균             ${avg.toFixed(2)} 질문  (질문 수 합 ${total[FULL]} / ${N}명)`);
  console.log(`  · 정보이론 하한 log2(${N}) = ${Math.log2(N).toFixed(2)}비트 → 이론상 최소 ${lowerBound}질문`);
  if (worst[FULL] === lowerBound) {
    console.log('  · 최악의 경우가 이론 하한과 일치 — 추리 완결성 확보');
  } else {
    console.log(`  · ⚠ 최악의 경우가 이론 하한(${lowerBound})보다 ${worst[FULL] - lowerBound} 질문 많다`);
  }
  if (worstOfTotalTree[FULL] === worst[FULL]) {
    console.log('  · 평균 최적 트리의 깊이도 최악값과 동일 — 두 최적이 양립한다');
  }
}

// ── 「구별되지 않는 덩어리」 리포트 (설계 의도 확인용) ─────────────────
section('수치 구간만으로는 갈라지지 않는 덩어리 (의도된 설계 · DECK.md 6-1)');

const numericGroups = new Map();
for (const c of DECK) {
  const k = `${heightBucket(c)}${weightBucket(c)}${ageBucket(c)}`;
  if (!numericGroups.has(k)) numericGroups.set(k, []);
  numericGroups.get(k).push(c);
}
let reported = 0;
for (const [k, group] of numericGroups) {
  if (group.length < 2) continue;
  reported += 1;
  const detail = group.map((c) => `${c.name}(${c.branch}/${c.drink})`).join(' · ');
  console.log(`  [${k}] ${group.length}명 — ${detail}`);
}
if (reported === 0) console.log('  (없음 — 모든 캐릭터가 수치 질문만으로 갈라진다)');

// ── 결론 ──────────────────────────────────────────────────────────────
console.log('');
if (problems.length === 0) {
  console.log('덱 검증 통과 — C1~C5 전부 충족');
  process.exit(0);
} else {
  console.log(`덱 검증 실패 — ${problems.length}건`);
  for (const p of problems) console.log(`  · ${p}`);
  process.exit(1);
}
