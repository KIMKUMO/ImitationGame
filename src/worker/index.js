/**
 * Worker 진입점 — 방 API 와 WebSocket 중계, 나머지는 정적 자산
 *
 *   POST /api/room             방 만들기 → { code, playerId }
 *   POST /api/room/:code/join  코드로 입장 → { playerId }
 *   GET  /api/room/:code/ws    WebSocket 업그레이드 (게임 진행)
 *   그 외                      정적 자산 (env.ASSETS)
 *
 * 정적 자산 요청은 애초에 이 Worker 를 거치지 않는다 (run_worker_first 를 켜지 않는 한).
 * 여기로 오는 것은 자산에 없는 경로뿐이다.
 */

import { GameRoom } from './room.js';

export { GameRoom };

/** 헷갈리는 글자(0/O, 1/I)를 뺀 32자 — 사람이 불러 주기 쉬워야 한다 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
const CREATE_ATTEMPTS = 8;

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

/** 사람이 부른 코드를 관대하게 받아들인다 (소문자·공백·하이픈 허용) */
function normalizeCode(raw) {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

const ERROR_TEXT = {
  'not-found': '그런 방이 없습니다. 코드를 확인해 주세요.',
  full: '정원이 찼습니다.',
  'in-progress': '이미 게임이 시작된 방입니다.',
  taken: '방 코드를 만들지 못했습니다. 다시 시도해 주세요.',
};

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);

    // ── 방 만들기 ─────────────────────────────────────────────────────
    if (path === '/api/room' && request.method === 'POST') {
      const { token, nick } = await readJson(request);
      if (!token) return json({ error: 'token 이 필요합니다' }, 400);

      for (let i = 0; i < CREATE_ATTEMPTS; i += 1) {
        const code = randomCode();
        const result = await env.ROOM.getByName(code).createRoom({ code, token, nick });
        if (result.ok) return json({ code, playerId: result.playerId });
      }
      return json({ error: ERROR_TEXT.taken, code: 'taken' }, 503);
    }

    // ── 입장 ──────────────────────────────────────────────────────────
    const joinMatch = path.match(/^\/api\/room\/([^/]+)\/join$/);
    if (joinMatch && request.method === 'POST') {
      const code = normalizeCode(joinMatch[1]);
      if (code.length !== CODE_LENGTH) {
        return json({ error: ERROR_TEXT['not-found'], code: 'not-found' }, 404);
      }
      const { token, nick } = await readJson(request);
      if (!token) return json({ error: 'token 이 필요합니다' }, 400);

      const result = await env.ROOM.getByName(code).joinRoom({ token, nick });
      if (!result.ok) {
        const status = result.code === 'not-found' ? 404 : 409;
        return json({ error: ERROR_TEXT[result.code] ?? '입장할 수 없습니다', code: result.code }, status);
      }
      return json({ code, playerId: result.playerId, rejoined: Boolean(result.rejoined) });
    }

    // ── WebSocket ─────────────────────────────────────────────────────
    const wsMatch = path.match(/^\/api\/room\/([^/]+)\/ws$/);
    if (wsMatch) {
      const code = normalizeCode(wsMatch[1]);
      if (code.length !== CODE_LENGTH) return new Response('방 코드가 올바르지 않습니다', { status: 404 });
      return env.ROOM.getByName(code).fetch(request);
    }

    return json({ error: 'not found' }, 404);
  },
};
