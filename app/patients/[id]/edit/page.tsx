"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { getPatients, savePatient, type CareLevel } from "@/lib/storage";
import { ArrowLeft, ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";

const CARE_LEVELS: CareLevel[] = [
  "要支援1","要支援2","要介護1","要介護2","要介護3","要介護4","要介護5",
];

export default function EditPatientPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [careLevel, setCareLevel] = useState<CareLevel>("要介護1");
  const [diagnosis, setDiagnosis] = useState("");
  const [carePlan, setCarePlan] = useState("");
  const [openCarePlan, setOpenCarePlan] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const patient = getPatients().find((p) => p.id === id);
    if (patient) {
      setName(patient.name);
      setAge(String(patient.age));
      setCareLevel(patient.careLevel);
      setDiagnosis(patient.diagnosis);
      setCarePlan(patient.carePlan ?? "");
      if (patient.carePlan) setOpenCarePlan(true);
    }
    setLoaded(true);
  }, [id]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return alert("氏名を入力してください");
    const existing = getPatients().find((p) => p.id === id);
    if (!existing) return;
    savePatient({
      ...existing,
      name: name.trim(),
      age: parseInt(age) || 0,
      careLevel,
      diagnosis: diagnosis.trim(),
      carePlan: carePlan.trim() || undefined,
    });
    router.push(`/patients/${id}`);
  }

  if (!loaded) return null;

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <header className="bg-blue-700 text-white px-4 py-4 shadow">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link href={`/patients/${id}`} className="text-blue-200 hover:text-white">
            <ArrowLeft size={22} />
          </Link>
          <h1 className="text-xl font-bold">利用者情報を編集</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                氏名 <span className="text-red-500">*</span>
              </label>
              <input type="text"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">年齢</label>
                <input type="number"
                  min="0"
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">介護度</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                  value={careLevel}
                  onChange={(e) => setCareLevel(e.target.value as CareLevel)}
                >
                  {CARE_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">主病名・疾患</label>
              <input type="text"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
              />
            </div>
          </div>

          {/* ケアプラン */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-5 py-2">
            <button
              type="button"
              onClick={() => setOpenCarePlan(!openCarePlan)}
              className="w-full flex items-center justify-between py-3"
            >
              <div className="text-left">
                <p className="font-semibold text-gray-800">ケアプラン・訪問方針</p>
                <p className="text-xs text-gray-400">入力するとAIのSOAP変換精度が上がります（任意）</p>
              </div>
              {openCarePlan
                ? <ChevronUp size={18} className="text-gray-400" />
                : <ChevronDown size={18} className="text-gray-400" />}
            </button>
            {openCarePlan && (
              <div className="pb-4">
                <textarea rows={5}
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                  placeholder="例：脳梗塞後の右半身麻痺あり。血圧管理が最重要課題（目標：収縮期130〜160）。褥瘡予防・関節拘縮予防のリハビリ実施。"
                  value={carePlan}
                  onChange={(e) => setCarePlan(e.target.value)}
                />
              </div>
            )}
          </div>

          <button type="submit"
            className="w-full bg-blue-700 text-white font-bold py-4 rounded-xl text-lg hover:bg-blue-800 transition shadow"
          >
            保存する
          </button>
        </form>
      </main>
    </div>
  );
}
