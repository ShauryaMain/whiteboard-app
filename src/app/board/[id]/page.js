"use client";

import { useState, useSyncExternalStore } from "react";
import { useParams } from "next/navigation";
import Whiteboard from "@/components/Whiteboard";
import TourGuide from "@/components/TourGuide";
import { TOURS } from "@/lib/tours";

// A board opened with ?tour=<name> (the "Show me the update" button on the
// boards page does this) starts that walkthrough on top of it.
const subscribe = () => () => {};
const readTour = () => new URLSearchParams(window.location.search).get("tour");
const noTour = () => null;

export default function BoardPage() {
  const params = useParams();
  const asked = useSyncExternalStore(subscribe, readTour, noTour);
  const [ended, setEnded] = useState(false);
  const tour = asked && !ended ? TOURS[asked] : null;

  function endTour() {
    setEnded(true);
    // tidy the address, so reloading or sharing the link doesn't restart it
    window.history.replaceState(null, "", window.location.pathname);
  }

  return (
    <>
      <Whiteboard boardId={params.id} />
      {tour && <TourGuide tour={tour} onEnd={endTour} />}
    </>
  );
}
