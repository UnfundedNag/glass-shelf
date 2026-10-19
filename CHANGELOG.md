# Changelog

## Unreleased

- README: a private-network setup (VPN or home Wi-Fi) with a minimal plain-HTTP CORS proxy, verified on Android; proxy examples now strip Calibre-Web's reverse-proxy login header on the paths the app uses; privacy note that Even's app storage is shared beyond Glass Shelf.
- Server requests give up after 15 s without an answer, so an unreachable server shows an error instead of hanging on "Testing connection…".

## 0.1.0 (2026-10-19)

First release. Read a Calibre-Web library on G2 glasses with reading positions synced through Calibre-Web-Automated's KOReader sync server, verified with Readest in both directions.

- Installable as a private Even Hub build (README). `PACKAGE_ID` sets your own package id; ids are unique across Even Hub.
- Pages follow the G2 firmware's line-wrap rule, so they fill all nine lines without overflowing.
- Phone app switches send no events to the app, so sync on leaving a book (double-tap) before changing devices.
- Known: in the installed app the book cache lasts only until the Even app restarts, because the app's local origin (`http://127.0.0.1:<port>`) changes each time.

- M4: exact positions. Pushes and pulls KOReader XPointers down to the character (`/text()[K].N`), following CREngine's text-node numbering and whitespace counting, so Readest and KOReader land on the line the glasses were on.

- M3: KOReader sync, verified both ways with Readest on Android (glasses to Readest opened on the pushed paragraph; Readest to glasses prompted and landed exactly). KOReader partial-MD5 document hash, sync client (HTTP Basic with md5-key fallback), pull on open with a "Jump to 47% (Readest)?" prompt, paragraph-level XPointer pushes 10 s after page turns and on leaving or backgrounding, an offline retry queue, and a sync check and status line on the phone page.

- M2: EPUB reader on the glasses (verified on real G2: pages fit with no overflow, fast open, resume works). EPUB parsing (spine, XHTML to text blocks with CREngine-style element paths, DRM detection), pixel-accurate page filling with Even's pretext measurement, swipe to turn pages across chapters, tap to toggle the footer (progress bar, chapter, percentage, clock), double-tap back to the library, and local resume. Skips covers and the book's own table of contents.

- M1: verified on real G2 glasses against Calibre-Web-Automated. phone settings page with connection test and search ("Send to glasses"), OPDS client and parser (Calibre-Web feeds, pagination, kepub filtering), glasses library list with "Continue", EPUB download with a 3-book IndexedDB cache. Settings live in Even bridge storage; the password is kept only as the Basic credential and kosync md5 key.

- M0 scaffold: Vite + TypeScript + Even Hub SDK 0.0.16, "Hello" glasses page, input gesture mapping, per-build manifest generation (`SERVER_ORIGIN`), CI that tests, builds and packs `.ehpk`.
