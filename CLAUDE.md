# Glass Shelf

Calibre-Web (OPDS) reader for the Even Realities G2 glasses with KOReader-sync progress (works with Readest).

- **Read [SPEC.md](SPEC.md) first.** It is the source of truth: architecture, protocols, position model, milestones (M0-M5) and open questions.
- G2 platform reference: https://github.com/nickustinov/even-g2-notes (check `docs/input-events.md` and `docs/page-lifecycle.md` before wiring input or lifecycle).
- This is a **public open-source repo (MIT)**. Never commit server origins, usernames, passwords, tokens or homelab hostnames/IPs. Those go in `.env.local` / `app.local.json` (gitignored). A gitleaks pre-commit hook runs on every commit; don't bypass it.
- Don't copy code from `chortya/epub-reader-g2` (all rights reserved). Ideas only.
- Work milestone by milestone; resolve SPEC §11 open questions as early as they block something, and record answers in SPEC.md.
