#!/usr/bin/env python3
"""Builds the Clean Slate landing site into ../landing.

Run it from the repo folder:

    python3 landing-src/build.py

What to edit, then re-run:
  pages.py      the words on the eight search pages, and the home page FAQ
  home.html     the body of the home page
  cta.html      the yellow "homework" call-to-action at the end of every page
  privacy.html  the body of the privacy page

Not generated (edit them directly in ../landing):
  styles.css, site.js, img/, fonts/, favicon.svg, vercel.json
"""
import datetime
import html
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True  # no __pycache__ folder left behind
from pages import APP, IMG, LABELS, PAGES, HOME_FAQ  # noqa: E402

# The landing site's own address, with no slash at the end. If you move to a
# custom domain, change this one line and run the build again.
SITE = "https://whiteboard-app-landing.vercel.app"

HOME_TITLE = "Free Online Whiteboard for Teachers and Tutors | Clean Slate"
HOME_DESC = ("Clean Slate is a free online whiteboard for teaching. Try it with no sign-up, "
             "keep the worksheet beside the board, and give every student their own board.")

OG_IMAGE = "img/clean-slate-online-whiteboard.png"   # 1200 x 630 share picture

NAV = [
    ("online-whiteboard-for-teaching", "Teaching"),
    ("online-whiteboard-for-tutoring", "Tutoring"),
    ("online-whiteboard-for-math", "Maths"),
    ("online-whiteboard-for-classroom", "Classroom"),
    ("whiteboard-for-ipad", "iPad"),
]
FOOT_USES = [
    ("online-whiteboard-for-teaching", "Online whiteboard for teaching"),
    ("online-whiteboard-for-tutoring", "Online whiteboard for tutoring"),
    ("online-whiteboard-for-math", "Online whiteboard for math"),
    ("online-whiteboard-for-classroom", "Online whiteboard for the classroom"),
    ("whiteboard-for-ipad", "Whiteboard for iPad"),
]
FOOT_COMPARE = [
    ("free-online-whiteboard-no-sign-up", "Free whiteboard, no sign-up"),
    ("microsoft-whiteboard-alternative", "Microsoft Whiteboard alternative"),
    ("jamboard-alternative", "Jamboard alternative"),
]
HOME_USES = [p["slug"] for p in PAGES]

# How wide each kind of picture is shown, so phones download the small file.
SIZES = {
    "home": "(min-width:1181px) 924px, 92vw",
    "hero": "(min-width:1100px) 980px, 92vw",
    "heronarrow": "(min-width:640px) 560px, 92vw",
    "half": "(min-width:1360px) 600px, (min-width:761px) 44vw, 92vw",
    "fig": "(min-width:900px) 820px, 92vw",
    "feature": "(min-width:1360px) 660px, (min-width:981px) 50vw, 92vw",
    "fignarrow": "(min-width:640px) 520px, 92vw",
}
EAGER = {"home", "hero", "heronarrow"}

ANALYTICS = ('<script>window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };</script>\n'
             '<script defer src="/_vercel/insights/script.js"></script>\n')

BRAND_MARK = ('<span class="brand-mark"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
              'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
              '<path d="M4 17c3-6 6-9 8-9s1 6 3 6 3-3 5-5"/></svg></span>')
ARROW = ('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" '
         'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>')


def read(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return f.read()


def esc(text):
    return html.escape(text, quote=True)


def strip_tags(text):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", text)).strip()


class Site:
    """One build. preview=True makes a copy that works without a web server's
    clean URLs (links end in .html, files are found next to the page)."""

    def __init__(self, preview=False):
        self.preview = preview

    # ---- addresses
    def url(self, slug):
        if self.preview:
            return (slug or "index") + ".html"
        return "/" + slug

    def asset(self, path):
        return path if self.preview else "/" + path

    def canonical(self, slug):
        return SITE + "/" + slug

    # ---- pictures
    def img(self, key, mode):
        base, widths, w, h, alt = IMG[key]
        srcset = ", ".join(f"{self.asset('img/' + base)}-{x}.webp {x}w" for x in widths)
        load = 'fetchpriority="high" decoding="async"' if mode in EAGER else 'loading="lazy" decoding="async"'
        return (f'<img src="{self.asset("img/" + base)}-{widths[-1]}.webp" srcset="{srcset}" sizes="{SIZES[mode]}" '
                f'width="{w}" height="{h}" alt="{esc(alt)}" {load}>')

    def figure(self, key, caption):
        base, widths, w, h, alt = IMG[key]
        narrow = w / h < 1.3
        cls = "fig narrow" if narrow else "fig"
        return (f'<figure class="{cls}"><div class="shot-frame">{self.img(key, "fignarrow" if narrow else "fig")}</div>'
                f'<figcaption>{caption}</figcaption></figure>')

    # ---- placeholders used in the source files
    def expand(self, text):
        text = text.replace("[[app]]", APP)
        text = re.sub(r"\[\[url:([a-z0-9-]*)\]\]", lambda m: self.url(m.group(1)), text)
        text = re.sub(r"\[\[img:(\w+):(\w+)\]\]", lambda m: self.img(m.group(1), m.group(2)), text)
        text = re.sub(r"\{fig:(\w+):([^}]+)\}", lambda m: self.figure(m.group(1), m.group(2)), text)
        text = text.replace('<table class="cmp">', '<div class="table-scroll"><table class="cmp">').replace("</table>", "</table></div>")
        assert "[[" not in text, text[text.index("[["):][:60]
        return text

    # ---- shared pieces
    def nav(self, current):
        here = ' aria-current="page"'
        links = "".join(
            f'<a href="{self.url(slug)}"{here if slug == current else ""}>{label}</a>'
            for slug, label in NAV)
        return f'''<header class="nav">
  <div class="wrap">
    <a class="brand" href="{self.url("")}" aria-label="Clean Slate home">
      {BRAND_MARK}
      Clean Slate
    </a>
    <nav class="nav-links" aria-label="Clean Slate for">{links}</nav>
    <a class="nav-join" href="{APP}/join">Join a class</a>
    <a class="btn btn-dark" href="{APP}/">Start free</a>
  </div>
</header>
'''

    def footer(self):
        def col(title, items):
            lis = "".join(f'<li><a href="{href}">{label}</a></li>' for href, label in items)
            return f'<nav aria-label="{esc(title)}"><p class="foot-h">{title}</p><ul>{lis}</ul></nav>'
        uses = [(self.url(s), l) for s, l in FOOT_USES]
        compare = [(self.url(s), l) for s, l in FOOT_COMPARE]
        start = [(f"{APP}/demo", "Try the demo board"), (f"{APP}/", "Sign in free"), (f"{APP}/join", "Join a class"),
                 (self.url("privacy"), "Privacy")]
        return f'''<footer>
  <div class="wrap foot">
    <div>
      <a class="fname" href="{self.url("")}">Clean Slate</a>
      <p>The free online whiteboard for every lesson.</p>
      <p>Questions? Email <span class="support">cleanslatesupportoffical@gmail.com</span></p>
    </div>
    {col("Clean Slate for", uses)}
    {col("Compare", compare)}
    {col("Get started", start)}
  </div>
</footer>
'''

    def use_card(self, slug):
        label, desc = LABELS[slug]
        return f'      <a class="use" href="{self.url(slug)}"><b>{label}</b><span>{desc}</span><i aria-hidden="true">Read more →</i></a>'

    def faq_items(self, faq):
        return "\n".join(f'      <div class="faq-item"><h3>{q}</h3><p>{self.expand(a)}</p></div>' for q, a in faq)

    def faq_ld(self, faq, page_url):
        return {
            "@type": "FAQPage",
            "@id": page_url + "#faq",
            "mainEntity": [
                {"@type": "Question", "name": q,
                 "acceptedAnswer": {"@type": "Answer", "text": strip_tags(re.sub(r"\[\[url:[a-z0-9-]*\]\]", "", a))}}
                for q, a in faq
            ],
        }

    def app_ld(self):
        return {
            "@type": "SoftwareApplication",
            "@id": SITE + "/#app",
            "name": "Clean Slate",
            "url": SITE + "/",
            "applicationCategory": "EducationalApplication",
            "applicationSubCategory": "Online whiteboard",
            "operatingSystem": "Any modern web browser: iPadOS, Android, ChromeOS, Windows, macOS, Linux",
            "description": HOME_DESC,
            "isAccessibleForFree": True,
            "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
            "image": SITE + "/" + OG_IMAGE,
            "screenshot": [f"{SITE}/img/{IMG[k][0]}-{IMG[k][1][-1]}.webp" for k in ("worksheet", "plot", "overview", "shapes", "charts", "calculator")],
            "featureList": [
                "Demo board with no sign-up, ready lesson boards and a pretend live class",
                "Sign in with Google or with a code sent to your email",
                "PDF or image worksheet beside the board",
                "Live class: every student gets their own board and joins with a code, no accounts",
                "Class overview of every student's board, hands up, pens down, and writing on a student's board",
                "Save every student's board as a PDF or pictures",
                "Graphs that plot equations, with sliders, shading, gradients and tables of values",
                "Statistics charts: bar charts, histograms, scatter graphs with a line of best fit, and box plots",
                "Exact shapes with angles and lengths labelled: polygons, triangles, quadrilaterals, circles and 3D solids",
                "Ruler and compass",
                "Cartesian, polar, log and number-line graph paper, and a unit circle",
                "Scientific calculator with exact answers",
                "Blank, lined, squared, dot grid and isometric paper",
                "Apple Pencil support with palm rejection",
            ],
        }

    def document(self, slug, title, desc, body, graph, index=True):
        canonical = self.canonical(slug)
        ld = json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False, indent=1).replace("</", "<\\/")
        robots = "index, follow, max-image-preview:large, max-snippet:-1" if index else "noindex, follow"
        a = self.asset
        og_title = title.replace(" | Clean Slate", "")
        return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{canonical}">
<meta name="robots" content="{robots}">
<link rel="icon" href="{a("favicon.svg")}" type="image/svg+xml">
<link rel="apple-touch-icon" href="{a("apple-touch-icon.png")}">
<meta name="theme-color" content="#FDFCF7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#15171C" media="(prefers-color-scheme: dark)">
<meta property="og:site_name" content="Clean Slate">
<meta property="og:type" content="website">
<meta property="og:url" content="{canonical}">
<meta property="og:title" content="{esc(og_title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:image" content="{SITE}/{OG_IMAGE}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Clean Slate, a free online whiteboard for teaching, with a worksheet open beside the board">
<meta name="twitter:card" content="summary_large_image">
<link rel="preload" href="{a("fonts/ShantellSans-Variable.woff2")}" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="{a("fonts/Geist-Variable.woff2")}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="{a("styles.css")}">
<script type="application/ld+json">
{ld}
</script>
</head>
<body>
{body.rstrip()}
<script src="{a("site.js")}" defer></script>
{"" if self.preview else ANALYTICS}</body>
</html>
'''

    # ---- pages
    def home_body(self):
        main = read("home.html")
        main = main.replace("[[uses]]", "\n".join(self.use_card(s) for s in HOME_USES))
        main = main.replace("[[faq]]", self.faq_items(HOME_FAQ))
        return (self.nav("") + '\n<main id="top">\n' + self.expand(main) + self.expand(read("cta.html")).rstrip()
                + "\n</main>\n\n" + self.footer())

    def home(self):
        page = SITE + "/"
        graph = [
            {"@type": "WebSite", "@id": SITE + "/#website", "url": page, "name": "Clean Slate",
             "description": HOME_DESC, "inLanguage": "en"},
            {"@type": "WebPage", "@id": page + "#webpage", "url": page, "name": HOME_TITLE, "description": HOME_DESC,
             "isPartOf": {"@id": SITE + "/#website"}, "about": {"@id": SITE + "/#app"},
             "primaryImageOfPage": SITE + "/" + OG_IMAGE, "inLanguage": "en"},
            self.app_ld(),
            self.faq_ld(HOME_FAQ, page),
        ]
        return self.document("", HOME_TITLE, HOME_DESC, self.home_body(), graph)

    def search_page(self, p):
        slug = p["slug"]
        label = LABELS[slug][0]
        w, h = IMG[p["hero"]][2], IMG[p["hero"]][3]
        narrow = w / h < 1.3
        cta_label, cta_path = p.get("cta_primary", ("Try it now, no sign-in", "/demo"))
        blocks = "\n".join(
            f'    <section class="block">\n      <h2>{h2}</h2>{self.expand(body).rstrip()}\n    </section>'
            for h2, body in p["sections"])
        related = "\n".join(self.use_card(s) for s in p["related"])
        body = f'''{self.nav(slug)}
<main id="top">
<section class="hero page-hero">
  <div class="wrap hero-copy">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="{self.url("")}">Clean Slate</a> <span aria-hidden="true">›</span> <span aria-current="page">{label}</span></nav>
    <h1><span class="tape-label">{p["kicker"]}</span> <span class="h1-main">{p["h1"]}</span></h1>
    <p class="hero-lede">{p["lede"]}</p>
    <div class="cta-row">
      <a class="btn btn-primary" href="{APP}{cta_path}">{cta_label}
        {ARROW}</a>
      <a class="btn btn-ghost" href="{APP}/">Start free</a>
    </div>
    <p class="cta-note">The demo opens a real board in your browser. Nothing to install, and your board is kept in your browser until you sign in.</p>
  </div>
  <div class="wrap">
    <div class="page-shot{" narrow" if narrow else ""}">
      <div class="shot-frame">{self.img(p["hero"], "heronarrow" if narrow else "hero")}</div>
      <span class="tape t1"></span><span class="tape t2"></span>
    </div>
  </div>
</section>

<div class="wrap">
  <article class="prose">
{blocks}
    <section class="block" id="faq">
      <h2>Common questions</h2>
      <div class="faq-list">
{self.faq_items(p["faq"])}
      </div>
    </section>
  </article>
</div>

<section class="related">
  <div class="wrap">
    <h2>Keep reading</h2>
    <div class="uses-grid">
{related}
    </div>
  </div>
</section>

{self.expand(read("cta.html")).rstrip()}
</main>

{self.footer()}'''
        page = self.canonical(slug)
        graph = [
            {"@type": "WebPage", "@id": page + "#webpage", "url": page, "name": p["title"], "description": p["desc"],
             "isPartOf": {"@id": SITE + "/#website"}, "about": {"@id": SITE + "/#app"},
             "primaryImageOfPage": f"{SITE}/img/{IMG[p['hero']][0]}-{IMG[p['hero']][1][-1]}.webp",
             "breadcrumb": {"@id": page + "#breadcrumb"}, "inLanguage": "en"},
            {"@type": "BreadcrumbList", "@id": page + "#breadcrumb", "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Clean Slate", "item": SITE + "/"},
                {"@type": "ListItem", "position": 2, "name": label, "item": page},
            ]},
            {"@type": "SoftwareApplication", "@id": SITE + "/#app", "name": "Clean Slate", "url": SITE + "/",
             "applicationCategory": "EducationalApplication", "operatingSystem": "Any modern web browser",
             "isAccessibleForFree": True, "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"}},
            self.faq_ld(p["faq"], page),
        ]
        return self.document(slug, p["title"], p["desc"], body, graph)

    def privacy(self):
        body = (self.nav("privacy") + '\n<main class="wrap policy">\n' + read("privacy.html").rstrip() + "\n</main>\n\n" + self.footer())
        page = self.canonical("privacy")
        desc = "How Clean Slate handles your data, in plain English: what we keep, what we don't, and how to delete it."
        graph = [{"@type": "WebPage", "@id": page + "#webpage", "url": page, "name": "Privacy | Clean Slate",
                  "description": desc, "isPartOf": {"@id": SITE + "/#website"}, "inLanguage": "en"}]
        return self.document("privacy", "Privacy | Clean Slate", desc, body, graph)

    def not_found(self):
        cards = "\n".join(self.use_card(s) for s in HOME_USES[:4])
        body = f'''{self.nav("404")}
<main id="top">
<section class="hero page-hero">
  <div class="wrap hero-copy">
    <h1><span class="tape-label">page not found</span> <span class="h1-main">That page isn’t here.</span></h1>
    <p class="hero-lede">The link may be old or mistyped. The whiteboard is still one tap away.</p>
    <div class="cta-row">
      <a class="btn btn-primary" href="{self.url("")}">Go to the home page</a>
      <a class="btn btn-ghost" href="{APP}/demo">Try the demo board</a>
    </div>
  </div>
</section>
<section class="related">
  <div class="wrap">
    <div class="uses-grid">
{cards}
    </div>
  </div>
</section>
</main>

{self.footer()}'''
        return self.document("404", "Page not found | Clean Slate", "That page isn’t here.", body, [], index=False)


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def build(out, preview=False):
    site = Site(preview)
    write(os.path.join(out, "index.html"), site.home())
    for p in PAGES:
        write(os.path.join(out, p["slug"] + ".html"), site.search_page(p))
    write(os.path.join(out, "privacy.html"), site.privacy())
    write(os.path.join(out, "404.html"), site.not_found())
    if preview:
        return
    today = datetime.date.today().isoformat()
    slugs = [""] + [p["slug"] for p in PAGES] + ["privacy"]
    urls = "\n".join(f"  <url><loc>{SITE}/{s}</loc><lastmod>{today}</lastmod></url>" for s in slugs)
    write(os.path.join(out, "sitemap.xml"),
          f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{urls}\n</urlset>\n')
    write(os.path.join(out, "robots.txt"), f"User-agent: *\nAllow: /\n\nSitemap: {SITE}/sitemap.xml\n")


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--preview":
        build(sys.argv[2], preview=True)
        print("preview copy written to", sys.argv[2])
    else:
        target = os.path.normpath(os.path.join(HERE, "..", "landing"))
        build(target)
        print(f"built {len(PAGES) + 3} pages, sitemap.xml and robots.txt in", target)
