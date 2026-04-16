"use client";

/**
 * 褥瘡計画書 編集ページ
 *
 * URL: /patients/[id]/pressure-ulcer-plan/[planId]/edit
 * 既存計画書を読み込み、修正後に上書き保存する。
 * 下書き/確定の切り替えもここから可能。
 */

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getPatients,
  getRecords,
  getPressureUlcerPlan,
  type Patient,
  type SoapRecord,
  type PressureUlcerPlan,
} from "@/lib/storage";
import { ArrowLeft } from "lucide-react";
import PressureUlcerPlanForm from "../../_components/PressureUlcerPlanForm";

export default function EditPressureUlcerPlanPage() {
  const { id, planId } = useParams<{ id: string; planId: string }>();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [recentRecords, setRecentRecords] = useState<SoapRecord[]>([]);
  const [plan, setPlan] = useState<PressureUlcerPlan | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const p = (await getPatients()).find((x) => x.id === id) ?? null;
      setPatient(p);
      if (p) {
        const records = await getRecords(id);
        setRecentRecords(records.sort((a, b) => b.visitDate.localeCompare(a.visitDate)).slice(0, 5));
      }
      const loadedPlan = await getPressureUlcerPlan(planId);
      setPlan(loadedPlan);
      setLoaded(true);
    })();
  }, [id, planId]);

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

  if (!plan) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ color: "var(--text-muted)" }}>
        計画書が見つかりません
      </div>
    );
  }

  return (
    <div className="min-h-screen relative z-[1]">
      <header className="app-header">
        <div className="app-header-inner">
          <Link href={`/patients/${id}/pressure-ulcer-plan`} className="header-back" aria-label="戻る">
            <ArrowLeft size={22} />
          </Link>
          <div className="flex-1">
            <h1>褥瘡計画書の編集</h1>
            <p className="subtitle">{patient.name} 様 / 作成: {plan.planDate}</p>
          </div>
        </div>
      </header>

      <PressureUlcerPlanForm
        patient={patient}
        recentRecords={recentRecords}
        mode="edit"
        initialPlan={plan}
      />
    </div>
  );
}
