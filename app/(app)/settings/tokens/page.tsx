import { redirect } from "next/navigation";

export default function LegacyTokensPage() {
  redirect("/settings");
}
