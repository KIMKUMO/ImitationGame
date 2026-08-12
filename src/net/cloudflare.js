/**
 * CloudflareTransport — M2 에서 채울 자리 (아직 구현하지 않았다)
 *
 * M1 은 네트워크 없이 규칙을 검증하는 단계다. 온라인 대전은 M2 의 작업이고,
 * 여기 남긴 것은 「무엇을 어디에 쓰면 되는지」다.
 *
 * ─────────────────────────────────────────────────────────────────────
 * 왜 Durable Object 인가
 *
 * 방 하나 = DO 인스턴스 하나. DO 는 단일 스레드로 직렬화된 상태를 갖기 때문에
 * 턴제 게임의 동시성 문제가 애초에 생기지 않는다. 무엇보다
 * **순수 룰 엔진(src/engine/engine.js)을 DO 안에서 그대로 돌릴 수 있다.**
 *
 * 그 결과 GDD 6-6 이 M4 로 미뤄뒀던 「서버 권위 판정」을 처음부터 얻는다:
 *
 *   - 상대의 cardId 가 클라이언트로 내려가지 않는다. 애초에 보내지 않는다
 *   - 코인 없이 거짓말하는 클라이언트 변조가 불가능하다 (진실값을 서버가 계산)
 *   - 지목 판정 조작이 불가능하다
 *
 * ★ 단, D6 은 서버에서도 똑같이 지켜야 한다.
 *   코인을 쓴 답변의 진실값은 **계산하지도 저장하지도 않는다.**
 *   log 항목에 wasLie 를 추가하는 순간 D6 이 무너진다 — 엔진이 이미 그렇게
 *   만들어져 있으므로, DO 는 엔진의 apply() 를 그대로 부르기만 하면 된다.
 *
 * ─────────────────────────────────────────────────────────────────────
 * M2 체크리스트
 *
 * 1. wrangler.jsonc 에 main · durable_objects · migrations 추가 (파일 안 주석 참고)
 *
 * 2. src/worker/index.js — 라우팅
 *      POST /api/room            새 방 코드 발급 → DO id
 *      GET  /api/room/:code/ws   WebSocket 업그레이드 → DO 로 전달
 *      그 외                     env.ASSETS.fetch(request) 로 정적 자산에 위임
 *
 * 3. src/worker/room.js — GameRoom (DurableObject)
 *      - createGame() / apply() 를 그대로 사용한다 (엔진 재사용, 규칙 재구현 금지)
 *      - 카드 배분은 서버가 한다. Firebase 의 deck/taken 트릭이 필요 없다 —
 *        DO 가 단일 권위이므로 dealCards() 를 그냥 부르면 된다
 *      - 소켓마다 「그 플레이어에게 보여도 되는 상태」로 걸러서 보낸다:
 *
 *          function viewFor(state, playerId) {
 *            // 내 카드만 남기고 상대 cardId 는 지운다.
 *            // 종료(RESULT) 시에는 result.cards 로 양쪽이 함께 공개된다.
 *          }
 *
 *      - hibernation API(ctx.acceptWebSocket)를 쓰면 대기 중 과금이 없다
 *      - 상태는 ctx.storage 에 넣어 재접속/복구에 대비한다 (GDD 10장 5번)
 *
 * 4. 이 파일의 CloudflareTransport 를 LocalTransport 와 같은 인터페이스로 구현
 *      subscribe(fn) → 소켓 메시지를 그대로 상태로 흘려보낸다
 *      dispatch(action) → JSON 으로 소켓에 실어 보낸다. 판정은 서버가 한다
 *
 * 5. src/ui/app.js 의 전송 계층 생성부에서 온라인 모드 분기 연결
 *
 * ─────────────────────────────────────────────────────────────────────
 * 로컬에서 확인
 *   npx wrangler dev        DO 도 로컬 시뮬레이션으로 함께 돈다
 */

/** LocalTransport 와 동일한 인터페이스를 구현할 자리 */
export class CloudflareTransport {
  constructor(roomCode) {
    this.roomCode = roomCode;
    throw new Error('CloudflareTransport 는 아직 구현되지 않았다 (M2). LocalTransport 를 사용할 것.');
  }

  get isLocal() { return false; }

  // TODO(M2): /api/room/:code/ws 로 WebSocket 연결 → 메시지를 상태로 emit
  subscribe(/* fn */) { throw new Error('not implemented (M2)'); }

  // TODO(M2): 방 생성 또는 입장 후 소켓 연결
  async start(/* opts */) { throw new Error('not implemented (M2)'); }

  // TODO(M2): 액션을 소켓으로 보낸다. 상태는 서버가 계산해 되돌려 준다
  async dispatch(/* action */) { throw new Error('not implemented (M2)'); }
}
