"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getPatients, deletePatient, type Patient } from "@/lib/storage";
import { UserPlus, FileText, Trash2, ChevronRight } from "lucide-react";

const CARE_LEVEL_COLOR: Record<string, string> = {
  "要支援1": "bg-green-100 text-green-700",
  "要支援2": "bg-green-100 text-green-700",
  "要介護1": "bg-blue-100 text-blue-700",
  "要介護2": "bg-blue-100 text-blue-700",
  "要介護3": "bg-yellow-100 text-yellow-700",
  "要介護4": "bg-orange-100 text-orange-700",
  "要介護5": "bg-red-100 text-red-700",
};

export default function PatientsPage() {
  const [patients, setPatients] = useState<Patient[]>([]);

  useEffect(() => {
    setPatients(getPatients());
  }, []);

  function handleDelete(id: string, name: string) {
    if (!confirm(`${name} 様の情報と全記録を削除しますか？`)) return;
    deletePatient(id);
    setPatients(getPatients());
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-blue-700 text-white px-4 py-4 shadow">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">AI訪問看護記録アシスト</h1>
            <p className="text-blue-200 text-sm mt-0.5">利用者一覧</p>
          </div>
          <Link
            href="/patients/new"
            className="flex items-center gap-2 bg-white text-blue-700 font-semibold px-4 py-2 rounded-full text-sm shadow hover:bg-blue-50 transition"
          >
            <UserPlus size={16} />
            利用者追加
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {patients.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <FileText size={48} className="mx-auto mb-4 opacity-40" />
            <p className="text-lg">利用者が登録されていません</p>
            <p className="text-sm mt-2">「利用者追加」から登録してください</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {patients.map((p) => (
              <li key={p.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="flex items-center">
                  <Link
                    href={`/patients/${p.id}`}
                    className="flex-1 flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition"
                  >
                    {/* アバター */}
                    <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-lg flex-shrink-0">
                      {p.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900 text-lg">{p.name} 様</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CARE_LEVEL_COLOR[p.careLevel] ?? "bg-gray-100 text-gray-600"}`}>
                          {p.careLevel}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 mt-0.5">{p.age}歳　{p.diagnosis}</p>
                      <p className="text-xs text-gray-400 mt-0.5">担当：{p.nurseInCharge}</p>
                    </div>
                    <ChevronRight size={20} className="text-gray-300 flex-shrink-0" />
                  </Link>
                  <button
                    onClick={() => handleDelete(p.id, p.name)}
                    className="px-4 py-4 text-red-300 hover:text-red-500 hover:bg-red-50 transition"
                    aria-label="削除"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
