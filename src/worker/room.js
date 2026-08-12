/**
 * GameRoom — 방 하나 = Durable Object 인스턴스 하나
 *
 * DO 는 요청을 직렬화해 처리하므로 턴제 게임의 동시성 문제가 애초에 생기지 않는다.
 * 무엇보다 **룰 엔진(src/engine/engine.js)을 여기서 그대로 돌린다.** 규칙을 두 번 쓰지 않는다.
 *
 * ─────────────────────────────────────────────────────────────────────
 * 이 파일이 지키는 것 두 가지
 *
 * 1. 상대의 cardId 는 클라이언트로 내려가지 않는다 (viewFor).
 *    게임이 끝나야 result.cards 로 양쪽이 함께 공개된다.
 *
 * 2. 누가 무엇을 할 수 있는지 서버가 판정한다 (authorize).
 *    엔진의 apply() 는 「호출자가 올바른 플레이어」임을 전제하므로,
 *    그 전제를 여기서 강제하지 않으면 상대 대신 답변을 보내는 조작이 가능해진다.
 *
 * ★ D6 은 서버에서도 동일하다. 코인을 쓴 답변의 진실값은 계산하지도 저장하지도 않는다.
 *   엔진이 이미 그렇게 되어 있으므로 apply() 를 부르기만 하면 된다.
 */

import { DurableObject } from 'cloudflare:workers';
import {
  createGame, apply, dealCards, currentPlayerId, revealedTokensOf,
} from '../engine/engine.js';

export const MAX_PLAYERS = 2;

/** 답변 공개 후 턴이 넘어가기까지의 뜸. 알람으로 처리해 클라이언트에 의존하지 않는다 */
const REVEAL_MS = 1500;

/** 이 시간이 지난 방은 버려진 것으로 보고 코드를 재사용한다 */
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;

const NICK_MAX = 12;
const cleanNick = (n, fallback) => {
  const s = String(n ?? '').trim().slice(0, NICK_MAX);
  return s.length > 0 ? s : fallback;
};

export class GameRoom extends DurableObject {
  // ── 저장소 ──────────────────────────────────────────────────────────
  //   room : { code, createdAt, status, hostId, seq, players: {id: {...}} }
  //   game : 엔진 상태 또는 null
  //
  // players[id].token 은 **절대 밖으로 내보내지 않는다** (재접속 신원 확인용).

  async #room() { return (await this.ctx.storage.get('room')) ?? null; }
  async #game() { return (await this.ctx.storage.get('game')) ?? null; }

  // ── RPC — 방 만들기 / 입장 ──────────────────────────────────────────

  /**
   * 호스트가 방을 연다. 이미 쓰이고 있는 코드면 거절한다 (워커가 다른 코드로 재시도).
   */
  async createRoom({ code, token, nick }) {
    const existing = await this.#room();
    const stale = existing && Date.now() - existing.createdAt > ROOM_TTL_MS;
    if (existing && !stale) return { ok: false, code: 'taken' };

    const room = {
      code,
      createdAt: Date.now(),
      status: 'waiting',
      hostId: 'p1',
      seq: 0,
      players: {
        p1: { id: 'p1', nick: cleanNick(nick, 'KESTREL'), token, ready: false, connected: false },
      },
    };
    await this.ctx.storage.put('room', room);
    await this.ctx.storage.delete('game');
    return { ok: true, playerId: 'p1' };
  }

  /**
   * 게스트가 코드로 입장한다. 같은 token 이면 재접속으로 보고 원래 자리를 돌려준다.
   */
  async joinRoom({ token, nick }) {
    const room = await this.#room();
    if (!room) return { ok: false, code: 'not-found' };
    if (Date.now() - room.createdAt > ROOM_TTL_MS) return { ok: false, code: 'not-found' };

    const mine = Object.values(room.players).find((p) => p.token === token);
    if (mine) {
      // 재접속 — 닉네임만 갱신한다
      mine.nick = cleanNick(nick, mine.nick);
      await this.ctx.storage.put('room', room);
      return { ok: true, playerId: mine.id, rejoined: true };
    }

    if (Object.keys(room.players).length >= MAX_PLAYERS) return { ok: false, code: 'full' };
    if (room.status !== 'waiting') return { ok: false, code: 'in-progress' };

    const id = 'p2';
    room.players[id] = { id, nick: cleanNick(nick, 'MAGPIE'), token, ready: false, connected: false };
    await this.ctx.storage.put('room', room);
    return { ok: true, playerId: id };
  }

  // ── WebSocket ───────────────────────────────────────────────────────

  async fetch(request) {
    const url = new URL(request.url);
    const token = url.searchParams.get('token') ?? '';

    const room = await this.#room();
    const me = room && Object.values(room.players).find((p) => p.token === token);
    if (!me) return new Response('먼저 방에 입장해야 합니다', { status: 403 });

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('WebSocket 업그레이드가 필요합니다', { status: 426 });
    }

    const [client, server] = Object.values(new WebSocketPair());

    // 하이버네이션을 쓴다 — 대기 중에는 DO 가 메모리에서 내려가도 연결은 유지된다.
    // 깨어날 때 constructor 가 다시 돌므로, 소켓이 누구인지는 attachment 로 들고 간다.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId: me.id, token });

    me.connected = true;
    await this.ctx.storage.put('room', room);

    server.send(JSON.stringify({ type: 'hello', playerId: me.id }));
    await this.#broadcast();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    const att = ws.deserializeAttachment();
    const playerId = att?.playerId;
    if (!playerId) return;

    let msg;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return this.#fail(ws, 'bad-json', '메시지를 읽을 수 없습니다');
    }

    try {
      switch (msg.type) {
        case 'ready':   return await this.#onReady(playerId, msg.ready !== false);
        case 'start':   return await this.#onStart(ws, playerId);
        case 'action':  return await this.#onAction(ws, playerId, msg.action);
        case 'again':   return await this.#onAgain(ws, playerId);
        case 'ping':    return ws.send(JSON.stringify({ type: 'pong' }));
        default:        return this.#fail(ws, 'unknown', `알 수 없는 메시지: ${msg.type}`);
      }
    } catch (err) {
      // 규칙 위반이나 순서 위반은 여기로 떨어진다. 방 전체를 죽이지 않는다.
      return this.#fail(ws, 'rejected', err.message);
    }
  }

  async webSocketClose(ws) {
    const att = ws.deserializeAttachment();
    const room = await this.#room();
    if (!room || !att?.playerId) return;

    const me = room.players[att.playerId];
    if (me) {
      // 같은 플레이어의 다른 소켓이 아직 살아 있으면 접속 중으로 둔다 (탭 두 개 등)
      const others = this.ctx.getWebSockets().filter((s) => {
        if (s === ws) return false;
        return s.deserializeAttachment()?.playerId === att.playerId;
      });
      me.connected = others.length > 0;
      await this.ctx.storage.put('room', room);
    }
    await this.#broadcast();
  }

  // ── 알람 — 답변 공개 후 턴 넘기기 ───────────────────────────────────

  async alarm() {
    const game = await this.#game();
    if (!game || game.phase !== 'REVEAL') return;
    const next = apply(game, { type: 'CONTINUE' });
    await this.#saveGame(next);
    await this.#broadcast();
  }

  // ── 메시지 처리 ─────────────────────────────────────────────────────

  async #onReady(playerId, ready) {
    const room = await this.#room();
    if (!room || room.status !== 'waiting') return;
    room.players[playerId].ready = ready;
    await this.ctx.storage.put('room', room);
    await this.#broadcast();
  }

  async #onStart(ws, playerId) {
    const room = await this.#room();
    if (!room) return this.#fail(ws, 'no-room', '방이 없습니다');
    if (playerId !== room.hostId) return this.#fail(ws, 'not-host', '방장만 시작할 수 있습니다');
    if (room.status !== 'waiting') return this.#fail(ws, 'already', '이미 시작했습니다');

    const ids = Object.keys(room.players);
    if (ids.length < MAX_PLAYERS) return this.#fail(ws, 'not-enough', '두 명이 모여야 시작합니다');
    if (!ids.every((id) => room.players[id].ready)) {
      return this.#fail(ws, 'not-ready', '전원이 준비를 마쳐야 합니다');
    }

    await this.#deal(room);
  }

  async #onAgain(ws, playerId) {
    const room = await this.#room();
    const game = await this.#game();
    if (!room) return this.#fail(ws, 'no-room', '방이 없습니다');
    if (!game || game.phase !== 'RESULT') return this.#fail(ws, 'not-finished', '아직 끝나지 않았습니다');
    if (playerId !== room.hostId) return this.#fail(ws, 'not-host', '방장만 다시 시작할 수 있습니다');

    await this.#deal(room);
  }

  /** 카드를 새로 돌리고 게임을 시작한다 — 배분은 전적으로 서버가 한다 */
  async #deal(room) {
    const ids = Object.keys(room.players);
    // 선공은 무작위 (GDD 3-1)
    const order = Math.random() < 0.5 ? ids : [...ids].reverse();

    const game = createGame({
      players: order.map((id) => ({ id, nick: room.players[id].nick, kind: 'human' })),
      cards: dealCards(order),
      firstIndex: 0,
    });

    room.status = 'playing';
    room.seq = (room.seq ?? 0) + 1;   // 판이 바뀌면 클라이언트가 추리 노트를 새로 연다
    for (const id of ids) room.players[id].ready = false;

    await this.ctx.storage.put('room', room);
    await this.#saveGame(game);
    await this.#broadcast();
  }

  async #onAction(ws, playerId, action) {
    const game = await this.#game();
    if (!game) return this.#fail(ws, 'no-game', '게임이 시작되지 않았습니다');

    this.#authorize(game, playerId, action);

    const next = apply(game, action);
    await this.#saveGame(next);

    if (next.phase === 'RESULT') {
      const room = await this.#room();
      if (room) {
        room.status = 'finished';
        await this.ctx.storage.put('room', room);
      }
    }

    await this.#broadcast();
  }

  /**
   * 이 플레이어가 지금 이 액션을 할 자격이 있는가.
   *
   * 엔진은 「현재 턴 플레이어가 부른다」고 전제할 뿐 호출자를 확인하지 않는다.
   * 이 확인이 없으면 상대 대신 ANSWER 를 보내 진실을 흘리게 만드는 조작이 가능하다.
   */
  #authorize(game, playerId, action) {
    const type = action?.type;
    if (!type) throw new Error('액션이 비었습니다');

    // CONTINUE 는 서버(알람)만 보낸다
    if (type === 'CONTINUE') throw new Error('CONTINUE 는 서버가 처리합니다');

    if (type === 'ACK_CARD') {
      if (action.playerId !== playerId) throw new Error('남의 카드를 확인할 수 없습니다');
      return;
    }

    if (type === 'ANSWER') {
      if (game.phase !== 'ANSWER_PENDING') throw new Error('지금은 답변할 때가 아닙니다');
      if (game.pending?.targetId !== playerId) throw new Error('당신에게 온 질문이 아닙니다');
      return;
    }

    // 나머지는 전부 현재 턴 플레이어의 행동이다
    const expected = currentPlayerId(game);
    if (playerId !== expected) throw new Error('당신의 차례가 아닙니다');
  }

  // ── 상태 저장 · 전파 ────────────────────────────────────────────────

  async #saveGame(game) {
    await this.ctx.storage.put('game', game);
    // 답변이 공개되면 잠시 뒤 서버가 턴을 넘긴다.
    // 하이버네이션 중에도 깨어나도록 setTimeout 이 아니라 알람을 쓴다.
    if (game.phase === 'REVEAL') await this.ctx.storage.setAlarm(Date.now() + REVEAL_MS);
  }

  async #broadcast() {
    const room = await this.#room();
    if (!room) return;
    const game = await this.#game();
    const publicRoom = this.#publicRoom(room);

    for (const ws of this.ctx.getWebSockets()) {
      const id = ws.deserializeAttachment()?.playerId;
      if (!id) continue;
      try {
        ws.send(JSON.stringify({
          type: 'sync',
          room: publicRoom,
          state: game ? viewFor(game, id) : null,
        }));
      } catch {
        // 이미 끊긴 소켓 — 무시한다
      }
    }
  }

  /** token 을 뺀 방 정보 */
  #publicRoom(room) {
    return {
      code: room.code,
      status: room.status,
      hostId: room.hostId,
      seq: room.seq ?? 0,
      players: Object.values(room.players).map((p) => ({
        id: p.id, nick: p.nick, ready: p.ready, connected: p.connected,
      })),
    };
  }

  #fail(ws, code, message) {
    try {
      ws.send(JSON.stringify({ type: 'error', code, message }));
    } catch { /* 끊긴 소켓 */ }
  }
}

/**
 * 이 플레이어에게 보여도 되는 것만 남긴 게임 상태.
 *
 * ★ 상대의 cardId 를 지우는 것이 이 게임 보안의 전부다.
 *   게임이 끝나면 result.cards 로 양쪽이 함께 공개된다 (화면 10).
 */
export function viewFor(game, playerId) {
  const view = JSON.parse(JSON.stringify(game));

  for (const id of view.order) {
    if (id === playerId) continue;
    const p = view.players[id];
    // 지목 실패로 공개된 토큰은 사실이므로 미리 풀어서 넣어 준다.
    // cardId 를 지우면 클라이언트가 슬롯을 토큰으로 바꿀 수 없기 때문이다.
    p.revealedTokens = revealedTokensOf(game, id);
    p.cardId = null;
  }

  return view;
}
