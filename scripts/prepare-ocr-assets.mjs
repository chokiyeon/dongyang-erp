import {copyFile,mkdir,readdir,cp} from 'node:fs/promises';
import {join} from 'node:path';
const root=process.cwd(),target=join(root,'public','ocr');
await mkdir(join(target,'core'),{recursive:true});await mkdir(join(target,'lang'),{recursive:true});
await copyFile(join(root,'node_modules/tesseract.js/dist/worker.min.js'),join(target,'worker.min.js'));
for(const f of await readdir(join(root,'node_modules/tesseract.js-core')))if(f.includes('-lstm.')&&/\.(js|wasm)$/.test(f))await copyFile(join(root,'node_modules/tesseract.js-core',f),join(target,'core',f));
for(const lang of ['kor','eng'])await copyFile(join(root,`node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`),join(target,'lang',`${lang}.traineddata.gz`));
await copyFile(join(root,'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'),join(target,'pdf.worker.min.mjs'));

for(const [from,to]of [['wasm','pdf-wasm'],['standard_fonts','pdf-fonts'],['cmaps','pdf-cmaps']])await cp(join(root,'node_modules/pdfjs-dist',from),join(target,to),{recursive:true});
await mkdir(join(target,'licenses'),{recursive:true});
for(const [from,to]of [['tesseract.js/LICENSE.md','tesseract-js.txt'],['tesseract.js-core/LICENSE','tesseract-core.txt'],['pdfjs-dist/LICENSE','pdfjs.txt']])await copyFile(join(root,'node_modules',from),join(target,'licenses',to));

console.log('로컬 OCR·PDF 파일 준비 완료');
