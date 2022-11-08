<h2 align="center">watch2gether</h2>

<h2 align="center">openW2G</h2>

<p align="center">The aim of openW2G is to enable two users to sync any kind of streaming service playback by simply sharing a room code similar to how <a href="https://w2g.tv">w2g.tv</a> works.
openW2G is an ad-free open-source browser extension that syncs user's clicks in their browser through a websocket.<br/>
<strong>The project is currently in early development and is not intended to be used in a real world scenario</strong></p>

## How to contribute

Read more about contributing to watch2gether in [CONTRIBUTING.md](https://github.com/andreademasi/watch2gether/blob/main/CONTRIBUTING.md).

## Getting Started

First, run the development server:

```bash
pnpm dev
# or
npm run dev
```

Open your browser and load the appropriate development build. For example, if you are developing for the chrome browser, using manifest v3, use: `build/chrome-mv3-dev`.

For further guidance, [visit the Documentation](https://docs.plasmo.com/)

## Making production build

Run the following:

```bash
pnpm build
# or
npm run build
```

This should create a production bundle, ready to be zipped and published to the stores.
