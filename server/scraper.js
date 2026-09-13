/**
 * 赛事流自动抓取与对齐模块 (Live Stream Scraper & Matcher)
 *
 * 职责：
 * 1. 自动抓取并解析聚合站今日赛程与实时比赛房间；
 * 2. 队名与别名智能对齐（将本地球队代码如 LIV/MCI/MIL 匹配至聚合比赛）；
 * 3. 逆向调用直播信号接口，解密提取原始 .m3u8 直链与多线路；
 * 4. 融合央视 CCTV-5 / CCTV-5+ / 咪咕4K 广电与 OTT 体育直播源作为高可用保底。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

/**
 * 保底直播频道（**外置，不入库**）
 *
 * 这些直链带会话级签名参数（含客户端 IP、会话标识一类个人数据），且源站强校验
 * timestamp / encrypt —— 实测改 timestamp 返回 605、去掉 encrypt 返回 403，
 * 因此必然在某个时刻整体失效。放在源码里有两重问题：
 *   ① 个人标识随版本库外泄；② 每次失效都要改代码并重新构建。
 *
 * 现在改为运行时从 server/tv-channels.local.json 读取（已 .gitignore），
 * 仓库只保留 server/tv-channels.example.json 作模板。
 * 文件缺失时返回空数组 —— 保底能力自然降级，不影响聚合站线路。
 */
function loadTvChannels() {
  try {
    const raw = readFileSync(resolve(ROOT, "server/tv-channels.local.json"), "utf8");
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed.channels;
    return Array.isArray(list) ? list.filter(c => c && c.id && c.url) : [];
  } catch {
    return [];
  }
}

export const TV_SPORTS_CHANNELS = loadTvChannels();

/**
 * 加载球队字典
 *
 * 分两层，避免同一份数据两处维护（漂移是这类映射最常见的失效方式）：
 *   ① teams.json 自动派生：zh 全称 / en 全称 / id —— teams 改了自动跟随
 *   ② server/scraper-alias.json 手工补充：中文简称、粤语译名、惯用别称
 *      （这些机器推不出来，只能人工维护；缺失项由 tools/check-scraper.mjs 持续发现）
 */
function loadTeamDictionary() {
  const map = new Map();
  try {
    const teams = JSON.parse(readFileSync(resolve(ROOT, "src/data/teams.json"), "utf8"));
    for (const t of teams) {
      map.set(t.zh, t.id);
      map.set(t.en, t.id);
      map.set(t.id, t.id);
    }
  } catch (e) {
    console.warn("[scraper] 无法加载 teams.json:", e.message);
  }

  try {
    const alias = JSON.parse(readFileSync(resolve(ROOT, "server/scraper-alias.json"), "utf8"));
    for (const [name, id] of Object.entries(alias.map || {})) {
      map.set(name, id);
    }
  } catch (e) {
    console.warn("[scraper] 无法加载 scraper-alias.json，仅用 teams 全称匹配:", e.message);
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
      const res = await fetch(base, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(6000)
      });
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

  const items = [...html.matchAll(/class="[^"]*group-game-item[^"]*"[\s\S]*?href=['"](\/live\/(\d+)\/play)['"][^>]*>([\s\S]*?)<\/a>/gi)];

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
        playUrl: activeMirror + playUrl,
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

  cache.schedule = { time: now, data: games };
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
      const res = await fetch(sourceApiUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          "Referer": base + "/live/" + gameId + "/play"
        },
        signal: AbortSignal.timeout(6000)
      });
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
    const decodedStr = Buffer.from(base64Payload, "base64").toString("utf8");
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
export async function getLiveSourcesForMatch({ matchId, h, a, date, t }) {
  let matched = { room: null, candidates: 0, ambiguous: false, pickedBy: 'none' };
  let lines = [];
  let unmatchedTeams = [];
  let scrapeError = null;

  try {
    const schedule = await fetchSchedule();

    // 匹配规则见 findRoomFor：双方全等 + 开球时刻邻近度
    matched = findRoomFor(schedule, { h, a, t });

    // 未匹配到的队名一并回报，供 tools/check-scraper.mjs 持续发现别名缺口
    // （聚合站是综合体育站，MLB / NBA 等本就该匹配不到，这是预期内的噪声）
    unmatchedTeams = schedule
      .filter(g => !g.homeId || !g.awayId)
      .map(g => `${g.homeRaw} / ${g.awayRaw}`);

    if (matched.room?.gameId) {
      const rawLines = await fetchGameSources(matched.room.gameId);
      lines.push(...rawLines);
    }
  } catch (err) {
    // 不再吞成「成功但没匹配到」：抓取失败（镜像全挂）与「今天确实没这场」是两件事，
    // 前者是环境问题、后者是事实，界面必须能区分，否则用户只会看到「暂未匹配到直链」。
    scrapeError = err.message;
    console.warn("[scraper] 获取聚合信号出错:", err.message);
  }

  // 追加常驻保底源（CCTV5 / CCTV5+ / 咪咕）：探测失效的直接剔除，不给死线路
  const probe = await probeChannels();
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
