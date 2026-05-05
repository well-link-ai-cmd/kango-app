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

type SoapLetter = "S" | "O" | "A" | "P";

export function textToSoap(text: string): { S: string; O: string; A: string; P: string } {
  const result = { S: "", O: "", A: "", P: "" };
  const lines = text.split("\n");
  // current は現在のセクション群（合成マーカー `A/P:` では複数セクションを同時に保持）
  let current: SoapLetter[] | null = null;
  let markerFound = false;
  const preambleLines: string[] = []; // どのマーカーも検出される前の行を退避

  for (const line of lines) {
    // 1) 合成マーカー（`A/P:` `S/O:` `S/O/A/P:` など）を最優先で認識。
    //    区切りは半角/ 全角／ 中点・ を許容。内容は指定された全セクションに投入する。
    const compoundMatch = line.match(/^([SOAP](?:[/／・][SOAP])+)[:：]\s*(.*)$/);
    if (compoundMatch) {
      markerFound = true;
      const letters = compoundMatch[1].split(/[/／・]/) as SoapLetter[];
      const rest = compoundMatch[2];
      current = letters;
      if (rest) {
        for (const letter of letters) {
          result[letter] = result[letter] ? `${result[letter]}\n${rest}` : rest;
        }
      }
      // rest が空（`A/P:` だけで中身なし）なら既存値は保護（非破壊）
      continue;
    }

    // 2) 単体マーカー（`S:` / 話者プレフィックス付き `夫S:` 等）
    const match = line.match(/^(.{0,5}?)([SOAP])[:：]\s*/);
    if (match) {
      markerFound = true;
      const prefix = match[1];
      const letter = match[2] as SoapLetter;
      const rest = line.slice(match[0].length);

      if (prefix && current) {
        // 話者プレフィックス扱い（セクション切替はせず、現セクション群の先頭に追記）
        // rest が空なら話者マーカー単独で意味がないので何もしない
        if (rest) {
          const appendText = `${prefix}${letter}: ${rest}`;
          const target = current[0];
          result[target] += (result[target] ? "\n" : "") + appendText;
        }
      } else {
        // セクション先頭として切替。
        // 空マーカー（`A:` のみで内容なし）が既存セクションを上書きしないよう保護
        current = [letter];
        if (rest) {
          const newContent = prefix ? `${prefix}${letter}: ${rest}` : rest;
          result[letter] = result[letter] ? `${result[letter]}\n${newContent}` : newContent;
        }
      }
      continue;
    }

    // 3) マーカー無し行は現セクション群全てに連結（合成マーカー中なら複数セクションに）
    if (current) {
      for (const target of current) {
        result[target] += (result[target] ? "\n" : "") + line;
      }
    } else {
      preambleLines.push(line);
    }
  }

  // マーカーが1つも検出されなかった場合、入力テキストを丸ごと S に入れて
  // ユーザーの貼り付け内容が消失しないようにする（フリー形式対応）
  if (!markerFound) {
    return { S: text.trim(), O: "", A: "", P: "" };
  }

  // 前置き行があれば S の先頭に差し込む（訪問日メモ等を失わないため）
  if (preambleLines.length > 0) {
    const preamble = preambleLines.join("\n").trim();
    if (preamble) {
      result.S = result.S ? `${preamble}\n${result.S}` : preamble;
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

export async function getRecordById(id: string): Promise<SoapRecord | null> {
  const { data, error } = await getSupabase()
    .from("soap_records")
    .select("*")
    .eq("id", id)
    .single();
  if (error) {
    if (error.code === "PGRST116") return null;
    console.error("getRecordById error:", error);
    return null;
  }
  return rowToRecord(data);
}

export async function saveRecord(record: SoapRecord): Promise<void> {
  const userId = await getCurrentUserId();
  const row = recordToRow(record, userId ?? undefined);
  const { error } = await getSupabase()
    .from("soap_records")
    .upsert(row, { onConflict: "id" });
  if (error) {
    console.error("saveRecord error:", error);
    throw new Error(error.message);
  }
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

/** 完了済みTo-Doの保持期間（日数）。これを過ぎたものは自動削除される */
const COMPLETED_TODO_RETENTION_DAYS = 7;

/** 完了から一定期間経過したTo-Doを削除（内部ヘルパー） */
async function cleanupOldCompletedTodos(): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - COMPLETED_TODO_RETENTION_DAYS);
  const { error } = await getSupabase()
    .from("patient_todos")
    .delete()
    .eq("is_done", true)
    .lt("done_at", cutoff.toISOString());
  if (error) console.error("cleanupOldCompletedTodos error:", error);
}

export async function getPatientTodos(patientId: string): Promise<PatientTodo[]> {
  // 古い完了済みTo-Doを自動削除
  await cleanupOldCompletedTodos();

  const { data, error } = await getSupabase()
    .from("patient_todos")
    .select("*")
    .eq("patient_id", patientId)
    .order("is_done", { ascending: true })      // 未完了(false)が先
    .order("created_at", { ascending: false }); // 同じ完了状態内では新しい順

  if (error) {
    console.error("getPatientTodos error:", error);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const todos = (data ?? []).map((row: any) => ({
    id: row.id,
    patientId: row.patient_id,
    content: row.content,
    isDone: row.is_done,
    createdAt: row.created_at,
    doneAt: row.done_at ?? undefined,
  }));

  // 念のためクライアント側でもソート: 未完了 → 完了の順
  todos.sort((a, b) => {
    if (a.isDone !== b.isDone) return a.isDone ? 1 : -1;
    return b.createdAt.localeCompare(a.createdAt);
  });

  return todos;
}

/** 全患者の「未完了To-Doあり」マップを取得（一覧バッジ表示用） */
export async function getPatientsWithPendingTodos(): Promise<Set<string>> {
  // ページ読み込み時にも古い完了済みTo-Doを自動削除
  await cleanupOldCompletedTodos();

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

// ============================================================
// 褥瘡計画書（褥瘡対策に関する看護計画書）
//
// AI責任分界:
//   - DESIGN-R, 危険因子, 日常生活自立度 → 看護師手入力
//   - 看護計画5軸のテキスト → AI下書き → 看護師確認・修正
// ============================================================

/** 日常生活自立度 */
export type DailyLifeLevel = "J1" | "J2" | "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

/** 危険因子評価（7項目） */
export interface RiskFactors {
  basicMobilityBed?: "できる" | "できない";        // 基本的動作能力（ベッド上の自力体位変換）
  basicMobilityChair?: "できる" | "できない";      // 基本的動作能力（イス上の座位保持・除圧）
  bonyProminence?: "なし" | "あり";                // 病的骨突出
  contracture?: "なし" | "あり";                   // 関節拘縮
  nutrition?: "なし" | "あり";                     // 栄養状態低下
  moisture?: "なし" | "あり";                      // 皮膚湿潤
  fragileSkin?: "なし" | "あり";                   // 皮膚の脆弱性
}

/** DESIGN-R®2020 採点（看護師手入力・AI禁止） */
export interface DesignR {
  d?: "d0" | "d1" | "d2" | "D3" | "D4" | "D5" | "DDTI" | "DU";  // 深さ（合計除外）
  e?: "e0" | "e1" | "e3" | "E6";                                  // 滲出液
  s?: "s0" | "s3" | "s6" | "s8" | "s9" | "s12" | "S15";          // 大きさ
  i?: "i0" | "i1" | "I3" | "I3C" | "I9";                          // 炎症・感染
  g?: "g0" | "g1" | "g3" | "G4" | "G5" | "G6";                    // 肉芽
  n?: "n0" | "N3" | "N6";                                         // 壊死組織
  p?: "p0" | "P6" | "P9" | "P12" | "P24";                         // ポケット
  total?: number;                                                 // 合計点（0-66、Dを除く）
}

/** 褥瘡部位 */
export type UlcerLocation = "仙骨部" | "坐骨部" | "尾骨部" | "腸骨部" | "大転子部" | "踵部" | "その他";

/** 褥瘡計画書 */
export interface PressureUlcerPlan {
  id: string;
  patientId: string;

  // 監査情報
  createdAt: string;
  updatedAt: string;

  // 基本情報
  planDate: string;                 // 計画作成日 YYYY-MM-DD
  nextReviewDate?: string;          // 次回評価日 YYYY-MM-DD
  staffName?: string;               // 記入看護師名
  staffTitle?: string;              // 肩書き

  // 判定（看護師入力）
  dailyLifeLevel?: DailyLifeLevel;
  riskFactors: RiskFactors;
  ohScaleScore?: number;            // 0-10

  // 現在の褥瘡
  hasCurrentUlcer: boolean;
  currentLocations: (UlcerLocation | string)[];  // 「その他」選択時は「その他（詳細）」形式の文字列を含む
  currentOnsetDate?: string;

  // 過去の褥瘡
  hasPastUlcer: boolean;
  pastLocations: (UlcerLocation | string)[];  // 「その他」選択時は「その他（詳細）」形式の文字列を含む
  pastHealedDate?: string;

  // DESIGN-R（看護師手入力・AI禁止）
  designR: DesignR;

  // 看護計画（AI下書き→看護師修正、各1000字以内）
  planBed?: string;
  planChair?: string;
  planSkincare?: string;
  planNutrition?: string;
  planRehab?: string;

  // 評価記録
  evaluationNotes?: string;

  // 下書きフラグ（AI生成前の途中状態）
  isDraft?: boolean;

  // AI生成メタ情報
  aiModel?: string;
  aiPromptVersion?: string;
  aiGeneratedAt?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pressureUlcerPlanFromRow(row: any): PressureUlcerPlan {
  return {
    id: row.id,
    patientId: row.patient_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    planDate: row.plan_date,
    nextReviewDate: row.next_review_date ?? undefined,
    staffName: row.staff_name ?? undefined,
    staffTitle: row.staff_title ?? undefined,
    dailyLifeLevel: row.daily_life_level ?? undefined,
    riskFactors: row.risk_factors ?? {},
    ohScaleScore: row.oh_scale_score ?? undefined,
    hasCurrentUlcer: row.has_current_ulcer,
    currentLocations: row.current_locations ?? [],
    currentOnsetDate: row.current_onset_date ?? undefined,
    hasPastUlcer: row.has_past_ulcer,
    pastLocations: row.past_locations ?? [],
    pastHealedDate: row.past_healed_date ?? undefined,
    designR: row.design_r ?? {},
    planBed: row.plan_bed ?? undefined,
    planChair: row.plan_chair ?? undefined,
    planSkincare: row.plan_skincare ?? undefined,
    planNutrition: row.plan_nutrition ?? undefined,
    planRehab: row.plan_rehab ?? undefined,
    evaluationNotes: row.evaluation_notes ?? undefined,
    isDraft: row.is_draft ?? false,
    aiModel: row.ai_model ?? undefined,
    aiPromptVersion: row.ai_prompt_version ?? undefined,
    aiGeneratedAt: row.ai_generated_at ?? undefined,
  };
}

/** 患者の褥瘡計画書一覧（新しい順） */
export async function getPressureUlcerPlans(patientId: string): Promise<PressureUlcerPlan[]> {
  const { data, error } = await getSupabase()
    .from("pressure_ulcer_plans")
    .select("*")
    .eq("patient_id", patientId)
    .order("plan_date", { ascending: false });

  if (error) {
    console.error("getPressureUlcerPlans error:", error);
    return [];
  }
  return (data ?? []).map(pressureUlcerPlanFromRow);
}

/** 単一の褥瘡計画書を取得 */
export async function getPressureUlcerPlan(id: string): Promise<PressureUlcerPlan | null> {
  const { data, error } = await getSupabase()
    .from("pressure_ulcer_plans")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("getPressureUlcerPlan error:", error);
    return null;
  }
  return data ? pressureUlcerPlanFromRow(data) : null;
}

/** 新規作成（id未指定）または更新（id指定） */
export async function savePressureUlcerPlan(
  plan: Omit<PressureUlcerPlan, "id" | "createdAt" | "updatedAt"> & { id?: string }
): Promise<PressureUlcerPlan | null> {
  const userId = await getCurrentUserId();

  const row = {
    ...(plan.id ? { id: plan.id } : {}),
    patient_id: plan.patientId,
    plan_date: plan.planDate,
    next_review_date: plan.nextReviewDate ?? null,
    staff_name: plan.staffName ?? null,
    staff_title: plan.staffTitle ?? null,
    daily_life_level: plan.dailyLifeLevel ?? null,
    risk_factors: plan.riskFactors ?? {},
    oh_scale_score: plan.ohScaleScore ?? null,
    has_current_ulcer: plan.hasCurrentUlcer,
    current_locations: plan.currentLocations ?? [],
    current_onset_date: plan.currentOnsetDate ?? null,
    has_past_ulcer: plan.hasPastUlcer,
    past_locations: plan.pastLocations ?? [],
    past_healed_date: plan.pastHealedDate ?? null,
    design_r: plan.designR ?? {},
    plan_bed: plan.planBed ?? null,
    plan_chair: plan.planChair ?? null,
    plan_skincare: plan.planSkincare ?? null,
    plan_nutrition: plan.planNutrition ?? null,
    plan_rehab: plan.planRehab ?? null,
    evaluation_notes: plan.evaluationNotes ?? null,
    is_draft: plan.isDraft ?? false,
    ai_model: plan.aiModel ?? null,
    ai_prompt_version: plan.aiPromptVersion ?? null,
    ai_generated_at: plan.aiGeneratedAt ?? null,
    user_id: userId,
    ...(plan.id ? {} : { created_by: userId }),
  };

  const { data, error } = await getSupabase()
    .from("pressure_ulcer_plans")
    .upsert(row)
    .select()
    .single();

  if (error) {
    console.error("savePressureUlcerPlan error:", error);
    return null;
  }
  return pressureUlcerPlanFromRow(data);
}

/** 削除 */
export async function deletePressureUlcerPlan(id: string): Promise<void> {
  const { error } = await getSupabase()
    .from("pressure_ulcer_plans")
    .delete()
    .eq("id", id);
  if (error) console.error("deletePressureUlcerPlan error:", error);
}

// =============================================================
// 訪問看護計画書（nursing_care_plans）
// カイポケ「訪問看護計画書」フォーマット準拠
// 手順書: docs/看護計画書_手順書.md
// =============================================================

export type NursingCarePlanType = "介護" | "医療";
export type NursingCarePlanTitle = "共通" | "看護" | "リハ";
/**
 * 課題の記述形式
 * - 'nanda':    課題ラベル + OP/TP/EP の構造化
 * - 'freeform': 自由文1ブロック（既存互換 + コピペ取り込み）
 */
export type NursingCareIssueFormat = "nanda" | "freeform";

/** AI生成・取り込みのメタ情報（NANDA / freeform 共通） */
export interface NursingCareIssueMeta {
  aiGenerated?: boolean;        // AIで生成された下書きかどうか
  aiModel?: string;             // 'claude-sonnet-4-6' 等
  aiGeneratedAt?: string;       // AI生成日時
  imported?: boolean;           // 既存計画書のコピペ取り込み起源かどうか
  importedAt?: string;          // 取り込み日時
}

/** NANDA形式の課題 */
export interface NursingCareIssueNanda extends NursingCareIssueMeta {
  no: number;
  date?: string;                // 記入日 YYYY-MM-DD
  format: "nanda";
  diagnosisLabel: string;       // 課題ラベル（看護診断名 or 自院の言い回し）
  op: string[];                 // 観察計画（O-P）
  tp: string[];                 // ケア計画（T-P）
  ep: string[];                 // 指導計画（E-P）
  evaluation?: string;          // 評価（AI下書き・看護師確認必須）
  evaluatedAt?: string;
}

/** 自由記載形式の課題（既存実装互換 + コピペ取り込み） */
export interface NursingCareIssueFreeform extends NursingCareIssueMeta {
  no: number;
  date?: string;
  format?: "freeform";          // 後方互換のため optional（未指定時は freeform 扱い）
  issue: string;                // 自由文（AI下書き or コピペ原文）
  evaluation?: string;
  evaluatedAt?: string;
}

/** 療養上の課題・支援内容 1行分（Discriminated Union） */
export type NursingCarePlanIssue = NursingCareIssueNanda | NursingCareIssueFreeform;

/** Issue から format を判定（後方互換：未指定なら freeform） */
export function getIssueFormat(issue: NursingCarePlanIssue): NursingCareIssueFormat {
  return issue.format === "nanda" ? "nanda" : "freeform";
}

/** Issue の表示用テキスト（NANDAなら整形して文字列化、freeformはそのまま） */
export function issueToDisplayText(issue: NursingCarePlanIssue): string {
  if (issue.format === "nanda") {
    const body = issueToBodyText(issue);
    return body ? `${issue.diagnosisLabel}\n${body}` : issue.diagnosisLabel;
  }
  return issue.issue;
}

/**
 * NANDA issue の本文部分（ラベルを除く OP/TP/EP の整形テキスト）。
 * カイポケ「療養上の課題・支援内容」欄にコピペできる形式。
 */
export function issueToBodyText(issue: NursingCareIssueNanda): string {
  const lines: string[] = [];
  if (issue.op.length > 0) {
    lines.push("(観察)");
    issue.op.forEach((item, i) => lines.push(`${formatBullet(i)}${item}`));
  }
  if (issue.tp.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("(ケア)");
    issue.tp.forEach((item, i) => lines.push(`${formatBullet(i)}${item}`));
  }
  if (issue.ep.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("(指導)");
    issue.ep.forEach((item, i) => lines.push(`${formatBullet(i)}${item}`));
  }
  return lines.join("\n");
}

/**
 * NANDA本文テキストをパースして OP/TP/EP に分割する。
 *
 * 想定する書式（ヘッダ）:
 *   - (観察) (ケア) (指導)
 *   - 観察計画 / ケア計画 / 指導計画
 *   - OP / TP / EP / O-P / T-P / E-P
 *
 * 各項目の区切り:
 *   - ①②③ などの囲み数字
 *   - 1. 2. 3.（半角数字）
 *   - ・ や - の箇条書き
 *   - 改行のみ
 *
 * ヘッダが検出できなかった場合は全文を op[] に入れる（情報損失を避ける）。
 */
export function parseBodyText(text: string): { op: string[]; tp: string[]; ep: string[] } {
  const result: { op: string[]; tp: string[]; ep: string[] } = { op: [], tp: [], ep: [] };
  if (!text.trim()) return result;

  const lines = text.split("\n");
  let current: "op" | "tp" | "ep" | "preamble" = "preamble";
  const preambleLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // ヘッダ判定（行頭一致）
    const opHeader = /^[(（]?\s*(観察|O-?P|OP)\s*[）)]?[:：]?\s*$/i;
    const tpHeader = /^[(（]?\s*(ケア|援助|T-?P|TP|ケア計画|援助計画)\s*[）)]?[:：]?\s*$/i;
    const epHeader = /^[(（]?\s*(指導|教育|E-?P|EP|指導計画|教育計画)\s*[）)]?[:：]?\s*$/i;

    if (opHeader.test(line)) { current = "op"; continue; }
    if (tpHeader.test(line)) { current = "tp"; continue; }
    if (epHeader.test(line)) { current = "ep"; continue; }

    // 行頭の箇条書き記号・番号を削除して項目テキスト本体を抽出
    const cleaned = line
      .replace(/^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]\s*/, "")
      .replace(/^[(（]?\s*\d+\s*[)）]?[.．、]?\s*/, "")
      .replace(/^[・\-—–]\s*/, "")
      .trim();
    if (!cleaned) continue;

    if (current === "preamble") {
      preambleLines.push(cleaned);
    } else {
      result[current].push(cleaned);
    }
  }

  // ヘッダが1つも見つからなかった場合：全行を op[] にフォールバック（情報損失防止）
  if (result.op.length === 0 && result.tp.length === 0 && result.ep.length === 0) {
    return { op: preambleLines, tp: [], ep: [] };
  }

  // ヘッダ前の行は最初に検出されたセクションに前置として入れる（通常は preamble は空）
  if (preambleLines.length > 0) {
    if (result.op.length > 0) result.op = [...preambleLines, ...result.op];
    else if (result.tp.length > 0) result.tp = [...preambleLines, ...result.tp];
    else result.ep = [...preambleLines, ...result.ep];
  }

  return result;
}

/** ①②③... の囲み数字（10超は括弧数字へフォールバック） */
function formatBullet(idx: number): string {
  const circled = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
  return idx < circled.length ? circled[idx] : `(${idx + 1})`;
}

export interface NursingCarePlan {
  id: string;
  patientId: string;

  // 監査情報
  createdAt: string;
  updatedAt: string;

  // 基本情報
  planDate: string;                        // 作成年月日 YYYY-MM-DD
  planType: NursingCarePlanType;           // 介護 / 医療
  planTitle: NursingCarePlanTitle;         // 共通 / 看護 / リハ
  isDraft: boolean;                        // 下書き / 確定

  // 課題の記述形式（NANDA構造化 / 自由記載）
  issueFormat: NursingCareIssueFormat;

  // 作成者（署名印字項目）
  authorName?: string;
  authorTitle?: string;
  author2Name?: string;
  author2Title?: string;

  // 看護・リハビリの目標（3000字、AI下書き可）
  nursingGoal?: string;

  // 療養上の課題・支援内容（複数行）
  issues: NursingCarePlanIssue[];

  // 衛生材料の情報（看護師手入力、AI禁止）
  hasSupplies: boolean;
  supplyProcedure?: string;     // 処置の内容（3000字）
  supplyMaterials?: string;     // 衛生材料（種類・サイズ）等（3000字）
  supplyQuantity?: string;      // 必要量（3000字）

  // 備考（3000字、AI補助可）
  remarks?: string;

  // 議事録（任意・AI生成時の参照ソース）
  // 退院前カンファレンス・サービス担当者会議等の貼付テキスト
  conferenceMemo?: string;

  // AI生成メタ情報
  aiModel?: string;
  aiPromptVersion?: string;
  aiGeneratedAt?: string;
}

/** DBの issues JSONB（snake_case）を camelCase + Discriminated Union に変換 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function issueFromRow(raw: any, idx: number): NursingCarePlanIssue {
  const no: number = typeof raw.no === "number" ? raw.no : idx + 1;
  const date: string | undefined = raw.date ?? undefined;
  const evaluation: string | undefined = raw.evaluation ?? undefined;
  const evaluatedAt: string | undefined = raw.evaluated_at ?? raw.evaluatedAt ?? undefined;
  const meta: NursingCareIssueMeta = {
    aiGenerated: raw.ai_generated ?? raw.aiGenerated ?? undefined,
    aiModel: raw.ai_model ?? raw.aiModel ?? undefined,
    aiGeneratedAt: raw.ai_generated_at ?? raw.aiGeneratedAt ?? undefined,
    imported: raw.imported ?? undefined,
    importedAt: raw.imported_at ?? raw.importedAt ?? undefined,
  };
  if (raw.format === "nanda") {
    return {
      no, date, format: "nanda",
      diagnosisLabel: raw.diagnosis_label ?? raw.diagnosisLabel ?? "",
      op: Array.isArray(raw.op) ? raw.op : [],
      tp: Array.isArray(raw.tp) ? raw.tp : [],
      ep: Array.isArray(raw.ep) ? raw.ep : [],
      evaluation, evaluatedAt, ...meta,
    };
  }
  // freeform（既存実装データは format フィールドなし）
  return {
    no, date, format: "freeform",
    issue: raw.issue ?? "",
    evaluation, evaluatedAt, ...meta,
  };
}

/** camelCase → DBの snake_case JSONB へ変換 */
function issueToRow(issue: NursingCarePlanIssue): Record<string, unknown> {
  const base: Record<string, unknown> = {
    no: issue.no,
    date: issue.date ?? null,
    evaluation: issue.evaluation ?? null,
    evaluated_at: issue.evaluatedAt ?? null,
    ai_generated: issue.aiGenerated ?? false,
    ai_model: issue.aiModel ?? null,
    ai_generated_at: issue.aiGeneratedAt ?? null,
    imported: issue.imported ?? false,
    imported_at: issue.importedAt ?? null,
  };
  if (issue.format === "nanda") {
    return {
      ...base,
      format: "nanda",
      diagnosis_label: issue.diagnosisLabel,
      op: issue.op,
      tp: issue.tp,
      ep: issue.ep,
    };
  }
  return {
    ...base,
    format: "freeform",
    issue: issue.issue,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function nursingCarePlanFromRow(row: any): NursingCarePlan {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawIssues: any[] = Array.isArray(row.issues) ? row.issues : [];
  return {
    id: row.id,
    patientId: row.patient_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    planDate: row.plan_date,
    planType: (row.plan_type ?? "介護") as NursingCarePlanType,
    planTitle: (row.plan_title ?? "共通") as NursingCarePlanTitle,
    isDraft: row.is_draft ?? true,
    issueFormat: (row.issue_format ?? "nanda") as NursingCareIssueFormat,
    authorName: row.author_name ?? undefined,
    authorTitle: row.author_title ?? undefined,
    author2Name: row.author2_name ?? undefined,
    author2Title: row.author2_title ?? undefined,
    nursingGoal: row.nursing_goal ?? undefined,
    issues: rawIssues.map((raw, i) => issueFromRow(raw, i)),
    hasSupplies: row.has_supplies ?? false,
    supplyProcedure: row.supply_procedure ?? undefined,
    supplyMaterials: row.supply_materials ?? undefined,
    supplyQuantity: row.supply_quantity ?? undefined,
    remarks: row.remarks ?? undefined,
    conferenceMemo: row.conference_memo ?? undefined,
    aiModel: row.ai_model ?? undefined,
    aiPromptVersion: row.ai_prompt_version ?? undefined,
    aiGeneratedAt: row.ai_generated_at ?? undefined,
  };
}

/** 患者の看護計画書一覧（新しい順） */
export async function getNursingCarePlans(patientId: string): Promise<NursingCarePlan[]> {
  const { data, error } = await getSupabase()
    .from("nursing_care_plans")
    .select("*")
    .eq("patient_id", patientId)
    .order("plan_date", { ascending: false });

  if (error) {
    console.error("getNursingCarePlans error:", error);
    return [];
  }
  return (data ?? []).map(nursingCarePlanFromRow);
}

/** 単一の看護計画書を取得 */
export async function getNursingCarePlan(id: string): Promise<NursingCarePlan | null> {
  const { data, error } = await getSupabase()
    .from("nursing_care_plans")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("getNursingCarePlan error:", error);
    return null;
  }
  return data ? nursingCarePlanFromRow(data) : null;
}

/**
 * 「現在有効な看護計画書」を取得。
 * is_draft=false の中で plan_date が最新のもの。
 * SOAP生成時の最優先コンテキストとして使う。
 */
export async function getActiveNursingCarePlan(patientId: string): Promise<NursingCarePlan | null> {
  const { data, error } = await getSupabase()
    .from("nursing_care_plans")
    .select("*")
    .eq("patient_id", patientId)
    .eq("is_draft", false)
    .order("plan_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("getActiveNursingCarePlan error:", error);
    return null;
  }
  return data ? nursingCarePlanFromRow(data) : null;
}

/** 新規作成（id未指定）または更新（id指定） */
export async function saveNursingCarePlan(
  plan: Omit<NursingCarePlan, "id" | "createdAt" | "updatedAt"> & { id?: string }
): Promise<NursingCarePlan | null> {
  const userId = await getCurrentUserId();

  const row = {
    ...(plan.id ? { id: plan.id } : {}),
    patient_id: plan.patientId,
    plan_date: plan.planDate,
    plan_type: plan.planType,
    plan_title: plan.planTitle,
    is_draft: plan.isDraft,
    issue_format: plan.issueFormat ?? "nanda",
    author_name: plan.authorName ?? null,
    author_title: plan.authorTitle ?? null,
    author2_name: plan.author2Name ?? null,
    author2_title: plan.author2Title ?? null,
    nursing_goal: plan.nursingGoal ?? null,
    issues: (plan.issues ?? []).map(issueToRow),
    has_supplies: plan.hasSupplies,
    supply_procedure: plan.supplyProcedure ?? null,
    supply_materials: plan.supplyMaterials ?? null,
    supply_quantity: plan.supplyQuantity ?? null,
    remarks: plan.remarks ?? null,
    conference_memo: plan.conferenceMemo ?? null,
    ai_model: plan.aiModel ?? null,
    ai_prompt_version: plan.aiPromptVersion ?? null,
    ai_generated_at: plan.aiGeneratedAt ?? null,
    user_id: userId,
    ...(plan.id ? {} : { created_by: userId }),
  };

  const { data, error } = await getSupabase()
    .from("nursing_care_plans")
    .upsert(row)
    .select()
    .single();

  if (error) {
    console.error("saveNursingCarePlan error:", error);
    return null;
  }
  return nursingCarePlanFromRow(data);
}

/** 削除 */
export async function deleteNursingCarePlan(id: string): Promise<void> {
  const { error } = await getSupabase()
    .from("nursing_care_plans")
    .delete()
    .eq("id", id);
  if (error) console.error("deleteNursingCarePlan error:", error);
}

// =============================================================
// 訪問看護報告書（visit_reports）— 通常 / 精神科
// 様式: 別紙様式2（通常） / 別紙様式4（精神科） 保医発0327第2号
// 手順書: docs/報告書3様式_手順書.md
// =============================================================

export type VisitReportType = "normal" | "psychiatric";
export type VisitCalendarSymbol = "○" | "◇" | "△";  // 看護師 / リハ職 / 特別指示書
export type DementiaLevel = "自立" | "Ⅰ" | "Ⅱa" | "Ⅱb" | "Ⅲa" | "Ⅲb" | "Ⅳ" | "M";

/** Barthel Index（10項目、0-100） */
export interface BarthelIndex {
  feeding?: number;       // 食事 0/5/10
  transfer?: number;      // 移乗 0/5/10/15
  grooming?: number;      // 整容 0/5
  toilet?: number;        // トイレ 0/5/10
  bathing?: number;       // 入浴 0/5
  walking?: number;       // 歩行 0/5/10/15
  stairs?: number;        // 階段 0/5/10
  dressing?: number;      // 更衣 0/5/10
  bowel?: number;         // 排便 0/5/10
  bladder?: number;       // 排尿 0/5/10
}

/** リハ別添（通常報告書のみ・PT/OT/STが訪問した場合） */
export interface RehabAttachment {
  dailyLifeLevel?: DailyLifeLevel;
  dementiaLevel?: DementiaLevel;
  barthelIndex?: BarthelIndex;
  barthelTotal?: number;
  communication?: string;
}

/** 衛生材料（看護師手入力・AI禁止） */
export interface HygieneMaterialItem {
  name: string;        // 例: ガーゼ、フィルム材
  quantity: string;    // 例: 1日3枚 × 30日
  status: "適切" | "不足" | "過剰" | "変更検討";
}

export interface HygieneMaterial {
  items: HygieneMaterialItem[];
  requestToDoctor?: string;  // 主治医への依頼事項（種類・量変更等）
}

/** 訪問日暦の1日 */
export interface VisitCalendarEntry {
  date: string;          // YYYY-MM-DD
  symbol: VisitCalendarSymbol;
}

/** 訪問看護報告書 */
export interface VisitReport {
  id: string;
  patientId: string;

  // 監査情報
  createdAt: string;
  updatedAt: string;

  // 基本情報
  reportType: VisitReportType;
  targetMonth: string;          // YYYY-MM
  isDraft: boolean;

  // 作成者
  authorName?: string;
  authorTitle?: string;

  // 本文（AI下書き可）
  diseaseProgress?: string;
  nursingContent?: string;
  familyCare?: string;          // 通常: 家庭での介護の状況 / 精神科: 家族等との関係
  specialNotes?: string;

  // 衛生材料（看護師手入力）
  hygieneMaterial?: HygieneMaterial;

  // 訪問日暦
  visitCalendar?: VisitCalendarEntry[];

  // リハ別添（通常のみ）
  rehabAttachment?: RehabAttachment;

  // GAF（精神科のみ・看護師手入力）
  gafScore?: number;
  gafJudgeDate?: string;
  gafUnavailable?: boolean;

  // AI生成メタ
  aiModel?: string;
  aiPromptVersion?: string;
  aiGeneratedAt?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function visitReportFromRow(row: any): VisitReport {
  const rehab = row.rehab_attachment;
  const rehabAttachment: RehabAttachment | undefined = rehab
    ? {
        dailyLifeLevel: rehab.daily_life_level ?? rehab.dailyLifeLevel ?? undefined,
        dementiaLevel: rehab.dementia_level ?? rehab.dementiaLevel ?? undefined,
        barthelIndex: rehab.barthel_index ?? rehab.barthelIndex ?? undefined,
        barthelTotal: rehab.barthel_total ?? rehab.barthelTotal ?? undefined,
        communication: rehab.communication ?? undefined,
      }
    : undefined;

  const hygiene = row.hygiene_material;
  const hygieneMaterial: HygieneMaterial | undefined =
    hygiene && (Array.isArray(hygiene.items) || hygiene.requestToDoctor || hygiene.request_to_doctor)
      ? {
          items: Array.isArray(hygiene.items) ? hygiene.items : [],
          requestToDoctor: hygiene.request_to_doctor ?? hygiene.requestToDoctor ?? undefined,
        }
      : undefined;

  return {
    id: row.id,
    patientId: row.patient_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reportType: row.report_type as VisitReportType,
    targetMonth: row.target_month,
    isDraft: row.is_draft ?? true,
    authorName: row.author_name ?? undefined,
    authorTitle: row.author_title ?? undefined,
    diseaseProgress: row.disease_progress ?? undefined,
    nursingContent: row.nursing_content ?? undefined,
    familyCare: row.family_care ?? undefined,
    specialNotes: row.special_notes ?? undefined,
    hygieneMaterial,
    visitCalendar: Array.isArray(row.visit_calendar) ? row.visit_calendar : [],
    rehabAttachment,
    gafScore: row.gaf_score ?? undefined,
    gafJudgeDate: row.gaf_judge_date ?? undefined,
    gafUnavailable: row.gaf_unavailable ?? false,
    aiModel: row.ai_model ?? undefined,
    aiPromptVersion: row.ai_prompt_version ?? undefined,
    aiGeneratedAt: row.ai_generated_at ?? undefined,
  };
}

/** 患者の月次報告書一覧（新しい順） */
export async function getVisitReports(patientId: string): Promise<VisitReport[]> {
  const { data, error } = await getSupabase()
    .from("visit_reports")
    .select("*")
    .eq("patient_id", patientId)
    .order("target_month", { ascending: false });

  if (error) {
    console.error("getVisitReports error:", error);
    return [];
  }
  return (data ?? []).map(visitReportFromRow);
}

/** 単一の月次報告書を取得 */
export async function getVisitReport(id: string): Promise<VisitReport | null> {
  const { data, error } = await getSupabase()
    .from("visit_reports")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("getVisitReport error:", error);
    return null;
  }
  return data ? visitReportFromRow(data) : null;
}

/** 同一の患者・対象月・様式の報告書を取得（重複作成防止用） */
export async function getVisitReportByMonth(
  patientId: string,
  targetMonth: string,
  reportType: VisitReportType
): Promise<VisitReport | null> {
  const { data, error } = await getSupabase()
    .from("visit_reports")
    .select("*")
    .eq("patient_id", patientId)
    .eq("target_month", targetMonth)
    .eq("report_type", reportType)
    .maybeSingle();

  if (error) {
    console.error("getVisitReportByMonth error:", error);
    return null;
  }
  return data ? visitReportFromRow(data) : null;
}

/** 新規作成（id未指定）または更新（id指定） */
export async function saveVisitReport(
  report: Omit<VisitReport, "id" | "createdAt" | "updatedAt"> & { id?: string }
): Promise<VisitReport | null> {
  const userId = await getCurrentUserId();

  const rehab = report.rehabAttachment;
  const rehabRow = rehab
    ? {
        daily_life_level: rehab.dailyLifeLevel ?? null,
        dementia_level: rehab.dementiaLevel ?? null,
        barthel_index: rehab.barthelIndex ?? null,
        barthel_total: rehab.barthelTotal ?? null,
        communication: rehab.communication ?? null,
      }
    : null;

  const hygieneRow = report.hygieneMaterial
    ? {
        items: report.hygieneMaterial.items ?? [],
        request_to_doctor: report.hygieneMaterial.requestToDoctor ?? null,
      }
    : {};

  const row = {
    ...(report.id ? { id: report.id } : {}),
    patient_id: report.patientId,
    report_type: report.reportType,
    target_month: report.targetMonth,
    is_draft: report.isDraft,
    author_name: report.authorName ?? null,
    author_title: report.authorTitle ?? null,
    disease_progress: report.diseaseProgress ?? null,
    nursing_content: report.nursingContent ?? null,
    family_care: report.familyCare ?? null,
    special_notes: report.specialNotes ?? null,
    hygiene_material: hygieneRow,
    visit_calendar: report.visitCalendar ?? [],
    rehab_attachment: rehabRow,
    gaf_score: report.gafScore ?? null,
    gaf_judge_date: report.gafJudgeDate ?? null,
    gaf_unavailable: report.gafUnavailable ?? false,
    ai_model: report.aiModel ?? null,
    ai_prompt_version: report.aiPromptVersion ?? null,
    ai_generated_at: report.aiGeneratedAt ?? null,
    user_id: userId,
    ...(report.id ? {} : { created_by: userId }),
  };

  const { data, error } = await getSupabase()
    .from("visit_reports")
    .upsert(row, { onConflict: "patient_id,target_month,report_type" })
    .select()
    .single();

  if (error) {
    console.error("saveVisitReport error:", error);
    return null;
  }
  return visitReportFromRow(data);
}

/** 削除 */
export async function deleteVisitReport(id: string): Promise<void> {
  const { error } = await getSupabase()
    .from("visit_reports")
    .delete()
    .eq("id", id);
  if (error) console.error("deleteVisitReport error:", error);
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
