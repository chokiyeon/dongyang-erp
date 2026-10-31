"use client";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { usePathname } from "next/navigation";

type ReportTable = { title: string; headers: string[]; rows: string[][] };
type Report = { title: string; company: string; capturedAt: string; tables: ReportTable[] };

function reportCell(cell: HTMLElement | undefined): string {
  if (!cell) return "";
  const controls = Array.from(cell.querySelectorAll("input,select,textarea"));
  if (!controls.length) return cell.innerText.replace(/\s+/g, " ").trim();
  const clone = cell.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("input,select,textarea").forEach((control) => control.remove());
  const values = controls.flatMap((control) => {
    if (control instanceof HTMLSelectElement) return Array.from(control.selectedOptions, (option) => option.text);
    if (control instanceof HTMLInputElement) {
      if (["hidden", "password", "file"].includes(control.type)) return [];
      return [control.type === "checkbox" ? control.checked ? "선택" : "미선택" : control.value];
    }
    return control instanceof HTMLTextAreaElement ? [control.value] : [];
  });
  return [clone.textContent ?? "", ...values].join(" ").replace(/\s+/g, " ").trim();
}

function visible(element: Element): boolean {
  return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
}

function captureReport(company: string): Report {
  const main = document.querySelector(".erp-workspace");
  const title = Array.from(main?.querySelectorAll("h1") ?? []).find(visible)?.textContent?.trim() || "업무 자료";
  const tables: ReportTable[] = [];
  // Next preserves previous routes in hidden Activity trees. Export only the
  // visible route, excluding the preview itself, so other projects cannot leak.
  for (const table of Array.from(main?.querySelectorAll("table") ?? []).filter((element) => visible(element) && !element.closest("dialog") && !element.closest("[data-erp-report-exclude]"))) {
    const header = table.querySelector("thead tr");
    const allHeaders = Array.from(header?.querySelectorAll("th") ?? [], (cell) => cell.getAttribute("data-erp-report-label") || cell.textContent?.trim() || "항목");
    const columns = allHeaders.map((name, index) => ({ name, index })).filter(({ name }) => !["처리", "수정", "바로가기", "상세"].includes(name));
    const headers = columns.map(({ name }) => name);
    const rows = Array.from(table.querySelectorAll("tbody tr"), (row) => {
      const cells = Array.from(row.querySelectorAll("td"));
      return columns.map(({ index }) => reportCell(cells[index] as HTMLElement | undefined));
    });
    tables.push({ title: table.getAttribute("data-erp-report-title") || table.closest("section")?.querySelector("h2")?.textContent?.trim() || title, headers, rows });
  }
  // Include the current entry values with the label 'unsaved' to distinguish them
  // from database-backed query results. Never capture hidden fields or passwords.
  for (const form of Array.from(main?.querySelectorAll(".erp-record-form") ?? []).filter(element=>visible(element)&&!element.closest("[data-erp-report-exclude]"))) {
    const rows: string[][] = [];
    for (const control of Array.from(form.querySelectorAll("input,select,textarea"))) {
      if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) continue;
      if (control instanceof HTMLInputElement && ["hidden", "password", "submit"].includes(control.type)) continue;
      const label = control.labels?.[0];
      const clone = label?.cloneNode(true) as HTMLElement | undefined;
      clone?.querySelectorAll("input,select,textarea").forEach((element) => element.remove());
      const name = clone?.textContent?.replace(/\s+/g, " ").trim() || control.name;
      const value = control instanceof HTMLSelectElement ? Array.from(control.selectedOptions, (option) => option.text).join(", ") : control instanceof HTMLInputElement && control.type === "checkbox" ? (control.checked ? "선택" : "미선택") : control.value;
      if (name) rows.push([name, value]);
    }
    if (rows.length) tables.push({ title: `${form.closest("section")?.querySelector("h2")?.textContent?.trim() || "입력 정보"} (입력값·저장 여부 별도 확인)`, headers: ["항목", "입력값"], rows });
  }
  return { title, company, capturedAt: new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date()), tables };
}

export function PageActions({ companyName }: { companyName: string }) {
  const pathname = usePathname();
  const [report, setReport] = useState<Report | null>(null);
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (report && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [report]);
  useEffect(() => { dialog.current?.close(); }, [pathname]);
  function preview(print = false) {
    const captured = captureReport(companyName);
    if (!captured.tables.length) { setNotice("미리보기할 자료가 없습니다."); return; }
    flushSync(() => { setReport(captured); setNotice(""); });
    if (!dialog.current?.open) dialog.current?.showModal();
    if (print) window.print();
  }
  function save() {
    const forms = Array.from(document.querySelectorAll<HTMLFormElement>(".erp-workspace .erp-record-form")).filter(visible);
    const form = forms.find((element) => element.dataset.erpActive === "true") ?? forms[0];
    if (!form) { setNotice("현재 화면에 저장할 입력 양식이 없습니다."); return; }
    if (form.querySelector("button:disabled")) { setNotice("저장 중입니다. 잠시 기다려 주세요."); return; }
    setNotice("");
    form.requestSubmit();
  }
  async function exportExcel() {
    const captured = captureReport(companyName);
    if (!captured.tables.length) { setNotice("엑셀로 저장할 자료가 없습니다."); return; }
    setExporting(true); setNotice("");
    try {
      const { Workbook } = await import("exceljs");
      const workbook = new Workbook();
      workbook.creator = "동양계전 ERP";
      for (const [index, table] of captured.tables.entries()) {
        const worksheet = workbook.addWorksheet(`${index + 1}_${table.title}`.replace(/[\\/*?:[\]]/g, "").slice(0, 31));
        worksheet.addRow([table.title]);
        worksheet.addRow([captured.company, `출력: ${captured.capturedAt}`]);
        worksheet.addRow([]);
        worksheet.addRow(table.headers);
        for (const row of table.rows) {
          const values = row.map((value, column) => {
            const isMoney = /금액|잔액|가액|한도|처리액|예정액|할인료|지급액|일당|기준액|총원가|공통액|반영액|배부액/.test(table.headers[column] ?? "");
            const normalized = value.replace(/^(예정|실제|남은)\s*/, "").replace(/[,원\s]/g, "");
            // Excel has only 15 significant digits. Keep larger amounts as text.
            if (isMoney && /^-?\d{1,15}$/.test(normalized) && Number.isSafeInteger(Number(normalized))) return Number(normalized);
            return value;
          });
          worksheet.addRow(values);
        }
        worksheet.getRow(1).font = { bold: true, size: 14 };
        worksheet.getRow(4).font = { bold: true, color: { argb: "FFFFFFFF" } };
        worksheet.getRow(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF264E78" } };
        worksheet.columns.forEach((column, i) => {
          column.width = i === 0 ? 24 : 22;
          if (/금액|잔액|가액|한도|처리액|예정액|할인료|지급액|일당|기준액|총원가|공통액|반영액|배부액/.test(table.headers[i] ?? "")) column.numFmt = '#,##0"원"';
        });
        worksheet.views = [{ state: "frozen", ySplit: 4 }];
        worksheet.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
      }
      const buffer = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement("a");
      link.href = url; link.download = `${captured.title}_${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date())}.xlsx`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setNotice("조회 자료를 엑셀 파일로 저장했습니다. 현재 조회 범위와 입력값만 포함됩니다.");
    } catch { setNotice("엑셀 파일을 만들지 못했습니다. 다시 시도해 주세요."); }
    finally { setExporting(false); }
  }
  return <div className="erp-actionbar">
    <div className="erp-action-controls"><span className="erp-action-caption">업무 도구</span><button className="erp-button erp-button-primary" onClick={save} disabled={pathname === "/"} title={pathname === "/" ? "입력 화면에서 사용할 수 있습니다." : "현재 입력 양식 저장"}>저장</button><button className="erp-button" onClick={() => preview()}>미리보기</button><button className="erp-button" onClick={() => preview(true)}>프린트</button><button className="erp-button erp-button-excel" disabled={exporting} onClick={exportExcel}>{exporting ? "엑셀 생성 중…" : "엑셀로 저장"}</button></div>
    {notice && <p role="status" className="erp-action-notice">{notice}</p>}
    <dialog ref={dialog} className="erp-report-dialog" aria-labelledby="erp-report-title" onCancel={() => setReport(null)} onClose={() => setReport(null)}>
      <div className="erp-report-controls"><strong>인쇄 미리보기</strong><div><button className="erp-button erp-button-primary" onClick={() => window.print()}>프린트</button><button className="erp-button" onClick={() => dialog.current?.close()}>닫기</button></div></div>
      {report && <article className="erp-report"><h1 id="erp-report-title">{report.title}</h1><p className="erp-report-meta">{report.company} · 출력일시 {report.capturedAt}</p><p className="erp-report-note">현재 조회 범위의 자료입니다. 입력 양식은 저장 전 값이 포함될 수 있습니다.</p>{report.tables.map((table, index) => <section key={index}><h2>{table.title}</h2><div className="overflow-x-auto"><table><thead><tr>{table.headers.map((header, i) => <th key={i}>{header}</th>)}</tr></thead><tbody>{table.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}>{cell}</td>)}</tr>)}</tbody></table></div></section>)}</article>}
    </dialog>
  </div>;
}
