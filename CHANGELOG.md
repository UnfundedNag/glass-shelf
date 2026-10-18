# Changelog

## Unreleased

- M1: verified on real G2 glasses against Calibre-Web-Automated. phone settings page with connection test and search ("Send to glasses"), OPDS client and parser (Calibre-Web feeds, pagination, kepub filtering), glasses library list with "Continue", EPUB download with a 3-book IndexedDB cache. Settings live in Even bridge storage; the password is kept only as the Basic credential and kosync md5 key.

- M0 scaffold: Vite + TypeScript + Even Hub SDK 0.0.16, "Hello" glasses page, input gesture mapping, per-build manifest generation (`SERVER_ORIGIN`), CI that tests, builds and packs `.ehpk`.
