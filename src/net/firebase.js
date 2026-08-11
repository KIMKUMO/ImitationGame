/**
 * FirebaseTransport — M2 에서 채울 자리 (아직 연결하지 않았다)
 *
 * 이 파일은 **의도적으로 미구현**이다. M1 은 네트워크 없이 규칙을 검증하는 단계이고,
 * Firebase 연동은 M2 의 작업이다. 여기에 남긴 것은 「무엇을 어디에 쓰면 되는지」다.
 *
 * ─────────────────────────────────────────────────────────────────────
 * M2 체크리스트
 *
 * 1. Firebase 프로젝트 생성 → 웹 앱 등록 → 익명 인증(Anonymous) 활성화
 * 2. Realtime Database 생성 (Firestore 아님 — GDD 6-6 의 `deck/taken` 트릭이
 *    RTDB 의 `!data.exists()` 규칙에 의존한다)
 * 3. firebase/database.rules.json 을 그대로 배포
 *      firebase deploy --only database
 * 4. 아래 CONFIG 를 실제 값으로 채우고 loadFirebase() 의 import 주석을 해제
 * 5. FirebaseTransport 의 메서드 구현 (아래 각 TODO)
 * 6. src/ui/app.js 의 createTransport() 에서 mode==='online' 분기를 연결
 *
 * ─────────────────────────────────────────────────────────────────────
 * 스키마 (GDD 6-5) — 엔진 상태와의 대응
 *
 *   rooms/{roomId}/meta            status · hostUid · maxPlayers · deckId · rulesetVersion
 *   rooms/{roomId}/turn            order[] · currentIndex · phase · turnNumber · counterAttack
 *   rooms/{roomId}/players/{uid}   nick · seat · connected · ready · coinsLeft ·
 *                                  revealedSlots · accuseFails      ← 전부 공개 정보
 *   rooms/{roomId}/secret/{uid}    cardId                            ← 본인만 read
 *   rooms/{roomId}/deck/taken/{cardId}                               ← read 차단
 *   rooms/{roomId}/log/{seq}       askerUid · targetUid · question · answer ·
 *                                  usedCoin · line · at
 *   rooms/{roomId}/events/{seq}    type · actorUid · payload
 *   rooms/{roomId}/result          winner · cards
 *
 * ★ 지켜야 할 비밀은 secret/{uid}/cardId 하나뿐이다 (GDD 6-6).
 *   코인을 쓴 답변의 진실 여부는 엔진이 계산조차 하지 않으므로 유출될 데이터가 없다.
 *   log 항목에 wasLie 를 절대 추가하지 말 것 — 추가하는 순간 D6 이 무너진다.
 *
 * ★ 카드 배분은 호스트가 섞지 않는다. 각 클라이언트가 직접 뽑는다:
 *     1) c01~c15 중 무작위로 하나 고른다
 *     2) deck/taken/{cardId} = true 쓰기를 시도한다
 *     3) 규칙 `!data.exists()` 때문에 이미 가져간 카드면 거부된다 → 다른 카드로 재시도
 *     4) 성공하면 secret/{uid}/cardId 에 기록
 *   deck/taken 은 .read:false 이므로 남은 카드 목록을 아무도 조회할 수 없다.
 */

export const FIREBASE_CONFIG = {
  // TODO(M2): 콘솔에서 복사한 값으로 교체
  apiKey: '',
  authDomain: '',
  databaseURL: '',
  projectId: '',
  appId: '',
};

export const isFirebaseConfigured = () => Boolean(FIREBASE_CONFIG.databaseURL);

/** LocalTransport 와 동일한 인터페이스를 구현할 자리 */
export class FirebaseTransport {
  constructor(roomId) {
    this.roomId = roomId;
    throw new Error('FirebaseTransport 는 아직 구현되지 않았다 (M2). LocalTransport 를 사용할 것.');
  }

  get isLocal() { return false; }

  // TODO(M2): rooms/{roomId} 구독 → 스냅샷을 엔진 상태 모양으로 조립해 emit
  subscribe(/* fn */) { throw new Error('not implemented (M2)'); }

  // TODO(M2): 방 생성 + deck/taken 으로 자기 카드 뽑기 + players/{uid} 등록
  async start(/* opts */) { throw new Error('not implemented (M2)'); }

  /**
   * TODO(M2): 액션을 경로별 write 로 번역한다.
   *
   *   ASK           → turn.phase='ANSWER_PENDING', turn.pending 갱신
   *   ANSWER        → log/{seq} push (+ players/{uid}/coinsLeft 감소)
   *                   ★ usedCoin=true 인 경우 진실값을 계산하지도, 쓰지도 않는다
   *   ACCUSE        → events/{seq} push, 판정 결과로 turn/result 갱신
   *   REVEAL_TOKENS → players/{uid}/revealedSlots 갱신
   *
   * MVP 는 클라이언트 판정이다. 답변자 클라이언트가 자기 카드로 진실값을 계산해
   * 답만 기록한다 — 상대 카드는 절대 클라이언트로 내려가지 않는다.
   * 랭킹·매칭을 붙이는 시점에 Cloud Functions 3종
   * (dealCards / submitAnswer / accuse) 으로 권위 판정으로 승격한다 (GDD 6-6).
   */
  async dispatch(/* action */) { throw new Error('not implemented (M2)'); }
}
