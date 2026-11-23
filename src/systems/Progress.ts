/**
 * Player progression: coins earned from flights, skins bought with coins.
 * Everything lives in localStorage on this device (no accounts, no network).
 */

export interface SkinColors {
  bodyColor: number;
  bellyColor: number;
  wingColor: number;
  tipColor: number;
  accentColor: number;
}

export interface Skin {
  id: string;
  name: string;
  icon: string;
  price: number;
  colors: SkinColors | null; // null = the species' own colors
}

export const SKINS: Skin[] = [
  { id: 'asli', name: 'Asli', icon: '🪶', price: 0, colors: null },
  {
    id: 'senja', name: 'Senja', icon: '🌅', price: 60,
    colors: { bodyColor: 0xf0803c, bellyColor: 0xffe7c2, wingColor: 0xd9506a, tipColor: 0x5b2a86, accentColor: 0xffd15c }
  },
  {
    id: 'salju', name: 'Salju', icon: '❄️', price: 150,
    colors: { bodyColor: 0xeaf4ff, bellyColor: 0xffffff, wingColor: 0xbcd9f5, tipColor: 0x4f7fb8, accentColor: 0xff9a3c }
  },
  {
    id: 'neon', name: 'Neon', icon: '⚡', price: 300,
    colors: { bodyColor: 0x7a3cff, bellyColor: 0xd6fff4, wingColor: 0x2ee6c8, tipColor: 0xff3ca8, accentColor: 0xfff23c }
  },
  {
    id: 'emas', name: 'Emas Sultan', icon: '👑', price: 500,
    colors: { bodyColor: 0xf2b920, bellyColor: 0xfff4c4, wingColor: 0xe09a10, tipColor: 0x7a3d00, accentColor: 0xd8353a }
  }
];

export interface Progress {
  coins: number;
  totalCoins: number;
  flights: number;
  unlocked: string[];
  skin: string;
  seenIntro: boolean;
}

const KEY = 'birds:progress';

function fresh(): Progress {
  return { coins: 0, totalCoins: 0, flights: 0, unlocked: ['asli'], skin: 'asli', seenIntro: false };
}

export function getProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const p = JSON.parse(raw);
    const base = fresh();
    const unlocked: string[] = Array.isArray(p.unlocked) ? p.unlocked.filter((id: string) => SKINS.some((s) => s.id === id)) : [];
    if (!unlocked.includes('asli')) unlocked.push('asli');
    const skin = unlocked.includes(p.skin) ? p.skin : 'asli';
    return {
      coins: Math.max(0, Number(p.coins) || 0),
      totalCoins: Math.max(0, Number(p.totalCoins) || 0),
      flights: Math.max(0, Number(p.flights) || 0),
      unlocked,
      skin,
      seenIntro: !!p.seenIntro || base.seenIntro
    };
  } catch {
    return fresh();
  }
}

function save(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode: progress simply isn't kept */
  }
}

export function getSkin(id: string): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

export interface Reward {
  fromScore: number;
  fromFeathers: number;
  newBestBonus: number;
  total: number;
}

export const COIN_RULES = { scorePerCoin: 100, perFeather: 3, newBest: 20 };

/** Coins a finished flight pays out. Pure, so the game-over screen and the tests agree. */
export function computeReward(score: number, feathers: number, isNewBest: boolean): Reward {
  const fromScore = Math.floor(Math.max(0, score) / COIN_RULES.scorePerCoin);
  const fromFeathers = Math.max(0, feathers) * COIN_RULES.perFeather;
  const newBestBonus = isNewBest ? COIN_RULES.newBest : 0;
  return { fromScore, fromFeathers, newBestBonus, total: fromScore + fromFeathers + newBestBonus };
}

export function awardReward(reward: Reward): Progress {
  const p = getProgress();
  p.coins += reward.total;
  p.totalCoins += reward.total;
  p.flights += 1;
  save(p);
  return p;
}

export function buySkin(id: string): { ok: boolean; progress: Progress } {
  const p = getProgress();
  const skin = SKINS.find((s) => s.id === id);
  if (!skin || p.unlocked.includes(id) || p.coins < skin.price) return { ok: false, progress: p };
  p.coins -= skin.price;
  p.unlocked.push(id);
  p.skin = id;
  save(p);
  return { ok: true, progress: p };
}

export function equipSkin(id: string): Progress {
  const p = getProgress();
  if (p.unlocked.includes(id)) {
    p.skin = id;
    save(p);
  }
  return p;
}

export function markIntroSeen(): void {
  const p = getProgress();
  if (!p.seenIntro) {
    p.seenIntro = true;
    save(p);
  }
}
