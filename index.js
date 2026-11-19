const http = require("http");

const BASE_URL = "https://historicalpoint.com";

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

const manifest = {
    id: "org.historicalpoint.urdu",
    version: "1.0.0",
    name: "Historical Point (Urdu Subtitles)",
    description: "Turkish historical series with Urdu subtitles from HistoricalPoint.com",
    resources: ["catalog", "meta", "stream"],
    types: ["series"],
    idPrefixes: ["hp_"],
    catalogs: [
        {
            type: "series",
            id: "hp_turkish_series",
            name: "Historical Point Series"
        }
    ]
};

function encodeId(url) {
    return "hp_" + Buffer.from(url).toString("base64url");
}

function decodeId(id) {
    return Buffer.from(id.replace("hp_", ""), "base64url").toString("utf8");
}

async function fetchHtml(url) {
    const res = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://historicalpoint.com"
        }
    });
    return await res.text();
}

function extractPoster(html) {
    // 1. Try OpenGraph & Twitter meta tags (any attribute order)
    const metaMatch = html.match(/<meta[^>]+(?:og:image|twitter:image)[^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:og:image|twitter:image)/i);
    if (metaMatch && metaMatch.at(1)) return metaMatch.at(1);

    // 2. Fallback: Find the first WordPress upload image inside the post
    const imgMatch = html.match(/https?:\/\/historicalpoint\.com\/wp-content\/uploads\/[^"'\s)]+\.(?:jpg|jpeg|png|webp)/i);
    return imgMatch ? imgMatch.at(0) : "";
}


function getMetaTag(html, property) {
    const regex = new RegExp("<meta[^>]+(?:property|name)=[\"']" + property + "[\"'][^>]+content=[\"']([^\"']+)[\"']", "i");
    const match = html.match(regex);
    return match ? (match.at(1) || "") : "";
}

async function getCatalog() {
    const metas = await Promise.all(
        SERIES_LIST.map(async (series) => {
            const pageUrl = BASE_URL + "/" + series.slug + "/";
            try {
                const html = await fetchHtml(pageUrl);
                const poster = getMetaTag(html, "og:image");
                const description = getMetaTag(html, "og:description");

                return {
                    id: encodeId(pageUrl),
                    type: "series",
                    name: series.title,
                    poster: poster,
                    description: description
                };
            } catch (e) {
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

async function getMeta(seriesId) {
    const seriesUrl = decodeId(seriesId);
    const html = await fetchHtml(seriesUrl);

    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const title = h1Match ? (h1Match.at(1) || "").replace(/<[^>]+>/g, "").trim() : "Series";
    const poster = getMetaTag(html, "og:image");
    const description = getMetaTag(html, "og:description");

    const videos = [];
    const seenUrls = new Set();

    const linkRegex = /<a[^>]+href=["'](https?:\/\/historicalpoint\.com\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;

    while ((match = linkRegex.exec(html)) !== null) {
        const href = match.at(1);
        const linkText = (match.at(2) || "").replace(/<[^>]+>/g, "").trim();

        if (!href || seenUrls.has(href)) continue;

        const epMatch = linkText.match(/Episode\s*(\d+)/i) || href.match(/episode-(\d+)/i);
        if (epMatch && epMatch.at(1)) {
            seenUrls.add(href);
            const episodeNum = parseInt(epMatch.at(1), 10);
            const seasonMatch = linkText.match(/Season\s*(\d+)/i) || href.match(/season-(\d+)/i);
            const seasonNum = (seasonMatch && seasonMatch.at(1)) ? parseInt(seasonMatch.at(1), 10) : 1;

            videos.push({
                id: encodeId(href),
                title: linkText || ("Episode " + episodeNum),
                season: seasonNum,
                episode: episodeNum,
                released: new Date().toISOString()
            });
        }
    }

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

async function getStreams(episodeId) {
    const episodeUrl = decodeId(episodeId);
    const html = await fetchHtml(episodeUrl);
    const streams = [];

    const iframeRegex = /<iframe[^>]+(?:src|data-src|data-lazy-src)=["']([^"']+)["']/gi;
    let match;
    let index = 1;

    while ((match = iframeRegex.exec(html)) !== null) {
        let src = match.at(1);
        if (!src) continue;
        if (src.startsWith("//")) src = "https:" + src;
        if (/google|facebook|ads|doubleclick/i.test(src)) continue;

        if (src.includes("mail.ru")) {
            try {
                const metaUrl = src.replace("/video/embed/", "/+/video/meta/");
                const metaRes = await fetch(metaUrl, {
                    headers: { Referer: "https://mail.ru" }
                });
                const metaJson = await metaRes.json();

                if (metaJson && Array.isArray(metaJson.videos)) {
                    metaJson.videos.forEach((vid) => {
                        const videoUrl = vid.url.startsWith("//") ? "https:" + vid.url : vid.url;
                        streams.push({
                            name: "Historical Point\n" + (vid.key || "HD"),
                            title: "Direct Stream (" + (vid.key || "MP4") + ") - Plays in Stremio",
                            url: videoUrl
                        });
                    });
                    index++;
                    continue;
                }
            } catch (e) {}
        }

        streams.push({
            name: "Historical Point",
            title: "Server " + index + " (Opens in Browser)",
            externalUrl: src
        });
        index++;
    }

    if (streams.length === 0) {
        streams.push({
            name: "Historical Point",
            title: "Watch on Historical Point (Browser)",
            externalUrl: episodeUrl
        });
    }

    return streams;
}

const PORT = process.env.PORT || 3000;
const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Content-Type", "application/json; charset=utf-8");

    if (req.method === "OPTIONS") {
        res.statusCode = 200;
        return res.end();
    }

    const fullUrl = req.url || "/";
    const pathOnly = fullUrl.split("?").at(0) || "/";
    const urlPath = decodeURIComponent(pathOnly);

    try {
        if (urlPath === "/" || urlPath === "/manifest.json") {
            res.statusCode = 200;
            return res.end(JSON.stringify(manifest));
        }

        if (urlPath.includes("/catalog/series/hp_turkish_series")) {
            const metas = await getCatalog();
            res.statusCode = 200;
            return res.end(JSON.stringify({ metas: metas }));
        }

        if (urlPath.includes("/meta/series/")) {
            const parts = urlPath.split("/meta/series/");
            const id = (parts.at(1) || "").replace(".json", "");
            const meta = await getMeta(id);
            res.statusCode = 200;
            return res.end(JSON.stringify({ meta: meta }));
        }

        if (urlPath.includes("/stream/series/")) {
            const parts = urlPath.split("/stream/series/");
            const id = (parts.at(1) || "").replace(".json", "");
            const streams = await getStreams(id);
            res.statusCode = 200;
            return res.end(JSON.stringify({ streams: streams }));
        }

            res.statusCode = 404;
        return res.end(JSON.stringify({ error: "Not found", path: urlPath }));
    } catch (err) {
        res.statusCode = 500;
        return res.end(JSON.stringify({ error: err.message }));
    }
});

server.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});
  
