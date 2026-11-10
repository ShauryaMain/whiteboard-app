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
//   tourNotebook   (optional) true: the walkthrough opens on a new notebook
//                  instead of a board
//
// Newest first.

export const RELEASES = [
  {
    id: "2026-11-classes",
    // (change to the day this goes out)
    date: "2026-11-12",
    title: "Classes and homework",
    headline: "Send homework straight into your students' notebooks",
    intro:
      "Make a class and your students join with a code. Each gets a notebook of their own that you can send work into. They hand it in, and you mark it right on the page.",
    slides: [
      {
        src: "/whats-new/classes/class.png",
        alt: "A class page: the join code in big letters, a Copy join link button, and a piece of homework listed with how many are waiting to be marked.",
        caption: "Make a class: students join with a code",
      },
      {
        src: "/whats-new/classes/homework.png",
        alt: "A worksheet as a page in a student's notebook, with a strip above it reading Homework, Quadratics worksheet, due Mon, and a Hand in button.",
        caption: "The work lands in their notebook, with its due date",
      },
      {
        src: "/whats-new/classes/mark.png",
        alt: "A teacher's red marks on a student's page, and a marking card with a score of 7 out of 10, a comment and a Return to student button.",
        caption: "Mark it on the page, then hand it back",
      },
      {
        src: "/whats-new/classes/by-question.png",
        alt: "Question 1 from two students side by side, each with buttons for full marks or none and a running total.",
        caption: "Or mark one question across the whole class",
      },
    ],
    points: [
      "Teaching on your home screen: make a class (students join with a code), or a notebook for one student you tutor.",
      "Send a worksheet, a past paper, pages of your notebook or a board, as homework with a due date or as notes to keep.",
      "Students see what's due on their home screen and hand it in from the page. You see who has, and who changed it since.",
      "Mark in red on their page, give a score and a comment, or mark one question across everyone side by side.",
    ],
  },
  {
    id: "2026-11-notebooks",
    // (change to the day this goes out)
    date: "2026-11-01",
    title: "Notebooks",
    headline: "Notebooks: pages, subjects, and tape to test yourself",
    intro:
      "Take notes the way you would on paper, with every board tool on every page. Keep as many notebooks as you like, sorted into subjects. They're kept for good, and they're free.",
    slides: [
      {
        src: "/whats-new/notebooks/shelf.png",
        alt: "The home screen's notebook shelf: coloured covers with names and stickers, and subject chips (All, Maths, Physics, Lessons) along the top.",
        caption: "Your notebooks, on a shelf, sorted into subjects",
      },
      {
        src: "/whats-new/notebooks/pages.png",
        alt: "A notebook with Cornell paper and the pages panel open down the left, showing small pictures of three pages.",
        caption: "Real pages: lined, squared, dots, Cornell and more",
      },
      {
        src: "/whats-new/notebooks/quiz.png",
        alt: "A page of notes with yellow tape over the answers, one of them outlined in blue, and a bar at the bottom reading '2 of 5' with a Show it button.",
        caption: "Tape over answers, then Quiz me",
      },
      {
        src: "/whats-new/notebooks/share.png",
        alt: "The Share window: 'Anyone with the link can look' is chosen, with the notebook's link and a Copy button.",
        caption: "Share a notebook with a link: no account needed to read it",
      },
    ],
    points: [
      "New notebook on your home screen: pick a cover, a subject and the first page's paper. Every page can have its own paper.",
      "All pages: jump, move, copy, turn or delete pages. Add pages from a PDF to write on, and export the notebook (or some pages) as one PDF.",
      "Tape hides an answer until you tap it. Quiz me covers every piece on a page and asks them one at a time.",
      "Share with a link, so anyone can read it (and quiz themselves), or let them write on it too. Your students can keep a live lesson in a notebook of their own.",
    ],
    tour: "notebooks",
    tourBoardName: "My first notebook",
    tourNotebook: true,
  },
  {
    id: "2026-10-documents",
    date: "2026-10-18",
    title: "Documents beside the board",
    headline: "Write on your worksheets, and clip questions onto the board",
    intro:
      "The PDF beside the board is now a proper notebook: more tools, saved with the board, easy to move through on a tablet or phone. Clip any question onto the board instead of taking screenshots.",
    slides: [
      {
        src: "/whats-new/documents/picker.png",
        alt: "The Choose pages window for a 40-page textbook, with pages 3 to 7 and 12 ticked and '6 of 30 picked' at the bottom.",
        caption: "A long PDF? Pick the pages you need (up to 30)",
      },
      {
        src: "/whats-new/documents/tools.png",
        alt: "A worksheet beside the board with a highlighted question, a typed note, and tape hiding the answer. The document's tools run along its top.",
        caption: "Highlight, type, cover answers with tape, and much more",
      },
      {
        src: "/whats-new/documents/clip-box.png",
        alt: "A box drawn round a question on the worksheet, with 'With my markings' and 'Add to board' underneath.",
        caption: "Draw a box round a question…",
      },
      {
        src: "/whats-new/documents/clip-board.png",
        alt: "The question now on the board as a card labelled 'p. 1 · test40.pdf', selected, with Show in document and Keep in view buttons.",
        caption: "…and it's on the board, ready to work on",
      },
    ],
    points: [
      "Pick pages from a long PDF, and add pages (or blank, lined and graph pages) any time.",
      "Pen sizes and colours, highlighter, eraser, lasso, text, tape, a laser pointer and \"Follow me\". Hold the pen still to make a straight line.",
      "Clip a question onto the board. \"Keep in view\" floats it over the board; \"Show in document\" takes you back to it.",
      "Saved with the board. Easy to scroll: with an Apple Pencil your finger scrolls, without one use two fingers or the page handle. Phones get a Board | Document switch.",
    ],
  },
  {
    id: "2026-10-text-pages",
    date: "2026-10-17",
    title: "Text styles and page colours",
    headline: "Style your text, write maths, and pick a page colour",
    intro:
      "Text boxes now work like a document: bold, colours, highlights, sizes and fonts, with maths that sets itself as you type. And the page can be any colour, chalkboard green included.",
    slides: [
      {
        src: "/whats-new/text/text.png",
        alt: "A text box being typed in, with a bar above it: font, size, bold, italic, underline, text colour, highlight, alignment and maths. In the box, 'both true at once?' is bold and highlighted yellow, and a red italic hint follows.",
        caption: "Select some words and style just those, like in a document",
      },
      {
        src: "/whats-new/text/maths.png",
        alt: "A text box where x^2 + 6x + 5 = 0 shows a raised 2, and 3/4 shows as a stacked fraction.",
        caption: "Type x^2, x_2 or 3/4 and it turns into real maths",
      },
      {
        src: "/whats-new/text/fonts.png",
        alt: "The font list open, with Your fonts showing Class Handwriting (an uploaded font) and Upload a font, then Google fonts underneath. A heading on the board is written in the uploaded handwriting font.",
        caption: "Choose from Google fonts, or upload your own",
      },
      {
        src: "/whats-new/text/dark.png",
        alt: "A chalkboard-green squared page with a white parabola and the title y = x squared on the chalkboard, and the Page menu open showing page colours.",
        caption: "Pick a page colour: on a dark page, black writing shows white",
      },
    ],
    points: [
      "Bold, italic, underline, colour, highlight, size, font and alignment, for any words you select (Ctrl/⌘+B, I and U work too).",
      "x^2 raises, x_2 lowers and 3/4 stacks. Press Backspace straight after to keep what you typed.",
      "Upload a font (.ttf, .otf or .woff) and everyone on the board sees it.",
      "Page colours, from white to chalkboard and black, saved with the board.",
    ],
  },
  {
    id: "2026-10-find-people",
    date: "2026-10-16",
    title: "Find each other",
    headline: "Find the others on your board",
    intro:
      "When someone else has your board open, their initial shows at the top. Tap it and your board glides to what they're looking at, so you never have to hunt for their work.",
    slides: [
      {
        src: "/whats-new/people/faces.png",
        alt: "A board's top bar with two coloured initials, A and S, ringed: the other people who have this board open.",
        caption: "Everyone else on the board shows as a coloured initial at the top",
      },
      {
        src: "/whats-new/people/found.png",
        alt: "After tapping S: the board has moved to Sam's question 2, with a dashed outline labelled Sam's screen around what he can see.",
        caption: "Tap one to go to what they're looking at; an outline shows their screen for a moment",
      },
      {
        src: "/whats-new/people/tag.png",
        alt: "Sam writing x = 3 by hand, with a small Sam name tag at the tip of his pen.",
        caption: "A little name tag follows their pen while they write",
      },
    ],
    points: [
      "Tap someone's initial to go straight to their part of the board.",
      "With lots of people on a board, the rest are in a list under +.",
      "Their name follows their pen while they write, then fades.",
    ],
  },
  {
    id: "2026-10-settings",
    date: "2026-10-12",
    title: "Settings",
    headline: "Settings: set the board up your way",
    intro:
      "Choose how easily a scribble erases, whether the Move tool stays on, and what new boards start with. Your settings follow your account to every device.",
    slides: [
      {
        src: "/whats-new/settings/panel.png",
        alt: "The Settings panel over the boards page: Scribble to erase switched on, how easily a scribble erases set to Normal (with Gentle and Eager), Eraser set to Precise, Pencil only, and under Tools: after moving the board, tool hints and calculator angles.",
        caption: "Open it from the account menu on your boards page",
      },
      {
        src: "/whats-new/settings/on-a-board.png",
        alt: "A board with a ring round the new gear button, next to the home button at the top left.",
        caption: "Or from the gear beside the home button on any board",
      },
      {
        src: "/whats-new/settings/explainer.png",
        alt: "The Scribble to erase explainer: a short clip of the board with 2x = 14 being written, and a sentence on how to scribble over a mistake to rub it out.",
        caption: "Tap an (i) to see a short clip of what a setting does",
      },
      {
        src: "/whats-new/settings/new-boards.png",
        alt: "The New boards part of Settings: paper (blank, lined, squared, dot grid, isometric), pen colour and pen size, then the Account part with your name, sign out and delete my account.",
        caption: "Pick the paper, pen colour and size new boards start with",
      },
    ],
    points: [
      "Scribble to erase can be Gentle, Normal or Eager.",
      "The Move tool can go back to your last tool after one drag, or stay on.",
      "Set your name, hide the tool hints, and choose degrees or radians for the calculator.",
    ],
  },
  {
    id: "2026-10-graph-boards",
    date: "2026-10-10",
    title: "Graphs and charts",
    headline: "Several graphs on a board, and statistics charts",
    intro:
      "Put a graph beside each question: it moves, resizes, copies and undoes like anything else. Graph now draws bar charts, histograms, scatter graphs and box plots too.",
    slides: [
      {
        src: "/whats-new/graph-boards/two.png",
        alt: "A board with two graphs side by side. Question 1 is y = x² − 3 with its roots and turning point marked. Question 2 is a selected scatter of points with a line of best fit, with Edit, Copy, Cut, Duplicate and Delete buttons under it.",
        caption: "A graph for each question, selected and moved like anything else",
      },
      {
        src: "/whats-new/graph-boards/dialog.png",
        alt: "The new graph window: a row of presets along the top (−10 to 10, First quadrant, Trig −2π to 2π, Number line, Save as a preset), a large preview of y = sin(x) from −2π to 2π, and the settings split into Axes, Plot and Style tabs.",
        caption: "One-tap presets, a bigger preview, and settings in Axes, Plot and Style",
      },
      {
        src: "/whats-new/graph-boards/charts.png",
        alt: "Two charts side by side: a histogram of journey times with unequal class widths drawn as frequency density, and a bar chart of favourite colours.",
        caption: "Histograms (frequency density when the widths differ) and bar charts",
      },
      {
        src: "/whats-new/graph-boards/stats.png",
        alt: "A scatter graph of plant growth against hours with a dashed line of best fit and r = 0.999, beside two box plots comparing the test scores of Class A and Class B with their five-number summaries.",
        caption: "Scatter graphs with a line of best fit, and box plots to compare",
      },
    ],
    points: [
      "Maths, then Graph, adds another graph. Double-tap one to change it.",
      "Save your own presets, and turn on snapping in Style so ruler lines and dots land on the grid.",
      "Type or paste a chart's data, and the axes fit themselves.",
    ],
  },
  {
    id: "2026-10-graph-paper",
    date: "2026-10-09",
    title: "Graph paper",
    headline: "Set up graphs the way you draw them",
    intro:
      "The graph's Axes and paper tab is new. Give each axis its own range and scale, put the origin where you want it, and add axis names, arrows and a title.",
    slides: [
      {
        src: "/whats-new/graph-paper/ranges.png",
        alt: "A first-quadrant graph titled A journey, with Time (s) along the bottom from 0 to 10 and Distance (m) up the side from 0 to 50 in 5s, faint small squares between the main lines, arrows on the axes, and a curve plotted on it.",
        caption: "A range and a scale for each axis, names, arrows and a title",
      },
      {
        src: "/whats-new/graph-paper/trig.png",
        alt: "A graph of y = sin x with the x-axis numbered in multiples of π from −2π to 2π and the y-axis in ordinary numbers from −1.5 to 1.5, with its roots and turning points marked.",
        caption: "π or degrees along x, ordinary numbers up y",
      },
      {
        src: "/whats-new/graph-paper/numberline.png",
        alt: "A number line from −10 to 10 with three things marked on it: x > 2 as a red bar with an open circle at 2 and an arrow to the right, −4 ≤ x < 3 as a blue bar with a filled circle at −4 and an open circle at 3, and a green dot at −7.",
        caption: "Number lines, with points and inequalities marked on them",
      },
      {
        src: "/whats-new/graph-paper/unitcircle.png",
        alt: "A unit circle with the standard angles marked round it, from 0 to 11π/6, each with its exact (cos, sin) written beside it, such as (√3/2, 1/2).",
        caption: "A unit circle with every standard angle and its exact values",
      },
    ],
    points: [
      "One tap for four quadrants, the first quadrant, the top half or a unit circle.",
      "Also dotted, isometric and log paper (equations plot on log paper too).",
      "Faint small squares, and numbers spaced so they don't crowd.",
    ],
  },
  {
    id: "2026-10-graph-plot",
    date: "2026-10-09",
    title: "Plotting on graphs",
    headline: "Plot equations on the Graph tool",
    intro:
      "Open a graph and choose the new Plot tab. Type an equation such as y = x² − 3 with the same maths keys as the calculator, and it's drawn on the board straight away.",
    slides: [
      {
        src: "/whats-new/graph-plot/dialog.png",
        alt: "The graph dialog on its Plot tab. Two equations, y = x² − 3 in red and y = 2x + 1 in blue, are typed in maths boxes above a pad of maths keys. The picture beside them shows both curves with their roots, the turning point and where they cross marked with coordinates.",
        caption: "Type equations, and mark roots, turning points and where curves cross",
      },
      {
        src: "/whats-new/graph-plot/sliders.png",
        alt: "A graph on the board of y = a sin(bx + c) in purple, with y = sin x in grey for comparison. A Sliders panel beside the graph has sliders for a, b and c.",
        caption: "Letters like a, b and c get sliders on the board, to drag in the lesson",
      },
      {
        src: "/whats-new/graph-plot/readoff.png",
        alt: "A parabola on the board. A point on it is being read off: dotted lines run to both axes, a bar above it reads (1.5, −0.75) with Tangent and Pin buttons, and the tangent is drawn with gradient = 3. Another point, (−2, 1), is pinned.",
        caption: "Tap a curve to read off a point, its tangent and gradient",
      },
      {
        src: "/whats-new/graph-plot/shading.png",
        alt: "A graph with the area under y = 4 − ½x² from −2 to 2 shaded in red and labelled Area = 13.333, and the region y < x − 3 shaded in green below a dashed line.",
        caption: "Shade inequalities and the area under a curve",
      },
    ],
    points: [
      "Plot points from a table, join them up, or add a line of best fit.",
      "Put a table of values next to the graph, with the y row left blank for the class to fill in.",
      "Students in a live class see every change as you make it.",
    ],
  },
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
