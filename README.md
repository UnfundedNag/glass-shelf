# Glass Shelf

Read your self-hosted Calibre-Web library on Even Realities G2 glasses, with reading position synced to KOReader-compatible apps such as Readest.

**Status:** early development (M1 done: library browsing; next is M2, the reader). See [SPEC.md](SPEC.md) for the design and roadmap.

## Requirements

- Node.js 20+
- Even App 2.2.10 or newer on your phone (Even Hub SDK 0.0.16)
- A Calibre-Web(-Automated) server the phone can reach over HTTPS, with CORS headers set (details coming in M1)

## Develop

```bash
npm install
npm run dev        # Vite dev server on :5173
npm run simulate   # Even Hub simulator pointed at the dev server
npm test
```

To skip typing settings in the simulator, put `VITE_DEV_SERVER_URL`, `VITE_DEV_SERVER_USER` and `VITE_DEV_SERVER_PASSWORD` in `.env.local` (see `.env.example`). They only apply to `npm run dev`.

To try it on real glasses, run `npx evenhub qr --url http://<your-computer-ip>:5173` and scan the code with the Even App.

## Build your own package

Each self-hoster builds their own `.ehpk`, because the app's network whitelist must name your server.

```bash
cp .env.example .env.local   # then set SERVER_ORIGIN=https://your-server.example
npm run pack                 # writes glass-shelf.ehpk
```

`SERVER_ORIGIN` is only the origin (scheme, host, optional port), with no path. The `.ehpk` built by CI carries a placeholder origin and is only useful as a build check.

## License

MIT. See [LICENSE](LICENSE).
