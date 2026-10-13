import type { Metadata } from "next";
import { QueryProvider } from "@/components/query-provider";
import { Toaster } from "@/components/ui/sonner";
import { RootClient } from "../RootClient";

export const metadata: Metadata = {
  title: "운동 기록",
  description: "운동 세트, 중량, 횟수를 빠르게 기록하세요.",
};

export default function AppPage() {
  return (
    <QueryProvider>
      <RootClient />
      <Toaster position="top-center" />
    </QueryProvider>
  );
}
