import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { assertAuthEnvironment, auth } from "@/lib/auth";

export async function getSession() {
  assertAuthEnvironment();
  return auth.api.getSession({
    headers: await headers(),
  });
}

export async function requireSession() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  return session;
}
