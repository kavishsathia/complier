import { redirect } from "next/navigation";
import { useCases } from "@/lib/usecases";

export default function UseCasesIndex() {
  redirect(`/use-cases/${useCases[0].slug}`);
}
