import { date, InputError } from "./validation";
export const ISSUED_NOTE_STATUSES = { OPEN: "미결제", SETTLED: "결제 완료", VOID: "등록 취소" } as const;
export function issuedNoteMaturity(value: string): string {
  const start = date(value, "발행일"); if (!start) throw new InputError("발행일을 입력해 주세요.");
  const month = start.getUTCMonth() + 3;
  const last = new Date(Date.UTC(start.getUTCFullYear(), month + 1, 0));
  const result = new Date(Date.UTC(start.getUTCFullYear(), month, Math.min(start.getUTCDate(), last.getUTCDate()))).toISOString().slice(0,10);
  if (result > "2199-12-31") throw new InputError("계산된 만기일이 지원 범위를 벗어납니다.");
  return result;
}
