"use client";

/**
 * 褥瘡計画書 新規作成ページ（複製モード対応）
 *
 * URL: /patients/[id]/pressure-ulcer-plan/new
 * クエリパラメータ:
 *   - copyFrom=<planId>: 既存計画書を複製して初期値にセット（日付・看護師名・AIドラフトは除く）
 */

import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  getPatients,
  getRecords,
  getPressureUlcerPlan,
  type Patient,
  type SoapRecord,
  type PressureUlcerPlan,
} from "@/lib/storage";
import { ArrowLeft, Home } from "lucide-react";
import PressureUlcerPlanForm from "../_components/PressureUlcerPlanForm";

export default function NewPressureUlcerPlanPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const copyFromId = searchParams.get("copyFrom");

  const [patient, setPatient] = useState<Patient | null>(null);
  const [recentRecords, setRecentRecords] = useState<SoapRecord[]>([]);
  const [copyFromPlan, setCopyFromPlan] = useState<PressureUlcerPlan | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const p = (await getPatients()).find((x) => x.id === id) ?? null;
      setPatient(p);
      if (p) {
        const records = await getRecords(id);
        setRecentRecords(records.sort((a, b) => b.visitDate.localeCompare(a.visitDate)).slice(0, 5));
      }
      if (copyFromId) {
        const plan = await getPressureUlcerPlan(copyFromId);
        setCopyFromPlan(plan);
      }
      setLoaded(true);
    })();
  }, [id, copyFromId]);

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ color: "var(--text-muted)" }}>
        読み込み中...
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ color: "var(--text-muted)" }}>
        患者情報が見つかりません
      </div>
    );
  }

  const isCopy = !!copyFromId && !!copyFromPlan;

  return (
    <div className="min-h-screen relative z-[1]">
      <header className="app-header">
        <div className="app-header-inner">
          <Link href={`/patients/${id}/pressure-ulcer-plan`} className="header-back" aria-label="戻る">
            <ArrowLeft size={22} />
          </Link>
          <div className="flex-1">
            <h1>{isCopy ? "褥瘡計画書の複製作成" : "褥瘡計画書の作成"}</h1>
            <p className="subtitle">{patient.name} 様</p>
          </div>
          <Link href="/patients" className="header-action" aria-label="患者一覧へ戻る" title="患者一覧へ戻る">
            <Home size={20} />
          </Link>
        </div>
      </header>

      <PressureUlcerPlanForm
        patient={patient}
        recentRecords={recentRecords}
        mode="new"
        initialPlan={isCopy ? copyFromPlan : undefined}
        isCopy={isCopy}
      />
    </div>
  );
}
