"use client";

import { useParams, useSearchParams } from "next/navigation";
import Whiteboard from "@/components/Whiteboard";

export default function BoardPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const boardId = params.id;
  const isOwner = searchParams.get("owner") === "true";

  return <Whiteboard boardId={boardId} isOwner={isOwner} />;
}