/**
 * CloudflareTransport — 온라인 대전 (M2)
 *
 * LocalTransport 와 같은 인터페이스에 방(room) 개념이 얹혔다.
 * 판정은 전부 서버(Durable Object)가 한다. 이 파일은 액션을 소켓으로 보내고,
 * 서버가 걸러 보낸 상태를 받아 두는 일만 한다.
 *
 * ★ 여기서 받는 state 에는 **상대의 cardId 가 없다.** 게임이 끝나야
 *   result.cards 로 양쪽이 함께 공개된다. 클라이언트를 뜯어도 상대 정체는 나오지 않는다.
 */

const TOKEN_KEY = 'imitation-game/token';
const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000];

/** 이 브라우저가 「나」임을 증명하는 값. 새로고침해도 같은 자리로 돌아온다. */
export function playerToken() {
  try {
    let t = localStorage.getItem(TOKEN_KEY);
    if (!t) {
      t = crypto.randomUUID();
      localStorage.setItem(TOKEN_KEY, t);
    }
    return t;
  } catch {
    // 프라이빗 모드 등 — 세션 한정 토큰으로 대신한다 (새로고침 시 재접속 불가)
    return crypto.randomUUID();
  }
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch { /* 본문 없음 */ }
  if (!res.ok) {
    const err = new Error(data.error ?? `요청이 실패했습니다 (${res.status})`);
    err.code = data.code;
    throw err;
  }
  return data;
}

export class CloudflareTransport {
  #listeners = new Set();
  #socket = null;
  #closedByUs = false;
  #retry = 0;

  code = null;
  playerId = null;
  room = null;
  state = null;
  status = 'idle';   // idle | connecting | open | reconnecting | closed
  error = null;

  get isLocal() { return false; }

  subscribe(fn) {
    this.#listeners.add(fn);
    fn();
    return () => this.#listeners.delete(fn);
  }

  #emit() { for (const fn of this.#listeners) fn(); }

  // ── 방 만들기 / 입장 ────────────────────────────────────────────────

  async createRoom(nick) {
    const { code, playerId } = await postJson('/api/room', { token: playerToken(), nick });
    this.code = code;
    this.playerId = playerId;
    await this.#connect();
    return code;
  }

  async joinRoom(code, nick) {
    const res = await postJson(`/api/room/${encodeURIComponent(code)}/join`, {
      token: playerToken(), nick,
    });
    this.code = res.code;
    this.playerId = res.playerId;
    await this.#connect();
    return res.code;
  }

  // ── 소켓 ────────────────────────────────────────────────────────────

  #connect() {
    return new Promise((resolve, reject) => {
      const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${scheme}//${location.host}/api/room/${this.code}/ws?token=${encodeURIComponent(playerToken())}`;

      this.status = this.#retry > 0 ? 'reconnecting' : 'connecting';
      this.#emit();

      let settled = false;
      const ws = new WebSocket(url);
      this.#socket = ws;

      ws.addEventListener('open', () => {
        this.#retry = 0;
        this.status = 'open';
        this.error = null;
        this.#emit();
        if (!settled) { settled = true; resolve(); }
      });

      ws.addEventListener('message', (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }

        if (msg.type === 'hello') {
          this.playerId = msg.playerId;
        } else if (msg.type === 'sync') {
          this.room = msg.room;
          this.state = msg.state;
        } else if (msg.type === 'error') {
          this.error = msg.message;
        }
        this.#emit();
      });

      ws.addEventListener('close', () => {
        if (this.#closedByUs) return;
        this.#scheduleReconnect();
        if (!settled) { settled = true; reject(new Error('연결이 끊겼습니다')); }
      });

      ws.addEventListener('error', () => {
        if (!settled) { settled = true; reject(new Error('연결에 실패했습니다')); }
      });
    });
  }

  #scheduleReconnect() {
    if (this.#closedByUs) return;
    const delay = RECONNECT_DELAYS[Math.min(this.#retry, RECONNECT_DELAYS.length - 1)];
    this.#retry += 1;
    this.status = 'reconnecting';
    this.#emit();
    setTimeout(() => {
      if (this.#closedByUs) return;
      this.#connect().catch(() => { /* close 이벤트가 다시 예약한다 */ });
    }, delay);
  }

  #send(msg) {
    if (this.#socket?.readyState !== WebSocket.OPEN) {
      this.error = '연결이 끊겼습니다. 다시 연결하는 중입니다…';
      this.#emit();
      return;
    }
    this.#socket.send(JSON.stringify(msg));
  }

  // ── 조작 ────────────────────────────────────────────────────────────

  async dispatch(action) { this.#send({ type: 'action', action }); }
  async setReady(ready) { this.#send({ type: 'ready', ready }); }
  async startGame() { this.#send({ type: 'start' }); }
  async again() { this.#send({ type: 'again' }); }

  clearError() { this.error = null; this.#emit(); }

  close() {
    this.#closedByUs = true;
    try { this.#socket?.close(); } catch { /* 이미 닫힘 */ }
    this.#socket = null;
    this.status = 'closed';
    this.state = null;
    this.room = null;
    this.code = null;
    this.#emit();
  }
}
