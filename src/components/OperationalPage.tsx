import OperationalApp from "@/components/OperationalApp";
import { getAdminSession, isAuthConfigured } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function OperationalPage({ route, loginError = "" }: { route: string; loginError?: string }) {
  const session = await getAdminSession();
  return <OperationalApp initialSession={session} authConfigured={isAuthConfigured()} initialLoginError={loginError} route={route} />;
}
