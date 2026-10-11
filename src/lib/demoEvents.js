// The demo board's two app-bar buttons ("Sign in free to keep your work"
// and the house button) ask the demo's guide (DemoGuide.js) first, so it
// can open the sign-in sheet or offer to keep the board before leaving.
// If nothing answers (no guide on the page), the old behaviour runs.

export const DEMO_SIGNIN_EVENT = "cleanslate:demo-signin";
export const DEMO_LEAVE_EVENT = "cleanslate:demo-leave";

// Returns true if the guide took care of it.
export function askDemoGuide(name) {
  if (typeof window === "undefined") return false;
  try {
    const event = new CustomEvent(name, { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  } catch (err) {
    return false;
  }
}
