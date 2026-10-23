"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Search, Users, MoreHorizontal, Pencil, Share2, Trash2, LogOut, X, MessageSquarePlus, Settings } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { BOARD_BACKGROUNDS, backgroundCss, parseBackground } from "@/lib/boardBackground";
import NewBoardModal from "@/components/NewBoardModal";
import ShareModal from "@/components/ShareModal";
import FeedbackModal from "@/components/FeedbackModal";
import WhatsNew from "@/components/WhatsNew";
import DemoCarryOver from "@/components/DemoCarryOver";
import SettingsPanel from "@/components/SettingsPanel";
import NotebookShelf from "@/components/NotebookShelf";
import NotebookShare from "@/components/NotebookShare";
import LessonCarryOver from "@/components/LessonCarryOver";
import { takeReturn } from "@/lib/returnTo";
import { displayNameFor, subscribeSettings } from "@/lib/settings";
import { track } from "@/lib/track";
import s from "./Home.module.css";
import { LANDING_URL } from "@/lib/links";
import d from "@/components/Dialog.module.css";

const BASE_COLUMNS = "id, name, created_at, owner_id, shared_with";
const FULL_COLUMNS = BASE_COLUMNS + ", background, thumbnail";
const KIND_COLUMNS = FULL_COLUMNS + ", kind";

// Loads boards with their preview + paper type when those (newer) columns
// exist, and without them when they don't, so the list always works.
async function selectBoards(build) {
  // (with `kind`, so notebooks can be left out, once the database has it)
  const withKind = await build(supabase.from("boards").select(KIND_COLUMNS));
  if (!withKind.error) return withKind;
  let full = await build(supabase.from("boards").select(FULL_COLUMNS));
  // An expired sign-in comes back as 401: refresh it once and try again.
  if (full.error && (full.status === 401 || /jwt/i.test(full.error.message || ""))) {
    await supabase.auth.refreshSession();
    full = await build(supabase.from("boards").select(FULL_COLUMNS));
  }
  if (!full.error) return full;
  console.warn("Boards list: falling back to the basic columns:", full.status, full.error.code, full.error.message);
  return build(supabase.from("boards").select(BASE_COLUMNS));
}

const PAGE_SIZE = 30;

// A page of the boards list ("mine" or "shared"), newest first, from the
// database in one request (list_boards). null when the database hasn't got
// that yet: the older, everything-at-once way is used instead.
// `after`: the last board shown so far (the next page starts after it).
async function listBoards(kind, search, after) {
  try {
    const { data, error } = await supabase.rpc("list_boards", {
      p_kind: kind,
      p_search: search || null,
      p_before: after ? after.created_at : null,
      p_limit: PAGE_SIZE,
      p_before_id: after ? after.id : null,
    });
    if (error || !data || !Array.isArray(data.rows)) return null;
    return data;
  } catch (err) {
    return null;
  }
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}

function pageLabel(background) {
  const found = BOARD_BACKGROUNDS.find((b) => b.id === parseBackground(background).paper);
  return found && found.id !== "blank" ? found.label : "";
}

export default function Home() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [myBoards, setMyBoards] = useState([]);
  const [sharedBoards, setSharedBoards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [shareTarget, setShareTarget] = useState(null);
  const [nbShareTarget, setNbShareTarget] = useState(null); // a notebook being shared
  const [renameTarget, setRenameTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [menuFor, setMenuFor] = useState(null); // board id whose ⋯ menu is open
  const [accountOpen, setAccountOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // The boards, a page at a time (more load as you scroll down), and
  // searched in the database rather than on this device.
  const [paged, setPaged] = useState(false); // the database pages the list
  const [moreMine, setMoreMine] = useState(false);
  const [moreShared, setMoreShared] = useState(false);
  const [myTotal, setMyTotal] = useState(null);
  const [searched, setSearched] = useState(""); // what the list shown was searched for
  const [loadingMore, setLoadingMore] = useState(false);
  // (once the list is paged, a new search asks the database again)
  const searchKey = paged ? query.trim() : "";

  // Which list is showing (a new search starts a new one): a "more" that
  // comes back for an older one is dropped.
  const listGenRef = useRef(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const gen = ++listGenRef.current;
    // (typing in the search box waits for a pause)
    const wait = searchKey ? 300 : 0;
    const timer = setTimeout(async () => {
      const [mineList, sharedList] = await Promise.all([listBoards("mine", searchKey), listBoards("shared", searchKey)]);
      if (cancelled || gen !== listGenRef.current) return;
      if (mineList && sharedList) {
        setPaged(true);
        setLoadError("");
        setMyBoards(mineList.rows);
        setMoreMine(!!mineList.more);
        if (typeof mineList.total === "number") setMyTotal(mineList.total);
        setSharedBoards(sharedList.rows);
        setMoreShared(!!sharedList.more);
        setSearched(searchKey);
        setLoading(false);
        return;
      }
      // the older way: everything at once (searched on this device)
      const [owned, shared] = await Promise.all([
        selectBoards((q) => q.eq("owner_id", user.id).order("created_at", { ascending: false })),
        selectBoards((q) => q.contains("shared_with", [user.email.toLowerCase()]).order("created_at", { ascending: false })),
      ]);
      if (cancelled) return;
      if (owned.error) console.error("Error loading owned boards:", owned.error);
      if (shared.error) console.error("Error loading shared boards:", shared.error);
      setPaged(false);
      setLoadError(owned.error ? "Couldn't load your boards. Check your connection and refresh the page." : "");
      // (notebooks have their own shelf)
      const boardsOnly = (list) => list.filter((b) => b.kind !== "notebook");
      if (!owned.error && owned.data) {
        setMyBoards(boardsOnly(owned.data));
        setMyTotal(boardsOnly(owned.data).length);
      }
      if (!shared.error && shared.data) setSharedBoards(shared.data.filter((b) => b.owner_id !== user.id));
      setMoreMine(false);
      setMoreShared(false);
      setSearched("");
      setLoading(false);
    }, wait);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [user, searchKey]);

  async function loadMore(kind) {
    if (loadingMore) return;
    const list = kind === "shared" ? sharedBoards : myBoards;
    const last = list[list.length - 1];
    if (!last) return;
    setLoadingMore(true);
    const gen = listGenRef.current;
    const next = await listBoards(kind, searched, last);
    setLoadingMore(false);
    if (!next || gen !== listGenRef.current) return;
    const seen = new Set(list.map((b) => b.id));
    const add = next.rows.filter((b) => !seen.has(b.id));
    if (kind === "shared") {
      setSharedBoards((prev) => [...prev, ...add]);
      setMoreShared(!!next.more);
    } else {
      setMyBoards((prev) => [...prev, ...add]);
      setMoreMine(!!next.more);
    }
  }

  // Close the ⋯ / account menus when tapping anywhere else.
  useEffect(() => {
    if (!menuFor && !accountOpen) return undefined;
    function handle(e) {
      if (e.target.closest && e.target.closest("[data-home-menu]")) return;
      setMenuFor(null);
      setAccountOpen(false);
    }
    function key(e) {
      if (e.key === "Escape") {
        setMenuFor(null);
        setAccountOpen(false);
      }
    }
    document.addEventListener("pointerdown", handle);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", handle);
      document.removeEventListener("keydown", key);
    };
  }, [menuFor, accountOpen]);

  function updateBoard(id, patch) {
    setMyBoards((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  async function handleCreate(name, background) {
    setShowNew(false);
    const row = { name: name || "Untitled board", owner_id: user.id };
    let result = await supabase.from("boards").insert({ ...row, background }).select().single();
    if (result.error) {
      // Project without the background column yet: create it plain.
      result = await supabase.from("boards").insert(row).select().single();
    }
    if (result.error) {
      alert("Couldn't create board: " + result.error.message);
      return;
    }
    track("board_created", { background: background || "blank" });
    router.push(`/board/${result.data.id}`);
  }

  async function handleRename(board, name) {
    setRenameTarget(null);
    const next = name.trim() || "Untitled board";
    if (next === board.name) return;
    updateBoard(board.id, { name: next });
    const { error } = await supabase.from("boards").update({ name: next }).eq("id", board.id);
    if (error) {
      updateBoard(board.id, { name: board.name });
      alert("Couldn't rename: " + error.message);
    }
  }

  async function handleDelete(board) {
    setDeleteTarget(null);
    const { error } = await supabase.from("boards").delete().eq("id", board.id);
    if (error) {
      alert("Couldn't delete board: " + error.message);
      return;
    }
    setMyBoards((prev) => prev.filter((b) => b.id !== board.id));
    setMyTotal((n) => (typeof n === "number" ? Math.max(0, n - 1) : n));
  }

  async function saveSharing(board, list) {
    updateBoard(board.id, { shared_with: list });
    setShareTarget((prev) => (prev && prev.id === board.id ? { ...prev, shared_with: list } : prev));
    const { error } = await supabase.from("boards").update({ shared_with: list }).eq("id", board.id);
    if (error) {
      updateBoard(board.id, { shared_with: board.shared_with });
      setShareTarget((prev) => (prev && prev.id === board.id ? { ...prev, shared_with: board.shared_with } : prev));
      alert("Couldn't update sharing: " + error.message);
    }
  }

  // Sharing a notebook from the shelf: by link or by email (NotebookShare
  // reads how it's shared now).
  function shareNotebook(nb) {
    setNbShareTarget(nb);
  }

  // Signed in from a page that asked to be come back to (a notebook opened
  // from its link, say: see src/lib/returnTo.js).
  useEffect(() => {
    if (!user) return;
    const back = takeReturn();
    if (back) router.replace(back);
  }, [user, router]);

  function handleShare(email) {
    const board = shareTarget;
    if (!board) return;
    saveSharing(board, Array.from(new Set([...(board.shared_with || []), email.toLowerCase()])));
  }

  function handleUnshare(email) {
    const board = shareTarget;
    if (!board) return;
    saveSharing(board, (board.shared_with || []).filter((e) => e !== email));
  }

  const q = query.trim().toLowerCase();
  // (a paged list is searched in the database; this only covers the moment
  // before its answer arrives, and the older way)
  const matches = (b) => !q || (b.name || "Untitled board").toLowerCase().includes(q);
  const mine = myBoards.filter(matches);
  const shared = sharedBoards.filter(matches);
  const mineCount = paged && q && searched.toLowerCase() === q && typeof myTotal === "number" ? myTotal : mine.length;
  // their name from Settings (or Google), else their email
  const shownName = useSyncExternalStore(subscribeSettings, () => displayNameFor(user), () => "");
  const initial = (shownName || user?.email || "?").charAt(0).toUpperCase();

  function renderThumb(b) {
    if (b.thumbnail) {
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={b.thumbnail} alt="" loading="lazy" draggable={false} />;
    }
    return (
      <span className={s.thumbEmpty} style={backgroundCss(b.background, 0.7, { x: 8, y: 8 })}>
        {b.background !== undefined && <span className={s.emptyLabel}>Nothing drawn yet</span>}
      </span>
    );
  }

  function renderCard(b, owned) {
    const meta = [owned ? `Created ${formatDate(b.created_at)}` : "Shared with you", pageLabel(b.background)]
      .filter(Boolean)
      .join(" · ");
    const sharedCount = owned && b.shared_with ? b.shared_with.length : 0;
    const open = menuFor === b.id;
    return (
      <div key={b.id} className={s.card}>
        <Link href={`/board/${b.id}`} className={s.cardLink}>
          <span className={s.thumb}>
            {renderThumb(b)}
            {sharedCount > 0 && (
              <span className={s.sharedBadge} title={`Shared with ${sharedCount} ${sharedCount === 1 ? "person" : "people"}`}>
                <Users size={13} strokeWidth={2} aria-hidden="true" />
                {`Shared with ${sharedCount}`}
              </span>
            )}
          </span>
          <span className={s.cardBody}>
            <span className={s.cardTitle}>{b.name || "Untitled board"}</span>
            <span className={s.cardMeta}>{meta}</span>
          </span>
        </Link>
        {owned && (
          <>
            <button
              type="button"
              data-home-menu="true"
              className={`${s.moreBtn} ${open ? s.moreBtnOpen : ""}`}
              aria-label={`More options for ${b.name || "Untitled board"}`}
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setMenuFor(open ? null : b.id)}
            >
              <MoreHorizontal size={18} />
            </button>
            {open && (
              <div className={s.cardMenu} role="menu" data-home-menu="true">
                <button type="button" role="menuitem" className={s.menuItem} onClick={() => { setMenuFor(null); setRenameTarget(b); }}>
                  <Pencil size={16} /> Rename
                </button>
                <button type="button" role="menuitem" className={s.menuItem} onClick={() => { setMenuFor(null); setShareTarget(b); }}>
                  <Share2 size={16} /> Share
                </button>
                <button type="button" role="menuitem" className={`${s.menuItem} ${s.menuItemDanger}`} onClick={() => { setMenuFor(null); setDeleteTarget(b); }}>
                  <Trash2 size={16} /> Delete
                </button>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className={s.page}>
      <header className={s.topBar}>
        {/* The logo and name go to the landing page (the public "about" site). */}
        <a href={LANDING_URL} className={s.brand} aria-label="Clean Slate home page" title="About Clean Slate">
          <span className={s.brandMark} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 17c3-6 6-9 8-9s1 6 3 6 3-3 5-5" />
            </svg>
          </span>
          <span className={s.brandName}>Clean Slate</span>
        </a>
        <label className={s.search}>
          <Search size={16} aria-hidden="true" />
          <input type="search" placeholder="Search" aria-label="Search notebooks and boards" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className={s.spacer} />
        {/* Announced updates: the button, and the pop-up that opens by itself after a new one */}
        <WhatsNew user={user} className={`${s.topBtn} ${s.feedbackBtn}`} labelClassName={s.longLabel} />
        <button
          type="button"
          className={`${s.topBtn} ${s.feedbackBtn} ${s.hideOnPhone}`}
          onClick={() => setFeedbackOpen(true)}
          aria-label="Send feedback"
          title="Send feedback — ideas, bugs or anything else"
        >
          <MessageSquarePlus size={16} />
          <span className={s.longLabel}>Feedback</span>
        </button>
        {/* a full page load, so the teacher pages' visit counting doesn't come along */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/join" className={s.topBtn} aria-label="Join a class with a code" title="Join a class with a code">
          <Users size={16} />
          <span className={s.longLabel}>Join with a class code</span>
        </a>
        <button
          type="button"
          data-home-menu="true"
          className={s.avatarBtn}
          aria-label="Account"
          aria-haspopup="menu"
          aria-expanded={accountOpen}
          onClick={() => setAccountOpen((v) => !v)}
        >
          {initial}
        </button>
        {accountOpen && (
          <div className={s.accountMenu} role="menu" data-home-menu="true">
            <div className={s.accountEmail}>
              <b>{shownName || "Signed in"}</b>
              {user?.email}
            </div>
            <button
              type="button"
              role="menuitem"
              className={s.menuItem}
              onClick={() => {
                setAccountOpen(false);
                setSettingsOpen(true);
              }}
            >
              <Settings size={16} /> Settings
            </button>
            <button
              type="button"
              role="menuitem"
              className={s.menuItem}
              onClick={() => {
                setAccountOpen(false);
                setFeedbackOpen(true);
              }}
            >
              <MessageSquarePlus size={16} /> Send feedback
            </button>
            <button type="button" role="menuitem" className={`${s.menuItem} ${s.menuItemDanger}`} onClick={signOut}>
              <LogOut size={16} /> Sign out
            </button>
          </div>
        )}
      </header>

      <main className={s.main}>
        {/* Notebooks (once the database has them: supabase/2026-11-notebooks.sql) */}
        <NotebookShelf user={user} query={query} onOpen={(id) => router.push(`/board/${id}`)} onShare={shareNotebook} />

        <div className={s.headRow}>
          <div>
            <h1 className={s.heading}>Your boards</h1>
            <p className={s.subheading}>
              {loading
                ? "Loading…"
                : q
                  ? `${mineCount} matching “${query.trim()}”`
                  : `${myTotal ?? myBoards.length} board${(myTotal ?? myBoards.length) === 1 ? "" : "s"} · newest first`}
            </p>
          </div>
          <div className={s.spacer} />
          <button type="button" className={s.primaryBtn} onClick={() => setShowNew(true)}>
            <Plus size={18} strokeWidth={2.2} />
            New board
          </button>
        </div>

        {loadError && <div className={s.errorBox}>{loadError}</div>}

        {loading ? (
          <div className={s.grid} aria-hidden="true">
            <div className={s.skeleton} />
            <div className={s.skeleton} />
            <div className={s.skeleton} />
          </div>
        ) : mine.length === 0 && q ? (
          <div className={s.empty}>
            <b>No boards match “{query.trim()}”</b>
            Try a different word, or clear the search.
          </div>
        ) : (
          <div className={s.grid}>
            {!q && (
              <button type="button" className={s.newTile} onClick={() => setShowNew(true)}>
                <Plus size={26} strokeWidth={1.8} />
                New board
                <span className={s.newTileHint}>{myBoards.length === 0 ? "Start your first board" : "Blank, lined, squared or dotted"}</span>
              </button>
            )}
            {mine.map((b) => renderCard(b, true))}
          </div>
        )}
        {!loading && moreMine && <MoreBoards busy={loadingMore} onMore={() => loadMore("mine")} />}

        {!loading && shared.length > 0 && (
          <>
            <h2 className={s.sectionHeading}>Shared with you</h2>
            <div className={s.grid}>{shared.map((b) => renderCard(b, false))}</div>
            {moreShared && <MoreBoards busy={loadingMore} onMore={() => loadMore("shared")} />}
          </>
        )}
      </main>

      {/* A demo board someone asked to keep before signing in is saved to
          their account here, then opened. */}
      <DemoCarryOver userId={user?.id} createdAt={user?.created_at} />
      {/* A lesson a student asked to keep (when their class ended) becomes a
          notebook here, then opens. */}
      <LessonCarryOver userId={user?.id} />

      {feedbackOpen && (
        <FeedbackModal userEmail={user?.email} boardCount={myTotal ?? myBoards.length} onClose={() => setFeedbackOpen(false)} />
      )}

      {showNew && <NewBoardModal onClose={() => setShowNew(false)} onCreate={handleCreate} />}

      {settingsOpen && <SettingsPanel user={user} signOut={signOut} onClose={() => setSettingsOpen(false)} />}

      {shareTarget && (
        <ShareModal board={shareTarget} onClose={() => setShareTarget(null)} onShare={handleShare} onRemove={handleUnshare} />
      )}
      {nbShareTarget && <NotebookShare boardId={nbShareTarget.id} name={nbShareTarget.name} onClose={() => setNbShareTarget(null)} />}

      {renameTarget && (
        <RenameDialog board={renameTarget} onClose={() => setRenameTarget(null)} onSave={(name) => handleRename(renameTarget, name)} />
      )}

      {deleteTarget && (
        <div className={d.overlay} onClick={() => setDeleteTarget(null)}>
          <div className={d.card} onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="delete-title">
            <div className={d.header}>
              <div className={d.titleBlock}>
                <h2 id="delete-title" className={d.title}>Delete “{deleteTarget.name || "Untitled board"}”?</h2>
                <p className={d.subtitle}>Everything on it is removed for everyone it&apos;s shared with. This can&apos;t be undone.</p>
              </div>
            </div>
            <div className={d.actions}>
              <button type="button" className={d.btn} onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
              <button type="button" className={`${d.btn} ${d.btnDanger}`} onClick={() => handleDelete(deleteTarget)}>
                Delete board
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RenameDialog({ board, onClose, onSave }) {
  const [name, setName] = useState(board.name || "");
  return (
    <div className={d.overlay} onClick={onClose}>
      <form
        className={d.card}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave(name);
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-title"
      >
        <div className={d.header}>
          <div className={d.titleBlock}>
            <h2 id="rename-title" className={d.title}>Rename board</h2>
          </div>
          <button type="button" className={d.close} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <label className={d.label}>
          Board name
          <input autoFocus className={d.input} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />
        </label>
        <div className={d.actions}>
          <button type="button" className={d.btn} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${d.btn} ${d.btnPrimary}`}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

// More boards load by themselves as the bottom of the list comes into view
// (or with the button, which also says what is happening).
function MoreBoards({ busy, onMore }) {
  const ref = useRef(null);
  const onMoreRef = useRef(onMore);
  useEffect(() => {
    onMoreRef.current = onMore;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onMoreRef.current();
    }, { rootMargin: "400px 0px" });
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  return (
    <div ref={ref} className={s.moreRow}>
      <button type="button" className={s.moreBoardsBtn} onClick={() => onMore()} disabled={busy}>
        {busy ? "Loading…" : "Show more boards"}
      </button>
    </div>
  );
}
