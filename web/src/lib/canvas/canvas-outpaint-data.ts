import type { CanvasOutpaintDirection, CanvasOutpaintMode } from "@/types/canvas";

export type DownwardOutpaintParams = {
    mode?: CanvasOutpaintMode;
    direction?: CanvasOutpaintDirection;
    extensionRatio: number;
    seamOverlapPixels: number;
    sourceScale?: number;
    maxTargetHeight?: number;
    maxTargetWidth?: number;
};

export type DownwardOutpaintGeometry = {
    mode: CanvasOutpaintMode;
    direction: CanvasOutpaintDirection;
    sourceWidth: number;
    sourceHeight: number;
    targetWidth: number;
    targetHeight: number;
    extensionPixels: number;
    seamOverlapPixels: number;
    sourceScale: number;
    sourceOffsetX: number;
    sourceOffsetY: number;
    sourceDrawWidth: number;
    sourceDrawHeight: number;
};

export type DownwardOutpaintPrepared = DownwardOutpaintGeometry & {
    baseDataUrl: string;
    maskDataUrl: string;
};

const DEFAULT_MAX_TARGET_HEIGHT = 2560;
const DEFAULT_MAX_TARGET_WIDTH = 2560;

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

function roundUp(value: number, step: number) {
    return Math.ceil(value / step) * step;
}

export function fullBodyPortraitAspect(extensionRatio: number) {
    // full_body 不再按“源图高度+延伸”算，而是直接选适合全身入镜的竖图比例。
    // 过长（≈2:1）会把头裁掉或把腿拉长；默认压在 1.5~1.75。
    const ratio = clamp(extensionRatio, 0.5, 1.25);
    if (ratio <= 0.8) return 1.5; // 标准全身
    if (ratio <= 1.05) return 1.65; // 舒展全身
    return 1.75; // 长幅上限
}

/** 面板默认提示词：全身重构（软参考重生成） */
export const FULL_BODY_DEFAULT_PROMPT =
    "尽量保持同一个角色的脸型、五官、发型、发色和服装气质，广角远景全身立绘，完整看见从头到脚，直立站立，头部竖直不低头，正视镜头，面部完整清晰可见，双手自然背在身后，完整全身入镜，画面无裁切、无畸变。注意：本模式是软参考重生成，不保证像素级锁脸。";

/** 面板默认提示词：原图续接各方向（像素锁定，只生成新增区域） */
export const EXTEND_DEFAULT_PROMPT_BY_DIRECTION: Record<CanvasOutpaintDirection, string> = {
    outward: "保持同一个角色和画面构图不变，自然向四周扩展背景与边缘内容，原图主体位置不动，接缝无痕，透视、光线和材质保持一致。",
    // 与引擎侧 up 默认词对齐：头已完整时只续场景，不主动写头部/发型/上半身，避免空白区再长实体
    up: "保持同一个角色和画面构图不变，自然向上延续墙面、天花板、天空或建筑等上方背景，头顶上方保持干净留白/场景空间，不要新增饰品或第二个人，接缝无痕，透视、光线和材质保持一致。",
    down: "保持同一个角色和画面构图完全不变，原图非接缝区域像素锁定，在当前新增画幅内自然向下延续可见服装、身体与背景，接缝无痕，透视、光线、材质和配色保持一致。需要完整头脚入镜时请使用全身重构。",
    left: "保持同一个角色和画面构图不变，自然向左扩展身体与背景，接缝无痕，透视、光线和材质保持一致。",
    right: "保持同一个角色和画面构图不变，自然向右扩展身体与背景，接缝无痕，透视、光线和材质保持一致。",
};

/** 判断用户是否改过面板默认提示词（未改动=只用引擎默认词，不做翻译合并） */
export function isDefaultOutpaintPrompt(prompt: string, mode: CanvasOutpaintMode, direction?: CanvasOutpaintDirection | string | null) {
    const trimmed = (prompt || "").trim();
    if (!trimmed) return true;
    if (mode === "full_body") return trimmed === FULL_BODY_DEFAULT_PROMPT;
    return trimmed === EXTEND_DEFAULT_PROMPT_BY_DIRECTION[normalizeOutpaintDirection(direction)];
}

export function normalizeOutpaintDirection(direction?: CanvasOutpaintDirection | string | null): CanvasOutpaintDirection {
    if (direction === "up" || direction === "left" || direction === "right" || direction === "down" || direction === "outward") return direction;
    return "down";
}


/** 近景/半身用「向下续接」冲到全身竖图时的建议延伸比例（相对源图高度）。 */
export function extendToFullBodyRatio(sourceWidth: number, sourceHeight: number, targetAspect = 1.55) {
    const aspect = Math.max(1.45, Math.min(1.75, targetAspect));
    const targetHeight = Math.max(sourceHeight + 128, Math.round(sourceWidth * aspect));
    // 对齐 64 后实际高度可能略高，这里用目标高估延伸比例
    const roundedTarget = Math.ceil(targetHeight / 64) * 64;
    const extension = Math.max(128, roundedTarget - sourceHeight);
    const ratio = extension / Math.max(1, sourceHeight);
    return Math.min(1.5, Math.max(0.35, Number(ratio.toFixed(3))));
}

/**
 * 产品默认：完整锁人优先原图续接。
 * 全身重构是 soft 重生成，只在用户主动要「姿势/构图自由重写」时使用。
 */
export function suggestOutpaintMode(sourceWidth: number, sourceHeight: number): CanvasOutpaintMode {
    if (!sourceWidth || !sourceHeight) return "extend";
    // 任意源图默认推荐像素锁定续接；近景/半身也优先向下续接成全身，而不是 EmptyLatent 重生成。
    return "extend";
}

export function suggestOutpaintDirection(sourceWidth: number, sourceHeight: number): CanvasOutpaintDirection {
    if (!sourceWidth || !sourceHeight) return "down";
    const aspect = sourceHeight / sourceWidth;
    // 很矮的图（头像/半身）默认向下补全身；已经足够高的图默认一键外扩更稳。
    if (aspect < 1.35) return "down";
    return "outward";
}

/** 边缘垫图条带：近缝保留结构，大延伸时略加宽，避免只靠 96px 模糊条硬撑复杂背景。 */
export function edgeBandPixels(sourceDim: number, extensionPixels: number) {
    const base = Math.min(128, Math.max(64, Math.round(sourceDim * 0.12)));
    const byExtension = Math.min(160, Math.max(64, Math.round(extensionPixels * 0.28)));
    return Math.min(sourceDim, Math.max(base, byExtension));
}

/** 近缝结构只能覆盖 seam 附近，不能随整个扩展区尺寸一起放大。 */
export function nearEdgeStructurePixels(seamOverlapPixels: number, padWidth: number, padHeight: number) {
    const padSpan = Math.max(1, Math.min(padWidth, padHeight));
    return Math.min(padSpan, Math.max(24, Math.round(seamOverlapPixels)));
}

/**
 * 扩展区远端均值取色：去掉高饱和“发梢青绿”等离群点，避免垫图把青发色拉成整片绿色服装。
 * pixels 为 RGB 三元组；返回 [r,g,b] 整数。
 */
export function computeRobustMeanRgb(
    pixels: Array<[number, number, number]> | ArrayLike<number>,
    options?: { excludeGreenDominance?: number; maxSamples?: number },
): [number, number, number] {
    const excludeDom = options?.excludeGreenDominance ?? 18;
    const maxSamples = options?.maxSamples ?? 4000;
    const samples: Array<[number, number, number]> = [];
    if (Array.isArray(pixels) && pixels.length && Array.isArray((pixels as any)[0])) {
        const arr = pixels as Array<[number, number, number]>;
        const step = Math.max(1, Math.floor(arr.length / maxSamples));
        for (let i = 0; i < arr.length; i += step) samples.push(arr[i]);
    } else {
        const flat = pixels as ArrayLike<number>;
        const count = Math.floor(flat.length / 3);
        const step = Math.max(1, Math.floor(count / maxSamples));
        for (let i = 0; i < count; i += step) {
            const o = i * 3;
            samples.push([flat[o], flat[o + 1], flat[o + 2]]);
        }
    }
    if (!samples.length) return [128, 128, 128];
    const filtered = samples.filter(([r, g, b]) => g - (r + b) / 2 < excludeDom);
    // 只要滤后仍保留足够样本（至少 3 个，或原样本 15%），就用稳健均值；样本太少时回退全量。
    const minKeep = Math.min(3, samples.length);
    const use = filtered.length >= Math.max(minKeep, Math.floor(samples.length * 0.15)) ? filtered : samples;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (const [r, g, b] of use) {
        sr += r;
        sg += g;
        sb += b;
    }
    const n = use.length;
    return [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)];
}

/**
 * 方向相关默认融合宽度。
 * 向上/左右常碰到发丝与场景硬缝，默认比向下略宽，仍受 geometry clamp 约束。
 */
export function defaultSeamOverlapForDirection(direction?: CanvasOutpaintDirection | string | null) {
    const dir = normalizeOutpaintDirection(direction);
    if (dir === "up" || dir === "left" || dir === "right") return 112;
    if (dir === "outward") return 104;
    return 96;
}


export function calculateDownwardOutpaintGeometry(sourceWidth: number, sourceHeight: number, params: DownwardOutpaintParams): DownwardOutpaintGeometry {
    const mode = params.mode || "extend";
    const direction = mode === "full_body" ? "down" : normalizeOutpaintDirection(params.direction);
    const seamOverlapPixels = Math.round(clamp(params.seamOverlapPixels, 16, Math.min(192, Math.max(16, Math.min(sourceWidth, sourceHeight) / 3))));
    // full_body 现走构图优先全身重生成，几何字段仅用于输出尺寸；保留兼容字段
    const sourceScale = mode === "full_body" ? clamp(params.sourceScale || 0.58, 0.45, 0.78) : 1;
    const sourceDrawWidth = Math.round(sourceWidth * sourceScale);
    const sourceDrawHeight = Math.round(sourceHeight * sourceScale);

    if (mode === "full_body") {
        const aspect = fullBodyPortraitAspect(params.extensionRatio);
        const maxTargetHeight = Math.min(params.maxTargetHeight || DEFAULT_MAX_TARGET_HEIGHT, roundUp(sourceWidth * 1.75, 64));
        let targetHeight = roundUp(sourceWidth * aspect, 64);
        targetHeight = Math.min(maxTargetHeight, Math.max(targetHeight, roundUp(sourceHeight + 64, 64)));
        // 近景头像源图高度≈宽度时，至少保证比源图更高，给全身构图空间
        if (targetHeight <= sourceHeight) {
            targetHeight = Math.min(maxTargetHeight, roundUp(Math.max(sourceHeight + 256, sourceWidth * 1.5), 64));
        }
        if (targetHeight - sourceHeight < 64 && targetHeight >= maxTargetHeight) {
            throw new Error("原图高度已达到全身重构画幅上限，请改用原图续接或缩小源图");
        }
        const targetWidth = sourceWidth;
        const extensionPixels = Math.max(0, targetHeight - sourceHeight);
        const sourceOffsetX = Math.round((targetWidth - sourceDrawWidth) / 2);
        const sourceOffsetY = Math.min(96, Math.max(32, Math.round(targetHeight * 0.04)));
        return {
            mode,
            direction: "down",
            sourceWidth,
            sourceHeight,
            targetWidth,
            targetHeight,
            extensionPixels,
            seamOverlapPixels,
            sourceScale,
            sourceOffsetX,
            sourceOffsetY,
            sourceDrawWidth,
            sourceDrawHeight,
        };
    }

    if (direction === "outward") {
        // 一键外扩：四边同时加画布，原图居中像素锁定；extensionRatio 按宽/高各自增长比例。
        const maxTargetWidth = Math.max(sourceWidth + 128, Math.min(params.maxTargetWidth || DEFAULT_MAX_TARGET_WIDTH, DEFAULT_MAX_TARGET_WIDTH));
        const maxTargetHeight = Math.max(sourceHeight + 128, Math.min(params.maxTargetHeight || DEFAULT_MAX_TARGET_HEIGHT, DEFAULT_MAX_TARGET_HEIGHT));
        const ratio = clamp(params.extensionRatio, 0.2, 1.5);
        let totalExtW = Math.max(128, Math.round(sourceWidth * ratio));
        let totalExtH = Math.max(128, Math.round(sourceHeight * ratio));
        let targetWidth = Math.min(maxTargetWidth, roundUp(sourceWidth + totalExtW, 64));
        let targetHeight = Math.min(maxTargetHeight, roundUp(sourceHeight + totalExtH, 64));
        totalExtW = targetWidth - sourceWidth;
        totalExtH = targetHeight - sourceHeight;
        if (totalExtW < 64 || totalExtH < 64) {
            throw new Error("原图画幅已接近外扩上限，请缩小源图或改用单方向续接");
        }
        const sourceOffsetX = Math.floor(totalExtW / 2);
        const sourceOffsetY = Math.floor(totalExtH / 2);
        return {
            mode,
            direction: "outward" as const,
            sourceWidth,
            sourceHeight,
            targetWidth,
            targetHeight,
            extensionPixels: totalExtW + totalExtH,
            seamOverlapPixels,
            sourceScale: 1,
            sourceOffsetX,
            sourceOffsetY,
            sourceDrawWidth: sourceWidth,
            sourceDrawHeight: sourceHeight,
        };
    }

    if (direction === "left" || direction === "right") {
        const maxTargetWidth = Math.max(sourceWidth + 64, Math.min(params.maxTargetWidth || DEFAULT_MAX_TARGET_WIDTH, DEFAULT_MAX_TARGET_WIDTH));
        const requestedExtension = Math.max(64, Math.round(sourceWidth * clamp(params.extensionRatio, 0.2, 1.5)));
        const targetWidth = Math.min(maxTargetWidth, roundUp(sourceWidth + requestedExtension, 64));
        const extensionPixels = targetWidth - sourceWidth;
        if (extensionPixels < 64) throw new Error(direction === "left" ? "原图宽度已达到向左扩图上限" : "原图宽度已达到向右扩图上限");
        return {
            mode,
            direction,
            sourceWidth,
            sourceHeight,
            targetWidth,
            targetHeight: sourceHeight,
            extensionPixels,
            seamOverlapPixels,
            sourceScale: 1,
            sourceOffsetX: direction === "left" ? extensionPixels : 0,
            sourceOffsetY: 0,
            sourceDrawWidth: sourceWidth,
            sourceDrawHeight: sourceHeight,
        };
    }

    const maxTargetHeight = Math.max(sourceHeight + 64, Math.min(params.maxTargetHeight || DEFAULT_MAX_TARGET_HEIGHT, DEFAULT_MAX_TARGET_HEIGHT));
    const requestedExtension = Math.max(64, Math.round(sourceHeight * clamp(params.extensionRatio, 0.2, 1.5)));
    const targetHeight = Math.min(maxTargetHeight, roundUp(sourceHeight + requestedExtension, 64));
    const extensionPixels = targetHeight - sourceHeight;
    if (extensionPixels < 64) throw new Error(direction === "up" ? "原图高度已达到向上扩图上限" : "原图高度已达到向下扩图上限");
    return {
        mode,
        direction,
        sourceWidth,
        sourceHeight,
        targetWidth: sourceWidth,
        targetHeight,
        extensionPixels,
        seamOverlapPixels,
        sourceScale: 1,
        sourceOffsetX: 0,
        sourceOffsetY: direction === "up" ? extensionPixels : 0,
        sourceDrawWidth: sourceWidth,
        sourceDrawHeight: sourceHeight,
    };
}

export async function prepareDownwardOutpaint(dataUrl: string, params: DownwardOutpaintParams): Promise<DownwardOutpaintPrepared> {
    const image = await loadImage(dataUrl);
    const geometry = calculateDownwardOutpaintGeometry(image.naturalWidth || image.width, image.naturalHeight || image.height, params);
    const base = document.createElement("canvas");
    base.width = geometry.targetWidth;
    base.height = geometry.targetHeight;
    const baseContext = base.getContext("2d");
    if (!baseContext) throw new Error("浏览器无法创建扩图画布");

    if (geometry.mode === "full_body") {
        baseContext.fillStyle = "#d8d5cf";
        baseContext.fillRect(0, 0, geometry.targetWidth, geometry.targetHeight);
        const gradient = baseContext.createLinearGradient(0, 0, 0, geometry.targetHeight);
        gradient.addColorStop(0, "rgba(255,255,255,.38)");
        gradient.addColorStop(0.55, "rgba(234,232,226,.18)");
        gradient.addColorStop(1, "rgba(124,117,106,.12)");
        baseContext.fillStyle = gradient;
        baseContext.fillRect(0, 0, geometry.targetWidth, geometry.targetHeight);
        baseContext.drawImage(image, geometry.sourceOffsetX, geometry.sourceOffsetY, geometry.sourceDrawWidth, geometry.sourceDrawHeight);
    } else {
        // 原图贴到偏移位置；扩展区用边缘条带分层铺底：近缝轻模糊保结构，远端再糊并淡到均值色。
        baseContext.drawImage(image, geometry.sourceOffsetX, geometry.sourceOffsetY, geometry.sourceDrawWidth, geometry.sourceDrawHeight);

        const meanColorOf = (sx: number, sy: number, sw: number, sh: number, opts?: { preferCenterX?: boolean }) => {
            const safeW = Math.max(1, Math.round(sw));
            const safeH = Math.max(1, Math.round(sh));
            let sampleX = Math.max(0, Math.round(sx));
            let sampleW = Math.min(safeW, geometry.sourceWidth - sampleX);
            if (opts?.preferCenterX) {
                // 向下续接：优先中段服装/身体，避开左右发梢青绿污染
                sampleW = Math.max(8, Math.round(geometry.sourceWidth * 0.5));
                sampleX = Math.max(0, Math.round((geometry.sourceWidth - sampleW) / 2));
            }
            const sampleY = Math.max(0, Math.round(sy));
            const sampleH = Math.min(safeH, geometry.sourceHeight - sampleY);
            const probe = document.createElement("canvas");
            // 限制采样分辨率，避免大图 getImageData 过重
            const pw = Math.min(64, Math.max(8, sampleW));
            const ph = Math.min(48, Math.max(8, sampleH));
            probe.width = pw;
            probe.height = ph;
            const pctx = probe.getContext("2d", { willReadFrequently: true });
            if (!pctx) return "128,128,128";
            pctx.drawImage(image, sampleX, sampleY, sampleW, sampleH, 0, 0, pw, ph);
            const data = pctx.getImageData(0, 0, pw, ph).data;
            const flat: number[] = [];
            for (let i = 0; i < data.length; i += 4) {
                flat.push(data[i], data[i + 1], data[i + 2]);
            }
            const [r, g, b] = computeRobustMeanRgb(flat);
            return `${r},${g},${b}`;
        };
        const fadeToMean = (x: number, y: number, w: number, h: number, fadeDir: "up" | "down" | "left" | "right", rgb: string, structureKeep = 0) => {
            if (w <= 0 || h <= 0) return;
            const span = fadeDir === "up" || fadeDir === "down" ? h : w;
            // 近缝 structureKeep 比例内保留垫图结构；其后才淡到均值，避免远端被头发/衣纹低频吸引。
            const keep = clamp(structureKeep > 0 ? structureKeep : geometry.seamOverlapPixels / Math.max(1, span), 0.12, 0.72);
            let grad: CanvasGradient;
            if (fadeDir === "up") grad = baseContext.createLinearGradient(0, y + h, 0, y);
            else if (fadeDir === "down") grad = baseContext.createLinearGradient(0, y, 0, y + h);
            else if (fadeDir === "left") grad = baseContext.createLinearGradient(x + w, 0, x, 0);
            else grad = baseContext.createLinearGradient(x, 0, x + w, 0);
            grad.addColorStop(0, `rgba(${rgb},0)`);
            grad.addColorStop(keep, `rgba(${rgb},0)`);
            grad.addColorStop(Math.min(1, keep + 0.22), `rgba(${rgb},0.55)`);
            grad.addColorStop(1, `rgba(${rgb},1)`);
            baseContext.fillStyle = grad;
            baseContext.fillRect(x, y, w, h);
        };
        const paintEdgePad = (
            sx: number,
            sy: number,
            sw: number,
            sh: number,
            dx: number,
            dy: number,
            dw: number,
            dh: number,
            nearBlur: number,
            farBlur: number,
        ) => {
            if (dw <= 0 || dh <= 0 || sw <= 0 || sh <= 0) return;
            // 远层：更糊，给深处一点色相连续，但不保留清晰纹理。
            baseContext.save();
            baseContext.filter = `blur(${farBlur}px)`;
            baseContext.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
            baseContext.restore();
            // 近层：沿接缝再画一遍更清晰的结构条，减少硬缝与发丝断裂感。
            // 旧逻辑按扩展区短边的 42% 计算，1024×640 向下扩图会保留 269px，
            // 把底边青色发丝/衣纹放大成大块 latent；现在严格限制在 seam 宽度附近。
            const nearKeep = nearEdgeStructurePixels(geometry.seamOverlapPixels, dw, dh);
            baseContext.save();
            baseContext.filter = `blur(${nearBlur}px)`;
            if (dh >= dw) {
                // 垂直延伸：靠近原图的一端
                if (geometry.direction === "up" || (geometry.direction === "outward" && dy + dh <= geometry.sourceOffsetY + 1)) {
                    // 向上：近缝在 extension 底部
                    baseContext.drawImage(image, sx, sy, sw, sh, dx, dy + dh - nearKeep, dw, nearKeep);
                } else if (geometry.direction === "down" || (geometry.direction === "outward" && dy >= geometry.sourceOffsetY + geometry.sourceDrawHeight - 1)) {
                    baseContext.drawImage(image, sx, sy, sw, sh, dx, dy, dw, nearKeep);
                } else {
                    baseContext.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
                }
            } else {
                if (geometry.direction === "left" || (geometry.direction === "outward" && dx + dw <= geometry.sourceOffsetX + 1)) {
                    baseContext.drawImage(image, sx, sy, sw, sh, dx + dw - nearKeep, dy, nearKeep, dh);
                } else if (geometry.direction === "right" || (geometry.direction === "outward" && dx >= geometry.sourceOffsetX + geometry.sourceDrawWidth - 1)) {
                    baseContext.drawImage(image, sx, sy, sw, sh, dx, dy, nearKeep, dh);
                } else {
                    baseContext.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
                }
            }
            baseContext.restore();
        };

        const bandH = edgeBandPixels(geometry.sourceHeight, geometry.direction === "outward" ? geometry.sourceOffsetY : geometry.extensionPixels);
        const bandW = edgeBandPixels(geometry.sourceWidth, geometry.direction === "outward" ? geometry.sourceOffsetX : geometry.extensionPixels);
        const nearBlur = geometry.direction === "up" ? 10 : 12;
        const farBlur = geometry.direction === "up" ? 28 : 24;

        if (geometry.direction === "outward") {
            const top = geometry.sourceOffsetY;
            const left = geometry.sourceOffsetX;
            const right = geometry.targetWidth - left - geometry.sourceDrawWidth;
            const bottom = geometry.targetHeight - top - geometry.sourceDrawHeight;
            if (top > 0) paintEdgePad(0, 0, geometry.sourceWidth, bandH, 0, 0, geometry.targetWidth, top, nearBlur, farBlur);
            if (bottom > 0) paintEdgePad(0, geometry.sourceHeight - bandH, geometry.sourceWidth, bandH, 0, top + geometry.sourceDrawHeight, geometry.targetWidth, bottom, nearBlur, farBlur);
            if (left > 0) paintEdgePad(0, 0, bandW, geometry.sourceHeight, 0, top, left, geometry.sourceDrawHeight, nearBlur, farBlur);
            if (right > 0) paintEdgePad(geometry.sourceWidth - bandW, 0, bandW, geometry.sourceHeight, left + geometry.sourceDrawWidth, top, right, geometry.sourceDrawHeight, nearBlur, farBlur);
        } else if (geometry.direction === "down") {
            // 只从中段服装/身体取边缘条，避开左右发梢青绿被整宽拉伸到扩展区。
            // 采样带上移到下半身衣物区（约 55%–78% 高度），底边仅近缝贴一下，远端不吃发梢。
            const centerW = Math.max(8, Math.round(geometry.sourceWidth * 0.5));
            const centerX = Math.max(0, Math.round((geometry.sourceWidth - centerW) / 2));
            const clothBandH = Math.max(24, Math.min(bandH, Math.round(geometry.sourceHeight * 0.18)));
            const clothBandY = Math.max(0, Math.min(geometry.sourceHeight - clothBandH, Math.round(geometry.sourceHeight * 0.62) - Math.floor(clothBandH / 2)));
            paintEdgePad(
                centerX,
                clothBandY,
                centerW,
                clothBandH,
                0,
                geometry.sourceOffsetY + geometry.sourceDrawHeight,
                geometry.targetWidth,
                geometry.extensionPixels,
                nearBlur,
                farBlur,
            );
        } else if (geometry.direction === "up") {
            paintEdgePad(0, 0, geometry.sourceWidth, bandH, 0, 0, geometry.targetWidth, geometry.extensionPixels, nearBlur, farBlur);
        } else if (geometry.direction === "right") {
            paintEdgePad(geometry.sourceWidth - bandW, 0, bandW, geometry.sourceHeight, geometry.sourceOffsetX + geometry.sourceDrawWidth, 0, geometry.extensionPixels, geometry.targetHeight, nearBlur, farBlur);
        } else {
            paintEdgePad(0, 0, bandW, geometry.sourceHeight, 0, 0, geometry.extensionPixels, geometry.targetHeight, nearBlur, farBlur);
        }

        // 远缝段淡出到边带均值色：模糊拉伸条带的低频形状（头发暗块/衣物竖纹）在深处
        // 会被模型当成"第二颗头/装饰带"吸引子；近缝保留条带保证接缝连续，远端只留纯色调。
        // 向下身体续接：远端只保留很窄的结构条，其余用稳健均值色，避免把底边发丝/青发低频拉伸成绿衣。
        // down: 只在近缝保留极窄结构，远端几乎纯服装/肤色均值，避免底边发丝低频把下半身吸成绿衣。
        const structureKeepRatio =
            geometry.direction === "down"
                ? clamp(geometry.seamOverlapPixels / Math.max(1, geometry.extensionPixels || 1), 0.08, 0.18)
                : clamp(geometry.seamOverlapPixels / Math.max(1, geometry.extensionPixels || 1), 0.18, 0.55);
        if (geometry.direction === "outward") {
            const top = geometry.sourceOffsetY;
            const left = geometry.sourceOffsetX;
            const right = geometry.targetWidth - left - geometry.sourceDrawWidth;
            const bottom = geometry.targetHeight - top - geometry.sourceDrawHeight;
            if (top > 0) fadeToMean(0, 0, geometry.targetWidth, top, "up", meanColorOf(0, 0, geometry.sourceWidth, bandH), structureKeepRatio);
            if (bottom > 0) fadeToMean(0, top + geometry.sourceDrawHeight, geometry.targetWidth, bottom, "down", meanColorOf(0, geometry.sourceHeight - bandH, geometry.sourceWidth, bandH), structureKeepRatio);
            if (left > 0) fadeToMean(0, top, left, geometry.sourceDrawHeight, "left", meanColorOf(0, 0, bandW, geometry.sourceHeight), structureKeepRatio);
            if (right > 0) fadeToMean(left + geometry.sourceDrawWidth, top, right, geometry.sourceDrawHeight, "right", meanColorOf(geometry.sourceWidth - bandW, 0, bandW, geometry.sourceHeight), structureKeepRatio);
        } else if (geometry.direction === "down") {
            // 取中段衣物色（避开底边发梢/背景），让远端垫图贴近白衣/肤色而不是青绿发梢。
            const clothBandH = Math.max(24, Math.round(geometry.sourceHeight * 0.18));
            const clothBandY = Math.max(0, Math.round(geometry.sourceHeight * 0.62) - Math.floor(clothBandH / 2));
            fadeToMean(
                0,
                geometry.sourceOffsetY + geometry.sourceDrawHeight,
                geometry.targetWidth,
                geometry.extensionPixels,
                "down",
                meanColorOf(0, clothBandY, geometry.sourceWidth, clothBandH, { preferCenterX: true }),
                structureKeepRatio,
            );
        } else if (geometry.direction === "up") {
            fadeToMean(0, 0, geometry.targetWidth, geometry.extensionPixels, "up", meanColorOf(0, 0, geometry.sourceWidth, bandH), structureKeepRatio);
        } else if (geometry.direction === "right") {
            fadeToMean(geometry.sourceOffsetX + geometry.sourceDrawWidth, 0, geometry.extensionPixels, geometry.targetHeight, "right", meanColorOf(geometry.sourceWidth - bandW, 0, bandW, geometry.sourceHeight), structureKeepRatio);
        } else {
            fadeToMean(0, 0, geometry.extensionPixels, geometry.targetHeight, "left", meanColorOf(0, 0, bandW, geometry.sourceHeight), structureKeepRatio);
        }
    }

    const mask = document.createElement("canvas");
    mask.width = geometry.targetWidth;
    mask.height = geometry.targetHeight;
    const maskContext = mask.getContext("2d");
    if (!maskContext) throw new Error("浏览器无法创建扩图蒙版");
    if (geometry.mode === "full_body") {
        const inset = Math.min(geometry.seamOverlapPixels, Math.floor(Math.min(geometry.sourceDrawWidth, geometry.sourceDrawHeight) / 4));
        const coreX = geometry.sourceOffsetX + inset;
        const coreY = geometry.sourceOffsetY + inset;
        const coreWidth = Math.max(1, geometry.sourceDrawWidth - inset * 2);
        const coreHeight = Math.max(1, geometry.sourceDrawHeight - inset * 2);
        maskContext.save();
        maskContext.globalAlpha = 0.55;
        maskContext.filter = `blur(${Math.max(8, Math.round(inset / 2))}px)`;
        maskContext.fillStyle = "#fff";
        maskContext.fillRect(coreX, coreY, coreWidth, coreHeight);
        maskContext.restore();
        maskContext.fillStyle = "#fff";
        maskContext.fillRect(coreX, coreY, coreWidth, coreHeight);
    } else {
        // 白底=保护；纯扩展区 clear=全量重绘；侵入原图的 seam 带用 alpha 渐变（denoise 软过渡）。
        // 网关会按 alpha 连续映射，不再硬二值化，避免发丝/人物边缘被矩形 seam 整段重画。
        maskContext.fillStyle = "#fff";
        maskContext.fillRect(0, 0, mask.width, mask.height);
        const seam = geometry.seamOverlapPixels;
        const clearExtensionAndSoftSeam = (extX: number, extY: number, extW: number, extH: number, seamDir: "up" | "down" | "left" | "right") => {
            if (extW > 0 && extH > 0) maskContext.clearRect(extX, extY, extW, extH);
            if (seam <= 0) return;
            // 渐变：靠扩展侧 alpha=0（可重绘）→ 深入原图侧 alpha=1（保护）
            let gx0 = 0;
            let gy0 = 0;
            let gx1 = 0;
            let gy1 = 0;
            let rx = 0;
            let ry = 0;
            let rw = 0;
            let rh = 0;
            if (seamDir === "up") {
                // 原图在下方：seam 带在 extension 底边向下侵入 source 顶部
                rx = extX;
                ry = extY + extH;
                rw = extW;
                rh = seam;
                gx0 = 0;
                gy0 = ry;
                gx1 = 0;
                gy1 = ry + rh;
            } else if (seamDir === "down") {
                rx = extX;
                ry = Math.max(0, extY - seam);
                rw = extW;
                rh = Math.min(seam, extY);
                gx0 = 0;
                gy0 = ry + rh;
                gx1 = 0;
                gy1 = ry;
            } else if (seamDir === "left") {
                rx = extX + extW;
                ry = extY;
                rw = seam;
                rh = extH;
                gx0 = rx;
                gy0 = 0;
                gx1 = rx + rw;
                gy1 = 0;
            } else {
                rx = Math.max(0, extX - seam);
                ry = extY;
                rw = Math.min(seam, extX);
                rh = extH;
                gx0 = rx + rw;
                gy0 = 0;
                gx1 = rx;
                gy1 = 0;
            }
            if (rw <= 0 || rh <= 0) return;
            const grad = maskContext.createLinearGradient(gx0, gy0, gx1, gy1);
            // destination-out：白=擦除保护，alpha 越大擦得越多 → 重绘越强
            grad.addColorStop(0, "rgba(255,255,255,1)");
            grad.addColorStop(0.45, "rgba(255,255,255,0.72)");
            grad.addColorStop(0.78, "rgba(255,255,255,0.28)");
            grad.addColorStop(1, "rgba(255,255,255,0)");
            maskContext.save();
            maskContext.globalCompositeOperation = "destination-out";
            maskContext.fillStyle = grad;
            maskContext.fillRect(rx, ry, rw, rh);
            maskContext.restore();
        };

        if (geometry.direction === "outward") {
            const sx = geometry.sourceOffsetX;
            const sy = geometry.sourceOffsetY;
            const sw = geometry.sourceDrawWidth;
            const sh = geometry.sourceDrawHeight;
            const top = sy;
            const left = sx;
            const right = geometry.targetWidth - left - sw;
            const bottom = geometry.targetHeight - top - sh;
            // 纯扩展区硬清；四边向内 seam 用软渐变（角部会被相邻边覆盖，取更强重绘）
            if (top > 0) clearExtensionAndSoftSeam(0, 0, geometry.targetWidth, top, "up");
            if (bottom > 0) clearExtensionAndSoftSeam(0, top + sh, geometry.targetWidth, bottom, "down");
            if (left > 0) clearExtensionAndSoftSeam(0, top, left, sh, "left");
            if (right > 0) clearExtensionAndSoftSeam(left + sw, top, right, sh, "right");
        } else if (geometry.direction === "down") {
            clearExtensionAndSoftSeam(0, geometry.sourceOffsetY + geometry.sourceDrawHeight, geometry.targetWidth, geometry.extensionPixels, "down");
        } else if (geometry.direction === "up") {
            clearExtensionAndSoftSeam(0, 0, geometry.targetWidth, geometry.extensionPixels, "up");
        } else if (geometry.direction === "right") {
            clearExtensionAndSoftSeam(geometry.sourceOffsetX + geometry.sourceDrawWidth, 0, geometry.extensionPixels, geometry.targetHeight, "right");
        } else {
            clearExtensionAndSoftSeam(0, 0, geometry.extensionPixels, geometry.targetHeight, "left");
        }
    }

    return {
        ...geometry,
        baseDataUrl: base.toDataURL("image/png"),
        maskDataUrl: mask.toDataURL("image/png"),
    };
}

function loadImage(dataUrl: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        const timer = window.setTimeout(() => reject(new Error("读取扩图源图片超时")), 15000);
        image.onload = () => {
            window.clearTimeout(timer);
            resolve(image);
        };
        image.onerror = () => {
            window.clearTimeout(timer);
            reject(new Error("读取扩图源图片失败"));
        };
        image.src = dataUrl;
    });
}
