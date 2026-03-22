"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { getPatients, deletePatient, type Patient } from "@/lib/storage";
import { UserPlus, FileText, Trash2, ChevronRight, Search } from "lucide-react";

const CARE_LEVEL_BADGE: Record<string, string> = {
  "要支援1": "badge-green",
  "要支援2": "badge-green",
  "要介護1": "badge-blue",
  "要介護2": "badge-blue",
  "要介護3": "badge-yellow",
  "要介護4": "badge-orange",
  "要介護5": "badge-red",
};

const KANA_GROUPS = [
  { label: "あ行", chars: "あいうえおアイウエオ" },
  { label: "か行", chars: "かきくけこがぎぐげごカキクケコガギグゲゴ" },
  { label: "さ行", chars: "さしすせそざじずぜぞサシスセソザジズゼゾ" },
  { label: "た行", chars: "たちつてとだぢづでどタチツテトダヂヅデド" },
  { label: "な行", chars: "なにぬねのナニヌネノ" },
  { label: "は行", chars: "はひふへほばびぶべぼぱぴぷぺぽハヒフヘホバビブベボパピプペポ" },
  { label: "ま行", chars: "まみむめもマミムメモ" },
  { label: "や行", chars: "やゆよヤユヨ" },
  { label: "ら行", chars: "らりるれろラリルレロ" },
  { label: "わ行", chars: "わをんワヲンヴ" },
];

function getKanaGroup(patient: Patient): string {
  const kana = patient.nameKana?.trim();
  if (!kana) return "その他";
  const firstChar = kana.charAt(0);
  for (const group of KANA_GROUPS) {
    if (group.chars.includes(firstChar)) return group.label;
  }
  return "その他";
}

export default function PatientsPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  useEffect(() => {
    setPatients(getPatients());
  }, []);

  function handleDelete(id: string, name: string) {
    if (!confirm(`${name} 様の情報と全記録を削除しますか？`)) return;
    deletePatient(id);
    setPatients(getPatients());
  }

  // 検索フィルタ
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return patients;
    const q = searchQuery.trim().toLowerCase();
    return patients.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.nameKana && p.nameKana.toLowerCase().includes(q)) ||
        p.diagnosis.toLowerCase().includes(q) ||
        (p.nurseInCharge && p.nurseInCharge.toLowerCase().includes(q))
    );
  }, [patients, searchQuery]);

  // あかさたなグループ分け
  const grouped = useMemo(() => {
    const map = new Map<string, Patient[]>();
    for (const p of filtered) {
      const group = getKanaGroup(p);
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push(p);
    }
    // あかさたな順にソート
    const order = [...KANA_GROUPS.map((g) => g.label), "その他"];
    return order
      .filter((label) => map.has(label))
      .map((label) => ({ label, patients: map.get(label)! }));
  }, [filtered]);

  // 存在するグループだけタブに表示
  const availableGroups = useMemo(() => grouped.map((g) => g.label), [grouped]);

  // activeGroupフィルタ
  const displayed = activeGroup
    ? grouped.filter((g) => g.label === activeGroup)
    : grouped;

  return (
    <div className="min-h-screen relative z-[1]">
      {/* Header */}
      <header className="app-header">
        <div className="app-header-inner justify-between">
          <div>
            <div className="logo-badge">Well-Link AI</div>
            <h1>AI訪問看護記録アシスト</h1>
            <p className="subtitle">利用者一覧（{patients.length}名）</p>
          </div>
          <Link href="/patients/new" className="btn-outline">
            <UserPlus size={16} />
            利用者追加
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 relative z-[1]">
        {patients.length === 0 ? (
          <div className="empty-state animate-fade-in-up">
            <FileText size={52} className="empty-state-icon" />
            <p className="text-lg font-medium" style={{ color: "var(--text-secondary)" }}>利用者が登録されていません</p>
            <p className="text-sm mt-2" style={{ color: "var(--text-muted)" }}>「利用者追加」から登録してください</p>
          </div>
        ) : (
          <div className="space-y-4 animate-fade-in-up">
            {/* Search Bar */}
            <div className="relative">
              <Search
                size={18}
                className="absolute left-4 top-1/2 -translate-y-1/2"
                style={{ color: "var(--text-muted)" }}
              />
              <input
                type="text"
                className="input-field"
                style={{ paddingLeft: "44px" }}
                placeholder="名前・ふりがな・疾患・担当で検索"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* あかさたな tabs */}
            {!searchQuery.trim() && availableGroups.length > 1 && (
              <div className="flex gap-1.5 flex-wrap">
                <button
                  onClick={() => setActiveGroup(null)}
                  className="text-xs px-3 py-1.5 rounded-full font-medium transition-colors"
                  style={{
                    background: activeGroup === null ? "var(--accent-cyan)" : "var(--bg-tertiary)",
                    color: activeGroup === null ? "#fff" : "var(--text-secondary)",
                  }}
                >
                  すべて
                </button>
                {availableGroups.map((label) => (
                  <button
                    key={label}
                    onClick={() => setActiveGroup(activeGroup === label ? null : label)}
                    className="text-xs px-3 py-1.5 rounded-full font-medium transition-colors"
                    style={{
                      background: activeGroup === label ? "var(--accent-cyan)" : "var(--bg-tertiary)",
                      color: activeGroup === label ? "#fff" : "var(--text-secondary)",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {/* Grouped List */}
            {filtered.length === 0 ? (
              <div className="empty-state">
                <p style={{ color: "var(--text-muted)" }}>該当する利用者が見つかりません</p>
              </div>
            ) : (
              <div className="space-y-5">
                {displayed.map(({ label, patients: groupPatients }) => (
                  <div key={label}>
                    {/* Group Header */}
                    {(displayed.length > 1 || activeGroup) && (
                      <div
                        className="flex items-center gap-2 mb-2 px-1"
                      >
                        <span
                          className="text-xs font-bold px-2.5 py-1 rounded-md"
                          style={{ background: "var(--bg-tertiary)", color: "var(--accent-cyan)" }}
                        >
                          {label}
                        </span>
                        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                          {groupPatients.length}名
                        </span>
                        <div className="flex-1 h-px" style={{ background: "var(--bg-tertiary)" }} />
                      </div>
                    )}

                    <ul className="space-y-2">
                      {groupPatients.map((p) => (
                        <li key={p.id} className="card card-interactive overflow-hidden">
                          <div className="flex items-center">
                            <Link
                              href={`/patients/${p.id}`}
                              className="flex-1 flex items-center gap-4 px-5 py-4 transition-colors"
                            >
                              <div className="avatar">
                                {p.name.charAt(0)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold text-lg" style={{ color: "var(--text-primary)" }}>{p.name} 様</span>
                                  {p.careLevel !== "なし" && (
                                    <span className={`badge ${CARE_LEVEL_BADGE[p.careLevel] ?? "badge-gray"}`}>
                                      {p.careLevel}
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>{p.age}歳　{p.diagnosis}</p>
                                {p.nurseInCharge && (
                                  <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>担当：{p.nurseInCharge}</p>
                                )}
                              </div>
                              <ChevronRight size={20} style={{ color: "var(--text-muted)" }} className="flex-shrink-0" />
                            </Link>
                            <button
                              onClick={() => handleDelete(p.id, p.name)}
                              className="btn-delete mr-2"
                              aria-label="削除"
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
