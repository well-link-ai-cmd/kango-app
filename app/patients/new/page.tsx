"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { savePatient, generateId, type CareLevel } from "@/lib/storage";
import { ArrowLeft, ChevronDown, ChevronUp, FileText } from "lucide-react";
import Link from "next/link";

const CARE_LEVELS: CareLevel[] = [
  "なし","要支援1","要支援2","要介護1","要介護2","要介護3","要介護4","要介護5",
];

interface InitialSoap {
  S: string;
  O: string;
  A: string;
  P: string;
  visitDate: string;
}

export default function NewPatientPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [nameKana, setNameKana] = useState("");
  const [age, setAge] = useState("");
  const [careLevel, setCareLevel] = useState<CareLevel>("なし");
  const [diagnosis, setDiagnosis] = useState("");
  const [nurseInCharge, setNurseInCharge] = useState("");
  const [carePlan, setCarePlan] = useState("");
  const [openCarePlan, setOpenCarePlan] = useState(false);

  // 直近のSOAP記録（導入時の初期データ）
  const [openInitialSoap, setOpenInitialSoap] = useState(false);
  const [initialSoap1, setInitialSoap1] = useState<InitialSoap>({ S: "", O: "", A: "", P: "", visitDate: "" });
  const [initialSoap2, setInitialSoap2] = useState<InitialSoap>({ S: "", O: "", A: "", P: "", visitDate: "" });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return alert("氏名を入力してください");

    // 入力があるSOAPのみ保存
    const initialSoapRecords = [initialSoap1, initialSoap2]
      .filter(s => s.S.trim() || s.O.trim() || s.A.trim() || s.P.trim());

    savePatient({
      id: generateId(),
      name: name.trim(),
      nameKana: nameKana.trim() || undefined,
      age: parseInt(age) || 0,
      careLevel,
      diagnosis: diagnosis.trim(),
      nurseInCharge: nurseInCharge.trim() || undefined,
      carePlan: carePlan.trim() || undefined,
      initialSoapRecords: initialSoapRecords.length > 0 ? initialSoapRecords : undefined,
      createdAt: new Date().toISOString(),
    });
    router.push("/patients");
  }

  function renderSoapInput(label: string, soap: InitialSoap, setSoap: (s: InitialSoap) => void) {
    return (
      <div className="space-y-2 p-4 rounded-xl" style={{ background: "var(--bg-tertiary)" }}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>{label}</span>
          <input
            type="date"
            className="input-field text-xs py-1 px-2"
            style={{ width: "auto", borderRadius: "8px" }}
            value={soap.visitDate}
            onChange={(e) => setSoap({ ...soap, visitDate: e.target.value })}
            placeholder="訪問日"
          />
        </div>
        {(["S", "O", "A", "P"] as const).map((key) => {
          const labels = { S: "S（主観的情報）", O: "O（客観的情報）", A: "A（アセスメント）", P: "P（プラン）" };
          return (
            <div key={key}>
              <label className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>{labels[key]}</label>
              <textarea
                rows={2}
                className="input-field text-sm mt-1"
                style={{ resize: "none" }}
                placeholder={`${labels[key]}を貼り付け`}
                value={soap[key]}
                onChange={(e) => setSoap({ ...soap, [key]: e.target.value })}
              />
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="min-h-screen relative z-[1] pb-10">
      <header className="app-header">
        <div className="app-header-inner">
          <Link href="/patients" className="header-back" aria-label="戻る">
            <ArrowLeft size={22} />
          </Link>
          <div>
            <h1>利用者登録</h1>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 relative z-[1]">
        <form onSubmit={handleSubmit} className="space-y-4 animate-fade-in-up">

          {/* Basic Info */}
          <div className="card p-5 space-y-4">
            <div>
              <label className="input-label">
                氏名 <span style={{ color: "var(--accent-error)" }}>*</span>
              </label>
              <input type="text"
                className="input-field text-lg"
                placeholder="例：田中 花子"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div>
              <label className="input-label">ふりがな</label>
              <input type="text"
                className="input-field"
                placeholder="例：たなか はなこ"
                value={nameKana}
                onChange={(e) => setNameKana(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="input-label">年齢</label>
                <input type="number"
                  min="0"
                  className="input-field text-lg"
                  placeholder="75"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                />
              </div>
              <div>
                <label className="input-label">介護度</label>
                <select
                  className="input-field text-lg"
                  value={careLevel}
                  onChange={(e) => setCareLevel(e.target.value as CareLevel)}
                >
                  {CARE_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="input-label">主病名・疾患</label>
              <input type="text"
                className="input-field"
                placeholder="例：脳梗塞後遺症、高血圧、糖尿病"
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
              />
            </div>

            <div>
              <label className="input-label">担当看護師</label>
              <input type="text"
                className="input-field"
                placeholder="例：山田 花子"
                value={nurseInCharge}
                onChange={(e) => setNurseInCharge(e.target.value)}
              />
            </div>
          </div>

          {/* Care Plan */}
          <div className="card overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenCarePlan(!openCarePlan)}
              className="w-full flex items-center justify-between px-5 py-4 transition-colors hover:bg-[rgba(0,200,200,0.02)]"
            >
              <div className="text-left">
                <p className="font-semibold" style={{ color: "var(--text-primary)" }}>ケアプラン・訪問方針</p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>入力するとAIのSOAP変換精度が上がります（任意）</p>
              </div>
              {openCarePlan
                ? <ChevronUp size={18} style={{ color: "var(--text-muted)" }} />
                : <ChevronDown size={18} style={{ color: "var(--text-muted)" }} />}
            </button>
            {openCarePlan && (
              <div className="px-5 pb-5 animate-fade-in">
                <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
                  訪問看護の目標・観察ポイント・実施ケアの内容などを入力してください。担当者会議の内容をそのまま貼ってもOKです。
                </p>
                <textarea rows={5}
                  className="input-field text-sm"
                  style={{ resize: "none" }}
                  placeholder="例：脳梗塞後の右半身麻痺あり。血圧管理が最重要課題（目標：収縮期130〜160）。褥瘡予防・関節拘縮予防のリハビリ実施。認知機能低下に注意。"
                  value={carePlan}
                  onChange={(e) => setCarePlan(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Initial SOAP Records */}
          <div className="card overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenInitialSoap(!openInitialSoap)}
              className="w-full flex items-center justify-between px-5 py-4 transition-colors hover:bg-[rgba(0,200,200,0.02)]"
            >
              <div className="text-left flex items-start gap-3">
                <FileText size={20} style={{ color: "var(--accent-cyan)", marginTop: "2px" }} />
                <div>
                  <p className="font-semibold" style={{ color: "var(--text-primary)" }}>直近のSOAP記録を貼り付け</p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>既存の記録があれば、初回から過去の文脈を踏まえたSOAPが生成されます（任意）</p>
                </div>
              </div>
              {openInitialSoap
                ? <ChevronUp size={18} style={{ color: "var(--text-muted)" }} />
                : <ChevronDown size={18} style={{ color: "var(--text-muted)" }} />}
            </button>
            {openInitialSoap && (
              <div className="px-5 pb-5 space-y-4 animate-fade-in">
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  このツール導入前に書いていた直近1〜2回分のSOAP記録を貼り付けてください。AIが初回から過去の経過を踏まえて記録を生成します。
                </p>
                {renderSoapInput("直近1回目のSOAP", initialSoap1, setInitialSoap1)}
                {renderSoapInput("直近2回目のSOAP（任意）", initialSoap2, setInitialSoap2)}
              </div>
            )}
          </div>

          <button type="submit" className="btn-primary">
            登録する
          </button>
        </form>
      </main>
    </div>
  );
}
