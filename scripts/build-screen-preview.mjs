import {readFile,writeFile,mkdir,copyFile} from "node:fs/promises";
import {chromium} from "@playwright/test";
const output="/workspace/artifacts";
const screens=[
 ["송금 준비표","transfer-preparation","자금"],
 ["송금 검토·구두승인","transfer-approvals","자금"],
 ["회사 통장 간 이체","bank-transfers","자금"],
 ["증빙·원본 파일","documents","자료"],
 ["공사별 손익계산서","project-profit-statement","공사"],
 ["직원별 급여 검토","payroll-review","인사"],
 ["총원가 확인·공사 배부","source-costs","공사"],
 ["자재·재고 관리","inventory","자재"],
 ["차량·과태료 관리","vehicles","차량"],
 ["법인세·지방소득세 추정","corporate-tax","세무"],
 ["회계 전달·인수인계","accounting-delivery","세무"],
];
await mkdir(output,{recursive:true});
let cards="";
for(const [title,key,category]of screens){const file=`/tmp/dongyang-erp-${key}.png`;const data=(await readFile(file)).toString("base64");await copyFile(file,`${output}/erp-${key}.png`);cards+=`<article data-category="${category}"><header><h2>${title}</h2><button type="button" class="zoom">크게 보기 ↗</button></header><div class="screen"><img src="data:image/png;base64,${data}" alt="${title}" loading="eager"></div></article>`;}
const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>동양계전 ERP 화면 미리보기</title><style>*{box-sizing:border-box}body{margin:0;background:#edf1f6;color:#183858;font:15px system-ui}body>header{background:#193b60;color:white;padding:24px 30px}h1{margin:0;font-size:26px}header p{margin:9px 0 0;color:#d0ddec;font-size:14px}nav{padding:16px 24px;display:flex;flex-wrap:wrap;gap:8px;background:white;border-bottom:1px solid #cbd6e3}button{cursor:pointer;font:inherit;border:1px solid #b9cadb;background:#fff;color:#193b60;border-radius:4px;padding:6px 12px}nav button.active{color:white;background:#246eb0}main{padding:22px;display:grid;grid-template-columns:1fr 1fr;gap:20px}article{background:white;border:1px solid #bccbdc;border-radius:7px;overflow:hidden;min-width:0}article[hidden]{display:none}article header{display:flex;align-items:center;justify-content:space-between;padding:12px 15px;border-bottom:1px solid #cbd6e3;gap:8px}h2{font-size:16px;margin:0}.zoom{font-size:12px;white-space:nowrap}.screen{height:380px;overflow:auto}img{width:100%;display:block}dialog{width:96vw;max-width:1600px;height:94vh;border:1px solid #849fbb;border-radius:8px;padding:0}dialog::backdrop{background:#142435c9}dialog header{position:sticky;top:0;z-index:1;background:white;padding:12px 18px;display:flex;justify-content:space-between;border-bottom:1px solid #cbd6e3}dialog img{min-width:900px}footer{padding:16px 24px;color:#556c83;font-size:13px}@media(max-width:780px){main{grid-template-columns:1fr;padding:12px}.screen{height:420px}h1{font-size:22px}}</style><header><h1>DONGYANG ERP · 화면 미리보기</h1><p>실제 개발 화면을 가상 검증 자료로 촬영했습니다. 회사 원본 자료는 포함하지 않았습니다.</p><p>각 화면의 ‘크게 보기’에서 세부 항목을 확인할 수 있습니다. 화면 안의 입력칸·버튼은 촬영된 이미지입니다.</p></header><nav aria-label="화면 분류">${["전체","자금","공사","인사","자재","차량","세무","자료"].map((c,i)=>`<button data-filter="${c}" class="${i===0?"active":""}">${c}</button>`).join("")}</nav><main>${cards}</main><footer>프로그램 사용은 별도 ERP 실행 주소에서 진행합니다. 이 파일은 설치 없이 열어 보는 화면 안내입니다.</footer><dialog aria-label="ERP 화면 확대"><header><strong id="screen-title"></strong><button id="close">닫기</button></header><img id="screen-image" alt=""></dialog><script>const modal=document.querySelector('dialog');document.querySelectorAll('.zoom').forEach(button=>button.onclick=()=>{const card=button.closest('article');const source=card.querySelector('img');document.querySelector('#screen-title').textContent=source.alt;document.querySelector('#screen-image').src=source.src;document.querySelector('#screen-image').alt=source.alt;modal.showModal()});document.querySelector('#close').onclick=()=>modal.close();document.querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b===button));document.querySelectorAll('article').forEach(card=>card.hidden=button.dataset.filter!=='전체'&&card.dataset.category!==button.dataset.filter)});</script></html>`;
await writeFile(`${output}/erp-preview.html`,html);
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH??"/usr/bin/chromium",args:["--no-sandbox"]});
try{const page=await browser.newPage({viewport:{width:1440,height:1100}});await page.setContent(html);await page.getByRole("button",{name:"크게 보기 ↗",exact:true}).first().click();if(!await page.getByRole("dialog").isVisible())throw new Error("화면 확대 실패");await page.getByRole("button",{name:"닫기",exact:true}).click();await page.screenshot({path:`${output}/erp-preview.png`,fullPage:true});}finally{await browser.close();}
console.log(`ERP 화면 미리보기 HTML·이미지 ${screens.length}개 생성 완료`);
