"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import {
  Player,
  MatchPair,
  generateFullSchedule,
  addPairToSameDaySet,
} from "../../lib/matching";

type MatchStatus = "idle" | "in-progress" | "finished";

type MatchWithState = MatchPair & {
  matchNumber: number; // 試合番号
  status: MatchStatus;
  winnerId?: string;
};

export default function AutoMatchesPage() {
  const [date, setDate] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().slice(0, 10); // "YYYY-MM-DD"
  });

  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);

  const [sameDayPairs, setSameDayPairs] = useState<Set<string>>(new Set());

  const [matches, setMatches] = useState<MatchWithState[]>([]);
  const [saving, setSaving] = useState(false);
  const [finishedAll, setFinishedAll] = useState(false);

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

  // 3) 「試合一覧を生成」ボタン
  const handleGenerate = async () => {
    if (selectedPlayerIds.length < 2) {
      alert("参加選手を2人以上選んでください");
      return;
    }

    setFinishedAll(false);
    setMatches([]);

    // ① 当日の対戦済みペアを取得
    const initialSameDayPairs = await loadSameDayPairs(selectedPlayerIds, date);

    // ② 対象選手だけを取り出す
    const playersForToday = allPlayers.filter((p) =>
      selectedPlayerIds.includes(p.id)
    );

    if (playersForToday.length < 2) {
      alert("参加選手を2人以上選んでください");
      return;
    }

    // ③ 1人あたりの最大試合数 = 参加人数 - 1（総当たり）
    const matchesPerPlayer = Math.max(1, playersForToday.length - 1);

    // ④ 各人が最大 matchesPerPlayer 試合できるように、
    //    その日の「全試合順」をまとめて作る
    const fullSchedule = generateFullSchedule({
      players: playersForToday,
      sameDayPairs: initialSameDayPairs,
      matchesPerPlayer,
    });

    if (fullSchedule.length === 0) {
      alert("条件を満たす試合組み合わせが作れませんでした。");
      return;
    }

    // ⑤ 試合番号を振って state に保存
    const numbered: MatchWithState[] = fullSchedule.map((m, idx) => ({
      ...m,
      matchNumber: idx + 1,
      status: "idle",
      winnerId: undefined,
    }));

    setMatches(numbered);
  };

  // 「試合進行中」の試合に参加している選手の ID 集合
  const busyPlayerIds = new Set<string>();
  matches.forEach((m) => {
    if (m.status === "in-progress") {
      busyPlayerIds.add(m.player1.id);
      busyPlayerIds.add(m.player2.id);
    }
  });

  const getPlayerTextClass = (match: MatchWithState, playerId: string) => {
    // この試合が「進行中」で、かつこの試合の選手 → 赤色
    if (
      match.status === "in-progress" &&
      (playerId === match.player1.id || playerId === match.player2.id)
    ) {
      return "text-red-400";
    }

    // 他の進行中試合に出ている選手 → 灰色
    if (busyPlayerIds.has(playerId)) {
      return "text-gray-400";
    }

    // どの進行中試合にも出ていない選手 → 白色
    return "text-white";
  };

  // 4) 勝者の選択
  const handleSelectWinner = (matchNumber: number, winnerId: string) => {
    setMatches((prev) =>
      prev.map((m) =>
        m.matchNumber === matchNumber ? { ...m, winnerId } : m
      )
    );
  };

  // 5) 試合結果を保存して、レートを更新
  const handleSaveResult = async (matchNumber: number) => {
    const target = matches.find((m) => m.matchNumber === matchNumber);
    if (!target) return;

    if (!target.winnerId) {
      alert("勝者を選択してください");
      return;
    }

    if (target.status === "finished") {
      alert("この試合はすでに結果が登録されています。");
      return;
    }

    setSaving(true);

    // 勝者・敗者を allPlayers から取得（最新レート）
    const winnerPlayer = allPlayers.find((p) => p.id === target.winnerId);
    const loserId =
      target.player1.id === target.winnerId
        ? target.player2.id
        : target.player1.id;
    const loserPlayer = allPlayers.find((p) => p.id === loserId);

    if (!winnerPlayer || !loserPlayer) {
      alert("選手情報の取得に失敗しました");
      setSaving(false);
      return;
    }

    // Elo レーティング計算（Home画面と同じロジック）
    const k = 32;
    const expectedW =
      1 / (1 + Math.pow(10, (loserPlayer.rating - winnerPlayer.rating) / 400));
    const expectedL =
      1 / (1 + Math.pow(10, (winnerPlayer.rating - loserPlayer.rating) / 400));

    const newWRating = Math.round(
      winnerPlayer.rating + k * (1 - expectedW)
    );
    const newLRating = Math.round(
      loserPlayer.rating + k * (0 - expectedL)
    );

    // ① matches テーブルに試合結果を保存（player_a / player_b / winner）
    const { error: matchError } = await supabase.from("matches").insert({
      player_a: target.player1.id,
      player_b: target.player2.id,
      winner: target.winnerId,
      // created_at は Supabase 側に任せる
    });

    if (matchError) {
      console.error("saveResult error:", matchError);
      alert("試合結果の保存に失敗しました");
      setSaving(false);
      return;
    }

    // ② players テーブルのレーティングを更新
    const { error: winnerUpdateError } = await supabase
      .from("players")
      .update({ rating: newWRating })
      .eq("id", winnerPlayer.id);

    const { error: loserUpdateError } = await supabase
      .from("players")
      .update({ rating: newLRating })
      .eq("id", loserPlayer.id);

    if (winnerUpdateError || loserUpdateError) {
      console.error("rating update error:", {
        winnerUpdateError,
        loserUpdateError,
      });
      alert("試合結果は保存されましたが、レーティング更新に失敗しました");
    } else {
      // ローカル状態のレートも更新しておく
      setAllPlayers((prev) =>
        prev.map((p) => {
          if (p.id === winnerPlayer.id) {
            return { ...p, rating: newWRating };
          }
          if (p.id === loserPlayer.id) {
            return { ...p, rating: newLRating };
          }
          return p;
        })
      );
    }

    // ③ sameDayPairs を更新（この日、この2人は対戦済み）
    const updatedSameDayPairs = addPairToSameDaySet(
      sameDayPairs,
      target.player1.id,
      target.player2.id
    );
    setSameDayPairs(updatedSameDayPairs);

    // ④ この試合を finished に変更
    const nextMatches = matches.map((m) =>
      m.matchNumber === matchNumber
        ? { ...m, status: "finished" as MatchStatus }
        : m
    );
    setMatches(nextMatches);

    setSaving(false);

    // ⑤ 全試合終わっているかチェック
    const allFinished = nextMatches.every((m) => m.status === "finished");
    if (allFinished) {
      setFinishedAll(true);
    }
  };

  // 6) 「試合進行中」トグル
  const handleToggleInProgress = (matchNumber: number) => {
    setMatches((prev) =>
      prev.map((m) => {
        if (m.matchNumber !== matchNumber) return m;
        if (m.status === "finished") return m; // 終了後は進行中にしない
        const nextStatus: MatchStatus =
          m.status === "in-progress" ? "idle" : "in-progress";
        return {
          ...m,
          status: nextStatus,
        };
      })
    );
  };

  // 7) 「試合進行状態リセット」（状態だけ）
  const handleResetStatus = () => {
    setMatches((prev) =>
      prev.map((m) => ({
        ...m,
        status: "idle" as MatchStatus,
        winnerId: m.winnerId, // 勝敗はそのまま
      }))
    );
    setFinishedAll(false);
  };

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-bold mb-2">オートマッチング（全試合一覧）</h1>

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
          <label className="block text-sm font-medium">
            参加選手（複数選択）
          </label>
          <div className="border rounded p-2 max-h-60 overflow-auto space-y-1 bg-white">
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
          onClick={handleGenerate}
          className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
          disabled={selectedPlayerIds.length < 2}
        >
          本日の試合一覧を生成
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={handleResetStatus}
            className="px-3 py-1 border rounded text-sm"
          >
            試合進行状態をリセット
          </button>
          {finishedAll && (
            <span className="text-sm text-green-700">
              全ての試合の結果が登録されました。
            </span>
          )}
        </div>
      </section>

      {/* 試合一覧 */}
      <section className="space-y-2">
        <h2 className="font-semibold mt-2">試合一覧</h2>
        {matches.length === 0 && (
          <div className="text-sm text-gray-500">
            まだ試合が生成されていません。
          </div>
        )}

        <div className="space-y-2">
          {matches
            .slice()
            .sort((a, b) => a.matchNumber - b.matchNumber)
            .map((m) => (
              <div
                key={m.matchNumber}
                className={`border rounded p-3 bg-slate-800 text-sm ${
                  m.status === "finished" ? "opacity-70" : ""
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="font-semibold text-white">
                    試合 {m.matchNumber}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-300">
                      状態:{" "}
                      {m.status === "idle"
                        ? "未開始"
                        : m.status === "in-progress"
                        ? "進行中"
                        : "終了"}
                    </span>
                    <button
                      onClick={() => handleToggleInProgress(m.matchNumber)}
                      disabled={m.status === "finished"}
                      className={`px-2 py-1 rounded text-xs border ${
                        m.status === "in-progress"
                          ? "bg-yellow-500 text-black border-yellow-400"
                          : "bg-slate-700 text-white border-slate-500"
                      } disabled:opacity-50`}
                    >
                      試合進行中
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between mb-2">
                  <div className="flex flex-col gap-1">
                    <div className={getPlayerTextClass(m, m.player1.id)}>
                      {m.player1.name}（{Math.round(m.player1.rating)}）
                    </div>
                    <div className={getPlayerTextClass(m, m.player2.id)}>
                      {m.player2.name}（{Math.round(m.player2.rating)}）
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    <select
                      value={m.winnerId ?? ""}
                      onChange={(e) =>
                        handleSelectWinner(m.matchNumber, e.target.value)
                      }
                      disabled={m.status === "finished"}
                      className="border rounded px-2 py-1 text-xs bg-white text-gray-900"
                    >
                      <option value="">勝者を選択</option>
                      <option value={m.player1.id}>{m.player1.name}</option>
                      <option value={m.player2.id}>{m.player2.name}</option>
                    </select>
                    <button
                      onClick={() => handleSaveResult(m.matchNumber)}
                      disabled={saving || m.status === "finished"}
                      className="px-3 py-1 bg-green-600 text-white rounded text-xs disabled:opacity-50"
                    >
                      結果を保存
                    </button>
                  </div>
                </div>
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}
