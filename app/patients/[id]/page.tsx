"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getPatients, getRecords, deleteRecord, type Patient, type SoapRecord } from "@/lib/storage";
import { ArrowLeft, PlusCircle, Copy, Trash2, ChevronDown, ChevronUp, Pencil } from "lucide-react";

export default function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [records, setRecords] = useState<SoapRecord[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const p = getPatients().find((p) => p.id === id) ?? null;
    setPatient(p);
    const r = getRecords(id).sort((a, b) => b.visitDate.localeCompare(a.visitDate));
    setRecords(r);
  }, [id]);

  function handleDelete(recordId: string) {
    if (!confirm("この記録を削除しますか？")) return;
    deleteRecord(recordId);
    setRecords(getRecords(id).sort((a, b) => b.visitDate.localeCompare(a.visitDate)));
  }

  function handleCopy(record: SoapRecord) {
    const text =
      `【訪問日】${record.visitDate}\n` +
      `S: ${record.S}\n` +
      `O: ${record.O}\n` +
      `A: ${record.A}\n` +
      `P: ${record.P}`;
    navigator.clipboard.writeText(text);
    setCopied(record.id);
    setTimeout(() => setCopied(null), 2000);
  }

  if (!patient) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-400">
        読み込み中...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-700 text-white px-4 py-4 shadow">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link href="/patients" className="text-blue-200 hover:text-white">
            <ArrowLeft size={22} />
          </Link>
          <div className="flex-1">
            <h1 className="text-xl font-bold">{patient.name} 様</h1>
            <p className="text-blue-200 text-sm">{patient.age}歳　{patient.careLevel}　{patient.diagnosis}</p>
          </div>
          <Link
            href={`/patients/${id}/edit`}
            className="text-blue-200 hover:text-white p-1"
            aria-label="編集"
          >
            <Pencil size={20} />
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* 新規記録ボタン */}
        <Link
          href={`/patients/${id}/records/new`}
          className="flex items-center justify-center gap-2 w-full bg-blue-700 text-white font-bold py-4 rounded-xl text-lg hover:bg-blue-800 transition shadow mb-6"
        >
          <PlusCircle size={22} />
          今日の訪問を記録する
        </Link>

        {/* 記録一覧 */}
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          訪問記録（{records.length}件）
        </h2>

        {records.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p>記録がまだありません</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {records.map((r) => (
              <li key={r.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                {/* 記録ヘッダー */}
                <div className="flex items-center px-5 py-3 border-b border-gray-50">
                  <button
                    className="flex-1 flex items-center gap-3 text-left"
                    onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  >
                    <span className="font-semibold text-gray-800">{r.visitDate}</span>
                    {expandedId === r.id
                      ? <ChevronUp size={18} className="text-gray-400" />
                      : <ChevronDown size={18} className="text-gray-400" />}
                  </button>
                  <button
                    onClick={() => handleCopy(r)}
                    className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 px-3 py-1 rounded-lg hover:bg-blue-50 transition"
                  >
                    <Copy size={16} />
                    {copied === r.id ? "コピー済！" : "コピー"}
                  </button>
                  <button
                    onClick={() => handleDelete(r.id)}
                    className="text-red-300 hover:text-red-500 hover:bg-red-50 p-2 rounded-lg transition"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                {/* SOAP詳細（展開時） */}
                {expandedId === r.id && (
                  <div className="px-5 py-4 space-y-3 text-sm">
                    {[
                      { label: "S（主観的情報）", value: r.S, color: "border-blue-400" },
                      { label: "O（客観的情報）", value: r.O, color: "border-green-400" },
                      { label: "A（アセスメント）", value: r.A, color: "border-yellow-400" },
                      { label: "P（プラン）", value: r.P, color: "border-purple-400" },
                    ].map(({ label, value, color }) => (
                      <div key={label} className={`border-l-4 ${color} pl-3`}>
                        <p className="text-xs font-semibold text-gray-500 mb-0.5">{label}</p>
                        <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">{value}</p>
                      </div>
                    ))}
                    {r.rawInput && (
                      <div className="mt-3 pt-3 border-t border-gray-100">
                        <p className="text-xs text-gray-400">元の入力：{r.rawInput}</p>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
