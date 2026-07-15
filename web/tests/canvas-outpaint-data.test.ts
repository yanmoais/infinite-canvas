import assert from "node:assert/strict";

import { calculateDownwardOutpaintGeometry, extendToFullBodyRatio, fullBodyPortraitAspect, normalizeOutpaintDirection, suggestOutpaintDirection, suggestOutpaintMode } from "../src/lib/canvas/canvas-outpaint-data.ts";

const halfExtension = calculateDownwardOutpaintGeometry(1152, 1280, {
    extensionRatio: 0.5,
    seamOverlapPixels: 96,
});
assert.deepEqual(halfExtension, {
    mode: "extend",
    direction: "down",
    sourceWidth: 1152,
    sourceHeight: 1280,
    targetWidth: 1152,
    targetHeight: 1920,
    extensionPixels: 640,
    seamOverlapPixels: 96,
    sourceScale: 1,
    sourceOffsetX: 0,
    sourceOffsetY: 0,
    sourceDrawWidth: 1152,
    sourceDrawHeight: 1280,
});

const cappedExtension = calculateDownwardOutpaintGeometry(1152, 2048, {
    extensionRatio: 0.75,
    seamOverlapPixels: 240,
});
assert.equal(cappedExtension.targetHeight, 2560, "target height should respect the managed VRAM ceiling");
assert.equal(cappedExtension.extensionPixels, 512);
assert.equal(cappedExtension.seamOverlapPixels, 192, "seam overlap should be clamped");

const minimumExtension = calculateDownwardOutpaintGeometry(1024, 1024, {
    extensionRatio: 0.01,
    seamOverlapPixels: 0,
});
assert.equal(minimumExtension.targetHeight, 1280, "extension ratio should use the managed minimum");
assert.equal(minimumExtension.seamOverlapPixels, 16);

assert.equal(fullBodyPortraitAspect(0.75), 1.5);
assert.equal(fullBodyPortraitAspect(1), 1.65);
assert.equal(fullBodyPortraitAspect(1.15), 1.75);
assert.equal(normalizeOutpaintDirection("up"), "up");
assert.equal(normalizeOutpaintDirection("side"), "down");

const fullBody = calculateDownwardOutpaintGeometry(1024, 1024, {
    mode: "full_body",
    extensionRatio: 0.75,
    seamOverlapPixels: 64,
    sourceScale: 0.58,
});
assert.equal(fullBody.targetHeight, 1536, "standard full_body should use ~3:2 portrait, not 2:1");
assert.equal(fullBody.sourceDrawWidth, 594);
assert.equal(fullBody.sourceDrawHeight, 594);
assert.equal(fullBody.sourceOffsetX, 215);
assert.equal(fullBody.sourceScale, 0.58);
assert.equal(fullBody.direction, "down");

const stretchFullBody = calculateDownwardOutpaintGeometry(1024, 1024, {
    mode: "full_body",
    extensionRatio: 1,
    seamOverlapPixels: 64,
    sourceScale: 0.58,
});
assert.equal(stretchFullBody.targetHeight, 1728, "stretch full_body should stay under extreme tall portrait");

const longFullBody = calculateDownwardOutpaintGeometry(1024, 1024, {
    mode: "full_body",
    extensionRatio: 1.25,
    seamOverlapPixels: 64,
    sourceScale: 0.58,
});
assert.equal(longFullBody.targetHeight, 1792, "full_body hard-cap should be ~1.75:1, not 2:1");

const upExtension = calculateDownwardOutpaintGeometry(1024, 1280, {
    mode: "extend",
    direction: "up",
    extensionRatio: 0.5,
    seamOverlapPixels: 96,
});
assert.equal(upExtension.targetHeight, 1920);
assert.equal(upExtension.extensionPixels, 640);
assert.equal(upExtension.sourceOffsetY, 640, "upward extend should place source below the new top band");
assert.equal(upExtension.sourceOffsetX, 0);

const leftExtension = calculateDownwardOutpaintGeometry(1024, 1280, {
    mode: "extend",
    direction: "left",
    extensionRatio: 0.5,
    seamOverlapPixels: 96,
});
assert.equal(leftExtension.targetWidth, 1536);
assert.equal(leftExtension.extensionPixels, 512);
assert.equal(leftExtension.sourceOffsetX, 512, "leftward extend should place source to the right of the new band");
assert.equal(leftExtension.targetHeight, 1280);

const rightExtension = calculateDownwardOutpaintGeometry(1024, 1280, {
    mode: "extend",
    direction: "right",
    extensionRatio: 0.35,
    seamOverlapPixels: 64,
});
assert.equal(rightExtension.targetWidth, 1408);
assert.equal(rightExtension.sourceOffsetX, 0);
assert.equal(rightExtension.extensionPixels, 384);

const outwardExtension = calculateDownwardOutpaintGeometry(1024, 1280, {
    mode: "extend",
    direction: "outward",
    extensionRatio: 0.5,
    seamOverlapPixels: 96,
});
assert.equal(outwardExtension.direction, "outward");
assert.equal(outwardExtension.targetWidth, 1536, "outward should grow width by ~50%");
assert.equal(outwardExtension.targetHeight, 1920, "outward should grow height by ~50%");
assert.equal(outwardExtension.sourceOffsetX, 256);
assert.equal(outwardExtension.sourceOffsetY, 320);
assert.equal(outwardExtension.sourceDrawWidth, 1024);
assert.equal(outwardExtension.sourceDrawHeight, 1280);
assert.equal(normalizeOutpaintDirection("outward"), "outward");


assert.equal(suggestOutpaintMode(1024, 1024), "extend", "face/near shots still prefer pixel-lock extend");
assert.equal(suggestOutpaintMode(1024, 1536), "extend");
assert.equal(suggestOutpaintDirection(1024, 1024), "down", "short portraits default downward full-body extend");
assert.equal(suggestOutpaintDirection(1024, 1536), "outward", "tall images default outward expand");
const ratio = extendToFullBodyRatio(1024, 1024);
assert.ok(ratio >= 0.45 && ratio <= 0.7, `extend-to-fullbody ratio should land near half height growth, got ${ratio}`);
const extendFull = calculateDownwardOutpaintGeometry(1024, 1024, {
    mode: "extend",
    direction: "down",
    extensionRatio: ratio,
    seamOverlapPixels: 96,
});
assert.equal(extendFull.sourceOffsetY, 0);
assert.ok(extendFull.targetHeight >= 1536, "extend-to-fullbody should reach full-body portrait height");
assert.equal(extendFull.sourceDrawHeight, 1024, "extend path must keep source pixel height 1:1");

console.log("canvas outpaint geometry tests passed");
