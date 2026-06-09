import type { Metadata } from "next";
import "@/app/globals.css";
import OperationalApp from "@/components/OperationalApp";
import { getAdminSession, isAuthConfigured } from "@/lib/auth";

export const metadata: Metadata = {
  title: "AI 학교 시간표 운영 콘솔",
  description: "AI와 함께 학교 시간표를 작성하고 검증하는 웹앱",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getAdminSession();

  return (
    <html lang="ko">
      <body>
        <OperationalApp initialSession={session} authConfigured={isAuthConfigured()} />
        <div hidden>{children}</div>
      </body>
    </html>
  );
}
