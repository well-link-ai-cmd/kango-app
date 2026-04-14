"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  getPatients,
  getRecordById,
  saveRecord,
  soapToText,
  textToSoap,
  type Patient,
  type SoapRecord,
} from "@/lib/storage";
import { ArrowLeft, Save, Home } from "lucide-react";

export default function EditRecordPage() {
  const { id, recordId } = useParams<{ id: string; recordId: string }>();
  const router = useRouter();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [record, setRecord] = useState<SoapRecord | null>(null);
  const [visitDate, setVisitDate] = useState("");
  const [soapText, setSoapText] = useState("");
  const [rawInput, setRawInput] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const p = (await getPatients()).find((p) => p.id === id) ?? null;
      setPatient(p);
      const r = await getRecordById(recordId);
      if (r) {
        setRecord(r);
        setVisitDate(r.visitDate);
        setSoapText(soapToText(r.S, r.O, r.A, r.P));
        setRawInput(r.rawInput ?? "");
      }
      setLoaded(true);
    })();
  }, [id, recordId]);

  async function handleSave() {
    if (!record) return;
    if (!soapText.trim()) {
      setError("SOAP記録が空です");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const parsed = textToSoap(soapText);
      await saveRecord({
        ...record,
        visitDate,
        rawInput,
        S: parsed.S,
        O: parsed.O,
        A: parsed.A,
        P: parsed.P,
      });
      router.push(`/patients/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
      setSaving(false);
    }
  }

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ color: "var(--text-muted)" }}>
        読み込み中...
      </div>
    );
  }

  if (!record) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4" style={{ color: "var(--text-muted)" }}>
        <p>記録が見つかりませんでした</p>
        <Link href={`/patients/${id}`} className="btn-outline">患者ページへ戻る</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative z-[1] pb-10">
      <header className="app-header">
        <div className="app-header-inner">
          <button
            onClick={() => router.push(`/patients/${id}`)}
            className="header-back"
            aria-label="戻る"
          >
            <ArrowLeft size={22} />
          </button>
          <div className="flex-1">
            <h1>訪問記録を編集</h1>
            {patient && <p className="subtitle">{patient.name} 様</p>}
          </div>
          <Link href="/patients" className="header-action" aria-label="患者一覧へ戻る" title="患者一覧へ戻る">
            <Home size={20} />
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-5 relative z-[1]">
        {error && <div className="alert-error animate-fade-in">{error}</div>}

        <div className="card p-5">
          <label className="input-label">訪問日</label>
          <input
            type="date"
            className="input-field text-lg"
            value={visitDate}
            onChange={(e) => setVisitDate(e.target.value)}
          />
        </div>

        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>SOAP記録</h2>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            S: O: A: P: の行頭を残したまま、内容を自由に編集できます。家族の発言は「姉S:」「夫S:」のように話者を頭に付けて書けます。
          </p>
          <textarea
            rows={18}
            className="input-field text-sm"
            style={{ resize: "vertical", lineHeight: "1.8", fontFamily: "inherit" }}
            value={soapText}
            onChange={(e) => setSoapText(e.target.value)}
          />
        </div>

        {rawInput && (
          <div className="card p-5">
            <label className="input-label">元の入力（任意で編集可）</label>
            <textarea
              rows={4}
              className="input-field text-sm"
              style={{ resize: "vertical", lineHeight: "1.8" }}
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
            />
          </div>
        )}

        <button onClick={handleSave} disabled={saving} className="btn-save">
          <Save size={20} />
          {saving ? "保存中..." : "変更を保存する"}
        </button>
      </main>
    </div>
  );
}
