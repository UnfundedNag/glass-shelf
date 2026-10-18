# Glass Shelf: Calibre-Web reader for Even Realities G2 with KOReader progress sync

> Name: **Glass Shelf** (renamed from the working name G2 Shelf before the first commit). Display name must be ≤20 chars, and `package_id` must be lowercase with no hyphens: `com.nickjohnson.glassshelf`. Treat `package_id` as permanent once anything is installed or published.

## 1. Goal

An Even Hub app for the G2 glasses that:

1. Browses Nick's self-hosted Calibre-Web(-Automated) library over **OPDS**.
2. Opens the book he was last reading (from any device) at the right spot.
3. Reports progress back so **Readest** on iPad/Android (and anything else that speaks KOReader sync) resumes where the glasses left off.

**Non-goals for v1:** annotations and highlights, PDF/CBZ, multiple servers, offline library management UI, Flow/RSVP mode.

## 2. System architecture

```
 ┌──────────── Phone (Even app WebView) ────────────┐        ┌──────── Homelab ────────┐
 │  Glass Shelf (Vite + TS + even_hub_sdk)         │  HTTPS │  Reverse proxy (single  │
 │  ├─ Settings page (phone UI)                    │ ─────► │  origin, adds CORS)     │
 │  ├─ OPDS client  ──────────── /opds/…           │        │   ├─ /opds   → CWA      │
 │  ├─ kosync client ─────────── /kosync/…         │        │   └─ /kosync → CWA      │
 │  ├─ EPUB parser + paginator                     │        │  Calibre-Web-Automated  │
 │  └─ Glasses renderer ── BLE ──► G2 (576×288)    │        │  (kosync enabled)       │
 └─────────────────────────────────────────────────┘        └─────────────────────────┘
          ▲ same kosync account
 Readest (iPad / Android) ──────────────────────────────────► /kosync
```

**Key facts from the platform:**

- **Where the app runs.** A G2 app is a regular web app. The Even phone app loads it in a WebView and relays display and input to the glasses over BLE. All logic, networking and storage happen on the phone.
- **Network whitelist.** Packaged apps declare network access in `app.json` as a `network` permission with a whitelist of full origins.
- **CORS still applies.** The whitelist is not a CORS bypass. The WebView enforces CORS, so the server must send `Access-Control-Allow-Origin`, or we put a proxy we control in front of it.
  - This is why a reverse proxy (Caddy, nginx / nginx proxy manager, …) fronts everything on **one origin**: one whitelist entry, one CORS config.
  - Preflight `OPTIONS` must be answered, because kosync uses custom `x-auth-*` headers.
- **Reachability is the builder's choice.** The app only needs one origin the phone can reach: a public reverse proxy, a WireGuard or Tailscale route, or LAN. The settings UI takes whatever origin works, and `SERVER_ORIGIN` sets the whitelist at pack time (§7).

### Caddy sketch (an nginx proxy manager equivalent is still to be written)

```caddy
books.<tailnet>.ts.net {
  @preflight method OPTIONS
  header {
    Access-Control-Allow-Origin  *          # tighten once the WebView origin is known
    Access-Control-Allow-Headers "Authorization, Content-Type, Accept, x-auth-user, x-auth-key"
    Access-Control-Allow-Methods "GET, PUT, POST, OPTIONS"
  }
  respond @preflight 204
  reverse_proxy calibre-web-automated:8083
}
```

## 3. Server prerequisites

1. **Enable KOReader sync in CWA.** CWA has a built-in kosync server at `/kosync`. Recent releases default the global KOReader sync toggle to **off**, so turn it on in the admin settings.
2. **Point Readest at the same server.** On both iPad and Android: KOReader Sync → custom server `https://<your-server>/kosync`, same CWA user. Set document matching to **Binary** (file hash) on every client.
3. **Same file everywhere.** Every client must download the **same EPUB file** from Calibre-Web, not a kepub or converted copy, or the hashes won't match.

## 4. Protocols

### 4.1 OPDS (Calibre-Web)

- **Root and auth.** The feed root is `GET /opds` with HTTP Basic auth (CWA user).
- **Feeds to use:**
  - root navigation;
  - "Recently added";
  - search via the OpenSearch template;
  - per-book acquisition link (`rel="http://opds-spec.org/acquisition"`, type `application/epub+zip`).
- **Parsing.** Parse the Atom XML with `DOMParser`. Keep a simple model: `{id, title, author, epubHref, updated}`.
- **Format.** Download EPUB only. Ignore kepub links.
  - Calibre-Web types kepub links `application/epub+zip` too, so tell them apart by the link `title` (`KEPUB`) and the `/kepub/` download path (`src/opds/parse.ts`).
- **Sub-path installs.** The app's server setting is a base URL (it may include a path such as `/calibre/`); feed links are resolved against the feed URL.

### 4.2 KOReader sync (kosync)

**Headers on every call:**

- `Accept: application/vnd.koreader.v1+json`
- `x-auth-user: <username>`
- `x-auth-key: <md5(password) hex>`
- `Content-Type: application/json` on PUT

**Auth: send HTTP Basic too (resolved in M1).** CWA's kosync also accepts `Authorization: Basic` with the plain username and password. When Calibre-Web authenticates against an external provider (LDAP/OAuth/an identity proxy such as Authentik), it has no local password hash to compare the md5 `x-auth-key` against, so the md5 method returns **401** and only Basic works. Readest falls back to Basic for the same reason. The client should send Basic on every `/kosync` call (plus the `x-auth-*` headers for stock kosync servers), and the settings test should hit `/kosync/users/auth` with it. Verified against a CWA instance behind an identity proxy: Basic gives `200 {"authorized":"OK"}` on `/users/auth` and works for progress reads; md5 gives 401.

**Endpoints** (relative to the base, e.g. `/kosync`):

| Call | Purpose | Body / response |
|---|---|---|
| `GET /users/auth` | Credential check on Settings save | 200 = ok |
| `GET /syncs/progress/{doc}` | Pull | `{document, progress, percentage, device, device_id, timestamp}`, or `{}` if none |
| `PUT /syncs/progress` | Push | `{document, progress, percentage, device:"G2", device_id:<uuid>}` |

**Implementation notes:**

- `doc` is the **KOReader partial-MD5 file hash**. Implement it exactly, using a small MD5 lib such as `spark-md5`, because WebCrypto has no MD5:

  ```ts
  // Port of KOReader util.partialMD5 — VERIFY with test vectors (see §8)
  export function koPartialMd5(buf: Uint8Array): string {
    const step = 1024, size = 1024, chunks: Uint8Array[] = [];
    for (let i = -1; i <= 10; i++) {
      const offset = i < 0 ? 0 : step << (2 * i);   // LuaJIT lshift(1024,-2) wraps to 0
      if (offset >= buf.length) break;
      chunks.push(buf.subarray(offset, offset + size));
    }
    return md5(concat(chunks));
  }
  ```

- `percentage` is a float from 0 to 1 for the whole book.
- `progress` is a CREngine **xpointer** string, e.g. `/body/DocFragment[12]/body/div/p[3]/text().45`.
  - `DocFragment[N]` is the 1-based **spine index**.
  - Readest converts its EPUB CFI to and from this format.
  - **Readest will not approximate (M3 finding).** If `progress` starts with `/body`, Readest treats it as the only acceptable answer: when the path does not resolve it shows "Sync failed" and does *not* fall back to `percentage`. A wrong XPointer is worse than none. Readest resolves a bare element path (`/body/DocFragment[7]/body/div/p[3]`, no text step) to the element start, counting same-name element siblings 1-based with the index omitted for the first, which is the rule `src/epub/blocks.ts` uses. So M3 pushes the element path of the block at the top of the page (paragraph-level); M4 adds the `/text().N` offset.
- **Client behaviour (M3).** Requests go to `<server URL>/kosync/`. Basic auth first; on 401 the client retries once with the `x-auth-*` md5 headers (stock kosync servers) and remembers which worked. The phone settings test checks `/kosync/users/auth` but only warns on failure, since reading works without sync.
- **CWA quirk.** CWA returned GET timestamps exactly 4 h in the future (PUT replies were correct): it appears to store server-local time and read it back as UTC. The sync prompt omits the age when a timestamp is in the future rather than show a wrong one.

## 5. Position model (the hard part)

The glasses re-flow text into ~400–500 character pages, so pages mean nothing to other devices. Store position as **(spineIndex, elementPath, charOffset)** and derive everything else from it.

**Push** (glasses → server):

1. `progress` = `/body/DocFragment[spineIndex+1]/body/<path to the block element at the top of the current page>`, with `/text().<offset>` when known.
   - Build the path from the parsed XHTML DOM (element names with 1-based sibling indexes), mirroring how CREngine addresses nodes.
2. `percentage` = characters before the page start ÷ total characters in the book.

**Pull** (server → glasses), using a precision ladder:

1. Parse `DocFragment[N]` → open spine item N. This always works if the hash matched.
2. Try to resolve the element path in that chapter's DOM. On success, start at that element (and the text offset if present).
3. Otherwise, use the global `percentage` and clamp to chapter N's character range.
4. Otherwise, use the global percentage alone.

> Expect paragraph-level accuracy most of the time and chapter-level accuracy at worst. Another small-screen reader that added kosync shipped chapter-level sync, because exact sync would need character-level tracking. **Ship the ladder; don't chase perfection in v1.**

**Conflict policy**, modeled on KOReader's:

- **On open:** pull. If the remote position is ahead of the local one and from a different `device_id`, show on the glasses: `Jump to 47% (Readest · 2h ago)? Tap = yes, double-tap = no`.
- **Push timing:** push on page-turn, debounced to about 10 s idle, and on app background/exit lifecycle events. Never push during the initial pull/prompt.
- **Offline:** keep the last unsent push in storage and retry on the next network success.
- **As built (M3):**
  - Opening a book waits up to 4 s for the pull, then reads locally.
  - "Ahead" compares resolved positions, not raw percentages (Readest's percentage is page-based, ours character-based). A remote position on the page already showing is not a jump, so a device that just opened where the glasses left off does not trigger a prompt.
  - Accepting marks the position as synced (no immediate push back). Declining keeps the local position; the next page turn pushes it, overwriting the remote one.
  - Pushes go out 10 s after the last page turn, immediately on leaving the book (double-tap), and on `FOREGROUND_EXIT`/exit events. Unchanged positions are not re-sent. Failed pushes are kept per document and retried when the library next loads.
  - Device name `Glass Shelf (G2)`; `device_id` is a random 32-hex id kept in bridge storage.
  - Local positions are keyed by the document hash (`pos:<hash>`).
  - **Same account.** Positions belong to the sync account, so the glasses and Readest must log in as the same user.

## 6. App structure

```
glass-shelf/
  app.json              # manifest (see §7)
  index.html            # phone-side settings + library UI
  src/
    main.ts             # bootstrap, waitForEvenAppBridge()
    glasses/            # page containers, renderer, input router
    opds/               # feed fetch + Atom parse
    kosync/             # client + partialMD5
    epub/               # JSZip unpack, spine, XHTML → text blocks w/ DOM paths
    paginate/           # pixel-accurate fit using @evenrealities/pretext measurement
    reader/             # page cursor across chapters, positions
    store/              # bridge storage (settings, positions) + IndexedDB (EPUB bytes)
  tests/                # vitest: hash vectors, xpointer build/parse, paginator
  vite.config.ts
  .github/workflows/ci.yml   # build + test + `evenhub pack` → upload .ehpk artifact
  LICENSE  README.md  CHANGELOG.md  CLAUDE.md
```

**Dependencies:**

- `@evenrealities/even_hub_sdk`
- `@evenrealities/evenhub-cli` (dev)
- `@evenrealities/pretext` (Even's pixel-accurate G2 text measurement; replaced `even-toolkit` in M2, which the app no longer needs)
- `jszip`
- `spark-md5`
- `vite`, `typescript`, `vitest`

Plain CSS only.

### Glasses UI

**Display constraints:**

- **Canvas.** 576×288, 4-bit green greyscale. A page holds at most 4 image containers plus 8 other containers.
- **Event capture.** Exactly one container must have `isEventCapture: 1`.
- **Text limits.** Text containers take up to 1000 characters on create/rebuild and 2000 on `textContainerUpgrade`.
- **Font.** There is one built-in font. It is **proportional**, and missing glyphs are silently dropped.
- **Text styling.** There is no font size or alignment control.

**Screens:**

- **Library** (list container, max 20 items, 64 chars each):
  - `▶ Continue: <last book>`;
  - then the 19 most recent books from OPDS;
  - "Search on phone" opens the phone UI.
- **Reader** (2 containers):
  - body text container with event capture;
  - 1-line footer: `Ch 7 · 47% · 12:41` with a `━━━━──` bar.
  - Use `textContainerUpgrade` for page turns (smoother on hardware than a rebuild).
- **Reader decisions (M2):**
  - **Layout.** Body 576×252 (9 lines; LVGL line height is fixed at 27 px), footer at y=256. Pages are measured with pretext against the inner width **minus an 8 px margin**: the simulator wrapped 566 px lines that pretext said fit 568 px, which overflowed the page (scrollbar). With the margin, 80 consecutive simulator pages showed no overflow. Confirmed on real G2 hardware: no overflow.
  - **Pages fill completely.** Paragraphs split across pages at word boundaries (by characters only for a word wider than the page). Paragraphs start on a new line with a fullwidth-space (`U+3000`) indent instead of a blank line, which would cost one of 9 lines.
  - **Text cleanup.** Soft hyphens and zero-width characters are removed (the font draws soft hyphens); typographic and no-break spaces become spaces; `ﬁ`/`ﬂ`-style ligatures are expanded (missing from the font). Curly quotes, dashes and ellipses are in the font.
  - **Skipped items.** Spine items with no text (covers) and the book's own table of contents (EPUB 3 `nav`, EPUB 2 guide `toc`) are skipped when reading but keep their spine index, so `DocFragment[N]` still lines up.
  - **Local position.** Saved on every page turn and on leaving the reader, as (spine index, block index, character offset, percentage). Block offsets are into the *normalized* text; M4 must map them to CREngine text-node offsets.
  - **Speed.** Books are fully parsed on open (needed for whole-book percentage) and paginated a chapter at a time. In the simulator, War and Peace (1.6 MB, 396 chapters) reopens from cache in ~0.8 s.

**Inputs.** Verify these against even-g2-notes `docs/input-events.md` before wiring:

| Gesture | Library | Reader |
|---|---|---|
| Swipe down / up | move selection (native) | next / prev page |
| Tap | open book | toggle footer / confirm sync prompt |
| Double-tap | exit app | back to library (pushes progress first) |

### Phone UI (settings)

- Server origin, username and password. The password is stored only as its md5 key plus the Basic credential, in bridge storage. Never log either. (The Basic credential is reversible, so it is effectively the password; it is required because kosync on externally-authenticated servers only accepts Basic, see §4.2.)
- A "Test connection" button that hits OPDS root and `/users/auth`.
- Library search, plus a "Send to glasses" button.
- Sync status: last push and last pull, with device name.

### Caching

- Keep the last 3 EPUBs as raw bytes in IndexedDB. The hash must be computed on **these exact bytes**.
- Keep the parsed chapter index in memory.
- Keep positions in bridge storage, keyed by doc hash.

## 7. `app.json`

```json
{
  "package_id": "com.nickjohnson.glassshelf",
  "edition": "202601",
  "name": "Glass Shelf",
  "version": "0.1.0",
  "min_app_version": "2.2.10",
  "min_sdk_version": "0.0.16",
  "tagline": "Read your Calibre-Web library with synced progress",
  "description": "Browse a Calibre-Web OPDS library and read EPUBs on the G2. Reading position syncs with KOReader-compatible apps like Readest via a KOReader sync server.",
  "author": "Nick Johnson",
  "entrypoint": "index.html",
  "supported_languages": ["en"],
  "permissions": [
    {
      "name": "network",
      "desc": "Downloads books from your Calibre-Web server and syncs reading position.",
      "whitelist": ["https://books.example.com"]
    }
  ]
}
```

**Manifest rules:**

- `permissions` must be an array of objects.
- `edition` must be `"202601"`.
- `version` is plain three-part semver.
- `min_app_version` follows the SDK: SDK 0.0.16 declares Even App ≥ 2.2.10. `npm run pack` passes `--sdk-ver` from the installed SDK so the CLI stamps that floor rather than the newest SDK on npm.

**Whitelist per build.** The whitelist is a fixed origin, and a self-hosted app needs a different origin per user. So generate `app.json` at pack time from `SERVER_ORIGIN` (env var or `.env.local`), using a tiny `scripts/gen-manifest.mjs` run before `evenhub pack`. The checked-in `app.json` uses a placeholder.

## 8. Testing

1. **Hash vectors.**
   - Take 3 EPUBs of different sizes (one under 1 KB).
   - Get KOReader's hash for each. Easiest is to open the file in KOReader desktop, push progress, and read the `document` field from CWA/server logs. Alternatively, run the Lua function in LuaJIT.
   - Assert that `koPartialMd5` matches.
2. **Round-trip with Readest.**
   - Read to the middle of chapter 5 in Readest and push.
   - Open on the G2 and confirm it lands in chapter 5 near the same paragraph.
   - Page forward 10 pages on the G2, exit, and open in Readest. It should land within a screen.
3. **Paginator.** Snapshot tests that no page exceeds container height, using pretext measurement. Include edge cases: long words, CJK, empty chapters. (`npm run test:live` also paginates every recent book on the configured server and checks every page.)
4. **xpointer.** Run build → parse → resolve against sample chapters, including nested `div`s and `text()` offsets.
5. **Simulator first, then hardware.**
   - `npm run dev` plus the Even Hub simulator (or the even-dev launcher with `APP_PATH=../glass-shelf`).
   - Then `npm run qr` to sideload on the real glasses over LAN or VPN.

## 9. Milestones

| # | Deliverable | Done when |
|---|---|---|
| M0 | Scaffold (`create-even-app` or official minimal template), CI, LICENSE, README | "Hello" renders in simulator; CI produces `.ehpk` |
| M1 | Settings + OPDS browse + EPUB download/cache | Library list shows real books on glasses |
| M2 | EPUB parse + paginator + reader + local position | Can read a full chapter; reopen resumes locally |
| M3 | kosync auth/pull/push + partialMD5 + sync prompt | Percentage/chapter-level round-trip with Readest |
| M4 | xpointer element paths (precision ladder) | Paragraph-level round-trip in the test in §8 |
| M5 | Polish + release | Tagged v0.1.0, `.ehpk` on GitHub Releases, PR to awesome-even-realities-g2 |

## 10. Open-sourcing conventions

- **License: MIT** (most G2 community apps and tooling use MIT). Apache-2.0 is an alternative if you want an explicit patent grant.
- **Do not copy code from `chortya/epub-reader-g2`.** Its license is "All rights reserved". Read it for ideas only; write the EPUB, pagination and storage code fresh. JSZip (MIT/GPLv3 dual) and spark-md5 (WTFPL) are fine to depend on.
- **Repo hygiene:**
  - `*.ehpk`, `.env*` and `app.local.json` go in `.gitignore`.
  - Never commit your server origin or credentials.
  - Add GitHub topics: `even-g2`, `even-hub`, `even-realities`, `calibre-web`, `koreader`, `opds`.
- **README:** simulator screenshots, the CWA/Readest setup steps from §3, the reverse-proxy/CORS snippets, and build/pack instructions.
- **Add a `CLAUDE.md`** pointing at this spec and at `nickustinov/even-g2-notes`. Several G2 repos ship CLAUDE.md/AGENTS.md files the same way.
- **Releases:** CI attaches the `.ehpk` to tagged releases. Anyone self-hosting builds their own with their `SERVER_ORIGIN`.
- **Distribution:** sideload via QR or a private build for yourself first. A public Even Hub listing depends on Q1 below.

## 11. Open questions to resolve early (M0/M1)

1. **Whitelist wildcards.** Does the `network` whitelist accept wildcards, or is a user-configured origin impossible for a public Hub listing? Check the official docs at hub.evenrealities.com/docs and ask in the Even Discord. This decides whether a public Hub listing is viable or the app stays build-it-yourself.
2. **WebView origin.** What is the WebView origin of a packaged `.ehpk` app? Needed to tighten `Access-Control-Allow-Origin` from `*`.
   - *M1:* not documented anywhere yet. The phone settings page now displays `location.origin`, so reading it off the phone answers this. In dev it is the Vite URL (e.g. `http://192.168.x.x:5173`).
3. **VPN reachability.** Does the Even app's WebView on GrapheneOS route through the phone's VPN? It should; verify in M1 with a fetch to the server origin. Moot if the server is reachable publicly.
   - *Resolved in M1:* yes. On a WireGuard phone the Even WebView loaded the dev server by LAN IP and fetched the library from the Calibre-Web server.
4. **Readest matching.** Does Readest use KOReader's binary partial-MD5 for the kosync `document` field? Confirm in the Readest source or by reading what it PUTs. If it hashes differently, the glasses must match Readest's scheme instead.
   - *M3:* the algorithm matches. Readest's `partialMD5` (`apps/readest-app/src/utils/md5.ts`) samples the same offsets, including `1024 << -2` wrapping to 0. CWA also matched a hash pushed by the glasses to its own record for that book (`calibre_checksum_version: koreader`), an independent check of the implementation. What remains is configuration: Readest set to Binary matching, downloading the same EPUB file.
5. **Lifecycle events.** Which lifecycle events fire reliably when the glasses app is closed? This is the final progress push; see `docs/page-lifecycle.md`.

## References

- even-g2-notes (community SDK reference): https://github.com/nickustinov/even-g2-notes
- Official templates: https://github.com/even-realities/evenhub-templates · dev kit: https://github.com/even-realities/everything-evenhub
- even-dev simulator launcher: https://github.com/BxNxM/even-dev
- Packaging-reference app: https://github.com/fuutott/rdt-even-g2-rddit-client
- Calibre-Web-Automated: https://github.com/crocodilestick/Calibre-Web-Automated
- KOReader sync server (protocol reference): https://github.com/koreader/koreader-sync-server
- Prior art, kosync on a small-screen reader: https://github.com/crosspoint-reader/crosspoint-reader/pull/232
