export type Match = {
  id: string;
  l: string;
  r?: number;
  t: string;
  tbd?: boolean;
  st: string;
  h: string;
  a: string;
  sc?: string | null;
};

export type Ev = {
  star: number;
  base: number;
  isFollowed: boolean;
  isLeagueFollowed: boolean;
  followedLeaguesCount: number;
  stories: Array<{ id: string; title?: string }>;
  storyIds: string[];
  keyNode: boolean;
  rivalry: string | null;
  rec: unknown;
  bonuses: string[];
};

export type Entry = {
  m: Match;
  ev: Ev;
  index: number;
};

export type Tier = {
  tier: number;
  label: string;
  cost: number;
  zh: string;
};

export type Narrative = {
  level: string;
  headline: string;
  lines: string[];
  trivia: string | null;
};

export type StandingsRow = {
  teamId: string;
  rank: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
  zoneKey: 'top' | 'mid' | 'bottom' | 'ucl-direct' | 'ucl-playoff' | 'ucl-out';
  zoneLabel: string;
  zoneTone: 'neutral' | 'warn';
  context: { primary: string; secondary: string } | null;
};

export type MatchStandings = {
  supported: boolean;
  league: string | null;
  asOfTs: number;
  historical: boolean;
  doneCount: number;
  lastResultAt: number | null;
  rows: StandingsRow[];
  home: StandingsRow | null;
  away: StandingsRow | null;
  zones:
    | { top: number; bottom: number }
    | { direct: number; playoff: number; total: number }
    | null;
  tiebreakerNote: string;
  note: string | null;
};
