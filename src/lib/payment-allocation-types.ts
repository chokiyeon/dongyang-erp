export const PAYMENT_CATEGORIES = { MATERIAL: "자재비", LABOR: "인건비", OTHER: "현장 기타비", COMPANY: "본사·공통·공사 외 지급" } as const;
export type PaymentCategoryKey = keyof typeof PAYMENT_CATEGORIES;
export type PaymentAllocationInput = { projectId: string; category: PaymentCategoryKey; amount: string; note: string };
