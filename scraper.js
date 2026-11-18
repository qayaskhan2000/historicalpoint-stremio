const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://historicalpoint.com";

// Configure axios with a browser User-Agent to avoid basic blocks
const client = axios.create({
    baseURL: BASE_URL,
    headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    },
    timeout: 10000
});

// List of main series hub pages on Historical Point
const SERIES_LIST = [
    { slug: "kurulus-osman", title: "Kurulus Osman" },
    { slug: "kurulus-orhan-urdu-subtitles", title: "Kurulus Orhan" },
    { slug: "sultan-muhammad-fateh-in-urdu-subtitles", title: "Sultan Muhammad Fateh" },
    { slug: "teskilat-season-best-shadow-team", title: "Teskilat" },
    { slug: "salahuddin-ayyubi-in-urdu-subtitles", title: "Salahuddin Ayyubi" },
    { slug: "vefa-sultan-urdu-subtitles", title: "Vefa Sultan" },
    { slug: "ask-ve-taht-urdu-subtitles", title: "Ask ve Taht (Ishq or Takht)" },
    { slug: "the-great-seljuk-in-urdu-subtitles", title: "The Great Seljuk" },
    { slug: "alp-arslan-buyuk-selcuklu", title: "Alp Arslan" },
    { slug: "ibn-i-sina-in-urdu-subtitles", title: "Ibn i Sina" }
];

// Helper: Encode/Decode URLs safely for Stremio IDs
const encodeId = (url) => "hp_" + Buffer.from(url).toString("base64url");
const decodeId = (id) => Buffer.from(id.replace("hp_", ""), "base64url").toString("utf8");

/**
 * 1. CATALOG SCRAPER
 * Fetches poster and description for each series from its OpenGraph meta tags
 */
async function getCatalog() {
    const metas = await Promise.all(
        SERIES_LIST.map(async (series) => {
            const pageUrl = `${BASE_URL}/${series.slug}/`;
            try {
                const { data } = await client.get(`/${series.slug}/`);
                const $ = cheerio.load(data);

                const poster = $('meta[property="og:image"]').attr("content") || "";
                const description = $('meta[property="og:description"]').attr("content") || "";

                return {
                    id: encodeId(pageUrl),
                    type: "series",
                    name: series.title,
                    poster: poster,
                    description: description
                };
            } catch (err) {
                // Fallback if a page fails to load
                return {
                    id: encodeId(pageUrl),
                    type: "series",
                    name: series.title
                };
            }
        })
    );

    return metas;
}

/**
 * 2. META & EPISODES SCRAPER
 * Extracts all episode links, season numbers, and episode numbers from a series page
 */
async function getMeta(seriesId) {
    const seriesUrl = decodeId(seriesId);
    const { data } = await client.get(seriesUrl);
    const $ = cheerio.load(data);

    const title = $("h1").first().text().trim() || $('meta[property="og:title"]').attr("content");
    const poster = $('meta[property="og:image"]').attr("content") || "";
    const description = $('meta[property="og:description"]').attr("content") || "";

    const videos = [];
    const seenUrls = new Set();

    // Scan links inside the main article/post content
    $(".entry-content a, article a").each((_, el) => {
        const href = $(el).attr("href");
        const linkText = $(el).text().trim();

        if (!href || !href.includes("historicalpoint.com") || seenUrls.has(href)) return;

        // Match links containing "Episode X" in text or "episode-X" in URL
        const epMatch = linkText.match(/Episode\s*(\d+)/i) || href.match(/episode-(\d+)/i);
        if (epMatch) {
            seenUrls.add(href);

            const episodeNum = parseInt(epMatch[1], 10);
            const seasonMatch = linkText.match(/Season\s*(\d+)/i) || href.match(/season-(\d+)/i);
            const seasonNum = seasonMatch ? parseInt(seasonMatch[1], 10) : 1;

            videos.push({
                id: encodeId(href),
                title: linkText || `Episode ${episodeNum}`,
                season: seasonNum,
                episode: episodeNum,
                released: new Date().toISOString()
            });
        }
    });

    // Sort episodes in ascending order
    videos.sort((a, b) => (a.season - b.season) || (a.episode - b.episode));

    return {
        id: seriesId,
        type: "series",
        name: title,
        poster: poster,
        background: poster,
        description: description,
        videos: videos
    };
}

/**
 * 3. STREAM SCRAPER (With Direct Stream Extraction & Logs)
 */
async function getStreams(episodeId) {
    const episodeUrl = decodeId(episodeId);
    console.log("\n[Stream Request] Fetching episode page:", episodeUrl);

    try {
        const { data } = await client.get(episodeUrl);
        const $ = cheerio.load(data);
        const streams = [];

        // Collect all iframes and video links on the episode page
        const iframeUrls = [];
        $("iframe").each((_, el) => {
            let src = $(el).attr("src") || $(el).attr("data-src") || $(el).attr("data-lazy-src");
            if (!src) return;
            if (src.startsWith("//")) src = "https:" + src;
            if (!/google|facebook|ads|doubleclick/i.test(src)) {
                iframeUrls.push(src);
            }
        });

        console.log("[Stream Request] Found iframes:", iframeUrls);

        // Try extracting direct playable .mp4 / .m3u8 links from each iframe
        for (let i = 0; i < iframeUrls.length; i++) {
            const iframeUrl = iframeUrls[i];

            try {
                // Handle Mail.ru embeds (very common on Historical Point)
                if (iframeUrl.includes("mail.ru")) {
                    const metaUrl = iframeUrl.replace("/video/embed/", "/+/video/meta/");
                    const metaRes = await client.get(metaUrl, {
                        headers: { Referer: "https://mail.ru" }
                    });

                    if (metaRes.data && Array.isArray(metaRes.data.videos)) {
                        metaRes.data.videos.forEach((vid) => {
                            let videoUrl = vid.url.startsWith("//") ? "https:" + vid.url : vid.url;
                            streams.push({
                                name: `Historical Point\n${vid.key || "HD"}`,
                                title: `Direct Stream (${vid.key || "MP4"}) - Plays in Stremio`,
                                url: videoUrl,
                                behaviorHints: {
                                    notWebReady: false
                                }
                            });
                        });
                        continue;
                    }
                }

                // Generic scan inside iframe HTML for raw .m3u8 or .mp4 links
                const iframeRes = await client.get(iframeUrl, {
                    headers: { Referer: episodeUrl }
                });
                const rawMatches = iframeRes.data.match(/https?:\/\/[^"'\s\\]+\.(?:m3u8|mp4)[^"'\s\\]*/g);

                if (rawMatches && rawMatches.length > 0) {
                    const uniqueLinks = [...new Set(rawMatches)];
                    uniqueLinks.forEach((directUrl, idx) => {
                        streams.push({
                            name: "Historical Point",
                            title: `Direct Player ${idx + 1} (In-App)`,
                            url: directUrl.replace(/\\u0026/g, "&")
                        });
                    });
                    continue;
                }
            } catch (embedErr) {
                console.log("[Stream Request] Could not resolve direct stream from:", iframeUrl);
            }

            // Fallback: Open the embed player in an external browser if encrypted
            streams.push({
                name: "Historical Point",
                title: `Server ${i + 1} (Opens in Browser)`,
                externalUrl: iframeUrl
            });
        }

        // Fallback if no iframes were found at all
        if (streams.length === 0) {
            console.log("[Stream Request] No iframes matched, returning webpage fallback.");
            streams.push({
                name: "Historical Point",
                title: "Watch on Website (Browser)",
                externalUrl: episodeUrl
            });
        }

        console.log(`[Stream Request] Returning ${streams.length} stream(s) to Stremio.`);
        return streams;

    } catch (err) {
        console.error("[Stream Error]", err.message);
        return [
            {
                name: "Historical Point",
                title: "Open Episode Page in Browser",
                externalUrl: episodeUrl
            }
        ];
    }
}
