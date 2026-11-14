/**
 * 隔离临时局域网配对 & 「回被窝接力」微服务器
 *
 * 绝对安全边界（Strict Isolation）：
 *   1. 主业务服务 server/index.js 保持 100% 绑定 127.0.0.1 不变；
 *   2. 本微服务器默认不启动，仅用户主动点击时临时创建独立 http.Server（120 秒硬编码 TTL 自动销毁）；
 *   3. 严格白名单：只挂载 GET /pair/info、POST /pair/sync、GET /pair/handoff 三个路由，
 *      其余任何路径（尤其 /api/proxy 等代理端点）全部返回 404，绝不充当局域网代理！
 */

import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';
import { buildSyncBundle, mergeSyncBundles } from '../src/core/sync-bundle.js';

export const PAIR_TTL_MS = 120_000;
export const PAIR_MAX_BODY_BYTES = 256 * 1024;
const MAX_PIN_ATTEMPTS = 5;

function safeEqualText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * 探测本机最合适的局域网 IPv4（未联网时回退 127.0.0.1）
 */
export function detectLanIp() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const entries of Object.values(ifaces)) {
    for (const info of entries || []) {
      if (!info || info.family !== 'IPv4' || info.internal) continue;
      candidates.push(info.address);
    }
  }
  const preferred =
    candidates.find(ip => ip.startsWith('192.168.')) ||
    candidates.find(ip => ip.startsWith('10.')) ||
    candidates.find(ip => /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) ||
    candidates[0];
  return preferred || '127.0.0.1';
}

/**
 * 脱敏桌面端线路：绝不下发 127.0.0.1/api/proxy 地址给手机，标注 proxyRequired 让手机端自动直连重抓
 */
export function sanitizeHandoffLines(rawLines = []) {
  if (!Array.isArray(rawLines)) return [];
  const out = [];
  for (const line of rawLines) {
    if (!line || !line.url) continue;
    const rawUrl = String(line.url);
    const label = String(line.label || line.name || '线路');
    const id = line.id ? String(line.id) : label;
    if (rawUrl.includes('/api/proxy') || rawUrl.includes('127.0.0.1')) {
      let originUrl = rawUrl;
      try {
        const parsed = new URL(rawUrl, 'http://127.0.0.1');
        originUrl = parsed.searchParams.get('url') || rawUrl;
      } catch {
        originUrl = rawUrl;
      }
      out.push({
        id,
        label,
        url: originUrl.startsWith('http') ? originUrl : null,
        proxyRequired: true
      });
    } else {
      out.push({
        id,
        label,
        url: rawUrl,
        proxyRequired: Boolean(line.proxyRequired)
      });
    }
  }
  return out;
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Pair-Pin, X-Pair-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = PAIR_MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', err => reject(err));
  });
}

/**
 * 创建隔离配对微服务器管理器
 */
export function createLanPairManager() {
  let active = null;

  async function stopSession() {
    if (!active) return;
    const current = active;
    active = null;
    if (current.timer) clearTimeout(current.timer);
    await new Promise(resolve => {
      try {
        current.server.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }

  function getStatus() {
    if (!active) return { active: false };
    const now = Date.now();
    if (now >= active.expiresAt) return { active: false };
    return {
      active: true,
      mode: active.mode,
      host: active.displayHost,
      port: active.port,
      pin: active.pin,
      token: active.token,
      pairUri: active.pairUri,
      expiresAt: active.expiresAt,
      ttlRemainingMs: Math.max(0, active.expiresAt - now),
      handoffMatchId: active.handoff?.matchId || null
    };
  }

  async function startSession({
    bindHost = '0.0.0.0',
    displayHost = null,
    port = 0,
    ttlMs = PAIR_TTL_MS,
    mode = 'sync',
    getLocalBundle = () => buildSyncBundle({}),
    onMergedBundle = null,
    handoff = null
  } = {}) {
    await stopSession();

    const resolvedDisplayHost = displayHost || (bindHost !== '0.0.0.0' ? bindHost : detectLanIp());
    const token = crypto.randomBytes(12).toString('hex');
    const pin = String(crypto.randomInt(100000, 1000000));
    const effectiveTtl = Number.isFinite(ttlMs) && ttlMs > 0 ? Math.min(ttlMs, PAIR_TTL_MS) : PAIR_TTL_MS;
    const cleanHandoff = handoff
      ? {
          matchId: String(handoff.matchId || ''),
          title: String(handoff.title || ''),
          lines: sanitizeHandoffLines(handoff.lines || [])
        }
      : null;

    let failedPinAttempts = 0;

    const verifyAuth = (searchParams, req) => {
      const qToken = searchParams.get('token') || req.headers['x-pair-token'] || '';
      const qPin = searchParams.get('pin') || req.headers['x-pair-pin'] || '';

      if (qToken && qPin) {
        return safeEqualText(String(qToken), token) && safeEqualText(String(qPin), pin);
      }
      if (qToken) {
        return safeEqualText(String(qToken), token);
      }
      if (qPin) {
        if (safeEqualText(String(qPin), pin)) return true;
        failedPinAttempts += 1;
        if (failedPinAttempts >= MAX_PIN_ATTEMPTS) {
          void stopSession();
        }
        return false;
      }
      return false;
    };

    const server = http.createServer(async (req, res) => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, X-Pair-Pin, X-Pair-Token',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
        });
        res.end();
        return;
      }

      const urlObj = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = urlObj.pathname;

      // 严格路由白名单：除 3 个 /pair/* 路由外全部 404
      if (
        pathname !== '/pair/info' &&
        pathname !== '/pair/sync' &&
        pathname !== '/pair/handoff'
      ) {
        sendJson(res, 404, { ok: false, error: 'Not Found' });
        return;
      }

      if (!active || Date.now() >= active.expiresAt) {
        await stopSession();
        sendJson(res, 410, { ok: false, error: '配对会话已过期，请在桌面端重新生成' });
        return;
      }

      if (!verifyAuth(urlObj.searchParams, req)) {
        sendJson(res, 401, { ok: false, error: '配对口令或 Token 无效' });
        return;
      }

      if (pathname === '/pair/info' && req.method === 'GET') {
        const local = buildSyncBundle(await getLocalBundle());
        sendJson(res, 200, {
          ok: true,
          mode: active.mode,
          expiresAt: active.expiresAt,
          ttlRemainingMs: Math.max(0, active.expiresAt - Date.now()),
          summary: {
            followedTeams: local.prefs.followedTeams.length,
            watchLaterCount: local.watchLater.length,
            revealedCount: local.revealedIds.length,
            diaryCount: Object.keys(local.diary.entries).length
          },
          hasHandoff: Boolean(cleanHandoff?.matchId)
        });
        return;
      }

      if (pathname === '/pair/handoff' && req.method === 'GET') {
        if (!cleanHandoff || !cleanHandoff.matchId) {
          sendJson(res, 404, { ok: false, error: '当前桌面端未发起接力播控' });
          return;
        }
        sendJson(res, 200, { ok: true, handoff: cleanHandoff });
        return;
      }

      if (pathname === '/pair/sync' && req.method === 'POST') {
        try {
          const remoteBody = await readJsonBody(req, PAIR_MAX_BODY_BYTES);
          const localBundle = buildSyncBundle(await getLocalBundle());
          const merged = mergeSyncBundles(localBundle, remoteBody, Date.now());
          if (typeof onMergedBundle === 'function') {
            await onMergedBundle(merged);
          }
          sendJson(res, 200, { ok: true, merged });
        } catch (err) {
          sendJson(res, err?.status || 400, {
            ok: false,
            error: String(err?.message || '同步数据包无效')
          });
        }
        return;
      }

      sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, bindHost, () => resolve());
    });

    const addr = server.address();
    const listeningPort = typeof addr === 'object' && addr ? addr.port : port;
    const pairUri = `nightowl://pair?host=${encodeURIComponent(resolvedDisplayHost)}&port=${listeningPort}&token=${token}&mode=${mode === 'handoff' ? 'handoff' : 'sync'}`;
    const expiresAt = Date.now() + effectiveTtl;

    const timer = setTimeout(() => {
      void stopSession();
    }, effectiveTtl);
    if (typeof timer.unref === 'function') timer.unref();

    active = {
      server,
      timer,
      mode: mode === 'handoff' ? 'handoff' : 'sync',
      displayHost: resolvedDisplayHost,
      port: listeningPort,
      token,
      pin,
      pairUri,
      expiresAt,
      handoff: cleanHandoff
    };

    return getStatus();
  }

  return {
    startSession,
    stopSession,
    getStatus
  };
}
