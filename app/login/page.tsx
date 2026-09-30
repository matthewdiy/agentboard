import { redirect } from "next/navigation";

import { LoginCard } from "@/components/login-card";
import { getSession } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/documents");
  return <LoginCard />;
}
