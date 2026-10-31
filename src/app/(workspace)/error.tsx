"use client";
export default function WorkspaceError({ reset }: { reset: () => void }) {
  return <div className="m-8 rounded-xl border border-red-200 bg-white p-8"><h2 className="text-lg font-bold">업무 자료를 불러오지 못했습니다.</h2><p className="mt-3 text-sm text-slate-600">데이터베이스 연결을 확인한 뒤 다시 시도해 주세요. 입력 중이던 자료는 저장되지 않았을 수 있습니다.</p><button onClick={reset} className="mt-5 rounded bg-blue-700 px-4 py-2 text-white">다시 시도</button></div>;
}
