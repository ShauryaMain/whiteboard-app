# Clean Slate landing site

The public marketing site for Clean Slate, kept separate from the app. It is a plain static site: Vercel serves the files in this folder as they are.

It is built so search engines can find it. There is a home page, plus one focused page for each thing people search for.

| Page | Written for people searching |
| --- | --- |
| `/` (index.html) | free online whiteboard for teachers and tutors |
| `/online-whiteboard-for-teaching` | online whiteboard for teaching |
| `/online-whiteboard-for-tutoring` | online whiteboard for tutoring |
| `/online-whiteboard-for-math` | online whiteboard for math, with geometry tools, with graph paper |
| `/online-whiteboard-for-classroom` | online whiteboard for the classroom |
| `/free-online-whiteboard-no-sign-up` | online whiteboard no sign up, no login, no download |
| `/whiteboard-for-ipad` | online whiteboard for iPad |
| `/microsoft-whiteboard-alternative` | Microsoft Whiteboard alternative |
| `/jamboard-alternative` | Jamboard alternative for teachers |
| `/privacy` | (privacy policy) |

## Changing the words

**Don't edit the `.html` files in this folder by hand.** They are generated, and your edits would be overwritten.

The words live in the `landing-src` folder next to this one:

| File | What it holds |
| --- | --- |
| `landing-src/pages.py` | The eight search pages and the home page's questions and answers |
| `landing-src/home.html` | The body of the home page |
| `landing-src/cta.html` | The yellow "homework" box at the end of every page |
| `landing-src/privacy.html` | The privacy page |

After editing, run this from the `whiteboard-app` folder, then commit and push:

```
python3 landing-src/build.py
```

It rewrites every `.html` file here, plus `sitemap.xml` and `robots.txt`.

These files are not generated, so edit them directly: `styles.css`, `site.js`, `vercel.json`, and everything in `img/` and `fonts/`.

Keep every claim true to the app. The notes at the top of `pages.py` list the things it's easy to get wrong.

## Where the buttons go

Every button sends people to the app at https://whiteboard-app-beta.vercel.app:

| Button | Goes to |
| --- | --- |
| Try it now, no sign-in · Try the demo first · Try the demo board | `/demo` (the demo board: no sign-in, nothing saved) |
| Start free · Start free with Google · Start for free · Sign in free | `/` (the app's Google sign-in) |
| Join a class | `/join` |
| Student class-code box | `/join?code=XXXXXX` (the app pre-fills the code) |

If the app's address changes, change `APP` at the top of `landing-src/pages.py` and `APP_URL` in `site.js`, then run the build.

## Counting visitors

Every page loads Vercel Web Analytics, which doesn't use cookies. Switch it on once: open this project in Vercel, go to **Analytics** and press **Enable**. The **Referrers** list then shows which sites send people here (Google, Reddit and so on).

You can also add `?ref=something` to a link you post, for example `?ref=reddit`. The site passes it on to every app link, so that visitor arrives at the app as `.../demo?ref=reddit`.

## Being found on Google

1. `sitemap.xml` lists every page and `robots.txt` points to it. Both are generated.
2. Add the site to Google Search Console and submit `sitemap.xml` there. That is how Google learns the pages exist, and where you see which searches show them.
3. Every page has its own title, description, one main heading, real screenshots with descriptions, and a questions section.

If you move to your own domain, change `SITE` at the top of `landing-src/build.py`, run the build, and add the new address in Search Console.

## Deploying on Vercel (already done)

This is a second Vercel project that imports the same `whiteboard-app` GitHub repo, with **Root Directory** set to `landing` and **Framework Preset** set to **Other**. Every push to `main` redeploys both the app and this site.

`vercel.json` in this folder turns on clean addresses (`/privacy` instead of `/privacy.html`; the old address redirects).
