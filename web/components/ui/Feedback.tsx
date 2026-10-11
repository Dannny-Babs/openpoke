"use client";
import { Toaster } from "sonner";
export function Feedback() {
  return <Toaster position="top-right" closeButton visibleToasts={2} toastOptions={{ className: "workspace-toast" }} />;
}
