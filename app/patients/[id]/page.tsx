"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getPatients, getRecordsByYearMonth, getRecordMonths, getRecords,
  deleteRecord, type Patient, type SoapRecord,
} from "@/lib/storage";
import { ArrowLeft, PlusCircle, Copy, Trash2, ChevronDown, ChevronUp, Pencil, FolderOpen, Folder, ClipboardList, Shield } from "lucide-react";

export default function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [months, setMonths] = useState<{ year: number; month: number; label: string; count: number }[]>([]);
  const [openMonth, setOpenMonth] = useState<string | null>(null);
  const [monthRecords, setMonthRecords] = useState<SoapRecord[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    (async () => {
      const p = (await getPatients()).find((p) => p.id === id) ?? null;
      setPatient(p);
      const ms = await getRecordMonths(id);
      setMonths(ms);
      setTotalCount(ms.reduce((sum, m) => sum + m.count, 0));
      if (ms.length > 0) {
        const first = ms[0];
        const key = `${first.year}-${first.month}`;
        setOpenMonth(key);
        const records = await getRecordsByYearMonth(id, first.year, first.month);
        setMonthRecords(records.sort((a, b) => b.visitDate.localeCompare(a.visitDate)));
      }
    })();
  }, [id]);

  async function toggleMonth(year: number, month: number) {
    const key = `${year}-${month}`;
    if (openMonth === key) {
      setOpenMonth(null);
      setMonthRecords([]);
    } else {
      setOpenMonth(key);
      const records = await getRecordsByYearMonth(id, year, month);
      setMonthRecords(records.sort((a, b) => b.visitDate.localeCompare(a.visitDate)));
    }
  }

  async function handleDelete(recordId: string) {
    if (!confirm("この記録を削除しますか？")) return;
    await deleteRecord(recordId);
    const ms = await getRecordMonths(id);
    setMonths(ms);
    setTotalCount(ms.reduce((sum, m) => sum + m.count, 0));
    if (openMonth) {
      const [y, m] = openMonth.split("-").map(Number);
      const records = await getRecordsByYearMonth(id, y, m);
      setMonthRecords(records.sort((a, b) => b.visitDate.localeCompare(a.visitDate)));
    }
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

  async function handleCopyMonth(year: number, month: number) {
    const records = (await getRecordsByYearMonth(id, year, month)).sort((a, b) => a.visitDate.localeCompare(b.visitDate));
    const text = records.map(r =>
      `【訪問日】${r.visitDate}\nS: ${r.S}\nO: ${r.O}\nA: ${r.A}\nP: ${r.P}`
    ).join("\n\n---\n\n");
    navigator.clipboard.writeText(text);
    setCopied(`month-${year}-${month}`);
    setTimeout(() => setCopied(null), 2000);
  }

  if (!patient) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ color: "var(--text-muted)" }}>
        読み込み中...
      </div>
    );
  }

  return (
    <div className="min-h-screen relative z-[1]">
      <header className="app-header">
        <div className="app-header-inner">
          <Link href="/patients" className="header-back" aria-label="戻る">
            <ArrowLeft size={22} />
          </Link>
          <div className="flex-1">
            <h1>{patient.name} 様</h1>
            <p className="subtitle">{patient.age}歳　{patient.careLevel !== "なし" ? `${patient.careLevel}　` : ""}{patient.diagnosis}</p>
          </div>
          <Link href={`/patients/${id}/edit`} className="header-action" aria-label="編集">
            <Pencil size={20} />
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 relative z-[1]">
        {/* 看護内容リストへのショートカット */}
        <Link
          href={`/patients/${id}/nursing-contents`}
          className="btn-outline w-full justify-center mb-3 animate-fade-in-up"
        >
          <ClipboardList size={18} />
          看護内容リストを確認する
        </Link>

        {/* 褥瘡計画書 */}
        <Link
          href={`/patients/${id}/pressure-ulcer-plan`}
          className="btn-outline w-full justify-center mb-3 animate-fade-in-up"
        >
          <Shield size={18} />
          褥瘡計画書
        </Link>

        {/* New Record Button */}
        <Link
          href={`/patients/${id}/records/new`}
          className="btn-primary mb-6 animate-fade-in-up"
        >
          <PlusCircle size={22} />
          今日の訪問を記録する
        </Link>

        {/* Monthly Folders */}
        <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-muted)" }}>
          訪問記録（全{totalCount}件）
        </h2>

        {months.length === 0 ? (
          <div className="empty-state">
            <p>記録がまだありません</p>
          </div>
        ) : (
          <div className="space-y-3 stagger">
            {months.map(({ year, month, label, count }) => {
              const key = `${year}-${month}`;
              const isOpen = openMonth === key;
              const monthKey = `month-${year}-${month}`;

              return (
                <div key={key} className="card overflow-hidden">
                  {/* Month Folder Header */}
                  <div className="folder-header" style={{ borderBottom: isOpen ? "1px solid rgba(0,0,0,0.04)" : "none" }}>
                    <button
                      className="flex-1 flex items-center gap-3 text-left"
                      onClick={() => toggleMonth(year, month)}
                    >
                      {isOpen
                        ? <FolderOpen size={18} style={{ color: "var(--accent-cyan)" }} />
                        : <Folder size={18} style={{ color: "var(--text-muted)" }} />}
                      <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{label}</span>
                      <span className="folder-count">{count}件</span>
                      {isOpen
                        ? <ChevronUp size={16} style={{ color: "var(--text-muted)" }} className="ml-auto" />
                        : <ChevronDown size={16} style={{ color: "var(--text-muted)" }} className="ml-auto" />}
                    </button>
                    <button
                      onClick={() => handleCopyMonth(year, month)}
                      className={`btn-copy ml-2 ${copied === monthKey ? "btn-copy-success" : ""}`}
                    >
                      <Copy size={14} />
                      {copied === monthKey ? "コピー済！" : "月まとめコピー"}
                    </button>
                  </div>

                  {/* Records within month */}
                  {isOpen && (
                    <ul>
                      {monthRecords.map((r) => (
                        <li key={r.id} style={{ borderBottom: "1px solid rgba(0,0,0,0.03)" }}>
                          <div className="flex items-center px-5 py-3">
                            <button
                              className="flex-1 flex items-center gap-3 text-left"
                              onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                            >
                              <span className="font-medium text-sm" style={{ color: "var(--text-secondary)" }}>{r.visitDate}</span>
                              <span className="text-xs truncate max-w-[160px]" style={{ color: "var(--text-muted)" }}>{r.S.slice(0, 30)}…</span>
                              {expandedId === r.id
                                ? <ChevronUp size={16} style={{ color: "var(--text-muted)" }} className="ml-auto" />
                                : <ChevronDown size={16} style={{ color: "var(--text-muted)" }} className="ml-auto" />}
                            </button>
                            <button
                              onClick={() => handleCopy(r)}
                              className={`btn-copy ${copied === r.id ? "btn-copy-success" : ""}`}
                            >
                              <Copy size={14} />
                              {copied === r.id ? "コピー済！" : "コピー"}
                            </button>
                            <Link
                              href={`/patients/${id}/records/${r.id}/edit`}
                              className="btn-copy"
                              aria-label="記録を編集"
                              title="記録を編集"
                            >
                              <Pencil size={14} />
                              編集
                            </Link>
                            <button
                              onClick={() => handleDelete(r.id)}
                              className="btn-delete"
                              aria-label="記録を削除"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>

                          {expandedId === r.id && (
                            <div className="px-5 pb-4 space-y-3 text-sm animate-fade-in" style={{ background: "var(--bg-tertiary)" }}>
                              {[
                                { label: "S（主観的情報）", value: r.S, cls: "soap-s" },
                                { label: "O（客観的情報）", value: r.O, cls: "soap-o" },
                                { label: "A（アセスメント）", value: r.A, cls: "soap-a" },
                                { label: "P（プラン）", value: r.P, cls: "soap-p" },
                              ].map(({ label, value, cls }) => (
                                <div key={label} className={`soap-section ${cls} py-2`}>
                                  <p className="text-xs font-semibold mb-0.5" style={{ color: "var(--text-muted)" }}>{label}</p>
                                  <p style={{ color: "var(--text-primary)" }} className="leading-relaxed whitespace-pre-wrap">{value}</p>
                                </div>
                              ))}
                              {r.rawInput && (
                                <div className="pt-2" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>元の入力：{r.rawInput}</p>
                                </div>
                              )}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
