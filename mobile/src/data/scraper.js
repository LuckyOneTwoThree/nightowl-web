/**
 * 赛事流自动抓取与对齐模块 (Live Stream Scraper & Matcher)
 *
 * 职责：
 * 1. 自动抓取并解析聚合站今日赛程与实时比赛房间；
 * 2. 队名与别名智能对齐（将本地球队代码如 LIV/MCI/MIL 匹配至聚合比赛）；
 * 3. 逆向调用直播信号接口，解密提取原始 .m3u8 直链与多线路；
 * 4. 融合央视 CCTV-5 / CCTV-5+ / 咪咕4K 广电与 OTT 体育直播源作为高可用保底。
 */

import teamsData from '../shared/data/teams.json';
import scraperAlias from '../shared/server/scraper-alias.json';

// 带签名的央视/咪咕保底源不入移动端：它们含会话/IP 信息且必然过期，
// 移动端用官方平台入口兜底。
export const TV_SPORTS_CHANNELS = [];

function loadTeamDictionary() {
  const map = new Map();
  for (const team of teamsData) {
    map.set(team.zh, team.id);
    map.set(team.en, team.id);
    map.set(team.id, team.id);
  }
  for (const [name, id] of Object.entries(scraperAlias.map || {})) {
    map.set(name, id);
  }
  return map;
}

const TEAM_MAP = loadTeamDictionary();

/** 内存缓存 */
const cache = {
  schedule: { time: 0, data: [] },
  sources: new Map()
};

const SCHEDULE_TTL_MS = 60 * 1000;
const SOURCE_TTL_MS = 90 * 1000;

/** 线路缓存条目上限：按 gameId 累积，长时间运行必须封顶（简单 FIFO 淘汰） */
const MAX_SOURCE_CACHE = 200;

const MIRROR_BASES = [
  "https://www.88kanqiu.net",
  "https://www.88kanqiu.com",
  "https://www.88kanqiu.cc",
  "https://www.88kanqiu.one"
];
let activeMirror = MIRROR_BASES[0];
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeBase64Utf8(input) {
  if (typeof globalThis.atob === 'function') {
    const binary = globalThis.atob(input);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
    try { return decodeURIComponent(escape(binary)); } catch { return binary; }
  }
  const clean = String(input).replace(/[^A-Za-z0-9+/=]/g, '');
  const bytes = [];
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]) << 18) |
      (B64.indexOf(clean[i + 1]) << 12) |
      ((B64.indexOf(clean[i + 2]) & 63) << 6) |
      (B64.indexOf(clean[i + 3]) & 63);
    bytes.push((n >> 16) & 255);
    if (clean[i + 2] !== '=' && i + 2 < clean.length) bytes.push((n >> 8) & 255);
    if (clean[i + 3] !== '=' && i + 3 < clean.length) bytes.push(n & 255);
  }
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b0 = bytes[i++];
    if (b0 < 0x80) out += String.fromCharCode(b0);
    else if (b0 < 0xe0) {
      const b1 = bytes[i++];
      out += String.fromCharCode(((b0 & 0x1f) << 6) | (b1 & 0x3f));
    } else if (b0 < 0xf0) {
      const b1 = bytes[i++], b2 = bytes[i++];
      out += String.fromCharCode(((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f));
    } else {
      const b1 = bytes[i++], b2 = bytes[i++], b3 = bytes[i++];
      const cp = ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
      out += String.fromCodePoint(cp);
    }
  }
  return out;
}

/** 抓取聚合站全量赛程与房间列表（带多镜像自动容灾） */
export async function fetchSchedule(force = false) {
  const now = Date.now();
  if (!force && cache.schedule.time && now - cache.schedule.time < SCHEDULE_TTL_MS) {
    return cache.schedule.data;
  }

  let html = null;
  let lastErr = null;

  for (const base of MIRROR_BASES) {
    try {
      const res = await fetchWithTimeout(base, { headers: { "User-Agent": USER_AGENT } }, 6000);
      if (res.ok) {
        html = await res.text();
        activeMirror = base;
        break;
      }
    } catch (e) {
      lastErr = e;
    }
  }

  if (!html) {
    throw new Error(`获取赛程失败，全部镜像均不可达: ${lastErr?.message || '未知错误'}`);
  }

  const games = parseScheduleHtml(html, activeMirror);

  /**
   * 结构性探活（P3）
   *
   * 聚合站改版（改一个 CSS 类名）时，三个正则会同时失效，解析出 0 条。
   * 此前 0 条与「今天确实没比赛」走同一条路径：返回空数组，上层静默降级成
   * 「本场暂无直播线路」—— 用户分不清是没匹配还是抓取挂了，而抓取其实早坏了。
   *
   * 判据：页面足够长（>2000 字符 = 真实首页），且存在**多个** /live/N/play 链接
   * （≥3 个），却一条都没解析出来 → 判定解析失败。
   *
   * 为什么要求「多个」而非「存在」：真正的无比赛日首页也可能在页脚放一两个
   * 回放/推荐链接，单个链接不足以区分「改版」与「今天没比赛」；
   * 而改版时整页几十个比赛链接全都失去 group-game-item 外壳，数量上远超阈值。
   */
  if (games.length === 0 && html.length > 2000) {
    const liveLinks = html.match(/\/live\/\d+\/play/gi) || [];
    if (liveLinks.length >= 3) {
      throw new Error(
        `页面结构已变化：HTML 含 ${html.length} 字符、${liveLinks.length} 个直播链接，但正则未匹配到任何场次（疑似站点改版）`
      );
    }
  }

  cache.schedule = { time: now, data: games };
  return games;
}

/**
 * 从聚合站首页 HTML 解析赛程（导出供离线回归测试直接调用）
 *
 * ⚠️ 测试必须调用本函数，不能自己重写一遍解析逻辑 ——
 *    此前 check-scraper.mjs 复制了一份匹配规则，结构上不可能发现解析本身的缺陷。
 */
export function parseScheduleHtml(html, baseUrl = "") {
  const items = [...String(html || "").matchAll(/class="[^"]*group-game-item[^"]*"[\s\S]*?href=['"](\/live\/(\d+)\/play)['"][^>]*>([\s\S]*?)<\/a>/gi)];

  const games = [];
  for (const item of items) {
    const playUrl = item[1];
    const gameId = item[2];
    const statusText = item[3].replace(/<[^>]+>/g, "").trim();
    const snippet = item[0];

    const teamMatches = [...snippet.matchAll(/class="team-name"[^>]*>([^<]+)/g)].map(t => t[1].trim());
    if (teamMatches.length >= 2) {
      const homeRaw = teamMatches[0];
      const awayRaw = teamMatches[1];
      const homeId = TEAM_MAP.get(homeRaw);
      const awayId = TEAM_MAP.get(awayRaw);

      const timeMatch = snippet.match(/class="[^"]*category-game-time[^"]*"[^>]*>([^<]+)/);
      const timeStr = timeMatch ? timeMatch[1].trim() : "";

      games.push({
        gameId,
        playUrl: (baseUrl || activeMirror) + playUrl,
        homeRaw,
        awayRaw,
        homeId: homeId || null,
        awayId: awayId || null,
        time: timeStr,
        statusText,
        isLive: statusText.includes("直播中") || statusText.includes("进行中"),
        isUpcoming: statusText.includes("未开始") || statusText.includes("预约")
      });
    }
  }

  return games;
}

/** 逆向解密 88看球/JRS 房间接口提取原始线路 */
export async function fetchGameSources(gameId, force = false) {
  const now = Date.now();
  const cached = cache.sources.get(gameId);
  if (!force && cached && now - cached.time < SOURCE_TTL_MS) {
    return cached.data;
  }

  let json = null;
  let lastErr = null;

  for (const base of [activeMirror, ...MIRROR_BASES.filter(b => b !== activeMirror)]) {
    try {
      const sourceApiUrl = base + "/live/" + gameId + "/source?share_id=" + gameId;
      const res = await fetchWithTimeout(sourceApiUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          "Referer": base + "/live/" + gameId + "/play"
        }
      }, 6000);
      if (res.ok) {
        json = await res.json();
        break;
      }
    } catch (e) {
      lastErr = e;
    }
  }

  if (!json) {
    throw new Error("获取房间线路失败: " + (lastErr?.message || '未知错误'));
  }

  if (!json?.data || typeof json.data !== "string") {
    return [];
  }

  let decodedJson;
  try {
    const rawData = json.data;
    const base64Payload = rawData.slice(6, -2);
    const decodedStr = decodeBase64Utf8(base64Payload);
    decodedJson = JSON.parse(decodedStr);
  } catch (err) {
    console.warn("[scraper] 解密房间 " + gameId + " 载荷失败:", err.message);
    return [];
  }

  const links = decodedJson.links || [];
  const lines = [];

  for (let i = 0; i < links.length; i++) {
    const item = links[i];
    let streamUrl = item.url;
    let name = item.name || ("线路 " + (i + 1));
    let isDirect = false;
    let kind = "other";

    if (streamUrl.includes("play.88player.top/m3u8.html?url=")) {
      const u = streamUrl.split("url=")[1];
      if (u) {
        streamUrl = decodeURIComponent(u);
        isDirect = true;
        kind = "m3u8";
      }
    } else if (streamUrl.endsWith(".m3u8") || streamUrl.includes(".m3u8?")) {
      isDirect = true;
      kind = "m3u8";
    } else if (streamUrl.includes("embed.st") || streamUrl.includes("sportsteam368.com")) {
      kind = "embed";
    }

    let label = name;
    if (/migu/i.test(name)) {
      label = "原画 · 咪咕源";
    } else if (/中文|高清|国内/i.test(name) || /线路[A-Z0-9]+/i.test(name)) {
      label = "超清 · 中文解说 (" + name.replace("线路", "线") + ")";
    } else if (/English|Sky|TNT|DAZN|Paramount/i.test(name)) {
      const src = name.match(/\((.*?)\)/)?.[1] || name.split("-")[1] || "原声";
      label = "英文原声 (" + src.trim() + ")";
    }

    lines.push({
      id: "live-" + gameId + "-" + i,
      name: label,
      rawName: name,
      url: streamUrl,
      kind,
      isDirect
    });
  }

  cache.sources.set(gameId, { time: now, data: lines });
  // FIFO 淘汰：Map 保持插入顺序，超限时删最旧的一条
  if (cache.sources.size > MAX_SOURCE_CACHE) {
    const oldest = cache.sources.keys().next().value;
    if (oldest !== undefined) cache.sources.delete(oldest);
  }
  return lines;
}

/**
 * 保底源健康探测
 *
 * 为什么需要：TV_SPORTS_CHANNELS 是带签名的 URL。实测服务端**强校验** timestamp 与 encrypt
 * （改 timestamp → 605，去掉 encrypt → 403），因此必然在某个时刻整体失效。
 * 失效后如果照旧返回，用户点下去就是一片黑 —— 属于「静默失败」。
 * 这里做带 TTL 的探测：失效的源不进入线路列表，并在响应里回报，由界面明确提示。
 */
const channelProbe = { time: 0, results: new Map() };
const CHANNEL_PROBE_TTL_MS = 10 * 60 * 1000;

export async function probeChannels(force = false) {
  const now = Date.now();
  if (!force && channelProbe.time && now - channelProbe.time < CHANNEL_PROBE_TTL_MS) {
    return channelProbe.results;
  }

  const results = new Map();
  await Promise.all(
    TV_SPORTS_CHANNELS.map(async ch => {
      let ok = false;
      try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 6000);
        const r = await fetch(ch.url, { signal: ac.signal });
        clearTimeout(timer);
        ok = r.ok;
      } catch {
        ok = false;
      }
      results.set(ch.id, ok);
    })
  );

  channelProbe.time = now;
  channelProbe.results = results;

  const dead = TV_SPORTS_CHANNELS.filter(c => results.get(c.id) === false).map(c => c.tag);
  if (dead.length) {
    console.warn(
      `[scraper] 保底频道已失效（签名过期），请更新 server/tv-channels.local.json：${dead.join('、')}`
    );
  }
  return results;
}

/** "HH:mm" → 当日分钟数；无法解析返回 NaN */
function minutesOf(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * 为本场比赛在聚合站赛程中找出对应房间
 *
 * 两条纪律：
 *   ① **只做双方全等匹配，禁止单队兜底。** 单队兜底实测 329/329 全部误配
 *      （本地「曼联 vs 萨巴赫」→ 播「曼联 vs 曼城」）。静默错配比匹配不到危险得多。
 *   ② **多候选时必须按开球时刻做邻近度排序。** 聚合站同一对阵可能同时存在多个房间
 *      （实测当日 48 条匹配里就有 2 组重复对阵，如「科莫 vs 帕尔马」同时挂着 21:00 与 00:30
 *      两个房间）。原先直接用 find 取第一条，一周双赛 / 杯赛场景会静默播错场 ——
 *      而且界面显示的队名与用户要的一模一样，肉眼看不出来。
 *
 * 导出本函数是为了让 tools/check-scraper.mjs 能直接测**真实逻辑**；
 * 此前测试自己重写了一遍同样的匹配，结构上不可能发现这里的缺陷。
 *
 * @param {Array} schedule fetchSchedule() 的结果
 * @param {{h:string, a:string, t?:string}} match h/a 为球队 id，t 为本场北京墙钟时间
 */
export function findRoomFor(schedule, { h, a, t }) {
  const cands = (schedule || []).filter(
    g =>
      g.homeId &&
      g.awayId &&
      ((g.homeId === h && g.awayId === a) || (g.homeId === a && g.awayId === h))
  );

  if (!cands.length) return { room: null, candidates: 0, ambiguous: false, pickedBy: 'none' };
  if (cands.length === 1) return { room: cands[0], candidates: 1, ambiguous: false, pickedBy: 'only' };

  const targetMin = minutesOf(t ? String(t).split('T')[1] : '');
  if (Number.isNaN(targetMin)) {
    // 拿不到本场时刻就没法排序 —— 保持旧行为但显式标记，交由上层决定是否提示
    return { room: cands[0], candidates: cands.length, ambiguous: true, pickedBy: 'first' };
  }

  const scored = cands
    .map(room => {
      const rm = minutesOf(room.time);
      const diff = Number.isNaN(rm)
        ? Infinity
        : Math.min(Math.abs(rm - targetMin), 1440 - Math.abs(rm - targetMin)); // 跨零点环绕
      return { room, diff };
    })
    .sort((x, y) => x.diff - y.diff);

  return {
    room: scored[0].room,
    candidates: cands.length,
    // 两个候选一样近（或都无法解析时刻）→ 结果不可信，上层应降低置信度
    ambiguous: scored.length > 1 && !(scored[0].diff < scored[1].diff),
    pickedBy: 'time-proximity'
  };
}

/**
 * 依据赛事信息（主队代码、客队代码、开球时刻）自动查找匹配的直播线路
 */
export async function getLiveSourcesForMatch({ matchId, h, a, date, t, force = false }) {
  let matched = { room: null, candidates: 0, ambiguous: false, pickedBy: 'none' };
  let lines = [];
  let unmatchedTeams = [];
  let scrapeError = null;

  try {
    const schedule = await fetchSchedule(force);

    // 匹配规则见 findRoomFor：双方全等 + 开球时刻邻近度
    matched = findRoomFor(schedule, { h, a, t });

    // 未匹配到的队名一并回报，供 tools/check-scraper.mjs 持续发现别名缺口
    // （聚合站是综合体育站，MLB / NBA 等本就该匹配不到，这是预期内的噪声）
    unmatchedTeams = schedule
      .filter(g => !g.homeId || !g.awayId)
      .map(g => `${g.homeRaw} / ${g.awayRaw}`);

    if (matched.room?.gameId) {
      const rawLines = await fetchGameSources(matched.room.gameId, force);
      lines.push(...rawLines);
    }
  } catch (err) {
    // 不再吞成「成功但没匹配到」：抓取失败（镜像全挂）与「今天确实没这场」是两件事，
    // 前者是环境问题、后者是事实，界面必须能区分，否则用户只会看到「暂未匹配到直链」。
    scrapeError = err.message;
    console.warn("[scraper] 获取聚合信号出错:", err.message);
  }

  // 追加常驻保底源（CCTV5 / CCTV5+ / 咪咕）：探测失效的直接剔除，不给死线路
  const probe = await probeChannels(force);
  const tvDown = [];
  for (const tv of TV_SPORTS_CHANNELS) {
    if (probe.get(tv.id) === false) {
      tvDown.push(tv.tag);
      continue;
    }
    lines.push(tv);
  }

  // 5. 去重与智能排序：原生直链优先（咪咕/中文 > 其它直链 > 电视广播源 > 网页内嵌）
  const seenUrls = new Set();
  const deduped = [];
  for (const l of lines) {
    if (!l.url || seenUrls.has(l.url)) continue;
    seenUrls.add(l.url);
    deduped.push(l);
  }

  const scoreLine = (l) => {
    if (l.isDirect && /咪咕/i.test(l.name)) return 100;
    if (l.isDirect && /中文|超清/i.test(l.name)) return 90;
    if (l.isDirect && !l.id.startsWith('tv-')) return 80;
    if (l.id.startsWith('tv-')) return 70;
    if (l.kind === 'embed') return 50;
    return 10;
  };

  deduped.sort((a, b) => scoreLine(b) - scoreLine(a));

  const room = matched.room;
  return {
    ok: true,
    matched: Boolean(room),
    // 匹配质量：多候选时是否已按开球时刻选定、结果是否可信
    matchCandidates: matched.candidates,
    matchAmbiguous: matched.ambiguous,
    matchPickedBy: matched.pickedBy,
    gameId: room?.gameId || null,
    gameTitle: room ? room.homeRaw + " vs " + room.awayRaw : null,
    statusText: room?.statusText || null,
    isLive: room?.isLive || false,
    // 抓取环节失败（如四个镜像全挂）。非 null 时界面应与「今天确实没这场」区分开
    scrapeError,
    // 保底源失效清单（签名过期等）。非空时界面应明确提示，而不是让用户点了没反应
    tvChannelsDown: tvDown,
    // 聚合站里没能匹配到球队的条目，用于持续补别名（含 MLB/NBA 等非足球噪声）
    unmatchedTeams: unmatchedTeams.slice(0, 30),
    lines: deduped
  };
}
