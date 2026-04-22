"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { savePatient, saveNursingContents, generateId, soapToText, textToSoap, type CareLevel, type DoctorInfo, type CareManagerInfo, type NursingContentItem } from "@/lib/storage";
import { ArrowLeft, ChevronDown, ChevronUp, FileText, Plus, Trash2, ClipboardList } from "lucide-react";
import Link from "next/link";

const CARE_LEVELS: CareLevel[] = [
  "なし","要支援1","要支援2","要介護1","要介護2","要介護3","要介護4","要介護5",
];

export default function NewPatientPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [nameKana, setNameKana] = useState("");
  const [age, setAge] = useState("");
  const [careLevel, setCareLevel] = useState<CareLevel>("なし");
  const [diagnosis, setDiagnosis] = useState("");
  const [nurseInCharge, setNurseInCharge] = useState("");
  const [doctors, setDoctors] = useState<DoctorInfo[]>([]);
  const [careManagersList, setCareManagersList] = useState<CareManagerInfo[]>([]);
  const [openDoctor, setOpenDoctor] = useState(false);
  const [openCareManager, setOpenCareManager] = useState(false);
  const [carePlan, setCarePlan] = useState("");
  const [openCarePlan, setOpenCarePlan] = useState(false);

  // ケア内容リスト（初回入力）— 複数行対応
  const [openNursingContents, setOpenNursingContents] = useState(false);
  const [nursingContentsText, setNursingContentsText] = useState("");

  // 直近のSOAP記録（導入時の初期データ）— 1つのtextareaに統合
  const [openInitialSoap, setOpenInitialSoap] = useState(false);
  const [initialSoapText1, setInitialSoapText1] = useState("");
  const [initialSoapDate1, setInitialSoapDate1] = useState("");
  const [initialSoapText2, setInitialSoapText2] = useState("");
  const [initialSoapDate2, setInitialSoapDate2] = useState("");

  // 複数行・箇条書きテキストを行単位で分割
  function parseNursingContentLines(raw: string): string[] {
    return raw
      .split("\n")
      .map((line) =>
        line
          .trim()
          .replace(/^[・•\-＊\*\+]\s*/, "")
          .replace(/^\d+[\.\)]\s*/, "")
          .trim()
      )
      .filter((line) => line.length > 0);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return alert("氏名を入力してください");

    // テキストからSOAPをパースして保存
    const initialSoapRecords = [
      { text: initialSoapText1, visitDate: initialSoapDate1 },
      { text: initialSoapText2, visitDate: initialSoapDate2 },
    ]
      .filter(s => s.text.trim())
      .map(s => ({ ...textToSoap(s.text), visitDate: s.visitDate }))
      // SOAP 4フィールドが全部空のレコードは保存しない（再表示時に頭文字だけ残るのを防ぐ）
      .filter(r => r.S.trim() || r.O.trim() || r.A.trim() || r.P.trim());

    const patientId = generateId();
    await savePatient({
      id: patientId,
      name: name.trim(),
      nameKana: nameKana.trim() || undefined,
      age: parseInt(age) || 0,
      careLevel,
      diagnosis: diagnosis.trim(),
      nurseInCharge: nurseInCharge.trim() || undefined,
      doctors: doctors.filter(d => d.name.trim() || d.hospital.trim()).length > 0
        ? doctors.filter(d => d.name.trim() || d.hospital.trim()) : undefined,
      careManagers: careManagersList.filter(c => c.name.trim() || c.office.trim()).length > 0
        ? careManagersList.filter(c => c.name.trim() || c.office.trim()) : undefined,
      carePlan: carePlan.trim() || undefined,
      initialSoapRecords: initialSoapRecords.length > 0 ? initialSoapRecords : undefined,
      createdAt: new Date().toISOString(),
    });

    // ケア内容リストを初回保存
    const lines = parseNursingContentLines(nursingContentsText);
    if (lines.length > 0) {
      const now = new Date().toISOString();
      const items: NursingContentItem[] = lines.map((text) => ({
        id: generateId(),
        text,
        isActive: true,
        source: "manual",
        addedAt: now,
      }));
      await saveNursingContents({
        patientId,
        items,
        updatedAt: now,
      });
    }

    router.push("/patients");
  }

  function renderSoapInput(label: string, soapText: string, setSoapText: (s: string) => void, date: string, setDate: (d: string) => void) {
    return (
      <div className="space-y-2 p-4 rounded-xl" style={{ background: "var(--bg-tertiary)" }}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>{label}</span>
          <input
            type="date"
            className="input-field text-xs py-1 px-2"
            style={{ width: "auto", borderRadius: "8px" }}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            placeholder="訪問日"
          />
        </div>
        <textarea
          rows={8}
          className="input-field text-sm"
          style={{ resize: "vertical", lineHeight: "1.8" }}
          placeholder={"S: 利用者の言葉・訴え\nO: バイタル・観察所見\nA: アセスメント・評価\nP: 今後のケア方針"}
          value={soapText}
          onChange={(e) => setSoapText(e.target.value)}
        />
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

          {/* 主治医・かかりつけ病院（複数対応） */}
          <div className="card overflow-hidden">
            <button
              type="button"
              onClick={() => { setOpenDoctor(!openDoctor); if (doctors.length === 0) setDoctors([{ name: "", hospital: "" }]); }}
              className="w-full flex items-center justify-between px-5 py-4 transition-colors hover:bg-[rgba(0,200,200,0.02)]"
            >
              <div className="text-left">
                <p className="font-semibold" style={{ color: "var(--text-primary)" }}>主治医・かかりつけ病院</p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>複数登録できます（任意）</p>
              </div>
              {openDoctor
                ? <ChevronUp size={18} style={{ color: "var(--text-muted)" }} />
                : <ChevronDown size={18} style={{ color: "var(--text-muted)" }} />}
            </button>
            {openDoctor && (
              <div className="px-5 pb-5 space-y-4 animate-fade-in">
                {doctors.map((doc, i) => (
                  <div key={i} className="space-y-2 p-4 rounded-xl relative" style={{ background: "var(--bg-tertiary)" }}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold" style={{ color: "var(--accent-cyan)" }}>主治医 {i + 1}</span>
                      {doctors.length > 1 && (
                        <button type="button" onClick={() => setDoctors(doctors.filter((_, j) => j !== i))} className="btn-delete"><Trash2 size={14} /></button>
                      )}
                    </div>
                    <input type="text" className="input-field text-sm" placeholder="主治医名" value={doc.name} onChange={(e) => { const d = [...doctors]; d[i] = { ...d[i], name: e.target.value }; setDoctors(d); }} />
                    <input type="text" className="input-field text-sm" placeholder="病院名" value={doc.hospital} onChange={(e) => { const d = [...doctors]; d[i] = { ...d[i], hospital: e.target.value }; setDoctors(d); }} />
                    <input type="text" className="input-field text-sm" placeholder="住所（任意）" value={doc.address ?? ""} onChange={(e) => { const d = [...doctors]; d[i] = { ...d[i], address: e.target.value }; setDoctors(d); }} />
                    <input type="tel" className="input-field text-sm" placeholder="電話番号（任意）" value={doc.phone ?? ""} onChange={(e) => { const d = [...doctors]; d[i] = { ...d[i], phone: e.target.value }; setDoctors(d); }} />
                  </div>
                ))}
                <button type="button" onClick={() => setDoctors([...doctors, { name: "", hospital: "" }])} className="btn-outline w-full justify-center">
                  <Plus size={16} /> もう1件追加
                </button>
              </div>
            )}
          </div>

          {/* ケアマネージャー（複数対応） */}
          <div className="card overflow-hidden">
            <button
              type="button"
              onClick={() => { setOpenCareManager(!openCareManager); if (careManagersList.length === 0) setCareManagersList([{ name: "", office: "" }]); }}
              className="w-full flex items-center justify-between px-5 py-4 transition-colors hover:bg-[rgba(0,200,200,0.02)]"
            >
              <div className="text-left">
                <p className="font-semibold" style={{ color: "var(--text-primary)" }}>ケアマネージャー</p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>複数登録できます（任意）</p>
              </div>
              {openCareManager
                ? <ChevronUp size={18} style={{ color: "var(--text-muted)" }} />
                : <ChevronDown size={18} style={{ color: "var(--text-muted)" }} />}
            </button>
            {openCareManager && (
              <div className="px-5 pb-5 space-y-4 animate-fade-in">
                {careManagersList.map((cm, i) => (
                  <div key={i} className="space-y-2 p-4 rounded-xl relative" style={{ background: "var(--bg-tertiary)" }}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold" style={{ color: "var(--accent-magenta)" }}>ケアマネ {i + 1}</span>
                      {careManagersList.length > 1 && (
                        <button type="button" onClick={() => setCareManagersList(careManagersList.filter((_, j) => j !== i))} className="btn-delete"><Trash2 size={14} /></button>
                      )}
                    </div>
                    <input type="text" className="input-field text-sm" placeholder="ケアマネ名" value={cm.name} onChange={(e) => { const c = [...careManagersList]; c[i] = { ...c[i], name: e.target.value }; setCareManagersList(c); }} />
                    <input type="text" className="input-field text-sm" placeholder="事業所名" value={cm.office} onChange={(e) => { const c = [...careManagersList]; c[i] = { ...c[i], office: e.target.value }; setCareManagersList(c); }} />
                    <input type="text" className="input-field text-sm" placeholder="住所（任意）" value={cm.address ?? ""} onChange={(e) => { const c = [...careManagersList]; c[i] = { ...c[i], address: e.target.value }; setCareManagersList(c); }} />
                    <input type="tel" className="input-field text-sm" placeholder="電話番号（任意）" value={cm.phone ?? ""} onChange={(e) => { const c = [...careManagersList]; c[i] = { ...c[i], phone: e.target.value }; setCareManagersList(c); }} />
                  </div>
                ))}
                <button type="button" onClick={() => setCareManagersList([...careManagersList, { name: "", office: "" }])} className="btn-outline w-full justify-center">
                  <Plus size={16} /> もう1件追加
                </button>
              </div>
            )}
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

          {/* Nursing Contents（ケア内容リスト） */}
          <div className="card overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenNursingContents(!openNursingContents)}
              className="w-full flex items-center justify-between px-5 py-4 transition-colors hover:bg-[rgba(0,200,200,0.02)]"
            >
              <div className="text-left flex items-start gap-3">
                <ClipboardList size={20} style={{ color: "var(--accent-cyan)", marginTop: "2px" }} />
                <div>
                  <p className="font-semibold" style={{ color: "var(--text-primary)" }}>ケア内容リスト</p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>訪問時に実施するケアを登録（複数行・箇条書き対応）</p>
                </div>
              </div>
              {openNursingContents
                ? <ChevronUp size={18} style={{ color: "var(--text-muted)" }} />
                : <ChevronDown size={18} style={{ color: "var(--text-muted)" }} />}
            </button>
            {openNursingContents && (
              <div className="px-5 pb-5 animate-fade-in">
                <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
                  1行1項目、または箇条書き（・や番号）で入力してください。後から患者ページの「看護内容リスト」で編集・AI整理もできます。
                </p>
                <textarea
                  rows={5}
                  className="input-field text-sm"
                  style={{ resize: "vertical", fontFamily: "inherit" }}
                  placeholder={"例：\n・バイタル測定（血圧・脈拍・体温・SpO2）\n・排便状態の確認\n・創部ガーゼ交換\n・ROM訓練\n・清拭介助"}
                  value={nursingContentsText}
                  onChange={(e) => setNursingContentsText(e.target.value)}
                />
                <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
                  {parseNursingContentLines(nursingContentsText).length} 件が登録されます
                </p>
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
                {renderSoapInput("直近1回目のSOAP", initialSoapText1, setInitialSoapText1, initialSoapDate1, setInitialSoapDate1)}
                {renderSoapInput("直近2回目のSOAP（任意）", initialSoapText2, setInitialSoapText2, initialSoapDate2, setInitialSoapDate2)}
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
