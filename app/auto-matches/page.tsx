// app/auto-matches/page.tsx
"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

import {
  Player,
  MatchPair,
  generateFullSchedule,
  addPairToSameDaySet,
} from "@/lib/matching";

type MatchInProgress = MatchPair & {
  id?: number;
  winnerId?: string;
};

const MATCHES_PER_PLAYER = 10;

export default function AutoMatchesPage() {
  const [date, setDate] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().slice(0, 10); // "YYYY-MM-DD"
  });

  const [tableCount, setTableCount] = useState<number>(2);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);

  const [sameDayPairs, setSameDayPairs] = useState<Set<string>>(new Set());

  const [currentMatches, setCurrentMatches] = useState<MatchInProgress[]>([]);
  const [waitingMatches, setWaitingMatches] = useState<MatchPair[]>([]);

  const [saving, setSaving] = useState(false);
  const [finished, setFinished] = useState(false);

  // 1) 選手一覧取得（players テーブル前提）
  useEffect(() => {
    const fetchPlayers = async () => {
      const { data, error } = await supabase
        .from("players")
        .select("id, name, rating")
        .order("rating", { ascending: false });

      if (error) {
        console.error("fetchPlayers error:", error);
        alert("選手一覧の取得に失敗しました");
        return;
      }

      const players: Player[] =
        data?.map((p: any) => ({
          id: p.id,
          name: p.name,
          rating: p.rating ?? 1500,
        })) ?? [];

      setAllPlayers(players);
    };

    fetchPlayers();
  }, []);

  /**
   * 2) 同じ日の対戦済みペアを取得
   * - matches テーブルに player_a, player_b, created_at がある想定
   * - その日・その参加者同士の全試合を取ってきて、ペアの組み合わせを Set に格納
   */
  const loadSameDayPairs = async (
    playerIds: string[],
    dateStr: string
  ): Promise<Set<string>> => {
    if (playerIds.length === 0) {
      const empty = new Set<string>();
      setSameDayPairs(empty);
      return empty;
    }

    const { data, error } = await supabase
      .from("matches")
      .select("player_a, player_b, created_at")
      .gte("created_at", `${dateStr} 00:00:00`)
      .lte("created_at", `${dateStr} 23:59:59`);

    if (error) {
      console.error("loadSameDayPairs error:", error);
      alert("当日の対戦履歴取得に失敗しました");
      const empty = new Set<string>();
      setSameDayPairs(empty);
      return empty;
    }

    const set = new Set<string>();

    (data ?? []).forEach((m: any) => {
      const p1 = m.player_a;
      const p2 = m.player_b;

      if (!p1 || !p2) return;
      if (!playerIds.includes(p1) || !playerIds.includes(p2)) return;

      const key = p1 < p2 ? `${p1}-${p2}` : `${p2}-${p1}`;
      set.add(key);
    });

    setSameDayPairs(set);
    return set;
  };

  // 3) 「本日のオートマッチングを開始」ボタン
  const handleStart = async () => {
    if (selectedPlayerIds.length < 2) {
      alert("参加選手を2人以上選んでください");
      return;
    }
    if (tableCount < 1) {
      alert("台数を1以上にしてください");
      return;
    }

    setFinished(false);
    setCurrentMatches([]);
    setWaitingMatches([]);

    // ① 当日の対戦済みペアを取得
    const initialSameDayPairs = await loadSameDayPairs(selectedPlayerIds, date);

    // ② 対象選手だけを取り出す
    const playersForToday = allPlayers.filter((p) =>
      selectedPlayerIds.includes(p.id)
    );

    // ③ 各人が最大 MATCHES_PER_PLAYER 試合できるように、
    //    その日の「全試合順」をまとめて作る
    const fullSchedule = generateFullSchedule({
      players: playersForToday,
      sameDayPairs: initialSameDayPairs,
      matchesPerPlayer: MATCHES_PER_PLAYER,
    });

    if (fullSchedule.length === 0) {
      alert("条件を満たす試合組み合わせが作れませんでした。");
      return;
    }

    // ④ 先頭の台数ぶんを「現在進行中の試合」に、
    //    残りを「待ち試合」として保持
    const initialCurrent: MatchInProgress[] = [];
    const remaining: MatchPair[] = [];

    fullSchedule.forEach((m, idx) => {
      if (idx < tableCount) {
        initialCurrent.push({
          ...m,
          tableNumber: idx + 1,
        });
      } else {
        remaining.push(m);
      }
    });

    setCurrentMatches(initialCurrent);
    setWaitingMatches(remaining);
  };

  // 4) 勝者の選択
  const handleSelectWinner = (tableNumber: number, winnerId: string) => {
    setCurrentMatches((prev) =>
      prev.map((m) =>
        m.tableNumber === tableNumber ? { ...m, winnerId } : m
      )
    );
  };

  // 5) 試合結果を保存して、次の試合を割り当て
  const handleSaveResult = async (match: MatchInProgress) => {
    if (!match.winnerId) {
      alert("勝者を選択してください");
      return;
    }

    setSaving(true);

    // 試合結果を DB に保存（player_a / player_b / winner）
    const { error } = await supabase.from("matches").insert({
      player_a: match.player1.id,
      player_b: match.player2.id,
      winner: match.winnerId,
      // created_at は Supabase 側の default に任せる
    });

    setSaving(false);

    if (error) {
      console.error("saveResult error:", error);
      alert("試合結果の保存に失敗しました");
      return;
    }

    // ① sameDayPairs を更新（この日、この2人は対戦済み）
    const updatedSameDayPairs = addPairToSameDaySet(
      sameDayPairs,
      match.player1.id,
      match.player2.id
    );
    setSameDayPairs(updatedSameDayPairs);

    // ② 待ち試合キューから次の1試合を取り出す
    const newWaiting = [...waitingMatches];
    const nextMatch = newWaiting.shift() ?? null;

    // ③ 現在進行中から、この台の試合を削除
    const newCurrent = currentMatches.filter(
      (m) => m.tableNumber !== match.tableNumber
    );

    // ④ 待ち試合が残っていれば、その台に次の試合を割り当て
    if (nextMatch) {
      newCurrent.push({
        ...nextMatch,
        tableNumber: match.tableNumber,
      });
    }

    // ⑤ 状態をまとめて更新
    setCurrentMatches(newCurrent);
    setWaitingMatches(newWaiting);

    // ⑥ 待ち試合も現在進行中もなくなったら「本日終了」
    if (newCurrent.length === 0 && newWaiting.length === 0) {
      setFinished(true);
    }
  };

  // 6) 本日の割り当て終了（強制終了）
  const handleFinish = () => {
    setFinished(true);
    setCurrentMatches([]);
    setWaitingMatches([]);
  };

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-bold">オートマッチング（台割り）</h1>

      {/* 基本設定 */}
      <section className="space-y-2">
        <div>
          <label className="block text-sm font-medium">日付</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border px-2 py-1 rounded"
          />
        </div>

        <div>
          <label className="block text-sm font-medium">台数</label>
          <input
            type="number"
            min={1}
            value={tableCount}
            onChange={(e) => setTableCount(Number(e.target.value))}
            className="border px-2 py-1 rounded"
          />
        </div>

        <div>
          <label className="block text-sm font-medium">
            参加選手（複数選択）
          </label>
          <div className="border rounded p-2 max-h-60 overflow-auto space-y-1">
            {allPlayers.map((p) => {
              const checked = selectedPlayerIds.includes(p.id);
              return (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      setSelectedPlayerIds((prev) =>
                        checked
                          ? prev.filter((id) => id !== p.id)
                          : [...prev, p.id]
                      );
                    }}
                  />
                  <span>
                    {p.name}（{Math.round(p.rating)}）
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <button
          onClick={handleStart}
          className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
          disabled={selectedPlayerIds.length < 2 || tableCount < 1}
        >
          本日のオートマッチングを開始
        </button>
      </section>

      {/* 進行状況 */}
      <section className="space-y-2">
        {finished && (
          <div className="text-sm text-gray-600">
            本日のマッチングは終了しました。
          </div>
        )}

        <div className="flex items-center justify-end space-x-2">
          <button
            onClick={handleFinish}
            className="px-3 py-1 border rounded text-red-600"
          >
            本日の割り当て終了
          </button>
        </div>

        <h2 className="font-semibold mt-2">現在進行中の試合</h2>
        {currentMatches.length === 0 && (
          <div className="text-sm text-gray-500">
            現在進行中の試合はありません。
          </div>
        )}

        <div className="space-y-2">
          {currentMatches
            .sort((a, b) => (a.tableNumber ?? 0) - (b.tableNumber ?? 0))
            .map((m) => (
              <div
                key={m.tableNumber}
                className="border rounded p-2 flex items-center justify-between"
              >
                <div>
                  <div className="font-semibold">台：{m.tableNumber}</div>
                  <div className="text-sm">
                    {m.player1.name}（{Math.round(m.player1.rating)}） vs{" "}
                    {m.player2.name}（{Math.round(m.player2.rating)}）
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={m.winnerId ?? ""}
                    onChange={(e) =>
                      handleSelectWinner(m.tableNumber!, e.target.value)
                    }
                    className="border rounded px-2 py-1 text-sm"
                  >
                    <option value="">勝者を選択</option>
                    <option value={m.player1.id}>{m.player1.name}</option>
                    <option value={m.player2.id}>{m.player2.name}</option>
                  </select>
                  <button
                    onClick={() => handleSaveResult(m)}
                    disabled={saving}
                    className="px-3 py-1 bg-green-600 text-white rounded text-sm disabled:opacity-50"
                  >
                    保存＆次の試合
                  </button>
                </div>
              </div>
            ))}
        </div>

        <h2 className="font-semibold mt-4">待ち試合</h2>
        {waitingMatches.length === 0 && (
          <div className="text-sm text-gray-500">待ち試合はありません。</div>
        )}
        <ul className="text-sm list-disc pl-5 space-y-1">
          {waitingMatches.map((m, idx) => (
            <li key={idx}>
              {m.player1.name} vs {m.player2.name}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
