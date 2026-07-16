"use client";

import { useParams } from "next/navigation";
import Whiteboard from "@/components/Whiteboard";

export default function BoardPage() {
  const params = useParams();
  return <Whiteboard boardId={params.id} />;
}