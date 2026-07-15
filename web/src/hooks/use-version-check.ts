import { useCallback, useEffect, useMemo, useState } from "react";
import { App } from "antd";
import { APP_VERSION } from "@/constant/env";
import { parseChangelog, type ReleaseInfo } from "@/lib/release";

// raw.githubusercontent.com 在浏览器里常因 CORS/网络失败；优先走带 CORS 的镜像
const VERSION_URLS = [
    "https://cdn.jsdelivr.net/gh/basketikun/infinite-canvas@main/VERSION",
    "https://raw.githubusercontent.com/basketikun/infinite-canvas/main/VERSION",
    "https://cdn.jsdelivr.net/gh/basketikun/infinite-canvas@master/VERSION",
];
const CHANGELOG_URLS = [
    "https://cdn.jsdelivr.net/gh/basketikun/infinite-canvas@main/CHANGELOG.md",
    "https://raw.githubusercontent.com/basketikun/infinite-canvas/main/CHANGELOG.md",
    "https://cdn.jsdelivr.net/gh/basketikun/infinite-canvas@master/CHANGELOG.md",
];

function readLocalReleases(): ReleaseInfo[] {
    return __APP_RELEASES__ || [];
}

function toVersionParts(version: string) {
    const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
    return match ? match.slice(1).map(Number) : null;
}

function isNewerVersion(latestVersion: string, currentVersion: string) {
    const latest = toVersionParts(latestVersion);
    const current = toVersionParts(currentVersion);
    if (!latest || !current) return false;
    return latest.some((value, index) => value > current[index] && latest.slice(0, index).every((part, prevIndex) => part === current[prevIndex]));
}

async function fetchTextFromUrls(urls: string[]) {
    let lastError: unknown;
    for (const url of urls) {
        try {
            const response = await fetch(url, { cache: "no-store" });
            if (!response.ok) {
                lastError = new Error(`${url} -> HTTP ${response.status}`);
                continue;
            }
            const text = (await response.text()).trim();
            if (!text) {
                lastError = new Error(`${url} 返回空内容`);
                continue;
            }
            return text;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError instanceof Error ? lastError : new Error("无法获取远程版本信息");
}

export function useVersionCheck() {
    const currentVersion = APP_VERSION;
    const { message } = App.useApp();
    const localReleases = useMemo(readLocalReleases, []);
    const [latestVersion, setLatestVersion] = useState(currentVersion);
    const [releases, setReleases] = useState<ReleaseInfo[]>(localReleases);
    const [checking, setChecking] = useState(false);
    const [open, setOpen] = useState(false);
    const hasNewVersion = isNewerVersion(latestVersion, currentVersion);

    const checkLatestVersion = useCallback(async () => {
        try {
            const version = await fetchTextFromUrls(VERSION_URLS);
            setLatestVersion(version || currentVersion);
            return true;
        } catch {
            return false;
        }
    }, [currentVersion]);

    const checkLatestRelease = useCallback(
        async (showMessage = false) => {
            setChecking(true);
            try {
                const [version, changelog] = await Promise.all([fetchTextFromUrls(VERSION_URLS), fetchTextFromUrls(CHANGELOG_URLS)]);
                setLatestVersion(version || currentVersion);
                if (changelog) setReleases(parseChangelog(changelog));
                if (showMessage) message.success("已获取最新版本信息");
                return true;
            } catch {
                // 远程失败时至少展示本地打包进来的 changelog，避免弹窗空白
                setLatestVersion(currentVersion);
                setReleases(localReleases);
                if (showMessage) message.error("获取最新版本信息失败（网络或镜像不可用），已显示本地版本记录");
                return false;
            } finally {
                setChecking(false);
            }
        },
        [currentVersion, localReleases, message],
    );

    useEffect(() => {
        void checkLatestVersion();
    }, [checkLatestVersion]);

    const openReleaseModal = useCallback(() => {
        setOpen(true);
        void checkLatestRelease();
    }, [checkLatestRelease]);

    return {
        open,
        setOpen,
        openReleaseModal,
        latestVersion,
        releases,
        checking,
        hasNewVersion,
        checkLatestRelease,
    };
}
