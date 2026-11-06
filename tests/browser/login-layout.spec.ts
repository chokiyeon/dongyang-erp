import {test,expect} from '@playwright/test';
test('로그인 비밀번호 입력칸과 버튼은 운영 빌드에서도 테두리·여백·너비가 표시된다',async({page})=>{
 await page.goto('/login');await expect(page.getByRole('heading',{name:'동양계전 ERP 로그인'})).toBeVisible();const field=page.getByLabel('관리자 비밀번호'),button=page.getByRole('button',{name:'로그인',exact:true});await expect(field).toBeVisible();
 const shape=await field.evaluate(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return{width:r.width,height:r.height,border:parseFloat(s.borderTopWidth),padding:parseFloat(s.paddingTop)};});expect(shape.width).toBeGreaterThan(250);expect(shape.height).toBeGreaterThan(40);expect(shape.border).toBeGreaterThanOrEqual(1);expect(shape.padding).toBeGreaterThanOrEqual(8);
 const card=await page.locator('main').boundingBox();expect(card!.width).toBeLessThan(600);expect(card!.y).toBeGreaterThan(40);expect(await button.evaluate(e=>getComputedStyle(e).backgroundColor)).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
 await page.screenshot({path:'/workspace/artifacts/login.png',fullPage:true});
});
