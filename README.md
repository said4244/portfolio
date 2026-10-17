# portfolio

Source of **[portfolio.offsecsaid.com](https://portfolio.offsecsaid.com)**, my offensive-security portfolio and writeup blog (Dutch/English).

Built with [Astro](https://astro.build) as a fully static site: no server, no database, minimal attack surface. Deployed on Cloudflare Pages; every push to `main` goes live.

## Features

- **Bilingual (NL/EN)** pages and writeups
- **Writeups as Markdown** in `src/content/writeups/`, with categories, tags, difficulty and filters generated automatically
- **Git-based CMS** ([Sveltia](https://github.com/sveltia/sveltia-cms)) at `/admin` that commits straight to this repo
- **Security headers** via `public/_headers`: strict CSP, HSTS, `X-Frame-Options: DENY`, locked-down permissions policy, with a separate, scoped CSP for `/admin` only
- **SEO**: sitemap, `robots.txt`, canonical/OpenGraph tags, Person JSON-LD

## Project structure

```
src/
  content/writeups/   Markdown writeups (one file = one writeup)
  data/               home, projects, certs and arsenal content (JSON)
  layouts/            base layout
  pages/              home page and writeup routes
  styles/             global CSS
public/
  _headers            Cloudflare Pages security headers
  admin/              Sveltia CMS
  media/              images for writeups and projects
```

## Running locally

```bash
npm install
npm run dev       # dev server on http://localhost:4321
npm run build     # static build into dist/
npm run preview   # preview the build
```

### Editing content with the CMS

With the dev server running, open `http://localhost:4321/admin` in Chrome, click **Work with Local Repository** and select this folder. No login needed.

## Writing a writeup

Add a Markdown file to `src/content/writeups/` with this frontmatter:

```yaml
---
title: "Titel"
title_en: "Title"
description: "Korte samenvatting"
description_en: "Short summary"
date: 2026-01-01
category: ["web"]
tags: ["sqli"]
difficulty: medium   # instap | medium | hard | pro-lab
readingTime: "10 min"
draft: false
pinned: false
---
```

## Deployment

Cloudflare Pages, connected to this repo:

| Setting          | Value           |
| ---------------- | --------------- |
| Framework        | Astro           |
| Build command    | `npm run build` |
| Output directory | `dist`          |
