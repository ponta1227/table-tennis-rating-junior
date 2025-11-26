"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabaseClient";

type Player = {
  id: string;
  name: string;
  rating: number;
  team: string;
  role: string;
};

export default function Ranking() {
  const [players, setPlayers] = useState<Player[]>([]);

  useEffect(() => {
    fetchPlayers();
  }, []);

  async function fetchPlayers() {
    const { data } = await supabase
      .from("players")
      .select("*")
      .eq("team", "P-CONNECT")
      .eq("role", "選手")
      .order("rating", { ascending: false });
    if (data) setPlayers(data);
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center py-10 px-4 text-gray-900">
      <h1 className="text-3xl font-bold mb-8">🏓 P-CONNECT ランキング（選手のみ）</h1>
      <table className="w-full max-w-2xl border-collapse bg-white shadow-md rounded-lg text-lg">
        <thead className="bg-gray-200">
          <tr>
            <th className="p-2">順位</th>
            <th className="p-2">名前</th>
            <th className="p-2">レート</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p, index) => (
            <tr key={p.id} className="border-b hover:bg-gray-50 text-gray-900">
              <td className="p-2">{index + 1}</td>
              <td className="p-2">{p.name}</td>
              <td className="p-2">{p.rating}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
