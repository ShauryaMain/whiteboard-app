# The words for the eight search pages and the home page FAQ.
#
# Every claim here must match what the app really does. Things to remember:
# no protractor, no sticky notes, no video or audio calls, no offline mode,
# not open source, the Graph tool places axes but does not plot functions,
# a shape from Insert > Shape becomes ordinary ink (it can't be re-opened
# and edited as a shape), the "What's new" pop-up and walkthroughs are for
# signed-in users on their boards page,
# saving happens in the background after each stroke, and students' boards
# in a live class are not kept afterwards.
#
# Links to other pages on this site are written [[url:page-name]].
# {fig:name:caption} drops in one of the screenshots listed in IMG.
# After editing, run:  python3 landing-src/build.py

APP = "https://whiteboard-app-beta.vercel.app"

IMG = {
    "worksheet": ("clean-slate-worksheet-beside-whiteboard", [900, 1600], 1600, 822,
                  "Clean Slate online whiteboard with a quadratics worksheet open beside the board, a hand-drawn parabola with its roots circled, and typed working"),
    "calculator": ("clean-slate-scientific-calculator", [700, 1200], 1200, 616,
                   "Scientific calculator on the Clean Slate whiteboard showing sin(30) = 1/2 as an exact fraction, with an Add to board button"),
    "compass": ("clean-slate-compass-tool", [700, 1200], 1200, 616,
                "Compass tool on the Clean Slate whiteboard drawing a perfect circle of radius 100 on squared paper"),
    "paper": ("clean-slate-paper-styles", [700, 1200], 1200, 616,
              "Page background menu in Clean Slate with blank, lined, squared, dot grid and isometric paper"),
    "graph": ("clean-slate-graph-on-board", [700, 1200], 1200, 616,
              "Cartesian axes from -5 to 5 placed on the Clean Slate whiteboard with the graph tool"),
    "graphtool": ("clean-slate-graph-tool", [600, 1000], 1000, 928,
                  "Graph tool settings in Clean Slate: Cartesian or polar, cell size, value per cell, trig labels in pi, and a unit circle option"),
    "join": ("clean-slate-join-class-code", [560, 900], 900, 806,
             "Clean Slate join screen where a student types a six-character class code and their first name, with no account needed"),
    "shapes": ("clean-slate-shapes-on-whiteboard", [900, 1600], 1600, 1000,
               "Clean Slate whiteboard with a hexagon, a triangle, a parallelogram, a sector, a triangular prism, a cuboid, a cylinder and a cone, each with its angles and lengths labelled"),
    "polygon": ("clean-slate-shape-tool-polygon", [700, 1200], 1200, 750,
                "Shape tool in Clean Slate showing a regular hexagon with its 120 degree interior angle and 60 degree exterior angle, side length, perimeter and area"),
    "solid": ("clean-slate-shape-tool-3d-solid", [700, 1200], 1200, 750,
              "Shape tool in Clean Slate showing a triangular prism that can be turned, with dashed hidden edges, its volume and its surface area"),
    "anglecheck": ("clean-slate-shape-tool-angle-check", [700, 1200], 1200, 750,
                   "Shape tool in Clean Slate explaining that no regular polygon has a 100 degree interior angle and offering the regular pentagon instead"),
}

# slug -> short label (used in the nav, footer and related links)
LABELS = {
    "online-whiteboard-for-teaching": ("Whiteboard for teaching", "A free online whiteboard built around how lessons actually run."),
    "online-whiteboard-for-tutoring": ("Whiteboard for tutoring", "One-to-one and small-group lessons, with the worksheet beside the board."),
    "online-whiteboard-for-math": ("Whiteboard for math", "Exact shapes, ruler, compass, graph paper and a calculator with exact answers."),
    "online-whiteboard-for-classroom": ("Whiteboard for the classroom", "Every student gets their own board. Join with a code, no accounts."),
    "free-online-whiteboard-no-sign-up": ("Whiteboard with no sign-up", "Open a board and draw. No account, no login, no download."),
    "whiteboard-for-ipad": ("Whiteboard for iPad", "Made for Apple Pencil, with palm rejection, in Safari."),
    "microsoft-whiteboard-alternative": ("Microsoft Whiteboard alternative", "Free, works with any Google account, on any device."),
    "jamboard-alternative": ("Jamboard alternative", "A free replacement for teachers, with no student sign-in."),
}

PAGES = [
    {
        "slug": "online-whiteboard-for-teaching",
        "title": "Free Online Whiteboard for Teaching | Clean Slate",
        "desc": "A free online whiteboard made for teaching. Try it with no sign-up, open a worksheet beside the board, and give every student their own board with one code.",
        "kicker": "no sign-up to try · nothing to install",
        "h1": "A free online whiteboard for teaching",
        "lede": "Clean Slate is an online whiteboard built for lessons, not office meetings. Open your worksheet beside the board, write with a stylus or a mouse, and bring the whole class in with one code. It's free.",
        "hero": "worksheet",
        "sections": [
            ("What a teaching whiteboard needs", """
<p>Most online whiteboards are designed for brainstorming at work: sticky notes, templates and voting. A lesson needs different things, and Clean Slate is built around them.</p>
<ul class="ticks">
  <li><b>The worksheet beside the board.</b> Open a PDF or a photo in a side pane and teach from it, without switching windows.</li>
  <li><b>Tools that say what they do.</b> Every button has a label and a one-line hint, so a new class can use it straight away. When a new tool arrives, a short walkthrough shows you how it works.</li>
  <li><b>A pen that keeps up.</b> Drawing happens on your device first and saving runs in the background, so writing never waits on your Wi-Fi.</li>
  <li><b>A board for every student.</b> Start a live class and each student gets their own board to work on.</li>
</ul>"""),
            ("Teach from your worksheet", """
<p>Choose Insert, then Reference document, and pick a PDF (up to 30 pages) or an image. It opens in a pane next to the board. Drag the divider to make it a third, a half or two thirds of the screen, and write on the worksheet itself with a pen, highlighter and eraser.</p>
<p>You teach from the question on the left and work it out on the right. Nothing to print, nothing to screenshot.</p>"""),
            ("See every student's working", """
<p>Press Start live class and Clean Slate gives you a six-character code. Students type it on any device, add their first name, and they're in. They don't need an account or an email address.</p>
<p>Each student sees your board and has a board of their own. You see the class list, open any student's board while they work, and pin a comment exactly where they went wrong.</p>
{fig:join:Students join with a code and a first name.}"""),
            ("One board for every subject", """
<p>Pick the paper that suits the lesson: blank, lined, squared, dot grid or isometric.</p>
<ul class="ticks">
  <li><b>Maths:</b> exact shapes with the angles and lengths marked, a ruler, a compass, Cartesian and polar graph paper, and a scientific calculator with exact answers.</li>
  <li><b>Science:</b> label a diagram, or embed a PhET simulation next to your notes.</li>
  <li><b>English and humanities:</b> paste in a passage or a source, highlight it and annotate the margins.</li>
  <li><b>Languages:</b> lined paper for handwriting, and typed text boxes for vocabulary.</li>
</ul>
{fig:paper:Five kinds of paper, chosen from the Page menu.}"""),
            ("Free, on the devices your school already has", """
<p>Clean Slate runs in the browser on iPads, Android tablets, Chromebooks, Windows PCs and Macs. There is nothing to install and no paid plan. It's made for a stylus: on an iPad, resting your palm on the screen doesn't leave marks or press buttons.</p>"""),
        ],
        "faq": [
            ("Is Clean Slate free for teachers?", "Yes. There is no paid plan, no board limit and no ads. You sign in with a Google account to save and share boards."),
            ("Can I try it without signing up?", f'Yes. The <a href="{APP}/demo">demo board</a> opens straight away with all the drawing tools. Nothing you draw there is saved.'),
            ("Do my students need accounts?", "No. Students join a live class with a six-character code and their first name."),
            ("Can I use it with Zoom, Google Meet or Teams?", "Yes. Clean Slate has no video or audio of its own, so run it beside your call. Share your screen, or start a live class so students follow on their own devices."),
            ("Which devices does it work on?", "Any device with a modern browser: iPads (iPadOS 15 and newer), Android tablets, Chromebooks, Windows, Mac and Linux."),
        ],
        "related": ["online-whiteboard-for-classroom", "online-whiteboard-for-tutoring", "online-whiteboard-for-math", "free-online-whiteboard-no-sign-up"],
    },
    {
        "slug": "online-whiteboard-for-tutoring",
        "title": "Free Online Whiteboard for Tutoring | Clean Slate",
        "desc": "A free online whiteboard for tutoring. Keep the worksheet or past paper beside the board, write with a stylus, and use it next to Zoom or Google Meet.",
        "kicker": "free for tutors",
        "h1": "A free online whiteboard for tutoring",
        "lede": "Clean Slate is an online whiteboard for one-to-one and small-group tutoring. Keep the past paper beside the board, write as you would on paper, and pick up next week exactly where you stopped.",
        "hero": "worksheet",
        "sections": [
            ("Built around a tutoring session", """
<ul class="ticks">
  <li><b>The question stays in view.</b> Open the worksheet or past paper as a PDF or photo beside the board, and write on it too.</li>
  <li><b>It feels like writing.</b> Pen, highlighter and eraser are made for a stylus. Scribble over something to rub it out.</li>
  <li><b>Your student can write as well.</b> Share a board by email and you both write on it at the same time.</li>
  <li><b>Next week is one tap away.</b> Every board saves automatically and shows a preview picture, so last lesson is easy to find.</li>
</ul>"""),
            ("Long lessons stay quick", """
<p>What you draw appears on your own device first, and saving happens quietly in the background. The pen doesn't wait for the internet, so writing feels the same at the end of a two-hour session as it did at the start.</p>"""),
            ("The tools a maths or science tutor reaches for", """
<p>The Maths menu has a ruler, a compass, graph paper you can set up as Cartesian or polar axes, and a scientific calculator that gives exact answers such as ½ or 2√2. You can send a calculator answer straight to the board.</p>
<p>Need a diagram for the question? Insert, then Shape draws a polygon, triangle, quadrilateral, circle or 3D solid to the sides and angles you type, with the measurements labelled.</p>
{fig:calculator:The calculator gives exact answers and adds them to the board.}
<p>For other subjects, switch the page to lined paper, paste in a text to annotate, or embed a PhET simulation.</p>"""),
            ("Use it alongside Zoom, Meet or Teams", """
<p>Clean Slate is a whiteboard, not a video call. Keep your usual call running for voice and video and use Clean Slate for the working. Share your screen, or send your student the board so they have it on their own device.</p>"""),
            ("Small groups: a board for each student", """
<p>For a group, start a live class. Students join with a six-character code and no account. Each one gets their own board, and you can open any of them while they work and pin a comment where it matters.</p>"""),
        ],
        "faq": [
            ("What is the best free online whiteboard for math tutoring?", "That depends on what you need. Clean Slate is free and has exact labelled shapes, a ruler, a compass, Cartesian and polar graph paper, a scientific calculator with exact answers, and a pane for the worksheet beside the board. It has no built-in video call."),
            ("Does it work with Zoom?", "Yes. Run Clean Slate in your browser beside Zoom, Google Meet or Teams, and either share your screen or share the board with your student."),
            ("Does my student need an account?", "Not for a live class: they join with a code and their first name. To write on the same board as you, they sign in with a free Google account."),
            ("Can I keep a separate board for each student?", "Yes. Make as many boards as you like and name them. Each one saves automatically. A board that nobody opens for 30 days is deleted, and you get an email first with a button to keep it."),
            ("How much does it cost?", "Nothing. There is no paid plan and no board limit."),
        ],
        "related": ["online-whiteboard-for-math", "online-whiteboard-for-teaching", "whiteboard-for-ipad", "free-online-whiteboard-no-sign-up"],
    },
    {
        "slug": "online-whiteboard-for-math",
        "title": "Online Whiteboard for Math with Geometry Tools | Clean Slate",
        "desc": "A free online whiteboard for math. Exact shapes with the angles marked, ruler, compass, graph paper and a scientific calculator. Try it with no sign-up.",
        "kicker": "shapes · ruler · compass · graph paper · calculator",
        "h1": "A free online whiteboard for math",
        "lede": "Clean Slate is an online whiteboard with real math tools built in: exact shapes with the angles and lengths marked, a ruler and compass, graph paper you can set up your way, and a scientific calculator that gives exact answers. It's free, and you can try it without signing up.",
        "hero": "shapes",
        "sections": [
            ("Exact shapes: polygons, triangles, circles and 3D solids", """
<p>Choose Insert, then Shape. Pick a family, type the numbers you want, and a live preview shows the shape before it goes on the board.</p>
<ul class="ticks">
  <li><b>Polygons</b> from 3 to 20 sides. The number of sides, the interior angle and the exterior angle are linked: change one and the others follow.</li>
  <li><b>Triangles:</b> equilateral, isosceles, right-angled, or any triangle from three sides, two sides and the angle between them, or two angles and the side between them.</li>
  <li><b>Quadrilaterals:</b> square, rectangle, parallelogram, rhombus, trapezium (trapezoid) and kite, with the equal-side marks and parallel arrows worked out for you.</li>
  <li><b>Circles:</b> circle, semicircle, sector, segment, arc and ellipse.</li>
  <li><b>3D solids:</b> cube, cuboid, prism, pyramid, cylinder, cone and sphere. Drag the solid to turn it, with the hidden edges dashed.</li>
</ul>
{fig:polygon:Type the sides or the angle, and the rest follows.}
<p>You choose what gets labelled: angles, side lengths, corner letters and equal-side marks. Under the preview are the facts for that shape, such as perimeter, area and angle sum, or volume and surface area for a solid.</p>
{fig:solid:Turn a solid round before you add it.}
<p>Ask for something that can't exist, such as a regular polygon with a 100° interior angle or a triangle whose sides can't meet, and it tells you why.</p>
{fig:anglecheck:Ask for an angle that can't exist and it explains why.}
<p>The shape lands on the board as ordinary ink with text labels, so you can move it, copy it or rub parts out. To change its measurements afterwards, insert a new one.</p>"""),
            ("Geometry tools: ruler and compass", """
<p>Open the Maths menu and pick Ruler or Compass. Both sit on the board like the real things.</p>
<ul class="ticks">
  <li><b>Ruler:</b> draw perfectly straight lines at any angle and measure lengths.</li>
  <li><b>Compass:</b> drag the pin to set the centre and the pencil to set the radius, then draw circles and arcs.</li>
</ul>
{fig:compass:The compass draws exact circles and arcs.}"""),
            ("Graph paper, set up your way", """
<p>The Graph tool places a set of axes on the board. You choose:</p>
<ul class="ticks">
  <li>Cartesian or polar axes.</li>
  <li>The cell size, and how many columns and rows.</li>
  <li>The value of each cell, with a unit such as cm or m.</li>
  <li>Trig labels, so the axis is marked in multiples of π.</li>
  <li>Whether to show the axes, the numbers and a unit circle.</li>
</ul>
<p>A live preview shows the graph before it goes on the board. Then drag it into place and draw on it.</p>
{fig:graphtool:Graph settings, with a live preview.}"""),
            ("A scientific calculator with exact answers", """
<p>The calculator is laid out like a school scientific calculator. It gives exact answers such as ½, 2√2 or π/4, and one tap switches between the exact form and a decimal. It works in degrees or radians, keeps a history of your last answers, and its Add to board button writes the calculation onto the board.</p>
{fig:calculator:sin(30) gives ½, not 0.5.}"""),
            ("Squared, dot grid and isometric paper", """
<p>Set the whole page to squared paper for graphs and tables, dot grid for diagrams, or isometric paper for 3D shapes. The pattern stays in place as you zoom and pan, and the eraser never rubs it out.</p>"""),
            ("Write maths by hand", """
<p>Maths is quicker to write than to type. Clean Slate is made for a stylus: the pen follows your hand, a scribble over a mistake rubs it out, and on an iPad your palm can rest on the screen. Typed text boxes are there when you want them.</p>"""),
        ],
        "faq": [
            ("Can it draw accurate shapes?", "Yes. Insert, then Shape draws polygons, triangles, quadrilaterals, circles and 3D solids to the sides and angles you set, and labels the measurements for you."),
            ("Can I change a shape after adding it?", "It becomes ordinary ink, so you can move it, copy it and rub parts out. To change its measurements, insert a new shape."),
            ("Does it have a ruler and a compass?", "Yes. Both are in the Maths menu. The ruler draws straight lines and measures lengths, and the compass draws circles and arcs."),
            ("Does it have graph paper?", "Yes, in two ways. The Page menu sets the whole board to squared paper, and the Graph tool places Cartesian or polar axes with the scale you choose."),
            ("Can it plot a function for me?", "No. The Graph tool gives you labelled axes and you draw the curve yourself, as you would on paper."),
            ("Is the calculator a graphing calculator?", "No. It is a scientific calculator with exact answers, fractions, powers, roots, logs and trig in degrees or radians."),
            ("Is it free?", f'Yes. You can also <a href="{APP}/demo">try the demo board</a> without signing up.'),
        ],
        "related": ["online-whiteboard-for-tutoring", "online-whiteboard-for-teaching", "whiteboard-for-ipad", "online-whiteboard-for-classroom"],
    },
    {
        "slug": "online-whiteboard-for-classroom",
        "title": "Free Online Whiteboard for the Classroom | Clean Slate",
        "desc": "A free online whiteboard for the classroom. Students join with a code and no account, each gets their own board, and you see everyone's working live.",
        "kicker": "a board for every student",
        "h1": "A free online whiteboard for the classroom",
        "lede": "With Clean Slate, every student in the room gets their own board. They join with a short code, you see each one's working as they write, and you can leave a comment exactly where it's needed. It's free, with no time limit.",
        "hero": "join",
        "sections": [
            ("How a live class works", """
<ol class="steps-list">
  <li><b>Start a live class.</b> Open any board and press Start live class. Clean Slate shows a six-character code.</li>
  <li><b>Students join with the code.</b> They type it on any device, add their first name, and they're in. No account, no email address.</li>
  <li><b>Everyone works.</b> Students see your board on one tab and their own board on another. Switching tabs never loses their work.</li>
  <li><b>You look in.</b> Pick a name from the class list to watch that student's board live, and pin a comment where it matters.</li>
</ol>"""),
            ("See who is stuck before they ask", """
<p>On paper you only see a student's working when you walk past. Here you can open any board from your own device, so you can spot the slip in line two while the student is still on line three.</p>
<p>Comments appear on the student's board as numbered pins, so they know exactly which step you mean.</p>"""),
            ("What students need", """
<p>A device with a browser. It can be an iPad, an Android tablet, a Chromebook or a laptop. They don't install anything, and they don't create an account or give an email address.</p>"""),
            ("What it's built for", """
<p>Clean Slate's live class is built for a normal class of 20 to 30 students working at the same time. There is no charge and no session time limit.</p>
<p>Your own board has the full set of tools: the worksheet pane, exact shapes, the ruler and compass, graph paper, the calculator and every paper style. Students' boards are kept simple: pen, eraser, colours, undo and clear.</p>"""),
        ],
        "faq": [
            ("Do students need to sign in?", "No. They join with a six-character class code and their first name."),
            ("Is there a time limit on a class?", "No. A live class runs until you end it."),
            ("How many students can join?", "It is built for classes of 20 to 30 students working at once."),
            ("Can students see each other's boards?", "No. Each student sees your board and their own."),
            ("Can I write on a student's board?", "You leave comments as numbered pins on their board. The writing on a student's board is always their own."),
            ("Is students' work saved after the class?", "No. Students' boards exist only while the class is running. Your own board is saved."),
        ],
        "related": ["online-whiteboard-for-teaching", "jamboard-alternative", "online-whiteboard-for-math", "whiteboard-for-ipad"],
    },
    {
        "slug": "free-online-whiteboard-no-sign-up",
        "title": "Free Online Whiteboard, No Sign-Up or Login | Clean Slate",
        "desc": "A free online whiteboard with no sign-up, no login and no download. Open it and draw. Shapes, ruler, compass, graph paper and calculator included.",
        "kicker": "no account · no login · no download",
        "h1": "A free online whiteboard with no sign-up",
        "lede": "Open the board and start drawing. There is no account to create, no login and nothing to download. Sign in only if you want to save your boards or teach a live class.",
        "hero": "worksheet",
        "cta_primary": ("Open the whiteboard", "/demo"),
        "sections": [
            ("What you get without an account", """
<p>The no-sign-up board is the real Clean Slate whiteboard, running in your browser tab.</p>
<ul class="ticks">
  <li>Pen, highlighter, eraser, text boxes, and scribble to erase.</li>
  <li>Blank, lined, squared, dot grid and isometric paper.</li>
  <li>Exact shapes, a ruler, a compass, graph paper and a scientific calculator.</li>
  <li>Pictures you paste or drop in, and a PDF or image open beside the board.</li>
  <li>Select, move, copy, paste, undo and redo.</li>
</ul>
<p>Nothing you draw is sent anywhere or saved. Reloading the page gives you a fresh board.</p>"""),
            ("When it's worth signing in", """
<p>Signing in is free and uses a Google account. It adds the things that need somewhere to keep your work:</p>
<ul class="ticks">
  <li>Boards that save automatically, with a preview of each one.</li>
  <li>Sharing a board so someone else can write on it with you.</li>
  <li>Live classes, where every student gets their own board.</li>
</ul>"""),
            ("Students never need an account", """
<p>If you teach, your students join a live class with a six-character code and their first name. They don't sign up for anything.</p>"""),
            ("No download, on any device", """
<p>Clean Slate is a web page, not an app to install. It works in Chrome, Edge, Firefox and Safari on iPads, Android tablets, Chromebooks, Windows, Mac and Linux.</p>"""),
        ],
        "faq": [
            ("Is it really free?", "Yes. There is no paid plan and no ads."),
            ("Is anything saved if I don't sign in?", "No. The no-sign-up board lives only in your browser tab and resets when you reload."),
            ("Can other people join my board without signing in?", "Students can join a live class with a code and no account. The teacher who starts the class signs in with Google."),
            ("Do I need to download anything?", "No. It runs in the browser."),
        ],
        "related": ["online-whiteboard-for-teaching", "online-whiteboard-for-math", "microsoft-whiteboard-alternative", "jamboard-alternative"],
    },
    {
        "slug": "whiteboard-for-ipad",
        "title": "Free Online Whiteboard for iPad and Apple Pencil | Clean Slate",
        "desc": "A free online whiteboard for iPad. Made for Apple Pencil with palm rejection, runs in Safari with nothing to install, and works on older iPads too.",
        "kicker": "made for Apple Pencil",
        "h1": "A free online whiteboard for iPad",
        "lede": "Clean Slate is an online whiteboard that runs in Safari on your iPad. It's made for Apple Pencil: rest your hand on the screen and nothing goes wrong. It's free, and there is nothing to install.",
        "hero": "worksheet",
        "sections": [
            ("Made for the Pencil", """
<ul class="ticks">
  <li><b>Pencil-only mode turns itself on.</b> The first time you write with a stylus, your fingers go back to scrolling and zooming and only the Pencil draws. You can turn it off.</li>
  <li><b>Your palm can't press buttons.</b> Nothing you can tap sits at the bottom of the screen where your hand rests, and the toolbar ignores a brush from your palm while you write.</li>
  <li><b>Scribble to erase.</b> Scribble back and forth over a mistake and it's gone. There is also a precise eraser and a whole-stroke eraser.</li>
</ul>"""),
            ("Runs in Safari. Nothing to install.", """
<p>Open the link and start writing. There is no app to download from the App Store and nothing to update. Your boards are there on any other device you sign in on.</p>"""),
            ("Works on older iPads", """
<p>Clean Slate runs on iPadOS 15 and newer, which includes iPads going back to the iPad Air 2 and iPad mini 4. On those older models you write with a finger or a simple stylus.</p>
<p>Opening a PDF beside the board needs iPadOS 16.4 or newer. On an older iPad, open the worksheet as an image instead.</p>"""),
            ("Worksheet on one side, board on the other", """
<p>Open a PDF or photo beside the board and drag the divider to size it. In portrait the worksheet sits above the board, and in landscape it sits beside it. You can write on both.</p>"""),
            ("Not only iPads", """
<p>The same board works on Android tablets with a stylus, on Chromebooks, and on a laptop with a drawing tablet or a mouse.</p>"""),
        ],
        "faq": [
            ("Is there an app in the App Store?", "No. Clean Slate is a web app that runs in Safari, so there is nothing to install."),
            ("Does it have palm rejection?", "Yes. Once you write with a Pencil, only the Pencil draws, and your fingers scroll and zoom."),
            ("Which Apple Pencil does it work with?", "Any Apple Pencil that works with your iPad."),
            ("Does it work on an old iPad?", "Yes, on iPadOS 15 and newer. PDFs beside the board need iPadOS 16.4 or newer."),
            ("Is it free?", "Yes. There is no paid plan."),
        ],
        "related": ["online-whiteboard-for-tutoring", "online-whiteboard-for-math", "online-whiteboard-for-teaching", "microsoft-whiteboard-alternative"],
    },
    {
        "slug": "microsoft-whiteboard-alternative",
        "title": "Free Microsoft Whiteboard Alternative | Clean Slate",
        "desc": "Microsoft Whiteboard no longer works with personal accounts. Clean Slate is a free alternative that runs in any browser with any Google account.",
        "kicker": "works with any Google account",
        "h1": "A free Microsoft Whiteboard alternative",
        "lede": "Microsoft Whiteboard no longer works with personal Microsoft accounts. Clean Slate is a free online whiteboard that runs in any browser, signs in with any Google account, and has the pen, eraser and menus where you expect them.",
        "hero": "worksheet",
        "sections": [
            ("What happened to Microsoft Whiteboard", """
<p>Microsoft has ended Whiteboard for personal Microsoft accounts, and its standalone Windows, iPad and Android apps retire on 16 October 2026. Whiteboard continues only for work and school Microsoft 365 accounts, inside the web version and Teams.</p>
<p class="src">Source: <a href="https://support.microsoft.com/en-us/whiteboard/retirement-standalone-microsoft-whiteboard-apps" target="_blank" rel="noopener">Microsoft Support</a>.</p>"""),
            ("What will feel familiar", """
<ul class="ticks">
  <li>A pen, a highlighter and an eraser, with colours and sizes.</li>
  <li>Text boxes and pictures you can move around.</li>
  <li>A ruler for straight lines.</li>
  <li>A board you can pan and zoom, with undo and redo.</li>
  <li>Sharing, so several people write on one board at once.</li>
</ul>"""),
            ("What's different", """
<table class="cmp">
  <thead><tr><th scope="col"></th><th scope="col">Clean Slate</th><th scope="col">Microsoft Whiteboard</th></tr></thead>
  <tbody>
    <tr><th scope="row">Account</th><td>Any Google account. The demo needs none.</td><td>Work or school Microsoft 365 accounts only</td></tr>
    <tr><th scope="row">Where it runs</th><td>Any browser: Windows, Mac, Linux, Chromebook, iPad, Android</td><td>Web and Teams. The standalone apps are being retired.</td></tr>
    <tr><th scope="row">PDF beside the board</th><td>Yes, for everyone</td><td>Inserting documents needs a work or school account</td></tr>
    <tr><th scope="row">A board for each student</th><td>Yes. Students join with a code and no account.</td><td>No</td></tr>
    <tr><th scope="row">Price</th><td>Free</td><td>Included with Microsoft 365 for work or school</td></tr>
  </tbody>
</table>
<p>Clean Slate also adds tools aimed at teaching: shapes drawn to the angles and lengths you set, a compass, Cartesian and polar graph paper, a scientific calculator, and lined, squared, dot grid or isometric paper.</p>"""),
            ("Moving your boards across", """
<ol class="steps-list">
  <li><b>Sign in to Clean Slate</b> with any Google account.</li>
  <li><b>Bring your old work across.</b> If you exported boards from Microsoft Whiteboard as pictures, drop them onto a new board.</li>
  <li><b>Carry on.</b> Draw over the picture, or start fresh beside it.</li>
</ol>
<p>Clean Slate can't open Microsoft Whiteboard files directly.</p>"""),
        ],
        "faq": [
            ("Is Clean Slate free?", "Yes. There is no paid plan, no board limit and no ads."),
            ("Does it work on Mac, Android and Linux?", "Yes. It runs in the browser, so it works on Mac, Windows, Linux, Chromebooks, iPads and Android tablets."),
            ("Can I import my Microsoft Whiteboard boards?", "Not directly. Export them from Microsoft Whiteboard as pictures and drop the pictures onto a Clean Slate board."),
            ("Does it work offline?", "No. Clean Slate needs an internet connection."),
            ("Is it open source?", "No. It is free to use, but the code is not open source."),
            ("Do I need to sign up to try it?", f'No. The <a href="{APP}/demo">demo board</a> opens with no sign-up.'),
        ],
        "related": ["jamboard-alternative", "free-online-whiteboard-no-sign-up", "online-whiteboard-for-teaching", "whiteboard-for-ipad"],
    },
    {
        "slug": "jamboard-alternative",
        "title": "Free Jamboard Alternative for Teachers | Clean Slate",
        "desc": "Google shut Jamboard down in 2024. Clean Slate is a free Jamboard alternative for teachers: students join with a code, no sign-in, each with their own board.",
        "kicker": "no student sign-in",
        "h1": "A free Jamboard alternative for teachers",
        "lede": "Google shut Jamboard down at the end of 2024. Clean Slate is a free online whiteboard for teachers that does what classes used Jamboard for: a shared board, quick activities for the whole class, and no sign-in for students.",
        "hero": "join",
        "sections": [
            ("What teachers used Jamboard for, and how it works here", """
<ul class="ticks">
  <li><b>A board the whole class can see.</b> Start a live class and every student sees your board on their own device.</li>
  <li><b>A space for each student.</b> In Jamboard you gave each student a frame. In Clean Slate each student gets a board of their own, and you can open any of them while they work.</li>
  <li><b>Annotating a picture or a text.</b> Paste an image onto the board, or open a PDF beside it, and write over it.</li>
  <li><b>Quick to start.</b> Students type a six-character code and their first name. No accounts.</li>
</ul>"""),
            ("What's different from Jamboard", """
<p>Clean Slate is a writing board, so some things work differently.</p>
<ul class="ticks">
  <li>There are no sticky notes. You add text with text boxes.</li>
  <li>There are no separate frames. A board is one page that you pan and zoom.</li>
  <li>Students' own boards last for the live class and aren't saved afterwards. Your board is saved.</li>
</ul>
<p>What you gain is a set of teaching tools Jamboard didn't have: shapes drawn to the angles and lengths you set, a ruler and compass, graph paper, a scientific calculator, five paper styles, and a pane for the worksheet beside the board.</p>
{fig:paper:Blank, lined, squared, dot grid or isometric paper.}"""),
            ("Works on Chromebooks and tablets", """
<p>Clean Slate runs in Chrome on Chromebooks, and in the browser on iPads, Android tablets, Windows and Mac. Nothing is installed.</p>"""),
        ],
        "faq": [
            ("Is Clean Slate free?", "Yes. There is no paid plan and no board limit."),
            ("Do students need a Google account?", "No. Students join a live class with a code and their first name. The teacher signs in with a Google account."),
            ("Does it have sticky notes?", "No. Use text boxes for typed notes."),
            ("Does it work on Chromebooks?", "Yes. It runs in Chrome."),
            ("Can I try it without signing up?", f'Yes. The <a href="{APP}/demo">demo board</a> needs no sign-up.'),
        ],
        "related": ["online-whiteboard-for-classroom", "microsoft-whiteboard-alternative", "online-whiteboard-for-teaching", "free-online-whiteboard-no-sign-up"],
    },
]

HOME_FAQ = [
    ("Is Clean Slate really free?", "Yes. There is no paid plan, no board limit and no ads."),
    ("Can I try it without signing up?", f'Yes. The <a href="{APP}/demo">demo board</a> opens with no sign-up, no login and nothing to download. Nothing you draw there is saved. Sign in with a Google account when you want to save and share boards.'),
    ("Do my students need accounts?", "No. Students join a live class with a six-character code and their first name."),
    ("Does it work on an iPad with Apple Pencil?", 'Yes. It runs in Safari on iPadOS 15 and newer. Once you write with a Pencil, only the Pencil draws, and resting your palm on the screen leaves no marks. See <a href="[[url:whiteboard-for-ipad]]">the whiteboard for iPad</a>.'),
    ("Can I open a PDF on the whiteboard?", "Yes. Open a PDF of up to 30 pages, or an image, in a pane beside the board, and write on it."),
    ("Is it a replacement for Microsoft Whiteboard or Jamboard?", 'Yes. Microsoft Whiteboard no longer works with personal accounts and Google shut Jamboard down in 2024. Clean Slate works with any Google account in any browser. See <a href="[[url:microsoft-whiteboard-alternative]]">the Microsoft Whiteboard alternative</a> and <a href="[[url:jamboard-alternative]]">the Jamboard alternative</a>.'),
    ("Can it draw accurate shapes for maths?", 'Yes. Insert, then Shape draws polygons, triangles, quadrilaterals, circles and 3D solids to the sides and angles you set, with the measurements labelled. See <a href="[[url:online-whiteboard-for-math]]">the whiteboard for math</a>.'),
    ("Does it have video or audio calls?", "No. Use it beside Zoom, Google Meet or Teams."),
    ("Are my boards saved?", "Yes. When you're signed in, boards save automatically. A board that nobody opens for 30 days is deleted, and you get an email first with a button to keep it."),
    ("Which devices and browsers does it work on?", "Chrome, Edge, Firefox and Safari, on iPads, Android tablets, Chromebooks, Windows, Mac and Linux. There is nothing to install."),
]
