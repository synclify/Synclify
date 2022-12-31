<img src="https://user-images.githubusercontent.com/25244986/209296944-cbc49344-3b1a-4010-a467-551ea9caa541.jpg"/>

<h2 align="center">openW2G</h2>
<p align="center"><a rel="noreferrer noopener" href="https://chrome.google.com/webstore/detail/openw2g/okdfcljlaacbdacenfeaiekllplonlfm/"><img alt="Chrome Web Store" src="https://img.shields.io/badge/Chrome-141e24.svg?&style=for-the-badge&logo=google-chrome&logoColor=white"></a>  <a rel="noreferrer noopener" href="https://addons.mozilla.org/firefox/addon/openw2g/"><img alt="Firefox Add-ons" src="https://img.shields.io/badge/Firefox-141e24.svg?&style=for-the-badge&logo=firefox-browser&logoColor=white"></a>  <a rel="noreferrer noopener" href="https://microsoftedge.microsoft.com/addons/detail/openw2g/chbmaekcnddeekhpcdefmmalilcinjne"><img alt="Edge Addons" src="https://img.shields.io/badge/Edge-141e24.svg?&style=for-the-badge&logo=microsoft-edge&logoColor=white"></a> 
<p align="center">The aim of openW2G is to enable two users to sync any kind of streaming service playback by simply sharing a room code similar to how <a href="https://w2g.tv">w2g.tv</a> works.
openW2G is an ad-free open-source browser extension that syncs user's clicks in their browser through a websocket.<br/>
<strong>The project is currently in early development so bugs are to be expected.</strong></p>

## How to contribute

Read more about contributing to openW2G in [CONTRIBUTING.md](https://github.com/openW2G/openW2G/blob/master/CONTRIBUTING.md).

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

Logo branding by [Victor Adetona](https://www.behance.net/victoradetona)
