"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { getPatients, saveRecord, generateId, type Patient } from "@/lib/storage";
import { ArrowLeft, Sparkles, Save } from "lucide-react";
import Link from "next/link";

interface Soap {
  S: string;
  O: string;
  A: string;
  P: string;
}

export default function NewRecordPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [visitDate, setVisitDate] = useState(new Date().toISOString().slice(0, 10));
  const [rawInput, setRawInput] = useState("");
  const [soap, setSoap] = useState<Soap>({ S: "", O: "", A: "", P: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const p = getPatients().find((p) => p.id === id) ?? null;
    setPatient(p);
  }, [id]);

  async function handleGenerate() {
    if (!rawInput.trim()) return alert("訪問内容を入力してください");
    if (!patient) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/soap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawInput,
          age: patient.age,
          careLevel: patient.careLevel,
          diagnosis: patient.diagnosis,
          carePlan: patient.carePlan,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "エラーが発生しました");
      }
      const data: Soap = await res.json();
      setSoap(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  function handleSave() {
    if (!soap.S && !soap.O) return alert("先にAI変換を行ってください");
    saveRecord({
      id: generateId(),
      patientId: id,
      visitDate,
      rawInput,
      S: soap.S,
      O: soap.O,
      A: soap.A,
      P: soap.P,
      createdAt: new Date().toISOString(),
    });
    router.push(`/patients/${id}`);
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <header className="bg-blue-700 text-white px-4 py-4 shadow">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link href={`/patients/${id}`} className="text-blue-200 hover:text-white">
            <ArrowLeft size={22} />
          </Link>
          <div>
            <h1 className="text-xl font-bold">訪問記録を作成</h1>
            {patient && <p className="text-blue-200 text-sm">{patient.name} 様</p>}
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        {/* 訪問日 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <label className="block text-sm font-semibold text-gray-700 mb-2">訪問日</label>
          <input
            type="date"
            className="w-full border border-gray-300 rounded-lg px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
            value={visitDate}
            onChange={(e) => setVisitDate(e.target.value)}
          />
        </div>

        {/* 訪問内容入力 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            訪問内容を話し言葉で入力
          </label>
          <p className="text-xs text-gray-400 mb-3">
            バイタル・症状・処置・会話など、気になったことを自由に入力してください
          </p>
          <textarea
            rows={6}
            className="w-full border border-gray-300 rounded-lg px-4 py-3 text-base leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
            placeholder="例：血圧168/92でいつもより高め。本人は頭痛なし、めまいもないと言っている。足首に軽度の浮腫あり。昨日より少し良くなっている。右踵の褥瘡処置実施、滲出液少量、感染兆候なし。食欲は普通。"
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
          />
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="mt-3 w-full flex items-center justify-center gap-2 bg-blue-600 text-white font-bold py-4 rounded-xl text-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed shadow"
          >
            <Sparkles size={20} />
            {loading ? "AI変換中..." : "AIでSOAPに変換"}
          </button>
          {error && (
            <p className="mt-2 text-red-500 text-sm bg-red-50 rounded-lg p-3">{error}</p>
          )}
        </div>

        {/* SOAP表示・編集 */}
        {(soap.S || soap.O) && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-700">SOAP記録（修正可能）</h2>
            {[
              { key: "S" as const, label: "S（主観的情報）", color: "border-blue-400", placeholder: "利用者・家族の訴え、主観的な情報" },
              { key: "O" as const, label: "O（客観的情報）", color: "border-green-400", placeholder: "バイタル、観察所見、処置内容など" },
              { key: "A" as const, label: "A（アセスメント）", color: "border-yellow-400", placeholder: "状態の評価・判断" },
              { key: "P" as const, label: "P（プラン）", color: "border-purple-400", placeholder: "今後の対応・継続ケアの方針" },
            ].map(({ key, label, color, placeholder }) => (
              <div key={key} className={`border-l-4 ${color} pl-4`}>
                <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
                <textarea
                  rows={3}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
                  placeholder={placeholder}
                  value={soap[key]}
                  onChange={(e) => setSoap({ ...soap, [key]: e.target.value })}
                />
              </div>
            ))}

            <button
              onClick={handleSave}
              className="w-full flex items-center justify-center gap-2 bg-green-600 text-white font-bold py-4 rounded-xl text-lg hover:bg-green-700 transition shadow"
            >
              <Save size={20} />
              記録を保存する
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
