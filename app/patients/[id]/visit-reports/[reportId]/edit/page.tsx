"use client";

/**
 * 月次報告書 編集ページ
 */

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getPatients, getVisitReport, type Patient, type VisitReport } from "@/lib/storage";
import { ArrowLeft, Home } from "lucide-react";
import VisitReportForm from "../../_components/VisitReportForm";

export default function EditVisitReportPage() {
  const { id, reportId } = useParams<{ id: string; reportId: string }>();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [report, setReport] = useState<VisitReport | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const p = (await getPatients()).find((x) => x.id === id) ?? null;
      setPatient(p);
      const r = await getVisitReport(reportId);
      setReport(r);
      setLoaded(true);
    })();
  }, [id, reportId]);

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ color: "var(--text-muted)" }}>
        読み込み中...
      </div>
    );
  }

  if (!patient || !report) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ color: "var(--text-muted)" }}>
        報告書が見つかりません
      </div>
    );
  }

  return (
    <div className="min-h-screen relative z-[1]">
      <header className="app-header">
        <div className="app-header-inner">
          <Link href={`/patients/${id}/visit-reports`} className="header-back" aria-label="戻る">
            <ArrowLeft size={22} />
          </Link>
          <div className="flex-1">
            <h1>月次報告書の編集</h1>
            <p className="subtitle">{patient.name} 様 / {report.targetMonth}</p>
          </div>
          <Link href="/patients" className="header-action" aria-label="患者一覧へ戻る" title="患者一覧へ戻る">
            <Home size={20} />
          </Link>
        </div>
      </header>

      <VisitReportForm patient={patient} mode="edit" initialReport={report} />
    </div>
  );
}
