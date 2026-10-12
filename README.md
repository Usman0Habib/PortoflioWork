# PortoflioWork
showcase of projects

The project grid is filled automatically from the YouTube playlist
"Dev Showcase" (`PLAUZVmhHqmnM`). Add, remove or reorder videos in the
playlist and the site follows within about 5 minutes.

- `api/playlist.js` is a Vercel serverless function that reads the playlist
  (including unlisted videos) and returns titles and descriptions.
- `projectDetails` in `index.html` optionally overrides a video's tag, title,
  description or preview points, matched by `youtubeId`.
