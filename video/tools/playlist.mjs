// Puts the uploaded series in a playlist and updates each video's description, straight through the
// YouTube Data API with Neon's sign-in (~/.neon-video/youtube.json and the OAuth client in
// ~/.secrets/neon-youtube-oauth-client.json). Neon's uploader can only add to a playlist at upload time.
//
//   node video/tools/youtube.ts descriptions && node video/tools/playlist.mjs
//
// Idempotent: reuses a playlist with the same title, skips videos already in it, and records the
// playlist id in video/youtube.json under "_playlist".
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const VIDEO = join(import.meta.dirname, "..");
const TITLE = "Git Gud: the complete tour";
const DESCRIPTION = "Every feature of Git Gud, a desktop Git client with a lane-colored commit graph, plus its headless daemon, relay and phone app. 13 episodes, about 30 minutes. https://github.com/joe-lloyd/git-gud";
const API = "https://www.googleapis.com/youtube/v3";

const client = JSON.parse(await readFile(join(homedir(), ".secrets", "neon-youtube-oauth-client.json"), "utf8")).installed;
const token = JSON.parse(await readFile(join(homedir(), ".neon-video", "youtube.json"), "utf8"));
const refreshed = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  body: new URLSearchParams({ client_id: client.client_id, client_secret: client.client_secret, refresh_token: token.refreshToken, grant_type: "refresh_token" }),
});
if (!refreshed.ok) throw new Error(`Token refresh failed: HTTP ${refreshed.status}`);
const { access_token } = await refreshed.json();

async function yt(method, path, body) {
  const response = await fetch(`${API}/${path}`, { method, headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path.split("?")[0]}: HTTP ${response.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

const recordFile = join(VIDEO, "youtube.json");
const record = JSON.parse(await readFile(recordFile, "utf8"));
const episodes = Object.keys(record).filter((k) => !k.startsWith("_")).sort();

// The playlist.
let playlistId = record._playlist?.id;
if (!playlistId) {
  const mine = await yt("GET", "playlists?part=snippet&mine=true&maxResults=50");
  playlistId = mine.items.find((p) => p.snippet.title === TITLE)?.id;
}
if (!playlistId) {
  const created = await yt("POST", "playlists?part=snippet,status", { snippet: { title: TITLE, description: DESCRIPTION }, status: { privacyStatus: "public" } });
  playlistId = created.id;
  console.log(`created playlist ${playlistId}`);
}
record._playlist = { id: playlistId, url: `https://www.youtube.com/playlist?list=${playlistId}` };
await writeFile(recordFile, `${JSON.stringify(record, null, 2)}\n`);

// Its items, in episode order.
const items = await yt("GET", `playlistItems?part=snippet&playlistId=${playlistId}&maxResults=50`);
const present = new Set(items.items.map((i) => i.snippet.resourceId.videoId));
for (const [position, id] of episodes.entries()) {
  const videoId = record[id].videoId;
  if (present.has(videoId)) continue;
  await yt("POST", "playlistItems?part=snippet", { snippet: { playlistId, position, resourceId: { kind: "youtube#video", videoId } } });
  console.log(`added ${id}`);
}

// Descriptions, now that every Previous and Next video has an id.
const descriptions = JSON.parse(await readFile(join(VIDEO, "build", "youtube", "descriptions.json"), "utf8"));
for (const [videoId, description] of Object.entries(descriptions)) {
  const current = (await yt("GET", `videos?part=snippet&id=${videoId}`)).items[0];
  if (!current) throw new Error(`No video ${videoId}`);
  const withPlaylist = `${description}\n\nThe whole series: ${record._playlist.url}`;
  if (current.snippet.description === withPlaylist) continue;
  const { title, categoryId, tags, defaultLanguage } = current.snippet;
  await yt("PUT", "videos?part=snippet", { id: videoId, snippet: { title, categoryId, tags, defaultLanguage, description: withPlaylist } });
  console.log(`description ${videoId}`);
}
console.log(record._playlist.url);
