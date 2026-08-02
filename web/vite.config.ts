import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { parseChangelog } from "./src/lib/release";

const webDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(webDir, "../VERSION"), "utf8").trim() || "dev";
const localChangelog = readFileSync(resolve(webDir, "../CHANGELOG.md"), "utf8");

const localReleases = parseChangelog(localChangelog);
const appVersionLiteral = JSON.stringify(localVersion);
const appReleasesLiteral = JSON.stringify(localReleases);

// 暴露 /plugins/index.json:列出 public/plugins 下的本地插件文件,
// 供前端自动发现并加入插件列表(默认关闭)。dev 下实时读目录,构建时产出静态清单。
function localPluginsManifest(): Plugin {
    const pluginsDir = resolve(webDir, "public/plugins");
    const listLocalPlugins = () => {
        try {
            return readdirSync(pluginsDir)
                .filter((file) => file.endsWith(".js"))
                .sort()
                .map((file) => `/plugins/${file}`);
        } catch {
            return [];
        }
    };
    return {
        name: "local-plugins-manifest",
        configureServer(server) {
            server.middlewares.use("/plugins/index.json", (_req, res) => {
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(listLocalPlugins()));
            });
        },
        generateBundle() {
            this.emitFile({ type: "asset", fileName: "plugins/index.json", source: JSON.stringify(listLocalPlugins()) });
        },
    };
}

// Vite 7 dev transform 偶发不替换 define 常量，导致界面仍显示旧 VERSION。
// 用 pre transform 强制写入根目录 VERSION / CHANGELOG 的当前值。
function injectAppMeta(): Plugin {
    return {
        name: "inject-app-meta",
        enforce: "pre",
        transform(code, id) {
            if (id.includes("node_modules") || id.endsWith(".d.ts")) return null;
            if (!code.includes("__APP_VERSION__") && !code.includes("__APP_RELEASES__")) return null;
            return code
                .replace(/\b__APP_VERSION__\b/g, appVersionLiteral)
                .replace(/\b__APP_RELEASES__\b/g, appReleasesLiteral);
        },
    };
}

export default defineConfig({
    base: process.env.VITE_BASE || "/",
    plugins: [injectAppMeta(), react(), localPluginsManifest()],
    resolve: {
        alias: {
            "@": resolve(webDir, "src"),
        },
    },
    define: {
        __APP_VERSION__: appVersionLiteral,
        __APP_RELEASES__: appReleasesLiteral,
    },
});
