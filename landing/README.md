# Clean Slate landing page

The public marketing page for Clean Slate. It's a plain static site (one HTML file and an icon, no build step), kept separate from the app.

Every button sends people to the app at https://whiteboard-app-beta.vercel.app:

| Button | Goes to |
| --- | --- |
| Start free · Start a board · Start for free · Open the app | `/` (the app's Google sign-in) |
| Join a class · I have a class code | `/join` |
| Student class-code box | `/join?code=XXXXXX` (the app pre-fills the code) |

If the app's address changes, search `index.html` for `whiteboard-app-beta.vercel.app` and replace every match (there are 8, including `APP_URL` in the script at the bottom).

## Deploying on Vercel (one-time setup)

1. In Vercel, choose **Add New → Project** and import the same `whiteboard-app` GitHub repo again.
2. Set **Root Directory** to `landing`.
3. Set **Framework Preset** to **Other**, and leave the build and output settings empty.
4. Deploy. Vercel gives this project its own address, separate from the app's.

After that, every push to `main` redeploys both the app and the landing page.
