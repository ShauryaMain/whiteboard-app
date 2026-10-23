"use client";

import { useParams } from "next/navigation";
import NotebookViewer from "@/components/NotebookViewer";

// A notebook opened from its link (anyone can read it: see
// supabase/2026-11-notebooks-sharing.sql). Public: no account needed.
export default function SharedNotebookPage() {
  const { token } = useParams();
  return <NotebookViewer token={String(token || "")} />;
}
