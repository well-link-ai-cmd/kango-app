"use client";

/**
 * 看護計画書 編集ページ
 * URL: /patients/[id]/nursing-care-plan/[planId]/edit
 */

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getPatients,
  getRecords,
  getNursingContents,
  getNursingCarePlan,
  type Patient,
  type SoapRecord,
  type NursingCarePlan,
} from "@/lib/storage";
import { ArrowLeft } from "lucide-react";
import NursingCarePlanForm from "../../_components/NursingCarePlanForm";

export default function EditNursingCarePlanPage() {
  const { id, planId } = useParams<{ id: string; planId: string }>();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [recentRecords, setRecentRecords] = useState<SoapRecord[]>([]);
  const [allRecords, setAllRecords] = useState<SoapRecord[]>([]);
  const [nursingContentItems, setNursingContentItems] = useState<string[]>([]);
  const [plan, setPlan] = useState<NursingCarePlan | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const p = (await getPatients()).find((x) => x.id === id) ?? null;
      setPatient(p);
      if (p) {
        const records = await getRecords(id);
        const sorted = records.sort((a, b) => b.visitDate.localeCompare(a.visitDate));
        setAllRecords(sorted);
        setRecentRecords(sorted.slice(0, 5));
        const contents = await getNursingContents(id);
        setNursingContentItems((contents?.items ?? []).filter((i) => i.isActive).map((i) => i.text));
      }
      const pl = await getNursingCarePlan(planId);
      setPlan(pl);
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

  if (!patient || !plan) {
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
          <Link href={`/patients/${id}/nursing-care-plan`} className="header-back" aria-label="戻る">
            <ArrowLeft size={22} />
          </Link>
          <div className="flex-1">
            <h1>看護計画書の編集</h1>
            <p className="subtitle">
              {patient.name} 様 / 作成日 {plan.planDate}
              {plan.isDraft && <span className="ml-2 text-xs px-2 py-0.5 rounded" style={{ background: "rgba(245, 158, 11, 0.15)", color: "#B45309" }}>下書き</span>}
            </p>
          </div>
        </div>
      </header>

      <NursingCarePlanForm
        patient={patient}
        recentRecords={recentRecords}
        allRecords={allRecords}
        nursingContentItems={nursingContentItems}
        mode="edit"
        initialPlan={plan}
      />
    </div>
  );
}
