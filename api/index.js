const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

let addonRouter = null;
let initError = null;

try {
    const { addonBuilder, getRouter } = require("stremio-addon-sdk");
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

    addonRouter = getRouter(builder.getInterface());
} catch (err) {
    initError = err;
    console.error("Init Error:", err);
}

app.get("/", (req, res) => {
    if (initError) {
        return res.status(500).json({ error: initError.message, stack: initError.stack });
    }
    res.redirect("/manifest.json");
});

app.use((req, res, next) => {
    if (initError) {
        return res.status(500).json({ error: initError.message, stack: initError.stack });
    }
    addonRouter(req, res, next);
});

module.exports = app;
