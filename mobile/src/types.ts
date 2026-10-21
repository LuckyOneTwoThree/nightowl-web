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
