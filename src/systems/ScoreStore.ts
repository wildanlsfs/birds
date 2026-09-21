export interface BestScore {
  distance: number;
  score: number;
  rings: number;
  date: string;
}

type BirdType = 'small' | 'medium' | 'large';
type BestScores = Record<BirdType, BestScore | null>;

const STORAGE_KEY = 'birds:bestScores';

function emptyBestScores(): BestScores {
  return { small: null, medium: null, large: null };
}

export function getBestScores(): BestScores {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyBestScores();

    const parsed = JSON.parse(raw);
    return {
      small: parsed?.small ?? null,
      medium: parsed?.medium ?? null,
      large: parsed?.large ?? null
    };
  } catch (e) {
    console.warn('[ScoreStore] Failed to read best scores:', e);
    return emptyBestScores();
  }
}

function saveBestScores(scores: BestScores): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scores));
  } catch (e) {
    console.warn('[ScoreStore] Failed to save best scores:', e);
  }
}

export function recordRun(
  type: BirdType,
  run: { distance: number; score: number; rings: number }
): { isNewBest: boolean; best: BestScore } {
  const scores = getBestScores();
  const existing = scores[type];
  const isNewBest = !existing || run.score > existing.score;

  if (!isNewBest) {
    return { isNewBest: false, best: existing };
  }

  const best: BestScore = {
    distance: run.distance,
    score: run.score,
    rings: run.rings,
    date: new Date().toISOString()
  };

  scores[type] = best;
  saveBestScores(scores);

  return { isNewBest: true, best };
}
