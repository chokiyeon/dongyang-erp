-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN     "businessType" TEXT;

-- CreateTable
CREATE TABLE "AccountingCodeTransition" (
    "id" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingCodeTransition_pkey" PRIMARY KEY ("id")
);

-- One-time user-authorized transition. Preserve prior code definitions and links.
INSERT INTO "AccountingCodeTransition" ("id", "snapshot", "createdAt")
SELECT 'construction-tax-v1', jsonb_build_object(
  'codes', (SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb) FROM "AccountingCode" c),
  'transactionLinks', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t."id", 'accountingCodeId', t."accountingCodeId", 'businessType', t."businessType")), '[]'::jsonb) FROM "BankTransaction" t WHERE t."accountingCodeId" IS NOT NULL OR t."businessType" IS NOT NULL),
  'bankCodes', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a."id", 'code', a."accountingCode", 'version', a."version")), '[]'::jsonb) FROM "BankAccount" a WHERE a."accountingCode" IS NOT NULL)
), CURRENT_TIMESTAMP;

-- Do not infer the meaning of prior classifications. Preserve all money/dates.
UPDATE "BankTransaction" SET "accountingCodeId" = NULL, "businessType" = NULL WHERE "accountingCodeId" IS NOT NULL OR "businessType" IS NOT NULL;
UPDATE "BankAccount" SET "accountingCode" = NULL, "version" = "version" + 1 WHERE "accountingCode" IS NOT NULL;
DELETE FROM "AccountingCode";

-- These are ERP management numbers, not a statutory nationwide numbering system.
INSERT INTO "AccountingCode" ("id", "code", "name", "group", "note", "active", "version", "createdAt", "updatedAt") VALUES
('tax-v1-1000', '1000', '현금', '자산', '현금 보유액과 현금 입출금', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-1010', '1010', '보통예금', '자산', '은행 예금의 상대계정. 거래 성격별 비용·채권·채무 분류와 구분', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-1020', '1020', '공사미수금', '자산', '청구한 공사대금 중 미수금의 발생·회수. 회수 시 매출 중복 인식 주의', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-1030', '1030', '받을어음', '자산', '수취한 어음과 만기 회수·할인', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-1040', '1040', '기타미수금', '자산', '공사대금 외 받을 금액', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-1050', '1050', '선급금', '자산', '자재·외주 등 거래 완료 전 선지급액', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-1060', '1060', '가지급금', '자산', '용도·정산이 미확정인 선지급액. 최종 계정 확인 필요', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-1070', '1070', '선급비용', '자산', '차기 기간에 해당하는 보험료·임차료 등', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-1080', '1080', '선납세금', '자산', '미리 납부한 법인세 등', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-1100', '1100', '원재료', '자산', '아직 사용하지 않은 창고·현장 보유 자재. 사용분 재료비와 구분', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-1110', '1110', '공구와기구', '자산', '자산으로 관리할 공구·기구. 비용 처리 기준은 별도 확인', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-1120', '1120', '차량운반구', '자산', '트럭·승용차 취득 원가. 유류·수리비와 구분', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-1130', '1130', '비품', '자산', '자산으로 관리할 사무용 비품', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-1140', '1140', '임차보증금', '자산', '사무실·창고 등의 임차보증금', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-1150', '1150', '부가세대급금', '자산', '매입 부가세. 공제 가능 여부는 증빙과 거래별 확인', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-2000', '2000', '미지급금', '부채', '자재·경비 등의 미지급액과 지급. 이미 발생한 비용의 중복 계상 주의', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-2010', '2010', '지급어음', '부채', '발행한 어음과 만기 결제', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-2020', '2020', '예수금', '부채', '급여 원천세·근로자 부담 보험료 등 보관 후 납부할 금액', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-2030', '2030', '부가세예수금', '부채', '매출 부가세', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-2040', '2040', '선수금', '부채', '매출 인식 전 받은 공사 착수금 등. 수익 귀속 확인 필요', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-2050', '2050', '단기차입금', '부채', '단기 차입금·마이너스통장 원금의 차입과 상환', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-2060', '2060', '장기차입금', '부채', '장기 차입금 원금. 이자비용과 구분', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-2070', '2070', '급여미지급금', '부채', '확정 급여의 지급 채무. 실수령액 이체를 급여 비용과 중복 계상하지 않음', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-2080', '2080', '미지급비용', '부채', '발생했지만 아직 지급하지 않은 이자 등', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-2090', '2090', '법인세등미지급금', '부채', '확정된 법인세·법인지방소득세 등의 납부 채무', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-3000', '3000', '자본금', '자본', '법인 출자금', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-3010', '3010', '이익잉여금', '자본', '결산 후 이익잉여금. 결산 조정 자료 확인', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-4000', '4000', '공사매출', '수익', '전기·계장·태양광·풍력 공사의 수익. 입금과 매출 귀속은 별도 판단', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-4010', '4010', '기타매출', '수익', '공사 외 재화·용역 매출', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-5000', '5000', '현장 재료비', '공사원가', '현장에 사용한 자재 원가. 미사용 자재 재고와 구분', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-5010', '5010', '현장 노무비', '공사원가', '현장 근로자의 공제 전 노무비. 지급액·공제·회사 부담분과 연결 필요', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-5020', '5020', '외주공사비', '공사원가', '협력업체에 맡긴 공사·용역 원가', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-5030', '5030', '장비임차료', '공사원가', '공사용 장비 임차비', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-5040', '5040', '현장 운반비', '공사원가', '자재·장비 운반비', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-5050', '5050', '현장 경비', '공사원가', '현장에 직접 귀속되는 기타 경비. 세부 증빙 확인', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-5060', '5060', '현장 복리후생비', '공사원가', '현장 근로자 식대·복리후생비 등', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-5070', '5070', '현장 차량유지비', '공사원가', '현장 귀속 차량의 유류·수리비', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-5080', '5080', '현장 보험료', '공사원가', '현장 귀속 보험료·회사 부담 보험료. 개인 공제와 구분', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-5090', '5090', '퇴직공제부금', '공사원가', '건설근로자 퇴직공제부금', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-5100', '5100', '현장 수도광열비', '공사원가', '현장 전기·수도·가스 요금. 관련 현장 확인', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-5110', '5110', '현장 통신비', '공사원가', '현장에 직접 귀속되는 통신비', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-5120', '5120', '현장 지급임차료', '공사원가', '현장 숙소·사무실 등 임차료. 보증금과 구분', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-5130', '5130', '현장 소모품비', '공사원가', '현장 소모성 물품. 자재·자산과 구분', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-5140', '5140', '현장 지급수수료', '공사원가', '현장 직접 귀속 수수료', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-6000', '6000', '사무실 급여', '판매관리비', '사무실 월급제 급여. 현장 노무비와 구분', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-6010', '6010', '상여금', '판매관리비', '임직원 상여금', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-6020', '6020', '퇴직급여', '판매관리비', '퇴직급여·퇴직연금 비용. 부담금 지급과 비용 귀속 확인', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-6030', '6030', '복리후생비', '판매관리비', '본사 직원 복리후생비', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-6040', '6040', '여비교통비', '판매관리비', '출장·교통비', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-6050', '6050', '차량유지비', '판매관리비', '본사·공용 차량 유류·수리·통행료 등. 현장 배분 여부 확인', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-6060', '6060', '보험료', '판매관리비', '본사·차량 보험료와 회사 부담 보험료', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-6070', '6070', '지급임차료', '판매관리비', '사무실·창고 임차료', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-6080', '6080', '통신비', '판매관리비', '전화·인터넷·우편 비용', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-6090', '6090', '소모품비', '판매관리비', '사무용·업무용 소모품', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-6100', '6100', '지급수수료', '판매관리비', '회계사무소·은행·각종 업무 수수료', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-6110', '6110', '세금과공과', '판매관리비', '자동차세·공과금 등. 법인세·부가세·벌과금과 구분', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-6120', '6120', '수도광열비', '판매관리비', '전기·수도·가스 요금', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-6130', '6130', '감가상각비', '판매관리비', '유형자산의 기간별 감가상각 비용', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-6140', '6140', '기업업무추진비', '판매관리비', '업무 관련 접대성 지출. 증빙·한도 등 세무조정 확인', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-6150', '6150', '과태료·범칙금·벌금', '판매관리비', '일반 차량비와 구분. 손금불산입 등 세무조정 검토 필요', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-7000', '7000', '이자수익', '영업외수익', '예금 등의 이자수익', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-7010', '7010', '잡이익', '영업외수익', '기타 영업외 수익. 거래 성격 확인', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-8000', '8000', '이자비용', '영업외비용', '차입금 이자. 원금 상환과 구분', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-8010', '8010', '어음할인료', '영업외비용', '받을어음 할인 시 발생하는 금융비용', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-8020', '8020', '잡손실', '영업외비용', '기타 영업외 손실. 최종 계정·세무조정 확인', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-9000', '9000', '법인세비용', '법인세등', '해당 사업연도 법인세 비용. 실제 납부액과 귀속·선납액 구분', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('tax-v1-9010', '9010', '법인지방소득세비용', '법인세등', '해당 사업연도 법인지방소득세 비용', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
