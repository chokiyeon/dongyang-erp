import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {getDb} from '../../src/lib/db';
import {COMPANY_ID} from '../../src/lib/constants';
test('거래처 사업자번호 변경 사유·이력을 표시하고 기존 송금 계좌 확인을 다시 보류한다',async({page})=>{
 const db=getDb(),tag=randomUUID().slice(0,8);let partnerId='';try{
 partnerId=(await db.partner.create({data:{companyId:COMPANY_ID,code:`BIZ-${tag}`,name:`사업자 합성업체 ${tag}`,type:'SUPPLIER',businessNumber:'1234567890',payeeBank:'합성은행',payeeAccount:'1234567890',payeeHolder:'합성 예금주',payeeVerifiedAt:new Date()}})).id;
 await page.goto('/login');await page.getByLabel('관리자 비밀번호').fill(process.env.ERP_ADMIN_PASSWORD!);await page.getByRole('button',{name:'로그인',exact:true}).click();await expect(page).not.toHaveURL(/\/login$/);await page.goto(`/partners?edit=${partnerId}`);await page.getByLabel('사업자등록번호',{exact:true}).fill('001-23-45678');await page.getByLabel('사업자번호 등록·변경 사유',{exact:true}).fill('합성 사업자등록증 대조');await page.locator('.erp-record-form').getByRole('button',{name:'저장',exact:true}).click();await expect(page).toHaveURL(/saved=/);
 const saved=await db.partner.findUniqueOrThrow({where:{id:partnerId}});expect(saved.businessNumber).toBe('0012345678');expect(saved.payeeVerifiedAt).toBeNull();expect(saved.payeeAccount).toBe('1234567890');await page.goto(`/partners?edit=${partnerId}`);await expect(page.getByLabel('통장 사본 등으로 송금 은행·계좌번호·예금주를 확인했습니다.')).not.toBeChecked();await page.getByText('사업자번호 변경 이력',{exact:true}).click();await expect(page.locator('details')).toContainText('001-23-45678');await expect(page.locator('details')).toContainText('합성 사업자등록증 대조');
 }finally{if(partnerId){await db.partnerIdentityChange.deleteMany({where:{partnerId}});await db.partnerPaymentChange.deleteMany({where:{partnerId}});await db.partner.delete({where:{id:partnerId}});}}
});
