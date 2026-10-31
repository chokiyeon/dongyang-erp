/** 사용자가 거래 목적을 고른 뒤 제안 계정을 확인한다. 적요만으로 확정하지 않는다. */
export const TRANSACTION_ACTIVITIES = [
  { key: "utilities-office", label: "사무실 전기·수도·가스 요금", code: "6120", hint: "수도광열비입니다. 자동차세·과태료와는 다른 항목입니다." },
  { key: "utilities-site", label: "현장 전기·수도·가스 요금", code: "5100", hint: "현장 수도광열비입니다. 사용한 공사 현장을 확인해 주세요." },
  { key: "penalty", label: "과태료·범칙금·벌금", code: "6150", hint: "일반 공과금·차량유지비와 별도 관리합니다. 손금불산입 등 세무조정 확인이 필요합니다." },
  { key: "rental-office", label: "정수기·복합기 등 일반 렌탈료", code: "6070", hint: "일반 임대 계약의 지급임차료입니다. 구입대금 할부나 금융리스라면 다른 처리가 필요합니다." },
  { key: "rental-site", label: "현장 장비 대여료", code: "5030", hint: "장비임차료입니다. 돌려받는 보증금·장비 구입대금은 제외합니다." },
  { key: "rental-car", label: "차량 일반 렌트료", code: "6070", hint: "일반 렌트 계약의 지급임차료입니다. 금융리스·차량 구입 할부인지 계약을 확인해 주세요." },
  { key: "rental-unknown", label: "렌탈·리스·할부 — 계약 종류 확인 필요", code: null, hint: "무엇을 빌렸는지와 계약 종류를 확인한 뒤 분류합니다. 임대료·구입 원금·이자를 한 코드로 확정하지 않습니다." },
  { key: "vehicle-office", label: "본사·공용 차량 주유·수리·통행료", code: "6050", hint: "차량유지비입니다. 보험료·자동차세·차량 구입 할부 원금은 별도 항목입니다." },
  { key: "vehicle-site", label: "현장 차량 주유·수리·통행료", code: "5070", hint: "현장 차량유지비입니다. 관련 현장을 확인해 주세요." },
  { key: "insurance", label: "회사·차량 보험료", code: "6060", hint: "보험료입니다. 보장 기간에 따른 선급비용 여부와 직원 부담 공제분은 별도 확인합니다." },
  { key: "vehicle-tax", label: "자동차세·일반 공과금", code: "6110", hint: "세금과공과입니다. 전기·수도·가스 요금, 부가세, 법인세, 과태료는 각각 따로 선택합니다." },
  { key: "communication", label: "전화·인터넷·우편 요금", code: "6080", hint: "통신비입니다." },
  { key: "office-rent", label: "사무실·창고 월세", code: "6070", hint: "지급임차료입니다. 돌려받는 보증금은 임차보증금으로 구분합니다." },
  { key: "deposit", label: "돌려받는 임차 보증금", code: "1140", hint: "임차보증금 자산입니다. 월세·렌탈료 비용과 구분합니다." },
  { key: "supplies", label: "사무용 소모품 구입", code: "6090", hint: "소모품비입니다. 자산으로 관리할 비품·장비 구입인지 확인해 주세요." },
  { key: "fee", label: "은행·회계사무소 등 수수료", code: "6100", hint: "지급수수료입니다. 대출 이자·어음 할인료와 구분합니다." },
  { key: "materials-used", label: "현장에서 바로 사용하는 자재 구입", code: "5000", hint: "현장 재료비입니다. 미사용 재고나 이미 잡힌 매입채무의 결제인지 확인합니다." },
  { key: "materials-stock", label: "창고에 보관할 자재 구입", code: "1100", hint: "미사용 원재료 자산입니다. 사용 시 현장 원가로 연결해야 합니다." },
  { key: "payable", label: "이미 등록한 자재·외주 미지급금 지급", code: "2000", hint: "미지급금 결제입니다. 원래 매입에서 발생한 비용을 다시 잡지 않습니다." },
  { key: "credit-card", label: "카드 사용대금 결제", code: "2000", hint: "카드 미지급금 결제로 분류합니다. 카드 사용내역의 자재비·차량비 등을 결제일에 다시 비용으로 잡지 않습니다." },
  { key: "payroll-paid", label: "이미 확정한 급여·일용직 급여 지급", code: "2070", hint: "급여미지급금 결제입니다. 실수령액과 공제 전 인건비는 다르며 급여대장에서 발생 비용을 확인합니다." },
  { key: "subcontract", label: "직접 발생한 외주공사비", code: "5020", hint: "외주공사비입니다. 이미 비용 처리한 외주대금의 결제라면 미지급금 지급을 선택합니다." },
  { key: "meals-office", label: "사무실 직원 식대·간식", code: "6030", hint: "본사 복리후생비입니다. 거래처 접대성 지출과 구분합니다." },
  { key: "meals-site", label: "현장 직원 식대·간식", code: "5060", hint: "현장 복리후생비입니다." },
  { key: "social-insurance-mixed", label: "4대보험 합산 납부 — 직원·회사 부담분 확인", code: null, hint: "직원에게 공제한 예수금과 회사 부담 보험료가 섞일 수 있습니다. 한 계정으로 자동 확정하지 않고 납부내역 확인 후 분리해야 합니다." },
  { key: "loan-short", label: "단기대출·마이너스통장 원금 상환", code: "2050", hint: "차입금 원금 상환입니다. 이자비용과 구분합니다." },
  { key: "loan-long", label: "장기대출 원금 상환", code: "2060", hint: "장기차입금 원금 상환입니다. 이자는 별도 분류합니다." },
  { key: "interest", label: "대출 이자 지급", code: "8000", hint: "이자비용입니다. 대출 원금 상환과 구분합니다." },
  { key: "loan-mixed", label: "대출·차량할부 원금과 이자 합산 지급", code: null, hint: "원금·이자와 계약 종류를 확인해 나눠야 합니다. 전액을 차량비·이자비용으로 확정하지 않습니다." },
  { key: "bill-payment", label: "발행한 지급어음 만기 결제", code: "2010", hint: "지급어음 채무 결제입니다. 자재비를 다시 발생시키지 않습니다." },
  { key: "bill-discount", label: "받을어음 할인 수수료", code: "8010", hint: "어음할인료입니다. 어음 원금·실제 입금액과 구분합니다." },
  { key: "construction-receipt", label: "청구한 공사대금 수금", code: "1020", hint: "공사미수금 회수입니다. 입금만으로 공사매출을 다시 발생시키지 않습니다." },
  { key: "interest-received", label: "예금 이자 입금", code: "7000", hint: "이자수익입니다. 원천징수된 세금과 실입금액의 차이를 별도로 확인합니다." },
  { key: "deposit-returned", label: "임차 보증금 돌려받음", code: "1140", hint: "임차보증금 회수입니다. 매출·잡이익과 구분합니다." },
  { key: "construction-advance", label: "매출 인식 전 공사 착수금 수령", code: "2040", hint: "선수금입니다. 실제 매출 귀속은 공사 계약·진행 기준을 확인합니다." },
  { key: "tax-payment", label: "확정된 법인세·법인지방소득세 납부", code: "2090", hint: "확정 납부 채무의 결제입니다. 선납세금·해당 연도 세금 비용과 대조가 필요합니다." },
  { key: "internal-transfer", label: "회사 통장끼리 이체", code: "1010", hint: "보통예금 간 이동입니다. 회사 매출·비용으로 처리하지 않습니다. 상대 계좌 거래도 함께 확인합니다." },
] as const;
export function getTransactionActivity(key: string) { return TRANSACTION_ACTIVITIES.find((item) => item.key === key); }

export function activityDirection(key: string): "IN" | "OUT" | null {
  if (key === "internal-transfer") return null;
  return ["construction-receipt", "construction-advance", "interest-received", "deposit-returned"].includes(key) ? "IN" : "OUT";
}
