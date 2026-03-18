// データ型定義

export type CareLevel =
  | "要支援1" | "要支援2"
  | "要介護1" | "要介護2" | "要介護3" | "要介護4" | "要介護5";

export interface Patient {
  id: string;
  name: string;
  age: number;
  careLevel: CareLevel;
  diagnosis: string;          // 主病名

  // 担当者（任意）
  nurseInCharge?: string;     // 担当看護師

  // 主治医情報（月次報告書用）
  doctorName?: string;        // 主治医名
  doctorHospital?: string;    // 所属病院名
  doctorAddress?: string;     // 病院住所
  doctorPhone?: string;       // 連絡先

  // ケアマネ情報（月次報告書用）
  careManagerName?: string;   // ケアマネ名
  careManagerOffice?: string; // 所属事業所
  careManagerAddress?: string;// 事業所住所
  careManagerPhone?: string;  // 連絡先

  // ケアプラン・担当者会議内容（AI精度向上用）
  carePlan?: string;          // ケアプラン・担当者会議での方針

  createdAt: string;
}

export interface SoapRecord {
  id: string;
  patientId: string;
  visitDate: string;       // 訪問日 YYYY-MM-DD
  rawInput: string;        // 元の入力テキスト
  S: string;               // Subjective
  O: string;               // Objective
  A: string;               // Assessment
  P: string;               // Plan
  createdAt: string;
}

// ---- LocalStorage ヘルパー ----

const PATIENTS_KEY = "kango_patients";
const RECORDS_KEY  = "kango_records";

export function getPatients(): Patient[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(PATIENTS_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function savePatient(patient: Patient): void {
  const list = getPatients();
  const idx = list.findIndex((p) => p.id === patient.id);
  if (idx >= 0) list[idx] = patient;
  else list.push(patient);
  localStorage.setItem(PATIENTS_KEY, JSON.stringify(list));
}

export function deletePatient(id: string): void {
  const list = getPatients().filter((p) => p.id !== id);
  localStorage.setItem(PATIENTS_KEY, JSON.stringify(list));
  // 関連記録も削除
  const records = getRecords().filter((r) => r.patientId !== id);
  localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
}

export function getRecords(patientId?: string): SoapRecord[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(RECORDS_KEY);
  const all: SoapRecord[] = raw ? JSON.parse(raw) : [];
  return patientId ? all.filter((r) => r.patientId === patientId) : all;
}

export function saveRecord(record: SoapRecord): void {
  const list = getRecords();
  const idx = list.findIndex((r) => r.id === record.id);
  if (idx >= 0) list[idx] = record;
  else list.push(record);
  localStorage.setItem(RECORDS_KEY, JSON.stringify(list));
}

export function deleteRecord(id: string): void {
  const list = getRecords().filter((r) => r.id !== id);
  localStorage.setItem(RECORDS_KEY, JSON.stringify(list));
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
