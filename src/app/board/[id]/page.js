"use client";

import { useParams } from "next/navigation";
import Whiteboard from "@/components/Whiteboard";

export default function BoardPage() {
  const params = useParams();
  const boardId = params.id;

  return <Whiteboard boardId={boardId} />;
}