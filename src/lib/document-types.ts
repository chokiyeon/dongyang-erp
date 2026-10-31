export const DOCUMENT_SOURCES={GENERAL:"회사 공통 자료",PROJECT:"공사 자료",TRADE:"매입·매출 증빙",EMPLOYEE:"근로계약·직원 자료",WORK:"현장 출역 원본",PAYROLL:"급여 확인 자료",VEHICLE:"차량 고지·비용",STOCK:"자재 입출고 증빙"} as const;
export const DOCUMENT_CATEGORIES={TAX:"세금계산서",STATEMENT:"거래명세서",CONTRACT:"계약서",WORK:"출역표·작업일보",VEHICLE:"차량 고지서",PAYROLL:"급여 근거",OTHER:"기타 증빙"} as const;
export const DOCUMENT_MAX_BYTES=10*1024*1024;
export const DOCUMENT_ACCEPT=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.docx,.doc,.pptx,.ppt,.hwp,.hwpx";
