import {test,expect} from '@playwright/test';
test('틀린 관리자 암호는 거부하고 설정한 암호로 로그인한다',async({page})=>{
 await page.goto('/login');const password=page.getByLabel('관리자 비밀번호');await password.fill('Ab!2468');await page.getByRole('button',{name:'로그인',exact:true}).click();await expect(page.locator('form').getByRole('alert')).toHaveText('비밀번호를 확인해 주세요.');await expect(page).toHaveURL(/\/login$/);
 await password.fill(process.env.ERP_ADMIN_PASSWORD!);await page.getByRole('button',{name:'로그인',exact:true}).click();await expect(page).not.toHaveURL(/\/login$/);await expect(page.getByRole('button',{name:'로그아웃',exact:true})).toBeVisible();
});
