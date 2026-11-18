const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const { getCatalog, getMeta, getStreams } = require("./scraper");

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

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ type, id }) => {
    if (type === "series" && id === "hp_turkish_series") {
        const metas = await getCatalog();
        return { metas };
    }
    return { metas: [] };
});

builder.defineMetaHandler(async ({ type, id }) => {
    if (type === "series" && id.startsWith("hp_")) {
        const meta = await getMeta(id);
        return { meta };
    }
    return { meta: null };
});

builder.defineStreamHandler(async ({ type, id }) => {
    if (type === "series" && id.startsWith("hp_")) {
        const streams = await getStreams(id);
        return { streams };
    }
    return { streams: [] };
});

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });

process.on("uncaughtException", (err) => {
    console.error("Prevented crash:", err.message);
});
process.on("unhandledRejection", (reason) => {
    console.error("Prevented promise crash:", reason);
});

