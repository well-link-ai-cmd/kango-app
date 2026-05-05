"use client";

/**
 * 看護計画書 新規作成ページ（複製モード対応）
 *
 * URL: /patients/[id]/nursing-care-plan/new
 * クエリパラメータ:
 *   - copyFrom=<planId>: 既存計画書を複製して初期値セット（日付・作成者・評価はリセット）
 */

import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
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
import NursingCarePlanForm from "../_components/NursingCarePlanForm";

export default function NewNursingCarePlanPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const copyFromId = searchParams.get("copyFrom");

  const [patient, setPatient] = useState<Patient | null>(null);
  const [recentRecords, setRecentRecords] = useState<SoapRecord[]>([]);
  const [allRecords, setAllRecords] = useState<SoapRecord[]>([]);
  const [nursingContentItems, setNursingContentItems] = useState<string[]>([]);
  const [copyFromPlan, setCopyFromPlan] = useState<NursingCarePlan | null>(null);
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
      if (copyFromId) {
        const plan = await getNursingCarePlan(copyFromId);
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
  // 複製時は日付・作成者・評価欄をクリアしたプランを渡す
  const copiedInitial: NursingCarePlan | undefined = isCopy && copyFromPlan
    ? {
        ...copyFromPlan,
        id: "",
        createdAt: "",
        updatedAt: "",
        planDate: new Date().toISOString().slice(0, 10),
        isDraft: true,
        authorName: undefined,
        author2Name: undefined,
        issues: copyFromPlan.issues.map((iss) => ({
          ...iss,
          date: new Date().toISOString().slice(0, 10),
          evaluation: undefined,
          evaluatedAt: undefined,
        })),
      }
    : undefined;

  return (
    <div className="min-h-screen relative z-[1]">
      <header className="app-header">
        <div className="app-header-inner">
          <Link href={`/patients/${id}/nursing-care-plan`} className="header-back" aria-label="戻る">
            <ArrowLeft size={22} />
          </Link>
          <div className="flex-1">
            <h1>{isCopy ? "看護計画書の複製作成" : "看護計画書の作成"}</h1>
            <p className="subtitle">{patient.name} 様</p>
          </div>
        </div>
      </header>

      <NursingCarePlanForm
        patient={patient}
        recentRecords={recentRecords}
        allRecords={allRecords}
        nursingContentItems={nursingContentItems}
        mode="new"
        initialPlan={copiedInitial}
        isCopy={isCopy}
      />
    </div>
  );
}
