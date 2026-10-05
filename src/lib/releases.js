// The updates that get announced in the "What's new" pop-up on the boards
// page.
//
// HOW THIS IS MANAGED
// An update is announced only if it has an entry in this list. So:
//
//   • Bug fixes, small tweaks, behind-the-scenes work: just push as usual
//     and leave this file alone. Nobody is interrupted.
//   • A real improvement people should know about: add ONE entry at the TOP
//     of the list below, in the same push. Everyone sees it once, the next
//     time they open their boards.
//
// Each entry needs:
//   id        a name that is never reused or changed afterwards (it is how
//             a browser remembers "this person has seen this one")
//   date      the day it went out, as "YYYY-MM-DD". People who created
//             their account after this day are not shown it as "new".
//   title     short name, shown in the list of updates
//   headline  the big line at the top of the pop-up
//   intro     one or two plain sentences
//   slides    screenshots: put the image files in public/whats-new/<name>/
//             and list them here with a caption. 16:10 pictures fit best
//             (for example 1600 × 1000). PNG is the safe choice: it shows
//             on every browser, iPad included.
//   points    two to four short "what you can do" lines
//   tour      (optional) the name of a walkthrough in src/lib/tours.js.
//             With one, the pop-up offers "Show me the update", which opens
//             a new board and guides the person through it. Leave it out
//             and that button isn't shown.
//   tourBoardName  (optional) what that new board is called
//
// Newest first.

export const RELEASES = [
  {
    id: "2026-10-class-tools",
    date: "2026-10-05",
    title: "Class tools",
    headline: "See, steer and save the whole class",
    intro:
      "In a live class, the Students list now starts with four tools: Class overview, Pens down, Send my board and Save boards.",
    slides: [
      {
        src: "/whats-new/class-tools/overview.png",
        alt: "The class overview: five small live pictures of students' boards side by side, each with the student's name under it. Dara's is ringed and flagged Hand up; Aisha's and Maya's are flagged Done.",
        caption: "Class overview: every student's board at once, live",
      },
      {
        src: "/whats-new/class-tools/write.png",
        alt: "The teacher's view of Ben's board. The teacher has ringed a wrong answer in red and written the correct working beside it. A strip along the bottom has Comment and Write buttons, three pen colours, Undo and Remove my writing.",
        caption: "Open a board and choose Write to mark their work",
      },
      {
        src: "/whats-new/class-tools/show.png",
        alt: "A student's screen showing a classmate's board, with a bar across the top that reads: Your teacher is showing Ben's board to the class.",
        caption: "Show to class puts one board on every screen",
      },
      {
        src: "/whats-new/class-tools/pens-down.png",
        alt: "The teacher's board with the Students list open. Its four class tools are at the top, with Pens up highlighted, and the LIVE bar shows Pens down.",
        caption: "Pens down pauses their boards and brings them to yours",
      },
    ],
    points: [
      "Send my board puts your question on every student's board.",
      "Only you can rub out what you write or send. Their own work is never touched.",
      "Show a board with the student's name, or without it.",
      "Save boards makes a PDF, or a zip of pictures, before you end the class.",
    ],
  },
  {
    id: "2026-10-live-hands",
    date: "2026-10-05",
    title: "Hands up",
    headline: "Hands up: students can ask for help",
    intro:
      "Students in a live class can now raise a hand, or tell you they're done. You see it next to their name in the Students list.",
    slides: [
      {
        src: "/whats-new/live-hands/hands.png",
        alt: "The Students list in a live class. Dara and Ben are at the top, each flagged Hand up. Aisha and Maya are flagged Done. The foot of the list reads 2 hands up, 2 of 5 done, beside a Clear all button.",
        caption: "Hands that are up go to the top of your Students list",
      },
      {
        src: "/whats-new/live-hands/lower-hand.png",
        alt: "The teacher's view of Dara's board, with a Lower hand button beside her name and a comment pinned on her working.",
        caption: "Help them, then press Lower hand",
      },
      {
        src: "/whats-new/live-hands/side-by-side.png",
        alt: "A student's screen with the teacher's board on the left and the student's own board, with its toolbar, on the right.",
        caption: "Students can put your board next to their own",
      },
      {
        src: "/whats-new/live-hands/class-ended.png",
        alt: "A note on a student's screen saying This class has ended, with one button to look at their board and one to leave.",
        caption: "When you press End, students are told",
      },
    ],
    points: [
      "Clear all, at the foot of the list, resets everyone for the next question.",
      "A student's work now comes back if they refresh or join again.",
      "A badge on My board tells them when you've pinned a comment.",
      "They can see your board and their own side by side (not on phones).",
    ],
  },
  {
    id: "2026-10-live-boards",
    date: "2026-10-04",
    title: "Live class boards",
    headline: "Students get the full toolbar in a live class",
    intro:
      "Each student's own board in a live class now has the same tools as yours, not just a pen and an eraser. Open their board and you see everything they do, live.",
    slides: [
      {
        src: "/whats-new/live-boards/student-board.png",
        alt: "A student's own board in a live class, with the full toolbar across the top, handwritten working, a typed question and a labelled triangle.",
        caption: "A student's own board now has the full toolbar",
      },
      {
        src: "/whats-new/live-boards/teacher-view.png",
        alt: "The teacher's view of that student's board, showing the same working, with a numbered comment pinned next to one line.",
        caption: "Open any student's board and watch it live",
      },
      {
        src: "/whats-new/live-boards/comment.png",
        alt: "The student's board with a numbered pin on their working and the teacher's comment open beside it.",
        caption: "Your comments are pinned to the exact spot",
      },
      {
        src: "/whats-new/live-boards/maths-tools.png",
        alt: "A student's board with a graph, a curve the student has drawn on it, and the calculator open beside it.",
        caption: "Graph, calculator, ruler and compass for every student",
      },
    ],
    points: [
      "Students join with the class code, exactly as before.",
      "Pictures, simulations and reference documents stay with you.",
      "Drag to move around a student's board, pinch to zoom, or press Show all.",
      "Students who join late now get your whole board, however full it is.",
    ],
    tour: "liveBoards",
    tourBoardName: "Trying out a live class",
  },
  {
    id: "2026-10-shapes",
    date: "2026-10-04",
    title: "Shapes",
    headline: "Shapes, with the angles and lengths marked",
    intro:
      "You can now drop accurate shapes straight onto the board, in 2D and 3D. Set the sides, angles and lengths you want and they're labelled for you.",
    slides: [
      {
        src: "/whats-new/shapes/board.png",
        alt: "A board with a hexagon, a triangle, a parallelogram, a sector, a prism, a cuboid, a cylinder and a cone, each with its measurements labelled.",
        caption: "Polygons, triangles, circles and 3D solids, all labelled",
      },
      {
        src: "/whats-new/shapes/polygon.png",
        alt: "The Shape window showing a regular hexagon with its interior angle of 120 degrees and exterior angle of 60 degrees.",
        caption: "Choose the number of sides, or type the angle you want",
      },
      {
        src: "/whats-new/shapes/angles.png",
        alt: "The Shape window explaining that no regular polygon has a 100 degree interior angle and offering the pentagon instead.",
        caption: "Ask for an angle that can't exist and it tells you why",
      },
      {
        src: "/whats-new/shapes/solid.png",
        alt: "The Shape window showing a triangular prism with dashed hidden edges, its volume and its surface area.",
        caption: "3D solids you can turn round before you add them",
      },
    ],
    points: [
      "Find it under Insert ▸ Shape on any board.",
      "Sides, interior angle and exterior angle are linked: change one and the others follow.",
      "Switch angles, lengths, corner letters and equal-side marks on or off.",
      "It lands as ordinary ink, so you can move it, copy it or rub parts out.",
    ],
    tour: "shapes",
    tourBoardName: "Trying out shapes",
  },
];

// The calendar day ("YYYY-MM-DD") an account was created, or "" if unknown.
function accountDay(createdAt) {
  if (!createdAt) return "";
  const d = new Date(createdAt);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

// Updates this person hasn't seen yet, newest first. Anything that went
// out before they even had an account isn't "new" to them (the whole app
// is), so it is skipped.
export function unreadReleases(releases, seenIds, accountCreatedAt) {
  const seen = new Set(seenIds || []);
  const since = accountDay(accountCreatedAt);
  return releases.filter((r) => !seen.has(r.id) && !(since && r.date < since));
}
