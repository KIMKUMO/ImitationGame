/**
 * 배포 산출물 만들기 — dist/ 에 브라우저가 필요한 파일만 모은다.
 *   npm run build
 *
 * 번들러도 트랜스파일도 없다. 브라우저가 ESM 을 그대로 읽으므로 파일을 옮기기만 한다.
 * 저장소 루트를 그대로 올리지 않는 이유는 node_modules · .git · 테스트 스크립트까지
 * 딸려 올라가기 때문이다.
 */

import { cp, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = join(ROOT, 'dist');

/**
 * 브라우저가 실제로 요청하는 것들.
 * src/worker/ 는 서버(Durable Object)에서만 도므로 여기 넣지 않는다 —
 * wrangler 가 소스에서 직접 번들한다.
 */
const INCLUDE = [
  'index.html',
  'styles',
  'src/main.js',
  'src/ui',
  'src/engine/engine.js',
  'src/engine/bot.js',
  'src/net',
  'data/deck.js',
];

async function walk(dir, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

let files = 0;
let bytes = 0;

for (const item of INCLUDE) {
  const from = join(ROOT, item);
  const to = join(OUT, item);
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });

  const info = await stat(from);
  const list = info.isDirectory() ? await walk(from) : [from];
  for (const f of list) {
    files += 1;
    bytes += (await stat(f)).size;
  }
}

const all = await walk(OUT);
console.log(`dist/ — ${files}개 파일 · ${(bytes / 1024).toFixed(1)} KB`);
for (const f of all.sort()) console.log(`  ${relative(OUT, f)}`);
