/**
 * 전송 계층 — 엔진과 UI 사이의 유일한 접점
 *
 * UI 는 이 인터페이스만 알고, 엔진 상태가 어디서 오는지는 모른다.
 * M1 은 LocalTransport (브라우저 메모리) 하나로 돌아가고,
 * M2 에서 CloudflareTransport 를 같은 인터페이스로 끼워 넣으면 UI 는 그대로 둔다.
 *
 *   interface Transport {
 *     get state(): GameState | null
 *     subscribe(fn: (state) => void): () => void
 *     start(opts: { players, cards, firstIndex }): Promise<void>
 *     dispatch(action): Promise<void>
 *     get isLocal(): boolean
 *   }
 */

import { createGame, apply } from '../engine/engine.js';

export class LocalTransport {
  #state = null;
  #listeners = new Set();

  get isLocal() { return true; }

  get state() { return this.#state; }

  subscribe(fn) {
    this.#listeners.add(fn);
    if (this.#state) fn(this.#state);
    return () => this.#listeners.delete(fn);
  }

  async start({ players, cards, firstIndex = 0 }) {
    this.#state = createGame({ players, cards, firstIndex });
    this.#emit();
  }

  async dispatch(action) {
    if (!this.#state) throw new Error('게임이 시작되지 않았다');
    this.#state = apply(this.#state, action);
    this.#emit();
  }

  reset() {
    this.#state = null;
    this.#emit();
  }

  #emit() {
    for (const fn of this.#listeners) fn(this.#state);
  }
}
