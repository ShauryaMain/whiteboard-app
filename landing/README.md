# Clean Slate landing page

The public marketing page for Clean Slate. It's a plain static site (`index.html`, `privacy.html` and an icon, no build step), kept separate from the app.

Every button sends people to the app at https://whiteboard-app-beta.vercel.app:

| Button | Goes to |
| --- | --- |
| Try it now, no sign-in · Try the demo first | `/demo` (the demo board: no sign-in, nothing saved) |
| Start free · Start free with Google · Start for free · Open the app | `/` (the app's Google sign-in) |
| Join a class | `/join` |
| Student class-code box | `/join?code=XXXXXX` (the app pre-fills the code) |

## Tracking where visitors come from

Add `?ref=something` to any link you post, for example `?ref=reddit` or `?ref=producthunt`. The page passes it on to every app link, so a visitor who clicks through arrives at `.../?ref=reddit`.

To count visits, open this project in Vercel, go to **Analytics** and enable **Web Analytics**. The page already loads Vercel's script, which doesn't use cookies.

If the app’s address changes, search `index.html` and `privacy.html` for `whiteboard-app-beta.vercel.app` and replace every match, including `APP_URL` in the script at the bottom of `index.html`.

## Deploying on Vercel (one-time setup)

1. In Vercel, choose **Add New → Project** and import the same `whiteboard-app` GitHub repo again.
2. Set **Root Directory** to `landing`.
3. Set **Framework Preset** to **Other**, and leave the build and output settings empty.
4. Deploy. Vercel gives this project its own address, separate from the app's.

After that, every push to `main` redeploys both the app and the landing page.
