/* ============================================================
   GET /api/playlist  (Vercel serverless function)

   Reads the "Dev Showcase" YouTube playlist and returns every
   video in it, in playlist order:
     { playlistId, videos: [{ youtubeId, title, description }] }

   The playlist page is read directly instead of the RSS feed,
   because RSS leaves out unlisted videos. No API key needed.

   Vercel's CDN caches the response for 5 minutes and keeps
   serving the last good copy while it refreshes, so a new
   upload shows up on the site within a few minutes.
   ============================================================ */

const PLAYLIST_ID = 'PLAUZVmhHqmnM';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  // skips the EU cookie-consent interstitial
  'Cookie': 'SOCS=CAI; CONSENT=YES+'
};

async function getText(url, timeoutMs){
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
  if(!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

function initialData(html){
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if(!m) throw new Error('ytInitialData not found on playlist page');
  return JSON.parse(m[1]);
}

// YouTube has shipped two shapes for playlist rows; accept either
function collectVideos(node, out, seen){
  if(Array.isArray(node)){ node.forEach(n => collectVideos(n, out, seen)); return; }
  if(!node || typeof node !== 'object') return;

  const lockup = node.lockupViewModel;
  if(lockup && lockup.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO'){
    const title = lockup.metadata?.lockupMetadataViewModel?.title?.content || '';
    add(lockup.contentId, title);
  }
  const row = node.playlistVideoRenderer;
  if(row){
    const title = row.title?.runs?.[0]?.text || row.title?.simpleText || '';
    add(row.videoId, title);
  }
  for(const key in node) collectVideos(node[key], out, seen);

  function add(id, title){
    if(!id || seen.has(id)) return;
    if(/^\[(private|deleted) video\]$/i.test(title)) return;
    seen.add(id);
    out.push({ youtubeId: id, title, description: '' });
  }
}

function findDescription(text){
  const m = text.match(/"attributedDescription":\{"content":"((?:[^"\\]|\\.)*)"/)
         || text.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
  return m ? JSON.parse(`"${m[1]}"`) : null;
}

// YouTube serves cloud servers a watch page without the player data, so ask
// the endpoint behind the watch page's description box first
async function fetchDescription(id){
  const sources = [
    async () => {
      const res = await fetch('https://www.youtube.com/youtubei/v1/next?prettyPrint=false', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, HEADERS),
        body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'en' } }, videoId: id }),
        signal: AbortSignal.timeout(6000)
      });
      if(!res.ok) throw new Error(`next -> HTTP ${res.status}`);
      return res.text();
    },
    () => getText(`https://www.youtube.com/watch?v=${id}`, 6000)
  ];
  for(const source of sources){
    try{
      const desc = findDescription(await source());
      if(desc !== null) return desc;
    }catch(e){ /* try the next source */ }
  }
  return ''; // a missing description shouldn't drop the video
}

module.exports = async (req, res) => {
  try{
    const html = await getText(`https://www.youtube.com/playlist?list=${PLAYLIST_ID}`, 8000);
    const videos = [];
    collectVideos(initialData(html), videos, new Set());
    if(!videos.length) throw new Error('playlist page parsed but no videos found');

    await Promise.all(videos.map(async v => { v.description = await fetchDescription(v.youtubeId); }));

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400');
    res.status(200).json({ playlistId: PLAYLIST_ID, videos });
  }catch(err){
    // the page falls back to its built-in list when this fails
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: String(err && err.message || err) });
  }
};
