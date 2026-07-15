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
        // 原图贴到偏移位置；扩展区用边缘条带模糊铺底，方便 inpaint 接缝。
        baseContext.drawImage(image, geometry.sourceOffsetX, geometry.sourceOffsetY, geometry.sourceDrawWidth, geometry.sourceDrawHeight);
        baseContext.save();
        baseContext.filter = "blur(24px)";
        if (geometry.direction === "outward") {
            const top = geometry.sourceOffsetY;
            const left = geometry.sourceOffsetX;
            const right = geometry.targetWidth - left - geometry.sourceDrawWidth;
            const bottom = geometry.targetHeight - top - geometry.sourceDrawHeight;
            const bandH = Math.min(96, geometry.sourceHeight);
            const bandW = Math.min(96, geometry.sourceWidth);
            // top / bottom full-width bands
            if (top > 0) baseContext.drawImage(image, 0, 0, geometry.sourceWidth, bandH, 0, 0, geometry.targetWidth, top);
            if (bottom > 0) baseContext.drawImage(image, 0, geometry.sourceHeight - bandH, geometry.sourceWidth, bandH, 0, top + geometry.sourceDrawHeight, geometry.targetWidth, bottom);
            // left / right side bands over remaining height of source row
            if (left > 0) baseContext.drawImage(image, 0, 0, bandW, geometry.sourceHeight, 0, top, left, geometry.sourceDrawHeight);
            if (right > 0) baseContext.drawImage(image, geometry.sourceWidth - bandW, 0, bandW, geometry.sourceHeight, left + geometry.sourceDrawWidth, top, right, geometry.sourceDrawHeight);
        } else if (geometry.direction === "down") {
            const sourceBandHeight = Math.min(96, geometry.sourceHeight);
            baseContext.drawImage(image, 0, geometry.sourceHeight - sourceBandHeight, geometry.sourceWidth, sourceBandHeight, 0, geometry.sourceOffsetY + geometry.sourceDrawHeight, geometry.targetWidth, geometry.extensionPixels);
        } else if (geometry.direction === "up") {
            const sourceBandHeight = Math.min(96, geometry.sourceHeight);
            baseContext.drawImage(image, 0, 0, geometry.sourceWidth, sourceBandHeight, 0, 0, geometry.targetWidth, geometry.extensionPixels);
        } else if (geometry.direction === "right") {
            const sourceBandWidth = Math.min(96, geometry.sourceWidth);
            baseContext.drawImage(image, geometry.sourceWidth - sourceBandWidth, 0, sourceBandWidth, geometry.sourceHeight, geometry.sourceOffsetX + geometry.sourceDrawWidth, 0, geometry.extensionPixels, geometry.targetHeight);
        } else {
            const sourceBandWidth = Math.min(96, geometry.sourceWidth);
            baseContext.drawImage(image, 0, 0, sourceBandWidth, geometry.sourceHeight, 0, 0, geometry.extensionPixels, geometry.targetHeight);
        }
        baseContext.restore();
        // 远缝段淡出到边带均值色：模糊拉伸条带的低频形状（头发暗块/衣物竖纹）在深处
        // 会被模型当成"第二颗头/装饰带"吸引子；近缝保留条带保证接缝连续，远端只留纯色调。
        const meanColorOf = (sx: number, sy: number, sw: number, sh: number) => {
            const tiny = document.createElement("canvas");
            tiny.width = 1;
            tiny.height = 1;
            const tctx = tiny.getContext("2d");
            if (!tctx) return "rgb(128,128,128)";
            tctx.drawImage(image, sx, sy, sw, sh, 0, 0, 1, 1);
            const d = tctx.getImageData(0, 0, 1, 1).data;
            return `${d[0]},${d[1]},${d[2]}`;
        };
        const fadeToMean = (x: number, y: number, w: number, h: number, fadeDir: "up" | "down" | "left" | "right", rgb: string) => {
            if (w <= 0 || h <= 0) return;
            const span = fadeDir === "up" || fadeDir === "down" ? h : w;
            const start = Math.min(0.85, geometry.seamOverlapPixels / Math.max(1, span));
            let grad: CanvasGradient;
            if (fadeDir === "up") grad = baseContext.createLinearGradient(0, y + h, 0, y);
            else if (fadeDir === "down") grad = baseContext.createLinearGradient(0, y, 0, y + h);
            else if (fadeDir === "left") grad = baseContext.createLinearGradient(x + w, 0, x, 0);
            else grad = baseContext.createLinearGradient(x, 0, x + w, 0);
            grad.addColorStop(0, `rgba(${rgb},0)`);
            grad.addColorStop(start, `rgba(${rgb},0)`);
            grad.addColorStop(1, `rgba(${rgb},1)`);
            baseContext.fillStyle = grad;
            baseContext.fillRect(x, y, w, h);
        };
        const bandH2 = Math.min(96, geometry.sourceHeight);
        const bandW2 = Math.min(96, geometry.sourceWidth);
        if (geometry.direction === "outward") {
            const top = geometry.sourceOffsetY;
            const left = geometry.sourceOffsetX;
            const right = geometry.targetWidth - left - geometry.sourceDrawWidth;
            const bottom = geometry.targetHeight - top - geometry.sourceDrawHeight;
            if (top > 0) fadeToMean(0, 0, geometry.targetWidth, top, "up", meanColorOf(0, 0, geometry.sourceWidth, bandH2));
            if (bottom > 0) fadeToMean(0, top + geometry.sourceDrawHeight, geometry.targetWidth, bottom, "down", meanColorOf(0, geometry.sourceHeight - bandH2, geometry.sourceWidth, bandH2));
            if (left > 0) fadeToMean(0, top, left, geometry.sourceDrawHeight, "left", meanColorOf(0, 0, bandW2, geometry.sourceHeight));
            if (right > 0) fadeToMean(left + geometry.sourceDrawWidth, top, right, geometry.sourceDrawHeight, "right", meanColorOf(geometry.sourceWidth - bandW2, 0, bandW2, geometry.sourceHeight));
        } else if (geometry.direction === "down") {
            fadeToMean(0, geometry.sourceOffsetY + geometry.sourceDrawHeight, geometry.targetWidth, geometry.extensionPixels, "down", meanColorOf(0, geometry.sourceHeight - bandH2, geometry.sourceWidth, bandH2));
        } else if (geometry.direction === "up") {
            fadeToMean(0, 0, geometry.targetWidth, geometry.extensionPixels, "up", meanColorOf(0, 0, geometry.sourceWidth, bandH2));
        } else if (geometry.direction === "right") {
            fadeToMean(geometry.sourceOffsetX + geometry.sourceDrawWidth, 0, geometry.extensionPixels, geometry.targetHeight, "right", meanColorOf(geometry.sourceWidth - bandW2, 0, bandW2, geometry.sourceHeight));
        } else {
            fadeToMean(0, 0, geometry.extensionPixels, geometry.targetHeight, "left", meanColorOf(0, 0, bandW2, geometry.sourceHeight));
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
        // 白底=保护；clear=重绘区（alpha=0 → 网关 inpaint 白区）
        maskContext.fillStyle = "#fff";
        maskContext.fillRect(0, 0, mask.width, mask.height);
        const seam = geometry.seamOverlapPixels;
        if (geometry.direction === "outward") {
            const sx = geometry.sourceOffsetX;
            const sy = geometry.sourceOffsetY;
            const sw = geometry.sourceDrawWidth;
            const sh = geometry.sourceDrawHeight;
            // 四边外扩区 + 向内 seam 融合带
            maskContext.clearRect(0, 0, geometry.targetWidth, Math.max(0, sy + seam)); // top
            maskContext.clearRect(0, Math.max(0, sy + sh - seam), geometry.targetWidth, geometry.targetHeight - Math.max(0, sy + sh - seam)); // bottom
            maskContext.clearRect(0, Math.max(0, sy), Math.max(0, sx + seam), sh); // left over source row
            maskContext.clearRect(Math.max(0, sx + sw - seam), Math.max(0, sy), geometry.targetWidth - Math.max(0, sx + sw - seam), sh); // right
        } else if (geometry.direction === "down") {
            maskContext.clearRect(0, Math.max(0, geometry.sourceOffsetY + geometry.sourceDrawHeight - seam), geometry.targetWidth, geometry.extensionPixels + seam);
        } else if (geometry.direction === "up") {
            maskContext.clearRect(0, 0, geometry.targetWidth, geometry.extensionPixels + seam);
        } else if (geometry.direction === "right") {
            maskContext.clearRect(Math.max(0, geometry.sourceOffsetX + geometry.sourceDrawWidth - seam), 0, geometry.extensionPixels + seam, geometry.targetHeight);
        } else {
            maskContext.clearRect(0, 0, geometry.extensionPixels + seam, geometry.targetHeight);
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
