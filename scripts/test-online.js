/**
 * 온라인 대전 통합 검증 — 실제로 뜬 서버에 WebSocket 두 개를 붙여 한 판을 끝까지 둔다.
 *
 *   npx wrangler dev --port 8787 &      (또는 npm run preview)
 *   node scripts/test-online.js
 *
 * 이 테스트가 확인하는 것 중 가장 중요한 것:
 *   ★ 상대의 cardId 가 클라이언트로 절대 내려오지 않는다 (게임이 끝나기 전까지)
 *   ★ 남의 차례에 보낸 액션, 남 대신 보낸 답변은 서버가 거절한다
 */

const BASE = process.env.BASE ?? 'http://127.0.0.1:8787';
const WS_BASE = BASE.replace(/^http/, 'ws');

let pass = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ✔ ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  ✘ ${name}\n      ${err.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg ?? '단정 실패'); }
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg ?? '값 불일치'} — 기대 ${JSON.stringify(b)}, 실제 ${JSON.stringify(a)}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postJson(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

/** 한 명의 클라이언트 */
class Client {
  constructor(name, token) {
    this.name = name;
    this.token = token;
    this.playerId = null;
    this.room = null;
    this.state = null;
    this.errors = [];
    this.syncs = 0;
  }

  connect(code) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${WS_BASE}/api/room/${code}/ws?token=${encodeURIComponent(this.token)}`);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error(`${this.name}: 연결 시간 초과`)), 8000);
      ws.addEventListener('message', (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'hello') { this.playerId = msg.playerId; clearTimeout(timer); resolve(); }
        else if (msg.type === 'sync') { this.room = msg.room; this.state = msg.state; this.syncs += 1; }
        else if (msg.type === 'error') { this.errors.push(msg); }
      });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`${this.name}: 소켓 오류`)); });
    });
  }

  send(msg) { this.ws.send(JSON.stringify(msg)); }
  act(action) { this.send({ type: 'action', action }); }
  close() { try { this.ws.close(); } catch { /* 이미 닫힘 */ } }
}

/** 조건이 참이 될 때까지 기다린다 */
async function until(fn, what, ms = 6000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fn()) return;
    await sleep(40);
  }
  throw new Error(`시간 초과: ${what}`);
}

// ─────────────────────────────────────────────────────────────────────

console.log(`\n대상 서버: ${BASE}`);

const host = new Client('HOST', crypto.randomUUID());
const guest = new Client('GUEST', crypto.randomUUID());
const stranger = new Client('STRANGER', crypto.randomUUID());

console.log('\n방 만들기 · 입장');

const created = await postJson('/api/room', { token: host.token, nick: '앨런' });
check('방을 만들면 4자리 코드가 나온다', () => {
  eq(created.status, 200);
  assert(/^[A-Z0-9]{4}$/.test(created.data.code), `코드 형식이 이상하다: ${created.data.code}`);
  eq(created.data.playerId, 'p1');
});
const CODE = created.data.code;
console.log(`      방 코드: ${CODE}`);

check('없는 코드로 입장하면 404', async () => {});
const bogus = await postJson('/api/room/ZZZZ/join', { token: guest.token, nick: 'x' });
check('없는 코드는 404 와 사유를 돌려준다', () => {
  eq(bogus.status, 404);
  eq(bogus.data.code, 'not-found');
});

const joined = await postJson(`/api/room/${CODE}/join`, { token: guest.token, nick: '조안' });
check('게스트가 코드로 입장한다', () => {
  eq(joined.status, 200);
  eq(joined.data.playerId, 'p2');
});

const lower = await postJson(`/api/room/${CODE.toLowerCase()}/join`, { token: guest.token, nick: '조안' });
check('소문자 코드도 같은 방으로 붙는다 (재입장)', () => {
  eq(lower.status, 200);
  eq(lower.data.playerId, 'p2');
  eq(lower.data.rejoined, true);
});

// stranger 는 끝까지 입장하지 않는다 — 「방에 없는 토큰」 검증용.
// 정원 초과(4인)는 아래 4인 서바이벌 절에서 확인한다.

console.log('\n연결 · 대기실');

await host.connect(CODE);
await guest.connect(CODE);
await until(() => host.room && guest.room, '양쪽이 방 정보를 받음');

// 입장하지 않은 토큰으로는 소켓 자체가 열리지 않아야 한다
const forbidden = await stranger.connect(CODE).then(() => 'opened', (e) => e.message);
check('입장하지 않은 토큰은 WebSocket 이 열리지 않는다', () => {
  assert(forbidden !== 'opened', '방에 없는 사람이 소켓을 열었다');
});

check('대기실에 두 명이 보이고 방장이 표시된다', () => {
  eq(host.room.players.length, 2);
  eq(host.room.hostId, 'p1');
  eq(host.room.status, 'waiting');
  assert(host.room.players.every((p) => p.connected), '접속 표시가 안 됐다');
});

check('방 정보에 토큰이 들어 있지 않다', () => {
  const dump = JSON.stringify(host.room);
  assert(!dump.includes(host.token), '호스트 토큰이 새어 나왔다');
  assert(!dump.includes(guest.token), '게스트 토큰이 새어 나왔다');
});

host.send({ type: 'start' });
await sleep(200);
check('준비가 안 됐으면 시작이 거절된다', () => {
  assert(host.errors.some((e) => e.code === 'not-ready'), '거절되지 않았다');
});

host.send({ type: 'ready', ready: true });
guest.send({ type: 'ready', ready: true });
await until(() => host.room.players.every((p) => p.ready), '전원 준비');

guest.errors.length = 0;
guest.send({ type: 'start' });
await sleep(200);
check('방장이 아니면 시작할 수 없다', () => {
  assert(guest.errors.some((e) => e.code === 'not-host'), '방장이 아닌데 시작이 됐다');
});

console.log('\n카드 배분 — 상대 정체는 내려오지 않는다');

host.errors.length = 0;
host.send({ type: 'start' });
await until(() => host.state && guest.state, '게임 시작');

check('둘 다 DEALING 상태를 받는다', () => {
  eq(host.state.phase, 'DEALING');
  eq(guest.state.phase, 'DEALING');
});

check('★ 내 카드만 보이고 상대 cardId 는 null 이다', () => {
  eq(typeof host.state.players.p1.cardId, 'string', '내 카드가 없다');
  eq(host.state.players.p2.cardId, null, '상대 카드가 내려왔다');
  eq(typeof guest.state.players.p2.cardId, 'string');
  eq(guest.state.players.p1.cardId, null);
});

check('★ 상대 카드 id 가 페이로드 어디에도 없다', () => {
  const hostCard = host.state.players.p1.cardId;
  const guestCard = guest.state.players.p2.cardId;
  assert(hostCard !== guestCard, '두 사람이 같은 카드를 받았다');
  assert(!JSON.stringify(host.state).includes(guestCard), '호스트 페이로드에 상대 카드가 있다');
  assert(!JSON.stringify(guest.state).includes(hostCard), '게스트 페이로드에 상대 카드가 있다');
});

check('두 사람이 서로 다른 자리를 받는다', () => {
  eq(host.playerId, 'p1');
  eq(guest.playerId, 'p2');
});

console.log('\n권한 — 서버가 누가 무엇을 할 수 있는지 판정한다');

const byId = { p1: host, p2: guest };
const firstId = host.state.order[0];
const secondId = host.state.order[1];
const first = byId[firstId];
const second = byId[secondId];

second.errors.length = 0;
second.act({ type: 'ACK_CARD', playerId: firstId });
await sleep(200);
check('남의 카드를 대신 확인할 수 없다', () => {
  assert(second.errors.some((e) => e.code === 'rejected'), '남의 ACK_CARD 가 통과했다');
});

host.act({ type: 'ACK_CARD', playerId: 'p1' });
guest.act({ type: 'ACK_CARD', playerId: 'p2' });
await until(() => host.state.phase === 'ACTION_SELECT', '양쪽 확인 완료');

second.errors.length = 0;
second.act({ type: 'OPEN_QUESTION' });
await sleep(200);
check('내 차례가 아니면 질문할 수 없다', () => {
  assert(second.errors.some((e) => e.code === 'rejected'), '남의 턴에 행동이 통과했다');
});

first.act({ type: 'OPEN_QUESTION' });
await until(() => host.state.phase === 'QUESTION_BUILD', '질문 빌더');
first.act({ type: 'ASK', questionId: 'h175' });
await until(() => host.state.phase === 'ANSWER_PENDING', '답변 대기');

first.errors.length = 0;
first.act({ type: 'ANSWER', usedCoin: false });
await sleep(200);
check('★ 상대 대신 답변할 수 없다 (진실 유출 차단)', () => {
  assert(first.errors.some((e) => e.code === 'rejected'), '질문자가 대신 답변했다');
  eq(host.state.phase, 'ANSWER_PENDING', '상태가 바뀌었다');
});

second.errors.length = 0;
second.act({ type: 'CONTINUE' });
await sleep(200);
check('CONTINUE 는 클라이언트가 보낼 수 없다 (서버 알람 전용)', () => {
  assert(second.errors.some((e) => e.code === 'rejected'), 'CONTINUE 가 통과했다');
});

console.log('\n진행 — 답변 · 서버 자동 턴 넘김');

second.act({ type: 'ANSWER', usedCoin: false });
await until(() => host.state.log.length === 1, '답변 기록');

check('코인 미사용 답변은 서버가 카드로 계산한다', () => {
  const entry = host.state.log[0];
  eq(entry.usedCoin, false);
  assert(entry.answer === 'Y' || entry.answer === 'N');
  assert(!('wasLie' in entry), 'wasLie 필드가 있다 — D6 위반');
});

check('양쪽이 같은 로그를 본다', () => {
  eq(JSON.stringify(host.state.log), JSON.stringify(guest.state.log));
});

await until(() => host.state.phase === 'ACTION_SELECT', '서버가 REVEAL 후 턴을 넘김', 8000);
check('서버가 REVEAL 을 알람으로 자동 진행한다', () => {
  eq(host.state.phase, 'ACTION_SELECT');
  eq(host.state.order[host.state.currentIndex], secondId, '답변자에게 턴이 넘어가야 한다');
});

// 코인 답변
second.act({ type: 'OPEN_QUESTION' });
await until(() => host.state.phase === 'QUESTION_BUILD', '질문 빌더 2');
second.act({ type: 'ASK', questionId: 'a36' });
await until(() => host.state.phase === 'ANSWER_PENDING', '답변 대기 2');
first.act({ type: 'ANSWER', usedCoin: true, answer: 'Y', line: '글쎄, 기억이 안 나는군' });
await until(() => host.state.log.length === 2, '코인 답변 기록');

check('코인 답변은 대사와 Y/N 이 그대로 기록되고 코인이 줄어든다', () => {
  const entry = host.state.log[1];
  eq(entry.usedCoin, true);
  eq(entry.answer, 'Y');
  eq(entry.line, '글쎄, 기억이 안 나는군');
  eq(host.state.players[firstId].coinsLeft, 1);
});

check('★ 코인 답변에도 진실 여부가 저장되지 않는다 (D6)', () => {
  const keys = Object.keys(host.state.log[1]).sort().join(',');
  eq(keys, 'answer,askerId,at,line,questionId,seq,targetId,usedCoin');
});

console.log('\n지목 — 게임 종료와 카드 공개');

await until(() => host.state.phase === 'ACTION_SELECT', '턴 넘김 2', 8000);

// 이번 턴 플레이어가 상대를 정확히 지목해 게임을 끝낸다
const turnId = host.state.order[host.state.currentIndex];
const turnClient = byId[turnId];
const otherId = turnId === 'p1' ? 'p2' : 'p1';
const otherClient = byId[otherId];
const answer = otherClient.state.players[otherId].cardId;   // 상대 본인만 아는 값

turnClient.act({ type: 'OPEN_ACCUSE' });
await until(() => host.state.phase === 'ACCUSE_SELECT', '지목 화면');
turnClient.act({ type: 'ACCUSE', cardId: answer });
await until(() => host.state.phase === 'RESULT' || host.state.counterAttack, '지목 처리');

if (host.state.counterAttack) {
  // 선공이 맞혔다 → 후공에게 반격 턴 (D4). 후공이 빗맞혀 종료시킨다
  const wrong = otherClient.state.players[otherId].cardId === 'c01' ? 'c02' : 'c01';
  otherClient.act({ type: 'OPEN_ACCUSE' });
  await until(() => host.state.phase === 'ACCUSE_SELECT', '반격 지목 화면');
  otherClient.act({ type: 'ACCUSE', cardId: wrong });
  await until(() => host.state.phase === 'RESULT', '반격 처리');
}

check('게임이 RESULT 로 끝난다', () => {
  eq(host.state.phase, 'RESULT');
  eq(guest.state.phase, 'RESULT');
  assert(host.state.result, 'result 가 비었다');
});

check('★ 끝나야 양쪽 카드가 함께 공개된다', () => {
  eq(host.state.result.cards.p1, guest.state.result.cards.p1);
  eq(host.state.result.cards.p2, guest.state.result.cards.p2);
  assert(host.state.result.cards.p2, '상대 카드가 공개되지 않았다');
});

check('방 상태가 finished 로 바뀐다', () => {
  eq(host.room.status, 'finished');
});

console.log('\n재접속 · 다시 하기');

guest.close();
await sleep(300);
const back = new Client('GUEST2', guest.token);
const rejoin = await postJson(`/api/room/${CODE}/join`, { token: guest.token, nick: '조안' });
await back.connect(CODE);
await until(() => back.state, '재접속 후 상태 수신');
check('같은 토큰으로 재접속하면 원래 자리로 돌아온다', () => {
  eq(rejoin.data.playerId, 'p2');
  eq(back.playerId, 'p2');
  eq(back.state.phase, 'RESULT');
});

back.errors.length = 0;
back.send({ type: 'again' });
await sleep(250);
check('방장이 아니면 다시 시작할 수 없다', () => {
  assert(back.errors.some((e) => e.code === 'not-host'), '방장이 아닌데 재시작이 됐다');
});

const seqBefore = host.room.seq;
host.send({ type: 'again' });
await until(() => host.state.phase === 'DEALING' && host.room.seq !== seqBefore, '새 판 시작');
check('방장이 다시 시작하면 카드가 새로 배분된다', () => {
  eq(host.state.phase, 'DEALING');
  eq(host.state.players.p2.cardId, null, '새 판에서도 상대 카드는 가려져야 한다');
  assert(host.room.seq > seqBefore, 'seq 가 올라가지 않았다');
});

host.close();
back.close();

console.log('\n4인 서바이벌');

{
  const four = ['HOST4', 'G1', 'G2', 'G3'].map((n) => new Client(n, crypto.randomUUID()));
  const made = await postJson('/api/room', { token: four[0].token, nick: '앨런' });
  const CODE4 = made.data.code;
  for (let i = 1; i < 4; i += 1) {
    await postJson(`/api/room/${CODE4}/join`, { token: four[i].token, nick: `P${i + 1}` });
  }
  const fifth = await postJson(`/api/room/${CODE4}/join`, { token: crypto.randomUUID(), nick: '난입' });
  check('5번째 사람은 정원 초과로 거절된다', () => {
    eq(fifth.status, 409);
    eq(fifth.data.code, 'full');
  });

  for (const c of four) await c.connect(CODE4);
  await until(() => four.every((c) => c.room?.players.length === 4), '4인 전원 방 정보 수신');
  check('대기실에 네 명이 모인다', () => eq(four[0].room.players.length, 4));

  for (const c of four) c.send({ type: 'ready', ready: true });
  await until(() => four[0].room.players.every((p) => p.ready), '전원 준비');
  four[0].send({ type: 'start' });
  await until(() => four.every((c) => c.state), '4인 게임 시작');

  const byId4 = Object.fromEntries(four.map((c) => [c.playerId, c]));
  const alive4 = () => four[0].state.order.filter((id) => !four[0].state.players[id].eliminated);

  check('4인은 서바이벌 모드이고 코인이 3개다', () => {
    eq(four[0].state.mode, 'survival');
    for (const id of four[0].state.order) eq(four[0].state.players[id].coinsLeft, 3);
  });

  check('★ 4인에서도 나머지 세 명의 카드가 전부 가려진다', () => {
    for (const c of four) {
      const mine = c.state.players[c.playerId].cardId;
      assert(typeof mine === 'string', `${c.name}: 내 카드가 없다`);
      for (const id of c.state.order) {
        if (id === c.playerId) continue;
        eq(c.state.players[id].cardId, null, `${c.name} 에게 ${id} 카드가 보인다`);
      }
    }
  });

  for (const c of four) c.act({ type: 'ACK_CARD', playerId: c.playerId });
  await until(() => four[0].state.phase === 'ACTION_SELECT', '4인 카드 확인 완료');

  // 지목 대상을 골라서 진행 — 현재 턴 플레이어가 다른 사람을 정확히 지목한다
  const turnId = four[0].state.order[four[0].state.currentIndex];
  const actor = byId4[turnId];
  const victimId = four[0].state.order.find((id) => id !== turnId);
  const victim = byId4[victimId];

  actor.errors.length = 0;
  actor.act({ type: 'OPEN_QUESTION' });
  await until(() => four[0].state.phase === 'QUESTION_BUILD', '질문 빌더');
  actor.act({ type: 'ASK', questionId: 'h175', targetId: victimId });
  await until(() => four[0].state.phase === 'ANSWER_PENDING', '대상 지정 질문');
  check('★ 질문 대상을 골라서 물을 수 있다', () => {
    eq(four[0].state.pending.targetId, victimId);
    eq(four[0].state.pending.askerId, turnId);
  });

  // 질문 대상이 아닌 사람이 답하려 하면 거절
  const bystanderId = four[0].state.order.find((id) => id !== turnId && id !== victimId);
  const bystander = byId4[bystanderId];
  bystander.errors.length = 0;
  bystander.act({ type: 'ANSWER', usedCoin: false });
  await sleep(200);
  check('질문받지 않은 사람은 대신 답할 수 없다', () => {
    assert(bystander.errors.some((e) => e.code === 'rejected'), '제3자가 답변했다');
  });

  victim.act({ type: 'ANSWER', usedCoin: false });
  // 브로드캐스트는 사람마다 도착 시각이 다르다 — 네 명분을 모두 기다린 뒤에 본다
  await until(() => four.every((c) => c.state.log.length === 1), '네 명 모두 답변 기록 수신');
  check('★ 질문과 답변을 네 명 모두가 본다 (전원 공개)', () => {
    for (const c of four) eq(c.state.log.length, 1, `${c.name} 이 로그를 못 봤다`);
    const first = JSON.stringify(four[0].state.log);
    for (const c of four) eq(JSON.stringify(c.state.log), first, `${c.name} 의 로그가 다르다`);
  });

  await until(() => four[0].state.phase === 'ACTION_SELECT', '턴 넘김', 8000);

  // 이번 턴 플레이어가 다른 사람을 정확히 지목 → 그 사람만 탈락
  // (답변자에게 턴이 넘어가므로 지목 대상은 이 시점에 다시 고른다)
  const t2 = four[0].state.order[four[0].state.currentIndex];
  const accuser = byId4[t2];
  const goneId = four[0].state.order.find((id) => id !== t2);
  const goneCard = byId4[goneId].state.players[goneId].cardId;   // 본인만 아는 값

  accuser.errors.length = 0;
  accuser.act({ type: 'OPEN_ACCUSE' });
  await until(() => four[0].state.phase === 'ACCUSE_SELECT', '지목 화면');
  accuser.act({ type: 'ACCUSE', targetId: goneId, cardId: goneCard });
  await until(() => four.every((c) => c.state.players[goneId].eliminated), '네 명 모두 탈락 처리 수신');

  check('★ 지목 성공 → 그 사람만 탈락하고 게임은 계속된다', () => {
    eq(four[0].state.phase, 'ACTION_SELECT');
    eq(four[0].state.players[goneId].eliminated, true);
    eq(four[0].state.result, null);
    eq(alive4().length, 3, '세 명이 남아야 한다');
  });

  check('★ 탈락자의 카드는 전원에게 공개된다', () => {
    for (const c of four) {
      eq(c.state.players[goneId].cardId, goneCard, `${c.name} 에게 탈락자 카드가 안 보인다`);
    }
  });

  check('탈락하지 않은 사람들의 카드는 여전히 가려져 있다', () => {
    for (const c of four) {
      for (const id of c.state.order) {
        if (id === c.playerId || id === goneId) continue;
        eq(c.state.players[id].cardId, null, `${c.name} 에게 ${id} 카드가 새어 나왔다`);
      }
    }
  });

  check('탈락자는 턴에서 건너뛰어진다', () => {
    const cur = four[0].state.order[four[0].state.currentIndex];
    assert(cur !== goneId, '탈락자에게 턴이 왔다');
  });

  const goneClient = byId4[goneId];
  goneClient.errors.length = 0;
  goneClient.act({ type: 'OPEN_QUESTION' });
  await sleep(200);
  check('탈락자는 더 이상 행동할 수 없다', () => {
    assert(goneClient.errors.some((e) => e.code === 'rejected'), '탈락자가 행동했다');
  });

  for (const c of four) c.close();
}

console.log('');
if (failures.length === 0) {
  console.log(`온라인 검증 통과 — ${pass}건`);
  process.exit(0);
} else {
  console.log(`온라인 검증 실패 — ${failures.length}건 / 통과 ${pass}건`);
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
