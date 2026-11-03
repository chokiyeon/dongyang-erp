# 근무 원본 판독 의존성

- `@e965/xlsx` 0.20.3: XLS/XLSX 판독, Apache-2.0. 고정 배포본은 SheetJS CE를 npm에 게시한 패키지다. 수식·매크로를 실행하지 않는다.
- `tesseract.js` 7.0.0 / `tesseract.js-core`: 브라우저 Web Worker·WebAssembly OCR. 설치된 패키지의 라이선스를 OCR 정적 파일과 함께 복사한다.
- `@tesseract.js-data/kor`, `@tesseract.js-data/eng` 1.0.0: `4.0.0_best_int`의 한국어/영어 학습 자료.
- `pdfjs-dist` 6.5.438: PDF 화면 렌더링. 작업 모듈·글꼴·CMap·WASM과 동봉 라이선스를 설치 패키지에서 복사한다. XFA는 사용하지 않는다.

준비 스크립트: `scripts/prepare-ocr-assets.mjs`. 원본을 외부 번역/인식 API에 전송하는 코드나 계정·유료 서비스 설정은 포함하지 않는다. 인식 정확도는 문서 품질과 손글씨에 따라 달라지며, 날짜별 공수와 지급액은 확인 절차를 거친다.
