export class InputError extends Error {}

export const BANKS = ["하나은행", "기업은행", "전북은행", "국민은행", "우리은행", "신한은행"] as const;
export const WORK_TYPES = ["전기", "계장", "태양광", "풍력"] as const;
export const STATUS_LABELS = { PLANNED: "착공 전", IN_PROGRESS: "진행 중", COMPLETED: "준공", SETTLED: "정산 완료" } as const;
export const PARTNER_LABELS = { CLIENT: "발주처", SUPPLIER: "매입처", BOTH: "발주·매입 겸용" } as const;

export function text(data: FormData, name: string, label: string, required = false, max = 100): string {
  const value = data.get(name);
  if (value !== null && typeof value !== "string") throw new InputError(`${label} 입력값을 확인해 주세요.`);
  const result = (value ?? "").trim();
  if (required && !result) throw new InputError(`${label}을(를) 입력해 주세요.`);
  if (result.length > max) throw new InputError(`${label}은(는) ${max}자 이내로 입력해 주세요.`);
  return result;
}

export function choice<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) throw new InputError(`${label}을(를) 확인해 주세요.`);
  return value as T;
}

export function amount(value: string, label: string): string | null {
  if (!value) return null;
  // 빈값(미확인)과 0원을 구분하고 Number 변환 없이 정밀도를 보존합니다.
  if (!/^(0|[1-9]\d{0,19})$/.test(value)) throw new InputError(`${label}은(는) 쉼표 없이 20자리 이하의 0 이상 정수로 입력해 주세요.`);
  return value;
}

export function date(value: string, label: string): Date | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InputError(`${label} 형식을 확인해 주세요.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || value < "1900-01-01" || value > "2199-12-31") {
    throw new InputError(`${label}은(는) 유효한 날짜여야 합니다.`);
  }
  return parsed;
}

export function revision(data: FormData): number {
  const value = text(data, "version", "버전");
  if (!/^\d{1,9}$/.test(value)) throw new InputError("화면을 새로 열고 다시 저장해 주세요.");
  return Number(value);
}

export function formatWon(value: { toFixed: (places: number) => string } | null): string {
  if (value === null) return "미등록";
  return `${BigInt(value.toFixed(0)).toLocaleString("ko-KR")}원`;
}
