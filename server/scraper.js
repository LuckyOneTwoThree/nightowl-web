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

/** 常驻高画质公共体育广播频道（免登录、无广告、纯净直播） */
export const TV_SPORTS_CHANNELS = [
  {
    id: "tv-cctv5",
    name: "电视 · CCTV-5 体育高清",
    url: "http://hlsztemgsplive.miguvideo.com:8080/wd_r2/cctv/cctv5hdnew/600/index.m3u8?msisdn=2026091222030405c6b5797ee84634bd30d2189ba77b45&mdspid=&spid=699004&netType=0&sid=5500516171&pid=2028597139&timestamp=20260912220304&Channel_ID=0116_2600000900-99000-201600010010027&ProgramID=641886683&ParentNodeID=-99&assertID=5500516171&client_ip=171.8.79.254&SecurityKey=20260912220304&promotionId=&mvid=5102048712&mcid=500020&playurlVersion=ZQ-A1-9.9.1-SNAPSHOT&userid=&jmhm=&videocodec=h264&appCode=miguvideo_android&bean=mgspad&tid=android&conFee=0&encrypt=631a4f53d881a710a1d1337d44c4b6d3",
    kind: "m3u8",
    isDirect: true,
    tag: "CCTV5"
  },
  {
    id: "tv-cctv5plus",
    name: "电视 · CCTV-5+ 赛事高清",
    url: "http://hlsztemgsplive.miguvideo.com:8080/wd_r2/cctv/cctv5plusnew/600/index.m3u8?msisdn=202609122203041345009cd3774d7fa72ab9f38c1f448c&mdspid=&spid=699004&netType=0&sid=5500516288&pid=2028597139&timestamp=20260912220304&Channel_ID=0116_2600000900-99000-201600010010027&ProgramID=641886773&ParentNodeID=-99&assertID=5500516288&client_ip=171.8.79.254&SecurityKey=20260912220304&promotionId=&mvid=5102048803&mcid=500020&playurlVersion=ZQ-A1-9.9.1-SNAPSHOT&userid=&jmhm=&videocodec=h264&appCode=miguvideo_android&bean=mgspad&tid=android&conFee=0&encrypt=05d6725a4f1f435b37fe9ad846252b10",
    kind: "m3u8",
    isDirect: true,
    tag: "CCTV5+"
  },
  {
    id: "tv-migu4k",
    name: "频道 · 咪咕 4K 体育超清",
    url: "http://gslbserv.itv.cmvideo.cn/index.m3u8?channel-id=FifastbLive&Contentid=3000000010000005180&livemode=1&stbId=YanG-1989",
    kind: "m3u8",
    isDirect: true,
    tag: "咪咕"
  }
];

/** 加载球队字典与别名 */
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
    console.warn("[scraper] 无法加载 teams.json，使用基础别名表:", e.message);
  }

  // 常见中文别名 / 简称拓展
  const aliases = {
    "曼城": "MCI", "曼彻斯特城": "MCI", "曼联": "MUN", "曼彻斯特联": "MUN",
    "阿森纳": "ARS", "兵工厂": "ARS", "切尔西": "CHE", "蓝军": "CHE",
    "利物浦": "LIV", "热刺": "TOT", "托特纳姆热刺": "TOT", "纽卡斯尔": "NEW", "纽卡斯尔联": "NEW",
    "维拉": "AVL", "阿斯顿维拉": "AVL", "埃弗顿": "EVE", "狼队": "WOL",
    "皇马": "RMA", "皇家马德里": "RMA", "巴萨": "BAR", "巴塞罗那": "BAR",
    "马竞": "ATM", "马德里竞技": "ATM", "毕尔巴鄂": "ATH", "毕尔巴鄂竞技": "ATH",
    "皇家社会": "RSO", "塞维利亚": "SEV", "贝蒂斯": "BET", "皇家贝蒂斯": "BET",
    "拜仁": "FCB", "拜仁慕尼黑": "FCB", "多特": "BVB", "多特蒙德": "BVB",
    "勒沃库森": "B04", "莱比锡": "RBL", "RB莱比锡": "RBL", "莱比锡红牛": "RBL",
    "法兰克福": "SGE", "斯图加特": "VFB",
    "国米": "INT", "国际米兰": "INT", "AC米兰": "MIL", "米兰": "MIL",
    "尤文": "JUV", "尤文图斯": "JUV", "那不勒斯": "NAP", "罗马": "ROM", "拉齐奥": "LAZ",
    "巴黎": "PSG", "巴黎圣日耳曼": "PSG", "摩纳哥": "MCO", "马赛": "OM", "里尔": "LIL"
  };

  for (const [name, id] of Object.entries(aliases)) {
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
  return lines;
}

/**
 * 依据赛事信息（主队代码、客队代码、时间）自动查找匹配的直播线路
 */
export async function getLiveSourcesForMatch({ matchId, h, a, date }) {
  let matchedGame = null;
  let lines = [];

  try {
    const schedule = await fetchSchedule();

    // 1. 精确匹配双方队伍 ID
    matchedGame = schedule.find(g => {
      if (g.homeId && g.awayId) {
        return (g.homeId === h && g.awayId === a) || (g.homeId === a && g.awayId === h);
      }
      return false;
    });

    // 2. 若双方无法完全匹配，尝试单队匹配
    if (!matchedGame) {
      matchedGame = schedule.find(g => {
        return (g.homeId === h || g.awayId === a);
      });
    }

    // 3. 若找到房间，拉取实时解密线路
    if (matchedGame?.gameId) {
      const rawLines = await fetchGameSources(matchedGame.gameId);
      lines.push(...rawLines);
    }
  } catch (err) {
    console.warn("[scraper] 获取聚合信号出错:", err.message);
  }

  // 4. 追加常驻高可用电视与广电体育源 (CCTV5 / CCTV5+ / 咪咕4K)
  for (const tv of TV_SPORTS_CHANNELS) {
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

  return {
    ok: true,
    matched: Boolean(matchedGame),
    gameId: matchedGame?.gameId || null,
    gameTitle: matchedGame ? (matchedGame.homeRaw + " vs " + matchedGame.awayRaw) : null,
    statusText: matchedGame?.statusText || null,
    isLive: matchedGame?.isLive || false,
    lines: deduped
  };
}
