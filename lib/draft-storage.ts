/**
 * SOAP記録作成中の下書き自動保存（localStorage ベース）
 *
 * 訪問看護の現場では、記録入力中に次の訪問に移動することがよくあり、
 * 画面を閉じてもAI投入前・確定前のデータを保持して続きから再開できるようにする。
 *
 * サーバー（Supabase）には保存しないため、同一端末の同一ブラウザ内でのみ有効。
 * 訪問看護の実運用（同じタブレット/スマホで移動中も使う）を想定した設計。
 */

export interface SoapDraft {
  patientId: string;
  visitDate: string;
  sInput: string;
  rawInput: string;
  alerts: string[];
  alertAnswers: { question: string; answer: string }[];
  questionAnswers: { question: string; answer: string }[];
  soap: { S: string; O: string; A: string; P: string };
  soapText: string;
  step: "input" | "questions" | "soap" | "nursing-update";
  updatedAt: string; // ISO 8601
}

const KEY_PREFIX = "kango-soap-draft-";

function key(patientId: string): string {
  return `${KEY_PREFIX}${patientId}`;
}

/**
 * 下書きを保存する。localStorage書き込みは失敗してもアプリは動作し続ける。
 */
export function saveDraft(draft: SoapDraft): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key(draft.patientId), JSON.stringify(draft));
  } catch (e) {
    // 容量オーバーや Private モードなどで失敗することがあるが、
    // アプリ機能としては致命ではないので握りつぶしてログのみ
    console.warn("draft save failed", e);
  }
}

/**
 * 下書きを読み込む。存在しない・壊れている場合は null。
 */
export function loadDraft(patientId: string): SoapDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key(patientId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SoapDraft;
    if (parsed.patientId !== patientId) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 下書きを明示的に削除する（記録を正式保存した時・ユーザーが破棄した時）。
 */
export function clearDraft(patientId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key(patientId));
  } catch {
    // ignore
  }
}

/**
 * 下書きが実質的に空かどうか（何も入力されていないなら保存しない）。
 */
export function isDraftEmpty(draft: Partial<SoapDraft>): boolean {
  if (draft.sInput?.trim()) return false;
  if (draft.rawInput?.trim()) return false;
  if (draft.soapText?.trim()) return false;
  if (draft.alertAnswers?.some((a) => a.answer.trim())) return false;
  if (draft.questionAnswers?.some((a) => a.answer.trim())) return false;
  return true;
}

/**
 * 自動保存時刻を人間が読める形式に整形する。
 * 例: "13:42", "昨日 22:15"
 */
export function formatDraftTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    if (sameDay) return hhmm;
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday =
      d.getFullYear() === yesterday.getFullYear() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getDate() === yesterday.getDate();
    if (isYesterday) return `昨日 ${hhmm}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${hhmm}`;
  } catch {
    return "";
  }
}
