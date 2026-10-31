export const PROJECT_COST_CATEGORIES = { MATERIAL: "자재비", LABOR: "인건비", OTHER: "현장 기타비", OVERHEAD: "배부 공통경비" } as const;
export const REMAINING_COST_FIELDS = { remainingMaterial: "남은 자재비", remainingLabor: "남은 인건비", remainingOther: "남은 현장 기타비", remainingOverhead: "남은 배부 공통경비" } as const;
export type ProjectCostCategoryKey = keyof typeof PROJECT_COST_CATEGORIES;
