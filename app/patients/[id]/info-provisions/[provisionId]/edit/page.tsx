"use client";

/**
 * 情報提供書 編集ページ
 */

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getPatients, getInfoProvision, type Patient, type InfoProvision } from "@/lib/storage";
import { ArrowLeft, Home } from "lucide-react";
import InfoProvisionForm from "../../_components/InfoProvisionForm";
import { INFO_PROVISION_ADDRESSEE_LABEL } from "@/lib/storage";

export default function EditInfoProvisionPage() {
  const { id, provisionId } = useParams<{ id: string; provisionId: string }>();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [provision, setProvision] = useState<InfoProvision | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const p = (await getPatients()).find((x) => x.id === id) ?? null;
      setPatient(p);
      const pv = await getInfoProvision(provisionId);
      setProvision(pv);
      setLoaded(true);
    })();
  }, [id, provisionId]);

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ color: "var(--text-muted)" }}>
        読み込み中...
      </div>
    );
  }

  if (!patient || !provision) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ color: "var(--text-muted)" }}>
        情報が見つかりません
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
            <h1>情報提供書の編集</h1>
            <p className="subtitle">
              {patient.name} 様 / {INFO_PROVISION_ADDRESSEE_LABEL[provision.addresseeType]}
              {provision.isDraft && (
                <span
                  className="ml-2 text-xs px-2 py-0.5 rounded"
                  style={{ background: "rgba(245, 158, 11, 0.15)", color: "#B45309" }}
                >
                  下書き
                </span>
              )}
            </p>
          </div>
          <Link href="/patients" className="header-action" aria-label="患者一覧へ戻る" title="患者一覧へ戻る">
            <Home size={20} />
          </Link>
        </div>
      </header>

      <InfoProvisionForm patient={patient} mode="edit" initialProvision={provision} />
    </div>
  );
}
