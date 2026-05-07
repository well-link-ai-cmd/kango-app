"use client";

/**
 * 情報提供書 新規作成ページ
 */

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getPatients, type Patient } from "@/lib/storage";
import { ArrowLeft, Home } from "lucide-react";
import InfoProvisionForm from "../_components/InfoProvisionForm";

export default function NewInfoProvisionPage() {
  const { id } = useParams<{ id: string }>();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const p = (await getPatients()).find((x) => x.id === id) ?? null;
      setPatient(p);
      setLoaded(true);
    })();
  }, [id]);

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

  return (
    <div className="min-h-screen relative z-[1]">
      <header className="app-header">
        <div className="app-header-inner">
          <Link href={`/patients/${id}/info-provisions`} className="header-back" aria-label="戻る">
            <ArrowLeft size={22} />
          </Link>
          <div className="flex-1">
            <h1>情報提供書の作成</h1>
            <p className="subtitle">{patient.name} 様</p>
          </div>
          <Link href="/patients" className="header-action" aria-label="患者一覧へ戻る" title="患者一覧へ戻る">
            <Home size={20} />
          </Link>
        </div>
      </header>

      <InfoProvisionForm patient={patient} mode="new" />
    </div>
  );
}
