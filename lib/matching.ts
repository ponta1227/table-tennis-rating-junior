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
  sameDayPairs: Set<string>; // その日すでに対戦済みのペア（DBから取得済み）
  matchesPerPlayer: number;  // 1人あたりの最大試合数（原則 人数-1）
};

/**
 * 総当たりをベースに、ラウンドごとに試合順を作る。
 *
 * 仕様:
 * - 基本は総当たり（全ペア N C 2）を候補とする
 * - sameDayPairs に含まれるペア（その日すでに対戦済み）は除外
 * - ラウンド制（1ラウンド = 各選手最大1試合）
 *   ⇒ 誰かが2試合目に入る前に、他の人の1試合目を優先的に埋める
 * - 奇数ラウンド:
 *   - レーティング無視、ランダムに相手を選ぶ
 * - 偶数ラウンド:
 *   - その日まだ対戦していない相手の中から
 *   - 「レーティングの高い人から順に」
 *   - 「レート差が最も近い相手」を優先して選ぶ
 */
export function generateFullSchedule(
  options: GenerateScheduleOptions
): MatchPair[] {
  const { players, sameDayPairs, matchesPerPlayer } = options;

  if (players.length < 2) return [];

  // いったんシャッフルして、毎回同じになりすぎないように
  const shuffled = [...players].sort(() => Math.random() - 0.5);

  // id → Player
  const playerMap = new Map<string, Player>();
  shuffled.forEach((p) => playerMap.set(p.id, p));

  // 各選手が今回スケジュール内で何試合こなしたか
  const matchCount = new Map<string, number>();
  shuffled.forEach((p) => matchCount.set(p.id, 0));

  // 「その日まだ対戦していないペア」の一覧
  type Pair = { id1: string; id2: string };
  const allPairs: Pair[] = [];

  for (let i = 0; i < shuffled.length; i++) {
    for (let j = i + 1; j < shuffled.length; j++) {
      const id1 = shuffled[i].id;
      const id2 = shuffled[j].id;
      const key = makePairKey(id1, id2);
      if (sameDayPairs.has(key)) {
        // その日すでに対戦済みなら候補に入れない
        continue;
      }
      allPairs.push({ id1, id2 });
    }
  }

  if (allPairs.length === 0) {
    // これ以上組める試合がない
    return [];
  }

  // どのペアをすでにスケジュールに使ったか（allPairs の index ）
  const usedPairIndex = new Set<number>();

  const schedule: MatchPair[] = [];
  const maxRounds = matchesPerPlayer; // 原則 players.length - 1 を渡す

  for (let round = 1; round <= maxRounds; round++) {
    const matchesBeforeRound = schedule.length;

    // このラウンドで既に割り当てられた選手
    const usedThisRound = new Set<string>();

    // このラウンドに出場できる候補（上限回数に達していない人）
    const baseList = shuffled.filter(
      (p) => (matchCount.get(p.id) ?? 0) < matchesPerPlayer
    );

    if (baseList.length < 2) {
      break; // もうほとんど全員やり切った
    }

    let roundPlayers: Player[];

    if (round % 2 === 1) {
      // 奇数ラウンド: レーティング無視、ランダム順
      roundPlayers = [...baseList].sort(() => Math.random() - 0.5);
    } else {
      // 偶数ラウンド: レーティング高い順
      roundPlayers = [...baseList].sort((a, b) => b.rating - a.rating);
    }

    if (round % 2 === 1) {
      // ===== 奇数ラウンド: ランダムマッチング =====
      for (const p of roundPlayers) {
        const pid = p.id;
        if (usedThisRound.has(pid)) continue;
        if ((matchCount.get(pid) ?? 0) >= matchesPerPlayer) continue;

        // pid が含まれていて、まだ使っていない & このラウンドで相手が空いているペア
        const candidateIdxs: number[] = [];
        allPairs.forEach((pair, idx) => {
          if (usedPairIndex.has(idx)) return;

          let otherId: string | null = null;
          if (pair.id1 === pid) otherId = pair.id2;
          else if (pair.id2 === pid) otherId = pair.id1;
          else return;

          if (usedThisRound.has(otherId)) return;
          if ((matchCount.get(otherId) ?? 0) >= matchesPerPlayer) return;

          candidateIdxs.push(idx);
        });

        if (candidateIdxs.length === 0) continue;

        const randomIdx =
          candidateIdxs[Math.floor(Math.random() * candidateIdxs.length)];
        const pair = allPairs[randomIdx];

        usedPairIndex.add(randomIdx);
        usedThisRound.add(pair.id1);
        usedThisRound.add(pair.id2);

        matchCount.set(pair.id1, (matchCount.get(pair.id1) ?? 0) + 1);
        matchCount.set(pair.id2, (matchCount.get(pair.id2) ?? 0) + 1);

        schedule.push({
          player1: playerMap.get(pair.id1)!,
          player2: playerMap.get(pair.id2)!,
        });
      }
    } else {
      // ===== 偶数ラウンド: 高レート優先 & レート差最小相手を選ぶ =====
      for (const p of roundPlayers) {
        const pid = p.id;
        if (usedThisRound.has(pid)) continue;
        if ((matchCount.get(pid) ?? 0) >= matchesPerPlayer) continue;

        let bestIdx: number | null = null;
        let bestDiff = Infinity;

        allPairs.forEach((pair, idx) => {
          if (usedPairIndex.has(idx)) return;

          let otherId: string | null = null;
          if (pair.id1 === pid) otherId = pair.id2;
          else if (pair.id2 === pid) otherId = pair.id1;
          else return;

          if (usedThisRound.has(otherId)) return;
          if ((matchCount.get(otherId) ?? 0) >= matchesPerPlayer) return;

          const pRating = playerMap.get(pid)!.rating;
          const oRating = playerMap.get(otherId)!.rating;
          const diff = Math.abs(pRating - oRating);

          if (diff < bestDiff) {
            bestDiff = diff;
            bestIdx = idx;
          }
        });

        if (bestIdx === null) continue;

        const pair = allPairs[bestIdx];

        usedPairIndex.add(bestIdx);
        usedThisRound.add(pair.id1);
        usedThisRound.add(pair.id2);

        matchCount.set(pair.id1, (matchCount.get(pair.id1) ?? 0) + 1);
        matchCount.set(pair.id2, (matchCount.get(pair.id2) ?? 0) + 1);

        schedule.push({
          player1: playerMap.get(pair.id1)!,
          player2: playerMap.get(pair.id2)!,
        });
      }
    }

    // このラウンドで1試合も作れなかったら、もう打ち止め
    if (schedule.length === matchesBeforeRound) {
      break;
    }

    // 全ペア使い切ったら終了
    if (usedPairIndex.size === allPairs.length) {
      break;
    }
  }

  return schedule;
}
