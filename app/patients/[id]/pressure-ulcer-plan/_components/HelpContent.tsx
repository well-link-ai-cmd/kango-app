"use client";

/**
 * 褥瘡計画書 判定基準ヘルプコンテンツ
 *
 * 各セクションの折りたたみヘルプに表示する内容。
 * 厚労省様式・日本褥瘡学会ガイドライン第5版・DESIGN-R®2020 に準拠。
 */

import type { RiskFactors } from "@/lib/storage";

const HELP_BOX_CLASS = "mt-3 p-4 rounded-lg text-xs space-y-2 animate-fade-in";
const HELP_BOX_STYLE = { background: "rgba(56, 189, 248, 0.08)", color: "var(--text-secondary)" };

// ============================================================
// 日常生活自立度
// ============================================================
export function DailyLifeLevelHelp() {
  return (
    <div className={HELP_BOX_CLASS} style={HELP_BOX_STYLE}>
      <p className="font-semibold" style={{ color: "#0369A1" }}>障害高齢者の日常生活自立度（厚労省）</p>
      <table className="w-full text-xs">
        <tbody>
          <tr><td className="font-semibold py-1 pr-2 align-top">J1</td><td className="py-1">交通機関等を利用して外出する。生活自立</td></tr>
          <tr><td className="font-semibold py-1 pr-2 align-top">J2</td><td className="py-1">隣近所へなら外出する。生活自立</td></tr>
          <tr><td className="font-semibold py-1 pr-2 align-top">A1</td><td className="py-1">介助により外出し、日中はほとんどベッドから離れて生活する。準寝たきり</td></tr>
          <tr><td className="font-semibold py-1 pr-2 align-top">A2</td><td className="py-1">外出の頻度が少なく、日中も寝たり起きたりの生活。準寝たきり</td></tr>
          <tr><td className="font-semibold py-1 pr-2 align-top">B1</td><td className="py-1">車いすに移乗し、食事・排泄はベッドから離れて行う。**寝たきり（計画書必須）**</td></tr>
          <tr><td className="font-semibold py-1 pr-2 align-top">B2</td><td className="py-1">介助により車いすに移乗する。**寝たきり（計画書必須）**</td></tr>
          <tr><td className="font-semibold py-1 pr-2 align-top">C1</td><td className="py-1">自力で寝返りをうつ。**寝たきり（計画書必須）**</td></tr>
          <tr><td className="font-semibold py-1 pr-2 align-top">C2</td><td className="py-1">自力では寝返りもうたない。**寝たきり（計画書必須）**</td></tr>
        </tbody>
      </table>
      <p className="text-xs pt-2" style={{ color: "var(--text-muted)" }}>
        A2以下は褥瘡計画書の作成不要。B1以上で作成必須。
      </p>
    </div>
  );
}

// ============================================================
// OHスケール
// ============================================================
export function OhScaleHelp() {
  return (
    <div className={HELP_BOX_CLASS} style={HELP_BOX_STYLE}>
      <p className="font-semibold" style={{ color: "#0369A1" }}>OHスケール採点基準（在宅・訪問看護の第一選択）</p>
      <p>4項目の合計（0〜10点）で褥瘡発生リスクを評価する。</p>

      <div className="space-y-1 pt-2">
        <p className="font-semibold">① 自力体位変換能力</p>
        <ul className="pl-4 list-disc">
          <li>できる：0点</li>
          <li>どちらでもない：1.5点</li>
          <li>できない：3点</li>
        </ul>

        <p className="font-semibold pt-1">② 病的骨突出（仙骨部）</p>
        <ul className="pl-4 list-disc">
          <li>なし：0点</li>
          <li>軽度・中等度：1.5点</li>
          <li>高度：3点</li>
        </ul>

        <p className="font-semibold pt-1">③ 浮腫</p>
        <ul className="pl-4 list-disc">
          <li>なし：0点</li>
          <li>あり：3点</li>
        </ul>

        <p className="font-semibold pt-1">④ 関節拘縮</p>
        <ul className="pl-4 list-disc">
          <li>なし：0点</li>
          <li>あり：1点</li>
        </ul>
      </div>

      <div className="pt-2 border-t" style={{ borderColor: "rgba(3, 105, 161, 0.2)" }}>
        <p className="font-semibold">リスク分類</p>
        <ul className="pl-4 list-disc">
          <li>0点：リスクなし</li>
          <li>1〜3点：軽度リスク</li>
          <li>4〜6点：中等度リスク</li>
          <li>7〜10点：高度リスク</li>
        </ul>
      </div>
    </div>
  );
}

// ============================================================
// 危険因子 各項目ヒント
// ============================================================
export const RISK_FACTOR_HINTS: Record<keyof RiskFactors, string> = {
  basicMobilityBed: "ベッド上で自力で寝返り・体位変換ができるか。できない＝他者の介助が必要な状態。",
  basicMobilityChair: "椅子・車椅子での座位保持と、自力でのプッシュアップ等の除圧動作ができるか。できない＝定期的な介助が必要。",
  bonyProminence: "仙骨部・踵部・大転子部・坐骨部等で骨の輪郭が目立つ状態。触診で明らかに骨が浮いて感じられる。",
  contracture: "関節の可動域制限により、拘縮肢位での圧迫集中や皮膚同士の接触が生じる状態。",
  nutrition: "血清Alb値の低下（3.5g/dL未満目安）、体重減少、食事摂取量の低下、MNA-SF低値など。数値がなくても臨床的に栄養低下と判断できれば『あり』。",
  moisture: "発汗過多・尿失禁・便失禁・浸出液等で皮膚が持続的に湿潤している状態。オムツ内で蒸れやすい場合も該当。",
  fragileSkin: "浮腫・長期ステロイド使用・加齢等による皮膚の菲薄化、スキン-テア（皮膚裂傷）の保有または既往がある状態。",
};

export function RiskFactorGeneralHelp() {
  return (
    <div className={HELP_BOX_CLASS} style={HELP_BOX_STYLE}>
      <p className="font-semibold" style={{ color: "#0369A1" }}>危険因子評価について</p>
      <p>厚労省様式「褥瘡対策に関する看護計画書」に準拠した7項目の評価。</p>
      <p><strong>1項目でも「あり／できない」に該当した場合、看護計画の立案が必須</strong>となる。</p>
      <p className="pt-2 text-xs" style={{ color: "var(--text-muted)" }}>
        各項目右側の「？」ボタンで詳しい判断基準を確認できる。
      </p>
    </div>
  );
}

// ============================================================
// DESIGN-R®2020
// ============================================================
export function DesignRHelp() {
  return (
    <div className={HELP_BOX_CLASS} style={HELP_BOX_STYLE}>
      <p className="font-semibold" style={{ color: "#0369A1" }}>DESIGN-R®2020 採点基準（日本褥瘡学会）</p>
      <p>7項目を観察・触診・計測で採点する。<strong>小文字＝軽症</strong>、<strong>大文字＝重症</strong>。合計点（Dを除く）0〜66点。</p>

      <div className="space-y-1 pt-2">
        <p className="font-semibold">D: 深さ（Depth）</p>
        <ul className="pl-4 list-disc">
          <li>d0: 皮膚損傷・発赤なし / d1: 持続する発赤 / d2: 真皮までの損傷</li>
          <li>D3: 皮下組織まで / D4: 皮下組織を越える / D5: 関節腔・体腔に至る</li>
          <li><strong>DDTI: 深部損傷褥瘡（DTI）疑い</strong> — 表面は紫/栗色でも深部進行中</li>
          <li>DU: 深さ判定不能（壊死組織で覆われ測定不可）</li>
        </ul>

        <p className="font-semibold pt-1">E: 滲出液（Exudate）</p>
        <ul className="pl-4 list-disc">
          <li>e0: なし / e1: 少量：毎日交換不要 / e3: 中等量：1日1回交換</li>
          <li>E6: 多量：1日2回以上交換</li>
        </ul>

        <p className="font-semibold pt-1">S: 大きさ（Size・長径×短径 cm²）</p>
        <ul className="pl-4 list-disc">
          <li>s0: 皮膚損傷なし / s3: 4未満 / s6: 4〜16未満 / s8: 16〜36未満 / s9: 36〜64未満 / s12: 64〜100未満</li>
          <li>S15: 100以上</li>
        </ul>

        <p className="font-semibold pt-1">I: 炎症・感染（Inflammation/Infection）</p>
        <ul className="pl-4 list-disc">
          <li>i0: 局所の炎症徴候なし / i1: 局所の炎症徴候あり</li>
          <li><strong>I3C: 臨界的定着疑い</strong> — バイオフィルム示唆（ぬめり・脆弱肉芽・滲出液多）</li>
          <li>I3: 局所の明らかな感染徴候 / I9: 全身的影響あり（発熱等）</li>
        </ul>

        <p className="font-semibold pt-1">G: 肉芽（Granulation）</p>
        <ul className="pl-4 list-disc">
          <li>g0: 治癒・浅い褥瘡 / g1: 良性肉芽90%以上 / g3: 良性肉芽50〜90%</li>
          <li>G4: 良性肉芽10〜50% / G5: 良性肉芽10%未満 / G6: 良性肉芽なし</li>
        </ul>

        <p className="font-semibold pt-1">N: 壊死組織（Necrotic tissue）</p>
        <ul className="pl-4 list-disc">
          <li>n0: なし / N3: 柔らかい壊死組織 / N6: 硬い壊死組織</li>
        </ul>

        <p className="font-semibold pt-1">P: ポケット（Pocket・潰瘍面を含めた大きさから潰瘍面積を引いた値 cm²）</p>
        <ul className="pl-4 list-disc">
          <li>p0: なし / P6: 4未満 / P9: 4〜16未満 / P12: 16〜36未満 / P24: 36以上</li>
        </ul>
      </div>

      <div className="pt-2 border-t text-xs" style={{ borderColor: "rgba(3, 105, 161, 0.2)", color: "var(--text-muted)" }}>
        <p>※ DESIGN-Rの採点はAIが行わない。観察・触診に基づき看護師が判断する。</p>
        <p>※ 感染判定（I3・I3C）やDTI疑いの判断は臨床所見の総合評価が必要。</p>
      </div>
    </div>
  );
}
