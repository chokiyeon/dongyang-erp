import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "동양계전 ERP",
  description: "공사 원가와 회사 자금을 연결하는 업무 공간",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body>{children}</body></html>;
}
