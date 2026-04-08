"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { getPatients, getRecords, deletePatient, migrateLocalStorageToSupabase, type Patient } from "@/lib/storage";
import { getSupabase } from "@/lib/supabase";
import { UserPlus, FileText, Trash2, ChevronRight, Search, ClipboardList, User, Calendar, X, Phone, LogOut } from "lucide-react";

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

  // モーダル
  const [infoPatient, setInfoPatient] = useState<Patient | null>(null);
  const [appointPatient, setAppointPatient] = useState<Patient | null>(null);
  const [appointLoading, setAppointLoading] = useState(false);
  const [appointData, setAppointData] = useState<{
    appointments: { date: string; type: string; detail: string; source: string }[];
    notes?: string;
  } | null>(null);
  const [appointError, setAppointError] = useState("");

  useEffect(() => {
    (async () => {
      await migrateLocalStorageToSupabase();
      setPatients(await getPatients());
    })();
  }, []);

  async function handleDelete(id: string, name: string) {
    if (!confirm(`${name} 様の情報と全記録を削除しますか？`)) return;
    await deletePatient(id);
    setPatients(await getPatients());
  }

  async function handleOpenAppointments(patient: Patient) {
    setAppointPatient(patient);
    setAppointData(null);
    setAppointError("");
    setAppointLoading(true);
    const records = (await getRecords(patient.id)).sort((a, b) => b.visitDate.localeCompare(a.visitDate));
    if (records.length === 0) {
      setAppointError("記録がありません");
      setAppointLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/nursing-contents/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          records: records.slice(0, 5).map((r) => ({
            visitDate: r.visitDate, S: r.S, O: r.O, A: r.A, P: r.P,
          })),
          diagnosis: patient.diagnosis,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAppointData(data);
    } catch (e) {
      setAppointError(e instanceof Error ? e.message : "AI処理に失敗しました");
    } finally {
      setAppointLoading(false);
    }
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
          <div className="flex items-center gap-2">
            <Link href="/patients/new" className="btn-outline">
              <UserPlus size={16} />
              利用者追加
            </Link>
            <button
              onClick={() => { getSupabase().auth.signOut(); }}
              className="btn-outline"
              style={{ padding: "0.5rem", minWidth: "auto" }}
              title="ログアウト"
            >
              <LogOut size={16} />
            </button>
          </div>
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
                          <Link
                            href={`/patients/${p.id}`}
                            className="flex items-center gap-4 px-5 py-4 transition-colors"
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
                          {/* クイックアクションボタン */}
                          <div
                            className="flex items-center gap-2 px-5 pb-3"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Link href={`/patients/${p.id}/nursing-contents`} className="btn-quick">
                              <ClipboardList size={13} />
                              看護内容
                            </Link>
                            <button onClick={() => setInfoPatient(p)} className="btn-quick">
                              <User size={13} />
                              基本情報
                            </button>
                            <button onClick={() => handleOpenAppointments(p)} className="btn-quick">
                              <Calendar size={13} />
                              受診予定
                            </button>
                            <div className="flex-1" />
                            <button
                              onClick={() => handleDelete(p.id, p.name)}
                              className="btn-delete"
                              aria-label="削除"
                            >
                              <Trash2 size={16} />
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

      {/* 基本情報モーダル */}
      {infoPatient && (
        <div className="modal-overlay" onClick={() => setInfoPatient(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-handle" />
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg" style={{ color: "var(--text-primary)" }}>
                {infoPatient.name} 様の基本情報
              </h2>
              <button onClick={() => setInfoPatient(null)} className="btn-delete">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              {/* 利用者情報 */}
              <div className="space-y-1">
                <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>利用者情報</p>
                <p className="text-sm"><span style={{ color: "var(--text-muted)" }}>年齢：</span>{infoPatient.age}歳</p>
                <p className="text-sm"><span style={{ color: "var(--text-muted)" }}>介護度：</span>{infoPatient.careLevel}</p>
                <p className="text-sm"><span style={{ color: "var(--text-muted)" }}>主病名：</span>{infoPatient.diagnosis}</p>
                {infoPatient.nurseInCharge && (
                  <p className="text-sm"><span style={{ color: "var(--text-muted)" }}>担当：</span>{infoPatient.nurseInCharge}</p>
                )}
              </div>

              {/* 主治医（複数対応） */}
              {infoPatient.doctors && infoPatient.doctors.length > 0 && (
                infoPatient.doctors.map((doc, i) => (
                  <div key={i} className="space-y-1 p-3 rounded-lg" style={{ background: "var(--bg-tertiary)" }}>
                    <p className="text-xs font-semibold" style={{ color: "var(--accent-cyan)" }}>主治医{infoPatient.doctors!.length > 1 ? ` ${i + 1}` : ""}</p>
                    {doc.name && <p className="text-sm font-medium">{doc.name}</p>}
                    {doc.hospital && <p className="text-sm">{doc.hospital}</p>}
                    {doc.address && <p className="text-xs" style={{ color: "var(--text-muted)" }}>{doc.address}</p>}
                    {doc.phone && (
                      <a href={`tel:${doc.phone}`} className="inline-flex items-center gap-1 text-sm mt-1" style={{ color: "var(--accent-blue)" }}>
                        <Phone size={14} /> {doc.phone}
                      </a>
                    )}
                  </div>
                ))
              )}

              {/* ケアマネ（複数対応） */}
              {infoPatient.careManagers && infoPatient.careManagers.length > 0 && (
                infoPatient.careManagers.map((cm, i) => (
                  <div key={i} className="space-y-1 p-3 rounded-lg" style={{ background: "var(--bg-tertiary)" }}>
                    <p className="text-xs font-semibold" style={{ color: "var(--accent-magenta)" }}>ケアマネ{infoPatient.careManagers!.length > 1 ? ` ${i + 1}` : ""}</p>
                    {cm.name && <p className="text-sm font-medium">{cm.name}</p>}
                    {cm.office && <p className="text-sm">{cm.office}</p>}
                    {cm.address && <p className="text-xs" style={{ color: "var(--text-muted)" }}>{cm.address}</p>}
                    {cm.phone && (
                      <a href={`tel:${cm.phone}`} className="inline-flex items-center gap-1 text-sm mt-1" style={{ color: "var(--accent-blue)" }}>
                        <Phone size={14} /> {cm.phone}
                      </a>
                    )}
                  </div>
                ))
              )}

              {(!infoPatient.doctors || infoPatient.doctors.length === 0) && (!infoPatient.careManagers || infoPatient.careManagers.length === 0) && (
                <p className="text-sm text-center py-4" style={{ color: "var(--text-muted)" }}>
                  主治医・ケアマネ情報が未登録です。編集ページから登録できます。
                </p>
              )}

              <Link
                href={`/patients/${infoPatient.id}/edit`}
                className="btn-outline w-full justify-center"
                onClick={() => setInfoPatient(null)}
              >
                編集する
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* 受診予定モーダル */}
      {appointPatient && (
        <div className="modal-overlay" onClick={() => { setAppointPatient(null); setAppointData(null); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-handle" />
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg" style={{ color: "var(--text-primary)" }}>
                {appointPatient.name} 様の受診予定
              </h2>
              <button onClick={() => { setAppointPatient(null); setAppointData(null); }} className="btn-delete">
                <X size={20} />
              </button>
            </div>

            {appointLoading && (
              <div className="text-center py-8">
                <div className="animate-spin inline-block w-6 h-6 border-2 rounded-full" style={{ borderColor: "var(--accent-cyan)", borderTopColor: "transparent" }} />
                <p className="text-sm mt-2" style={{ color: "var(--text-muted)" }}>記録からAIが受診予定を抽出中...</p>
              </div>
            )}

            {appointError && (
              <div className="alert-error">{appointError}</div>
            )}

            {appointData && (
              <div className="space-y-3">
                {appointData.appointments.length > 0 ? (
                  appointData.appointments.map((apt, i) => (
                    <div
                      key={i}
                      className="p-3 rounded-lg space-y-1"
                      style={{ background: "var(--bg-tertiary)" }}
                    >
                      <div className="flex items-center gap-2">
                        <Calendar size={14} style={{ color: "var(--accent-cyan)" }} />
                        <span className="font-medium text-sm">{apt.date}</span>
                        <span className="badge badge-blue">{apt.type}</span>
                      </div>
                      <p className="text-sm" style={{ color: "var(--text-primary)" }}>{apt.detail}</p>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>出典：{apt.source}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-center py-4" style={{ color: "var(--text-muted)" }}>
                    直近の記録から受診予定は見つかりませんでした
                  </p>
                )}
                {appointData.notes && (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>{appointData.notes}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
