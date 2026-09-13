/**
 * 图标层 —— 全站唯一图标出口
 *
 * 为什么包一层：Lucide 各图标默认 24px / 2 描边，直接散用会出现
 * 大小不一、粗细不一、与 11–13px 中文文字基线对不齐的问题。
 * 这里把尺寸与描边收敛成三档，组件只表达"用哪个图标、什么语义"。
 *
 * 离线约束：lucide-react 是纯 SVG 组件，构建期被打进 dist 的 JS chunk，
 * 运行时不产生任何网络请求 —— 与自托管字体的口径一致。
 */
import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleStop,
  Clock,
  ExternalLink,
  Eye,
  Gauge,
  Handshake,
  History,
  Inbox,
  Info,
  Keyboard,
  ListFilter,
  Maximize2,
  Minimize2,
  Moon,
  MoonStar,
  PictureInPicture,
  Play,
  Radio,
  RotateCcw,
  Scale,
  Search,
  Settings,
  Shield,
  Signal,
  Star,
  Swords,
  Tag,
  Timer,
  Trophy,
  TriangleAlert,
  X
} from 'lucide-react';

/**
 * @param Comp  Lucide 原始组件
 * @param size  该图标的默认边长（按其在文字旁的视觉重量选定，而非按图标名）
 */
function mk(Comp, size) {
  return function Icon({ size: s = size, strokeWidth = 1.75, className = '', ...rest }) {
    return (
      <Comp
        size={s}
        strokeWidth={strokeWidth}
        aria-hidden="true"
        focusable="false"
        className={`shrink-0 ${className}`}
        {...rest}
      />
    );
  };
}

/* ---- 导航与视图 ---- */
export const IconTonight = mk(Moon, 14);
export const IconWeek = mk(BarChart3, 14);
export const IconSchedule = mk(CalendarDays, 14);
export const IconSettings = mk(Settings, 14);

/* ---- 通用控件 ---- */
export const IconSearch = mk(Search, 14);
export const IconClose = mk(X, 14);
export const IconCheck = mk(Check, 12);
export const IconChevronDown = mk(ChevronDown, 12);
export const IconChevronUp = mk(ChevronUp, 12);
export const IconFilter = mk(ListFilter, 14);
export const IconReset = mk(RotateCcw, 13);
export const IconExternal = mk(ExternalLink, 12);
export const IconReveal = mk(Eye, 13);
export const IconPlay = mk(Play, 13);
export const IconStop = mk(CircleStop, 13);
export const IconTheaterOn = mk(Maximize2, 13);
export const IconTheaterOff = mk(Minimize2, 13);
export const IconPiP = mk(PictureInPicture, 13);
export const IconSwitchLine = mk(ArrowLeftRight, 12);

/* ---- 状态与提示 ---- */
export const IconLive = mk(Radio, 13);
export const IconSignal = mk(Signal, 13);
export const IconWarn = mk(TriangleAlert, 13);
export const IconAlert = mk(CircleAlert, 13);
export const IconInfo = mk(Info, 13);
export const IconKeyboard = mk(Keyboard, 13);
export const IconEmpty = mk(Inbox, 22);

/* ---- 情报语义 ---- */
export const IconTier = mk(MoonStar, 13);
export const IconCost = mk(Timer, 13);
export const IconBudget = mk(Gauge, 13);
export const IconDerby = mk(Swords, 13);
export const IconIdentity = mk(Shield, 13);
export const IconHonor = mk(Trophy, 13);
export const IconForm = mk(Activity, 13);
export const IconCompare = mk(Scale, 13);
export const IconH2H = mk(History, 13);
export const IconNoH2H = mk(Handshake, 22);
export const IconTime = mk(Clock, 13);
export const IconTag = mk(Tag, 13);

/**
 * 星级：看点权重是**排序依据**而非装饰，所以保留实心星，
 * 但降为一格一格的点阵，避免此前 `★★★★★★★★` 连排时的金色噪声。
 */
export function IconStars({ count = 0, className = '' }) {
  const n = Math.max(0, Math.min(3, count));
  return (
    <span
      className={`inline-flex items-center gap-px ${className}`}
      title={`看点 ${n} / 3 星`}
      aria-label={`看点 ${n} 星`}
    >
      {[0, 1, 2].map(i => (
        <Star
          key={i}
          size={11}
          strokeWidth={1.75}
          fill={i < n ? 'currentColor' : 'none'}
          className={i < n ? 'text-accent' : 'text-line-control'}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}
