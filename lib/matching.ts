// lib/matching.ts

export type Player = {
  id: string;
  name: string;
  rating: number;
};

export type MatchPair = {
  player1: Player;
  player2: Player;
  tableNumber?: number;
};

/**
 * 同日対戦済みペア Set に 2人の組み合わせを追加する
 */
export function addPairToSameDaySet(
  prev: Set<string>,
  p1Id: string,
  p2Id: string
): Set<string> {
  const newSet = new Set(prev);
  const key = makePairKey(p1Id, p2Id);
  newSet.add(key);
  return newSet;
}

/**
 * ペアを一意に表すキー（idの小さい方-大きい方）
 */
function makePairKey(a: string, b: string): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

type GenerateScheduleOptions = {
  players: Player[];
  sameDayPairs: Set<string>; // その日以前の「既に対戦済みペア」
  matchesPerPlayer: number; // 今回は 10 固定で呼ぶ
};

/**
 * 各選手が最大 matchesPerPlayer 試合できるように、
 * 試合順をすべて生成する関数。
 *
 * - スケジュールの並びは：
 *   全員の1試合目 → 全員の2試合目 → … の塊
 * - その中で、奇数回目の試合は「ランダム気味」、
 *   偶数回目の試合は「レートの近い相手」を優先
 * - 同じ日・同じ相手の対戦は避ける（sameDayPairs + この関数内で組んだ分）
 * - どうしても相手が見つからない場合、その選手はその回の試合はスキップ
 *   （＝結果として10試合未満になることもありうる）
 */
export function generateFullSchedule(
  options: GenerateScheduleOptions
): MatchPair[] {
  const { players, sameDayPairs, matchesPerPlayer } = options;

  if (players.length < 2) return [];

  // id → Player のマップ
  const playerMap = new Map<string, Player>();
  players.forEach((p) => playerMap.set(p.id, p));

  // 各選手の「今回スケジュール済み試合数」
  const matchCount = new Map<string, number>();
  players.forEach((p) => matchCount.set(p.id, 0));

  // 「同じ日・同じ相手」を避けるためのペア集合
  const usedPairs = new Set<string>(sameDayPairs);

  const schedule: MatchPair[] = [];

  // 1試合目の塊 → 2試合目の塊 → … の順で作る
  for (let nth = 1; nth <= matchesPerPlayer; nth++) {
    // まだ nth 試合目が割り当てられていない選手たち
    const needThisRound = players.filter(
      (p) => (matchCount.get(p.id) ?? 0) < nth
    );

    // 毎回順番を少しシャッフルして偏りを減らす
    const shuffled = [...needThisRound].sort(() => Math.random() - 0.5);

    // この「nth 試合目の塊」で、まだマッチングされていない人の集合
    const remainingIds = new Set<string>(shuffled.map((p) => p.id));

    while (remainingIds.size >= 2) {
      // 1人取り出す
      const iterator = remainingIds.values();
      const p1Id = iterator.next().value as string;
      remainingIds.delete(p1Id);
      const p1 = playerMap.get(p1Id);
      if (!p1) continue;

      // 対戦相手候補を探す
      let chosenId: string | null = null;
      let bestScore = Infinity;

      for (const p2Id of remainingIds) {
        const key = makePairKey(p1Id, p2Id);
        if (usedPairs.has(key)) {
          // 同じ日に対戦済みならスキップ
          continue;
        }

        const p2 = playerMap.get(p2Id);
        if (!p2) continue;

        if (nth % 2 === 1) {
          // 奇数回目：ランダム寄り → 最初に見つかった相手を採用
          chosenId = p2Id;
          break;
        } else {
          // 偶数回目：レート差が小さい相手を優先
          const diff = Math.abs(p1.rating - p2.rating);
          if (diff < bestScore) {
            bestScore = diff;
            chosenId = p2Id;
          }
        }
      }

      if (!chosenId) {
        // この回では p1 の相手が見つからなかった → その人はこの回スキップ
        continue;
      }

      // ペア確定
      remainingIds.delete(chosenId);
      const p2 = playerMap.get(chosenId);
      if (!p2) continue;

      const pairKey = makePairKey(p1Id, chosenId);
      usedPairs.add(pairKey);

      schedule.push({
        player1: p1,
        player2: p2,
      });

      matchCount.set(p1Id, (matchCount.get(p1Id) ?? 0) + 1);
      matchCount.set(chosenId, (matchCount.get(chosenId) ?? 0) + 1);
    }
  }

  return schedule;
}
