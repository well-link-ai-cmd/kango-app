import { getSupabase } from "./supabase";

// ---- 認証ヘルパー ----

async function getCurrentUserId(): Promise<string | null> {
  const { data: { user } } = await getSupabase().auth.getUser();
  return user?.id ?? null;
}

// データ型定義

export type CareLevel =
  | "なし"
  | "要支援1" | "要支援2"
  | "要介護1" | "要介護2" | "要介護3" | "要介護4" | "要介護5";

// 主治医・病院情報
export interface DoctorInfo {
  name: string;       // 主治医名
  hospital: string;   // 病院名
  address?: string;   // 住所
  phone?: string;     // 電話番号
}

// ケアマネ情報
export interface CareManagerInfo {
  name: string;       // ケアマネ名
  office: string;     // 事業所名
  address?: string;   // 住所
  phone?: string;     // 電話番号
}

export interface Patient {
  id: string;
  name: string;
  nameKana?: string;          // ふりがな（あかさたなグループ用）
  age: number;
  careLevel: CareLevel;
  diagnosis: string;          // 主病名

  // 担当者（任意）
  nurseInCharge?: string;     // 担当看護師

  // 主治医（複数対応）
  doctors?: DoctorInfo[];

  // ケアマネ（複数対応）
  careManagers?: CareManagerInfo[];

  // 旧フィールド（後方互換）
  doctorName?: string;
  doctorHospital?: string;
  doctorAddress?: string;
  doctorPhone?: string;
  careManagerName?: string;
  careManagerOffice?: string;
  careManagerAddress?: string;
  careManagerPhone?: string;

  // ケアプラン・担当者会議内容（AI精度向上用）
  carePlan?: string;          // ケアプラン・担当者会議での方針

  // 導入時に貼り付ける直近のSOAP記録（初回からAIの精度を上げる）
  initialSoapRecords?: {
    S: string;
    O: string;
    A: string;
    P: string;
    visitDate?: string;
  }[];

  createdAt: string;
}

/** SOAP統合テキスト ↔ 個別フィールド変換 */
export function soapToText(s: string, o: string, a: string, p: string): string {
  return `S: ${s}\nO: ${o}\nA: ${a}\nP: ${p}`;
}

export function textToSoap(text: string): { S: string; O: string; A: string; P: string } {
  const result = { S: "", O: "", A: "", P: "" };
  const lines = text.split("\n");
  let current: "S" | "O" | "A" | "P" | null = null;
  for (const line of lines) {
    const match = line.match(/^([SOAP])[:：]\s*/);
    if (match) {
      current = match[1] as "S" | "O" | "A" | "P";
      result[current] = line.slice(match[0].length);
    } else if (current) {
      result[current] += (result[current] ? "\n" : "") + line;
    }
  }
  return result;
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

// 看護内容リスト
export interface NursingContentItem {
  id: string;
  text: string;              // 例: "バイタル測定（血圧・脈拍・体温・SpO2）"
  isActive: boolean;
  source: "manual" | "ai";
  addedAt: string;
}

export interface NursingContents {
  patientId: string;
  items: NursingContentItem[];
  lastAnalyzedAt?: string;
  updatedAt: string;
}

// 患者別To-Do（引き継ぎメモ）
export interface PatientTodo {
  id: string;
  patientId: string;
  content: string;
  isDone: boolean;
  createdAt: string;
  doneAt?: string;
}

// ---- camelCase <-> snake_case 変換 ----

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function patientToRow(p: Patient, userId?: string): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = {
    id: p.id,
    name: p.name,
    name_kana: p.nameKana ?? null,
    age: p.age,
    care_level: p.careLevel,
    diagnosis: p.diagnosis,
    nurse_in_charge: p.nurseInCharge ?? null,
    doctors: p.doctors ?? [],
    care_managers: p.careManagers ?? [],
    // 旧フィールドも保持（後方互換）
    doctor_name: p.doctorName ?? null,
    doctor_hospital: p.doctorHospital ?? null,
    doctor_address: p.doctorAddress ?? null,
    doctor_phone: p.doctorPhone ?? null,
    care_manager_name: p.careManagerName ?? null,
    care_manager_office: p.careManagerOffice ?? null,
    care_manager_address: p.careManagerAddress ?? null,
    care_manager_phone: p.careManagerPhone ?? null,
    care_plan: p.carePlan ?? null,
    initial_soap_records: p.initialSoapRecords ?? null,
    created_at: p.createdAt,
  };
  if (userId) row.user_id = userId;
  return row;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToPatient(row: any): Patient {
  // 旧フィールドからdoctors/careManagers配列に変換（移行対応）
  let doctors: DoctorInfo[] = row.doctors ?? [];
  if (doctors.length === 0 && (row.doctor_name || row.doctor_hospital)) {
    doctors = [{
      name: row.doctor_name ?? "",
      hospital: row.doctor_hospital ?? "",
      address: row.doctor_address ?? undefined,
      phone: row.doctor_phone ?? undefined,
    }];
  }
  let careManagers: CareManagerInfo[] = row.care_managers ?? [];
  if (careManagers.length === 0 && (row.care_manager_name || row.care_manager_office)) {
    careManagers = [{
      name: row.care_manager_name ?? "",
      office: row.care_manager_office ?? "",
      address: row.care_manager_address ?? undefined,
      phone: row.care_manager_phone ?? undefined,
    }];
  }

  return {
    id: row.id,
    name: row.name,
    nameKana: row.name_kana ?? undefined,
    age: row.age,
    careLevel: row.care_level,
    diagnosis: row.diagnosis,
    nurseInCharge: row.nurse_in_charge ?? undefined,
    doctors: doctors.length > 0 ? doctors : undefined,
    careManagers: careManagers.length > 0 ? careManagers : undefined,
    carePlan: row.care_plan ?? undefined,
    initialSoapRecords: row.initial_soap_records ?? undefined,
    createdAt: row.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function recordToRow(r: SoapRecord, userId?: string): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = {
    id: r.id,
    patient_id: r.patientId,
    visit_date: r.visitDate,
    raw_input: r.rawInput,
    s_text: r.S,
    o_text: r.O,
    a_text: r.A,
    p_text: r.P,
    created_at: r.createdAt,
  };
  if (userId) row.user_id = userId;
  return row;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToRecord(row: any): SoapRecord {
  return {
    id: row.id,
    patientId: row.patient_id,
    visitDate: row.visit_date,
    rawInput: row.raw_input,
    S: row.s_text,
    O: row.o_text,
    A: row.a_text,
    P: row.p_text,
    createdAt: row.created_at,
  };
}

// ---- Supabase ヘルパー ----

export async function getPatients(): Promise<Patient[]> {
  const { data, error } = await getSupabase()
    .from("patients")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) { console.error("getPatients error:", error); return []; }
  return (data ?? []).map(rowToPatient);
}

export async function savePatient(patient: Patient): Promise<void> {
  const userId = await getCurrentUserId();
  const row = patientToRow(patient, userId ?? undefined);
  const { error } = await getSupabase()
    .from("patients")
    .upsert(row, { onConflict: "id" });
  if (error) console.error("savePatient error:", error);
}

export async function deletePatient(id: string): Promise<void> {
  // ON DELETE CASCADEにより関連レコード・看護内容も自動削除
  const { error } = await getSupabase()
    .from("patients")
    .delete()
    .eq("id", id);
  if (error) console.error("deletePatient error:", error);
}

export async function getRecords(patientId?: string): Promise<SoapRecord[]> {
  let query = getSupabase().from("soap_records").select("*");
  if (patientId) query = query.eq("patient_id", patientId);
  query = query.order("visit_date", { ascending: false });
  const { data, error } = await query;
  if (error) { console.error("getRecords error:", error); return []; }
  return (data ?? []).map(rowToRecord);
}

export async function saveRecord(record: SoapRecord): Promise<void> {
  const userId = await getCurrentUserId();
  const row = recordToRow(record, userId ?? undefined);
  const { error } = await getSupabase()
    .from("soap_records")
    .upsert(row, { onConflict: "id" });
  if (error) console.error("saveRecord error:", error);
}

export async function deleteRecord(id: string): Promise<void> {
  const { error } = await getSupabase()
    .from("soap_records")
    .delete()
    .eq("id", id);
  if (error) console.error("deleteRecord error:", error);
}

/** 特定の利用者の特定年月の記録を取得 */
export async function getRecordsByYearMonth(patientId: string, year: number, month: number): Promise<SoapRecord[]> {
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;

  const { data, error } = await getSupabase()
    .from("soap_records")
    .select("*")
    .eq("patient_id", patientId)
    .gte("visit_date", startDate)
    .lt("visit_date", endDate)
    .order("visit_date", { ascending: false });

  if (error) { console.error("getRecordsByYearMonth error:", error); return []; }
  return (data ?? []).map(rowToRecord);
}

/** 特定の利用者の記録がある年月一覧を返す（新しい順、件数付き） */
export async function getRecordMonths(patientId: string): Promise<{ year: number; month: number; label: string; count: number }[]> {
  const { data, error } = await getSupabase()
    .from("soap_records")
    .select("visit_date")
    .eq("patient_id", patientId)
    .order("visit_date", { ascending: false });

  if (error) { console.error("getRecordMonths error:", error); return []; }

  const countMap = new Map<string, number>();
  for (const row of data ?? []) {
    const [y, m] = row.visit_date.split("-");
    const key = `${y}-${m}`;
    countMap.set(key, (countMap.get(key) ?? 0) + 1);
  }

  const seen = new Set<string>();
  const result: { year: number; month: number; label: string; count: number }[] = [];
  for (const row of data ?? []) {
    const [y, m] = row.visit_date.split("-");
    const key = `${y}-${m}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({
        year: Number(y),
        month: Number(m),
        label: `${y}年${Number(m)}月`,
        count: countMap.get(key) ?? 0,
      });
    }
  }
  return result;
}

// ---- 看護内容ヘルパー ----

export async function getNursingContents(patientId: string): Promise<NursingContents | null> {
  const { data, error } = await getSupabase()
    .from("nursing_contents")
    .select("*")
    .eq("patient_id", patientId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // 該当なし
    console.error("getNursingContents error:", error);
    return null;
  }

  return {
    patientId: data.patient_id,
    items: data.items ?? [],
    lastAnalyzedAt: data.last_analyzed_at ?? undefined,
    updatedAt: data.updated_at,
  };
}

export async function saveNursingContents(contents: NursingContents): Promise<void> {
  const userId = await getCurrentUserId();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = {
    patient_id: contents.patientId,
    items: contents.items,
    last_analyzed_at: contents.lastAnalyzedAt ?? null,
    updated_at: contents.updatedAt,
  };
  if (userId) row.user_id = userId;
  const { error } = await getSupabase()
    .from("nursing_contents")
    .upsert(row, { onConflict: "patient_id" });
  if (error) console.error("saveNursingContents error:", error);
}

export async function deleteNursingContents(patientId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("nursing_contents")
    .delete()
    .eq("patient_id", patientId);
  if (error) console.error("deleteNursingContents error:", error);
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---- 患者別To-Do ヘルパー ----

export async function getPatientTodos(patientId: string): Promise<PatientTodo[]> {
  const { data, error } = await getSupabase()
    .from("patient_todos")
    .select("*")
    .eq("patient_id", patientId)
    .order("is_done", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getPatientTodos error:", error);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => ({
    id: row.id,
    patientId: row.patient_id,
    content: row.content,
    isDone: row.is_done,
    createdAt: row.created_at,
    doneAt: row.done_at ?? undefined,
  }));
}

/** 全患者の「未完了To-Doあり」マップを取得（一覧バッジ表示用） */
export async function getPatientsWithPendingTodos(): Promise<Set<string>> {
  const { data, error } = await getSupabase()
    .from("patient_todos")
    .select("patient_id")
    .eq("is_done", false);

  if (error) {
    console.error("getPatientsWithPendingTodos error:", error);
    return new Set();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Set((data ?? []).map((row: any) => row.patient_id));
}

export async function addPatientTodo(patientId: string, content: string): Promise<PatientTodo | null> {
  const userId = await getCurrentUserId();
  const { data, error } = await getSupabase()
    .from("patient_todos")
    .insert({
      patient_id: patientId,
      content,
      is_done: false,
      created_by: userId,
    })
    .select()
    .single();

  if (error) {
    console.error("addPatientTodo error:", error);
    return null;
  }

  return {
    id: data.id,
    patientId: data.patient_id,
    content: data.content,
    isDone: data.is_done,
    createdAt: data.created_at,
    doneAt: data.done_at ?? undefined,
  };
}

export async function togglePatientTodo(id: string, isDone: boolean): Promise<void> {
  const userId = await getCurrentUserId();
  const { error } = await getSupabase()
    .from("patient_todos")
    .update({
      is_done: isDone,
      done_at: isDone ? new Date().toISOString() : null,
      done_by: isDone ? userId : null,
    })
    .eq("id", id);

  if (error) console.error("togglePatientTodo error:", error);
}

export async function deletePatientTodo(id: string): Promise<void> {
  const { error } = await getSupabase()
    .from("patient_todos")
    .delete()
    .eq("id", id);
  if (error) console.error("deletePatientTodo error:", error);
}

// ---- localStorageからの自動移行 ----

const MIGRATION_KEY = "kango_migrated_to_supabase";

export async function migrateLocalStorageToSupabase(): Promise<void> {
  if (typeof window === "undefined") return;
  if (localStorage.getItem(MIGRATION_KEY)) return;

  const patientsRaw = localStorage.getItem("kango_patients");
  const recordsRaw = localStorage.getItem("kango_records");
  const nursingRaw = localStorage.getItem("kango_nursing_contents");

  const patients: Patient[] = patientsRaw ? JSON.parse(patientsRaw) : [];
  const records: SoapRecord[] = recordsRaw ? JSON.parse(recordsRaw) : [];
  interface LocalNursingContents {
    patientId: string;
    items: NursingContentItem[];
    lastAnalyzedAt?: string;
    updatedAt: string;
  }
  const nursingContents: LocalNursingContents[] = nursingRaw ? JSON.parse(nursingRaw) : [];

  if (patients.length === 0 && records.length === 0 && nursingContents.length === 0) {
    localStorage.setItem(MIGRATION_KEY, "true");
    return;
  }

  console.log(`[移行] localStorage → Supabase: 患者${patients.length}件, 記録${records.length}件, 看護内容${nursingContents.length}件`);

  // 患者をupsert
  if (patients.length > 0) {
    const rows = patients.map((p) => patientToRow(p));
    const { error } = await getSupabase().from("patients").upsert(rows, { onConflict: "id" });
    if (error) { console.error("[移行] patients error:", error); return; }
  }

  // 記録をupsert
  if (records.length > 0) {
    const rows = records.map((r) => recordToRow(r));
    const { error } = await getSupabase().from("soap_records").upsert(rows, { onConflict: "id" });
    if (error) { console.error("[移行] soap_records error:", error); return; }
  }

  // 看護内容をupsert
  for (const nc of nursingContents) {
    const { error } = await getSupabase().from("nursing_contents").upsert({
      patient_id: nc.patientId,
      items: nc.items,
      last_analyzed_at: nc.lastAnalyzedAt ?? null,
      updated_at: nc.updatedAt,
    }, { onConflict: "patient_id" });
    if (error) { console.error("[移行] nursing_contents error:", error); return; }
  }

  localStorage.setItem(MIGRATION_KEY, "true");
  console.log("[移行] 完了");
}
