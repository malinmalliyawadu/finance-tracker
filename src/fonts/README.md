# Fonts

Self-hosted copies of the three families the app uses, loaded through
`next/font/local` in `src/app/layout.tsx`.

They live here rather than coming from `next/font/google` because that helper
downloads the files while `next build` runs, which put fonts.gstatic.com on the
critical path of every production build. A blocked or flaky fetch from inside
the Docker builder failed the build outright - there is no fallback to a system
face, the build just stops. Committing the files takes ~98 KB and removes the
network from the build entirely.

Each file is the **latin** subset only, matching what the app asked Google for
before, in `woff2` only, which every browser the app supports has handled for
years.

| File | Family | Weights |
| --- | --- | --- |
| `bricolage-grotesque-latin-600-700.woff2` | Bricolage Grotesque | variable, 600-700 |
| `public-sans-latin-400-700.woff2` | Public Sans | variable, 100-900 |
| `ibm-plex-mono-latin-{400,500,600}.woff2` | IBM Plex Mono | 400, 500, 600 (static) |

Bricolage Grotesque and Public Sans are variable fonts, so one file covers the
whole weight range the app declares. IBM Plex Mono has no variable cut on Google
Fonts, hence the three static files.

Licensing: all three are under the SIL Open Font License 1.1, which permits
bundling them like this. See `LICENSE.txt`.

## Refreshing them

Ask the Google Fonts CSS API for the family, with a browser user agent so it
serves `woff2`, then pull the URL from the `/* latin */` block:

```bash
curl -s -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36" \
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600..700"
```

Note the `wght@600..700` range: asking for the full `200..800` range returns a
131 KB file instead of a 41 KB one, for weights nothing renders. If the app
starts using a weight outside a file's range, widen the range here and update
the `weight` string in `layout.tsx` to match - a weight outside the declared
range gets synthesised by the browser and looks wrong.
