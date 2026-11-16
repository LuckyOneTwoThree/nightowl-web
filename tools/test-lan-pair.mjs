import assert from 'node:assert/strict';
import net from 'node:net';
import { createLanPairManager, listLanCandidates, sanitizeHandoffLines } from '../server/lan-pair.js';
import { buildSyncBundle } from '../src/core/sync-bundle.js';
import { generateQrMatrix } from '../src/lib/qr-svg.js';

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
}

await check('isolated LAN pair server rejects /api/proxy with 404 and validates PIN/Token + sync/handoff', async () => {
  const now = Date.now();
  let stored = buildSyncBundle({
    prefsUpdatedAt: 100,
    prefs: { followedTeams: ['ARS'], spoilerFree: true },
    revealedIds: ['m1'],
    watchLater: [{ id: 'm1', night: '2026-11-15', addedAt: now - 5000, status: 'pending' }]
  });

  const mgr = createLanPairManager();
  const status = await mgr.startSession({
    bindHost: '127.0.0.1',
    displayHost: '127.0.0.1',
    port: 0,
    ttlMs: 30_000,
    mode: 'handoff',
    getLocalBundle: () => stored,
    onMergedBundle: merged => {
      stored = merged;
    },
    handoff: {
      matchId: 'm-live',
      title: '阿森纳 vs 曼城',
      lines: [
        { id: 'l1', label: '桌面代理源', url: 'http://127.0.0.1:3100/api/proxy?url=https%3A%2F%2Fcdn.example.com%2Fa.m3u8' },
        { id: 'l2', label: '直连源', url: 'https://public.example.com/live.m3u8' }
      ]
    }
  });

  const base = `http://127.0.0.1:${status.port}`;

  // 1. Security: /api/proxy MUST NOT EXIST on LAN pair port
  const proxyProbe = await fetch(`${base}/api/proxy?url=http://127.0.0.1:22`);
  assert.equal(proxyProbe.status, 404);

  // 2. Unauthorized without token/pin -> 401 and no wildcard CORS header
  const unauth = await fetch(`${base}/pair/info`);
  assert.equal(unauth.status, 401);
  assert.equal(unauth.headers.get('access-control-allow-origin'), null);

  // 3. Valid token -> 200 /pair/info
  const infoRes = await fetch(`${base}/pair/info?token=${status.token}`);
  assert.equal(infoRes.status, 200);
  const info = await infoRes.json();
  assert.equal(info.ok, true);
  assert.equal(info.hasHandoff, true);

  // 4. Handoff sanitizes /api/proxy into proxyRequired: true without 127.0.0.1 leak and preserves isDirect/name/kind
  const handoffRes = await fetch(`${base}/pair/handoff?pin=${status.pin}`);
  assert.equal(handoffRes.status, 200);
  const handoffData = await handoffRes.json();
  assert.equal(handoffData.handoff.lines[0].proxyRequired, true);
  assert.equal(handoffData.handoff.lines[0].isDirect, false);
  assert.equal(handoffData.handoff.lines[0].url.includes('127.0.0.1/api/proxy'), false);
  assert.equal(handoffData.handoff.lines[1].proxyRequired, false);
  assert.equal(handoffData.handoff.lines[1].isDirect, true);
  assert.equal(handoffData.handoff.lines[1].name, '直连源');
  assert.equal(handoffData.handoff.lines[1].kind, 'm3u8');

  // 5. Bidirectional sync merges phone watched status & new revealedIds
  const phoneBundle = buildSyncBundle({
    prefsUpdatedAt: 200,
    prefs: { followedTeams: ['ARS', 'LIV'], spoilerFree: true },
    revealedIds: ['m2'],
    watchLater: [{ id: 'm1', night: '2026-11-15', addedAt: now - 5000, status: 'watched', watchedAt: now - 100 }]
  });
  const syncRes = await fetch(`${base}/pair/sync?token=${status.token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(phoneBundle)
  });
  assert.equal(syncRes.status, 200);
  const syncData = await syncRes.json();
  assert.equal(syncData.merged.watchLater[0].status, 'watched');
  assert.deepEqual(syncData.merged.revealedIds.sort(), ['m1', 'm2']);
  assert.deepEqual(stored.prefs.followedTeams, ['ARS', 'LIV']);

  await mgr.stopSession();
  assert.equal(mgr.getStatus().active, false);
});

await check('LAN pair auto-closes on TTL expiry and sanitizeHandoffLines handles proxy URLs', async () => {
  const mgr = createLanPairManager();
  const s = await mgr.startSession({ bindHost: '127.0.0.1', port: 0, ttlMs: 120 });
  assert.equal(s.active, true);
  await new Promise(r => setTimeout(r, 180));
  assert.equal(mgr.getStatus().active, false);

  const sanitized = sanitizeHandoffLines([
    { name: 'p', url: 'http://127.0.0.1:3100/api/proxy?url=https%3A%2F%2Fstream.test%2Fx.m3u8', isDirect: true },
    { name: 'd', url: 'https://cdn.test/live.m3u8', kind: 'm3u8', isDirect: true }
  ]);
  assert.equal(sanitized[0].url, 'https://stream.test/x.m3u8');
  assert.equal(sanitized[0].proxyRequired, true);
  assert.equal(sanitized[0].isDirect, false);
  assert.equal(sanitized[1].isDirect, true);
  assert.equal(sanitized[1].name, 'd');
  assert.equal(listLanCandidates().some(ip => ip.startsWith('169.254.')), false);
});

await check('generateQrMatrix produces valid ISO QR finder patterns for pairing URI', async () => {
  const qr = generateQrMatrix('nightowl://pair?host=192.168.1.42&port=51234&token=abcdef0123456789abcdef01&mode=sync');
  assert.ok(qr.size >= 33);
  assert.equal(qr.modules.length, qr.size);
  // Top-left 7x7 finder outer border must be 1 and dark module (n-8, 8) = 1
  assert.equal(qr.modules[0][0], 1);
  assert.equal(qr.modules[6][6], 1);
  assert.equal(qr.modules[1][1], 0);
  assert.equal(qr.modules[qr.size - 8][8], 1);
});

await check('qToken+qPin failures enforce PIN rate limit, concurrent /pair/sync does not lose updates, and slow POST does not hang stopSession', async () => {
  // 1. qToken+qPin 分支失败也计入 PIN 尝试次数上限
  const mgr1 = createLanPairManager();
  const s1 = await mgr1.startSession({ bindHost: '127.0.0.1', port: 0, ttlMs: 30_000 });
  const base1 = `http://127.0.0.1:${s1.port}`;
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`${base1}/pair/info?token=badtoken&pin=000000`);
    assert.equal(r.status, 401);
  }
  await new Promise(r => setTimeout(r, 30));
  assert.equal(mgr1.getStatus().active, false);

  // 2. 并发 /pair/sync 串行化不丢更新 + getLocalBundle 返回 null 不崩
  let current = buildSyncBundle({ prefsUpdatedAt: 100, revealedIds: ['init'] });
  const mgr2 = createLanPairManager();
  const s2 = await mgr2.startSession({
    bindHost: '127.0.0.1',
    port: 0,
    ttlMs: 30_000,
    getLocalBundle: () => current,
    onMergedBundle: async merged => {
      await new Promise(r => setTimeout(r, 20));
      current = merged;
    }
  });
  const base2 = `http://127.0.0.1:${s2.port}`;
  const [rA, rB] = await Promise.all([
    fetch(`${base2}/pair/sync?token=${s2.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildSyncBundle({ revealedIds: ['mA'] }))
    }),
    fetch(`${base2}/pair/sync?token=${s2.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildSyncBundle({ revealedIds: ['mB'] }))
    })
  ]);
  assert.equal(rA.status, 200);
  assert.equal(rB.status, 200);
  assert.deepEqual(current.revealedIds.sort(), ['init', 'mA', 'mB']);

  // 3. 慢 POST 连接不阻塞 stopSession
  await new Promise(resolve => {
    const sock = net.createConnection({ host: '127.0.0.1', port: s2.port }, () => {
      sock.write(`POST /pair/sync?token=${s2.token} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 100\r\n\r\n{"half":`);
      setTimeout(resolve, 30);
    });
    sock.on('error', () => resolve());
  });
  const t0 = Date.now();
  await mgr2.stopSession();
  assert.ok(Date.now() - t0 < 800);
  assert.equal(mgr2.getStatus().active, false);
});

console.log(`[test:lan-pair] ${passed} passed`);
