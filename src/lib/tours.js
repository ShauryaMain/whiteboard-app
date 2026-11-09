// Walkthroughs: short, step-by-step guides shown on a board when it is
// opened with ?tour=<name> (the "Show me the update" button does this).
//
// A walkthrough is a list of steps. Each step points at something on
// screen and says what to do with it:
//
//   id      a name for the step (other steps jump to it by this name)
//   title   a few words
//   body    one or two plain sentences
//   target  the thing to point at: a CSS selector. Elements are tagged for
//           this with data-tour="…" so the selectors stay stable.
//   place   where the note sits next to it: "below" | "above" | "left" | "right"
//   beside  (optional) put the note next to this element instead, when
//           sitting by the target would cover what the person needs to see
//   next    for "read this, then press Next" steps: the step to go to
//   clicks  for "your turn" steps: { selector: step } — pressing that
//           element moves on to that step
//   watch   called a few times a second; return a step id to jump there
//           (used to follow along when menus open and close), or null
//   last    true on the final step (the button says Done)
//
// To add a walkthrough for a future update: add data-tour tags to the
// buttons it needs to point at, add an entry below, and name it in that
// update's `tour` in src/lib/releases.js.

const has = (selector) => typeof document !== "undefined" && !!document.querySelector(selector);

const SHAPES = {
  insert: '[data-tour="insert-menu"]',
  item: '[data-tour="insert-shape"]',
  dialog: '[data-tour="shape-dialog"]',
  kinds: '[data-tour="shape-kinds"]',
  labels: '[data-tour="shape-labels"]',
  add: '[data-tour="shape-add"]',
  preview: '[data-tour="shape-preview"]',
  selected: '[role="toolbar"][aria-label="Selected items"]',
};

// While the Shape window is open: pressing Add finishes the tour; closing
// the window any other way goes back to the start.
const inShapeWindow = () => (has(SHAPES.dialog) ? null : "insert");

// The demo board's "Try a live class": the class is a pretend one (see
// src/lib/demoClassroom.js), and this walks a visitor through the part a
// teacher actually does: open a student's board and pin a comment on it.
const CLASS = {
  students: '[data-tour="live-students"]',
  anyStudent: '[data-tour^="roster-"]',
  ben: '[data-tour="roster-demo-ben"]',
  board: '[data-tour="student-board"]',
  comment: '[data-tour="student-comment"]',
  signIn: '[data-tour="demo-signin"]',
};

// The live class update: students get the full toolbar on their own board.
// A real class needs students, so this one is read-and-press-Next: it
// shows where a class starts, what students now have, and where to look.
const LIVE = {
  start: '[data-tour="start-live"]',
  tools: '[data-tour="tool-row"]',
};

// Notebooks (the November update): pages, paper, tape and Quiz me, and
// sharing. Runs on a new, empty notebook ("Show me the update").
const NB = {
  pill: '[data-notebook-pill="true"]',
  pageMenu: '[data-tour="page-menu"]',
  tapeTool: '[data-tour="tape-tool"]',
  tape: "[data-tape-id]",
  shown: '[data-tape="shown"]',
  quizStart: "[data-quiz-start]",
  quiz: "[data-quiz]",
  quizDone: '[data-quiz="done"]',
  share: '[data-notebook-share="true"]',
  signIn: '[data-tour="demo-signin"]',
};

export const TOURS = {
  notebooks: {
    id: "notebooks",
    name: "Notebooks",
    steps: [
      {
        id: "pages",
        title: "This is a notebook",
        body: "Paper pages, one under another: scroll to move through them. Tap here to see every page, and to move, copy or add pages.",
        target: NB.pill,
        place: "below",
        next: "paper",
      },
      {
        id: "paper",
        title: "Each page has its own paper",
        body: "Lined, squared, dots, Cornell and more. The Page menu also adds pages from a PDF, and exports the notebook as a PDF.",
        target: NB.pageMenu,
        place: "below",
        next: "tape",
      },
      {
        id: "tape",
        title: "New: tape",
        body: "Write something on the page, then pick Tape and drag it over what you wrote to hide it.",
        target: NB.tapeTool,
        place: "below",
        watch: () => (has(NB.tape) ? "peek" : null),
      },
      {
        id: "peek",
        title: "Tap the tape to peek",
        body: "The answer's underneath. Tap again to cover it.",
        target: NB.tape,
        place: "below",
        watch: () => (has(NB.quiz) ? "answer" : has(NB.shown) ? "quiz" : has(NB.tape) ? null : "tape"),
      },
      {
        id: "quiz",
        title: "Quiz me",
        body: "Covers every piece of tape on the page, then asks them one at a time. How you did stays on this device.",
        target: NB.quizStart,
        place: "right",
        watch: () => (has(NB.quiz) ? "answer" : null),
      },
      {
        id: "answer",
        title: "Say it, then check",
        body: "Press Show it, then say whether you knew it. At the end you can try just the ones you missed.",
        target: NB.quiz,
        place: "above",
        watch: () => (has(NB.quizDone) || !has(NB.quiz) ? "share" : null),
      },
      {
        id: "share",
        title: "Share it with a link",
        body: "Anyone with the link can read your notebook and quiz themselves, with no account. Or let them write on it with you.",
        target: NB.share,
        place: "below",
        last: true,
      },
    ],
  },
  // The demo notebook (/demo?start=notebook): its tape is already down.
  demoNotebook: {
    id: "demoNotebook",
    name: "A revision notebook",
    steps: [
      {
        id: "peek",
        title: "Tap the yellow tape",
        body: "The answer's underneath. Tap again to cover it.",
        target: NB.tape,
        place: "below",
        watch: () => (has(NB.quiz) ? "answer" : has(NB.shown) ? "quiz" : null),
      },
      {
        id: "quiz",
        title: "Now test yourself",
        body: "Quiz me covers every piece of tape on the page, then asks them one at a time.",
        target: NB.quizStart,
        place: "right",
        watch: () => (has(NB.quiz) ? "answer" : null),
      },
      {
        id: "answer",
        title: "Say it, then check",
        body: "Press Show it, then say whether you knew it. At the end you can try just the ones you missed.",
        target: NB.quiz,
        place: "above",
        watch: () => (has(NB.quizDone) || !has(NB.quiz) ? "pages" : null),
      },
      {
        id: "pages",
        title: "More pages",
        body: "Tap here to see every page. Add a page, or change its paper, from the Page menu. Your own tape: pick Tape and drag it over anything you write.",
        target: NB.pill,
        place: "below",
        next: "keep",
      },
      {
        id: "keep",
        title: "Keep it, free",
        body: "Sign in to keep this notebook and make as many more as you like, on your laptop, tablet and phone.",
        target: NB.signIn,
        place: "below",
        last: true,
      },
    ],
  },

  liveBoards: {
    id: "liveBoards",
    name: "Live class boards",
    steps: [
      {
        id: "start",
        title: "A live class starts here",
        body: "You get a class code. Students type it in on their own devices to join: no accounts, nothing to install.",
        target: LIVE.start,
        place: "below",
        next: "tools",
      },
      {
        id: "tools",
        title: "Students now get this whole row",
        body: "Each student has their own board, and it now has every tool you see here: highlighter, text, the Maths tools, shapes and page styles. Pictures, simulations and reference documents stay with you.",
        target: LIVE.tools,
        place: "below",
        next: "watch",
      },
      {
        id: "watch",
        title: "Then look in on anyone",
        body: "Once the class is running, a Students button appears up here. Tap it and pick a name to watch that student's board live. Tap their board to pin a comment right where they need it.",
        target: LIVE.start,
        place: "below",
        last: true,
      },
    ],
  },
  demoClass: {
    id: "demoClass",
    name: "A live class",
    steps: [
      {
        id: "students",
        title: "Your class is joining",
        body: "Five pretend students are each solving 2x + 3 = 11 on their own board. Tap Students to see who's here.",
        target: CLASS.students,
        place: "below",
        watch: () => (has(CLASS.board) ? "comment" : has(CLASS.anyStudent) ? "pick" : null),
      },
      {
        id: "pick",
        title: "Open a student's board",
        body: "Tap a name to see that student's working, live. Try Ben: he has slipped up somewhere.",
        target: CLASS.ben,
        beside: CLASS.anyStudent,
        place: "left",
        watch: () => (has(CLASS.board) ? "comment" : has(CLASS.anyStudent) ? null : "students"),
      },
      {
        id: "comment",
        title: "Pin a comment on the mistake",
        body: "This is the student's own board. Tap right where they went wrong, type a note and press Send. They see it straight away.",
        target: CLASS.board,
        place: "left",
        watch: () => (has(CLASS.comment) ? "done" : has(CLASS.board) ? null : "students"),
      },
      {
        id: "done",
        title: "Now watch Ben",
        body: "He reads your note and fixes his working, live. In a real class, every student does this on their own device, with no accounts.",
        target: CLASS.board,
        place: "left",
        last: true,
      },
    ],
  },
  // After keeping a demo lesson "for my next lesson": where the class
  // starts. (Opened with ?tour=classReady by DemoCarryOver.js.)
  classReady: {
    id: "classReady",
    name: "Your lesson board",
    steps: [
      {
        id: "start",
        title: "Your lesson board is ready",
        body: "When your class is in front of you, press Start live class. You get a code, and students type it on their own devices to join, with no accounts.",
        target: LIVE.start,
        place: "below",
        last: true,
      },
    ],
  },
  shapes: {
    id: "shapes",
    name: "Shapes",
    steps: [
      {
        id: "insert",
        title: "Tap Insert",
        body: "Shapes live in the Insert menu, next to images and simulations.",
        target: SHAPES.insert,
        place: "below",
        watch: () => (has(SHAPES.dialog) ? "pick" : has(SHAPES.item) ? "shape" : null),
      },
      {
        id: "shape",
        title: "Choose Shape",
        body: "This opens the Shape window, with a live preview.",
        target: SHAPES.item,
        place: "right",
        watch: () => (has(SHAPES.dialog) ? "pick" : has(SHAPES.item) ? null : "insert"),
      },
      {
        id: "pick",
        title: "Pick a shape and set it up",
        body: "Choose a family along the top. On a polygon, try typing 108 as the interior angle and watch it become a pentagon.",
        target: SHAPES.kinds,
        beside: SHAPES.preview,
        place: "below",
        next: "labels",
        clicks: { [SHAPES.add]: "done" },
        watch: inShapeWindow,
      },
      {
        id: "labels",
        title: "Choose what's labelled",
        body: "Switch angles, side lengths and corner letters on or off. The picture updates as you go. In 3D, drag the picture to turn it.",
        target: SHAPES.labels,
        beside: SHAPES.preview,
        place: "below",
        next: "add",
        clicks: { [SHAPES.add]: "done" },
        watch: inShapeWindow,
      },
      {
        id: "add",
        title: "Add it to the board",
        body: "Happy with it? Press Add to board.",
        target: SHAPES.add,
        beside: SHAPES.preview,
        place: "below",
        clicks: { [SHAPES.add]: "done" },
        watch: inShapeWindow,
      },
      {
        id: "done",
        title: "That's it — it's ink now",
        body: "Drag it into place, copy it, or rub parts out, just like anything you draw. Shape is under Insert whenever you need it.",
        target: SHAPES.selected,
        // beside the selection bar, so the note doesn't sit on the new shape
        place: "right",
        last: true,
      },
    ],
  },
};
