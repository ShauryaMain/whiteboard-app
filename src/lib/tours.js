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

export const TOURS = {
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
