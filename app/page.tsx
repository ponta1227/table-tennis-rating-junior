"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import Link from "next/link";

type Player = {
  id: string;
  name: string;
  rating: number;
  team: string;
  role: string; // 「選手」or「コーチ」or「OB」
};

export default function Home() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [name, setName] = useState("");
  const [initialRating, setInitialRating] = useState(1500);
  const [winner, setWinner] = useState("");
  const [loser, setLoser] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetchPlayers();
  }, []);

  // ✅ P-CONNECT のみ取得
  async function fetchPlayers() {
    const { data } = await supabase
      .from("players")
      .select("*")
      .eq("team", "P-CONNECT")
      .order("rating", { ascending: false });
    if (data) setPlayers(data);
  }

  // ✅ 新規登録時は「選手」固定
  async function addPlayer() {
    if (!name) return;
    await supabase.from("players").insert([
      { name, rating: initialRating, team: "P-CONNECT", role: "選手" },
    ]);
    setName("");
    setInitialRating(1500);
    fetchPlayers();
  }

  // ✅ 試合結果登録
  async function recordMatch() {
    if (!winner || !loser) {
      alert("勝者と敗者を選んでください");
      return;
    }
    if (winner === loser) {
      alert("同じ選手を勝者と敗者に指定できません");
      return;
    }

    const w = players.find((p) => p.id === winner);
    const l = players.find((p) => p.id === loser);
    if (!w || !l) return;

    const k = 32;
    const expectedW = 1 / (1 + Math.pow(10, (l.rating - w.rating) / 400));
    const expectedL = 1 / (1 + Math.pow(10, (w.rating - l.rating) / 400));

    const newWRating = w.rating + k * (1 - expectedW);
    const newLRating = l.rating + k * (0 - expectedL);

    await supabase
      .from("players")
      .update({ rating: Math.round(newWRating) })
      .eq("id", w.id);
    await supabase
      .from("players")
      .update({ rating: Math.round(newLRating) })
      .eq("id", l.id);

    await supabase.from("matches").insert([{ winner_id: w.id, loser_id: l.id }]);

    await fetchPlayers();

    setMessage(`${w.name} VS ${l.name} の試合結果を送信しました！`);
    setWinner("");
    setLoser("");
    setTimeout(() => setMessage(""), 5000);
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center py-10 px-4 text-gray-900">
      <h1 className="text-3xl font-bold mb-4">
        🏓 卓球レーティング管理 (P-CONNECT専用)
      </h1>

      {/* ✅ オートマッチング画面へのリンクボタン */}
      <div className="mb-6">
        <Link href="/auto-matches" className="inline-block">
          <button className="bg-emerald-600 text-white px-4 py-2 rounded hover:bg-emerald-700 text-sm font-semibold">
            オートマッチング（台割り）画面を開く
          </button>
        </Link>
      </div>

      {/* ✅ メッセージ */}
      {message && (
        <div className="mb-6 p-4 bg-green-100 border border-green-400 text-green-800 rounded">
          {message}
        </div>
      )}

      {/* ✅ 選手登録フォーム */}
      <div className="bg-white p-6 rounded-lg shadow-md w-full max-w-md mb-8">
        <h2 className="text-xl font-semibold mb-4">選手登録</h2>
        <div className="flex flex-col gap-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="選手名を入力"
            className="border p-2 rounded w-full"
          />
          <input
            type="number"
            value={initialRating}
            onChange={(e) => setInitialRating(Number(e.target.value))}
            placeholder="初期レーティング (例: 1500)"
            className="border p-2 rounded w-full"
          />
          <button
            onClick={addPlayer}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          >
            登録
          </button>
        </div>
      </div>

      {/* ✅ 試合結果入力 */}
      <div className="bg-white p-6 rounded-lg shadow-md w-full max-w-md mb-8">
        <h2 className="text-xl font-semibold mb-4">試合結果入力</h2>
        <div className="flex flex-col gap-4">
          <select
            value={winner}
            onChange={(e) => setWinner(e.target.value)}
            className="border p-2 rounded"
          >
            <option value="">勝者を選択</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <select
            value={loser}
            onChange={(e) => setLoser(e.target.value)}
            className="border p-2 rounded"
          >
            <option value="">敗者を選択</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <button
            onClick={recordMatch}
            className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
          >
            結果を登録
          </button>
        </div>
      </div>

      {/* ✅ 順位一覧（選手のみ） */}
      <div className="bg-white p-6 rounded-lg shadow-md w-full max-w-2xl">
        <h2 className="text-xl font-semibold mb-4">ランキング</h2>
        <table className="w-full border-collapse">
          <thead className="bg-gray-200">
            <tr>
              <th className="p-2">順位</th>
              <th className="p-2">名前</th>
              <th className="p-2">レート</th>
            </tr>
          </thead>
          <tbody>
            {players
              .filter((p) => p.role === "選手")
              .map((p, index) => (
                <tr
                  key={p.id}
                  className="border-b hover:bg-gray-50 text-gray-900"
                >
                  <td className="p-2">{index + 1}</td>
                  <td className="p-2">{p.name}</td>
                  <td className="p-2">{p.rating}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
