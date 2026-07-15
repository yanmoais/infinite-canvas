import assert from "node:assert/strict";

import {
    analyzeComposeCompleteness,
    applySmartPromptForGeneration,
    buildSelectionFromSceneTemplate,
    composePromptFromBaseAndTags,
    extractIdentityPack,
    extractSceneTemplates,
    mergeIdentityPackIntoSelection,
    getTagConflictHint,
    getPoseChangePipelineStatus,
    getTagRelationHint,
    isQualityPrefixTag,
    isQualitySuffixTag,
    isTrueReferencePoseChange,
    smartComposePrompt,
} from "../src/lib/canvas/smart-compose-prompt.ts";

const reverseCowgirlCase = smartComposePrompt(
    "amazing quality, best quality, masterpiece, 1girl, solo, cute beautiful girl, long hair with teal tips, blue eyes, white dress, rear view, cock in pussy, explicit penetration, thick penis deeply inserted into pussy, reverse cowgirl position, girl on top facing away, ass towards camera, low angle from below, full body, thick penis deeply inserted into vagina, pussy stretched around cock, vagina focus, balls deep, cum overflow from pussy, creampie, ahegao, rolling eyes, mind break, detailed face, soft lighting, highly detailed",
    { hasReferenceImages: true },
);

assert.equal(reverseCowgirlCase.prompt.includes("solo"), false, "solo should be removed against penetration");
assert.match(reverseCowgirlCase.prompt, /\b1boy\b/i, "1boy should be injected for partner sex");
assert.match(reverseCowgirlCase.prompt, /looking back over shoulder/i, "rear + ahegao should inject look-back");
assert.match(reverseCowgirlCase.prompt, /reverse cowgirl/i, "pose should stay");
assert.match(reverseCowgirlCase.prompt, /man lying under her/i, "should expand male under her");
assert.match(reverseCowgirlCase.prompt, /no futanari/i, "should ban futa");
assert.match(reverseCowgirlCase.prompt, /penis belongs to the man under her/i, "should clarify penis ownership");
assert.match(reverseCowgirlCase.prompt, /only one boy|single male partner|two people only/i, "should force single partner couple");
assert.match(reverseCowgirlCase.prompt, /do not keep original standing composition/i, "standing negation must survive");
assert.equal(/(^|,\s*)standing(,|$)/i.test(reverseCowgirlCase.prompt), false, "pure standing pose should not remain");

const userPrompt = applySmartPromptForGeneration(
    "keep character identity from reference, same face, same hair, same outfit unless prompt changes clothing, change pose completely, do not keep original standing composition, 1boy, full body, rolling eyes, girl on top facing away, reverse cowgirl position, balls deep, cock in pussy, creampie, cum overflow from pussy, explicit penetration, pussy stretched around cock, thick penis deeply inserted into pussy, thick penis deeply inserted into vagina, vagina focus, ass towards camera, low angle from below, ahegao, mind break, looking back over shoulder, visible insertion, cute beautiful girl, white dress, detailed face, masterpiece, best quality, highly detailed",
    { hasReferenceImages: true },
);
assert.match(userPrompt.prompt, /man lying under her/i);
assert.match(userPrompt.prompt, /do not keep original standing composition/i);
assert.match(userPrompt.prompt, /no futanari/i);
assert.equal(userPrompt.removed.some((item) => /do not keep original standing composition/i.test(item.token)), false, "instruction must not be removed as standing pose");

const viewConflict = smartComposePrompt("front view, rear view, from behind, low angle from below", {
    preferred: ["rear view", "low angle from below"],
});
assert.match(viewConflict.prompt, /rear view|from behind|low angle/i);
assert.equal(viewConflict.prompt.includes("front view"), false, "front view should lose to preferred rear/low angle");

const poseConflict = composePromptFromBaseAndTags("standing, front view, 1girl, solo", ["reverse cowgirl", "cock in pussy", "rear view"], true);
assert.equal(poseConflict.prompt.includes("solo"), false);
assert.equal(/(^|,\s*)standing(,|$)/i.test(poseConflict.prompt), false, "standing should lose to reverse cowgirl");
assert.match(poseConflict.prompt, /reverse cowgirl/i);
assert.match(poseConflict.prompt, /\b1boy\b/i);

const soloHint = getTagConflictHint("solo", ["reverse cowgirl", "cock in pussy"]);
assert.ok(soloHint, "solo against penetration should hint");
assert.equal(soloHint?.severity, "block");

const rearHint = getTagConflictHint("front view", ["rear view", "ass towards camera"]);
assert.ok(rearHint, "front view against rear should hint");

const rawMode = composePromptFromBaseAndTags("1girl, solo", ["reverse cowgirl", "cock in pussy"], false);
assert.match(rawMode.prompt, /solo/);
assert.equal(rawMode.removed.length, 0);

const dedupe = smartComposePrompt("best quality, Best Quality, masterpiece");
assert.equal(dedupe.tokens.filter((token) => /best quality/i.test(token)).length, 1);


const doggyCase = smartComposePrompt("1girl, solo, standing, front view, doggystyle, cock in pussy, ahegao, rear view", { preferred: ["doggystyle", "rear view"] });
assert.equal(doggyCase.prompt.includes("solo"), false);
assert.equal(/(^|,\s*)standing(,|$)/i.test(doggyCase.prompt), false);
assert.match(doggyCase.prompt, /doggystyle/i);
assert.match(doggyCase.prompt, /1boy/i);
assert.match(doggyCase.prompt, /no futanari/i);
assert.match(doggyCase.prompt, /looking back over shoulder/i);

const breastCase = smartComposePrompt("large breasts, small breasts, flat chest", { preferred: ["large breasts"] });
assert.match(breastCase.prompt, /large breasts/i);
assert.equal(breastCase.prompt.includes("small breasts"), false);
assert.equal(breastCase.prompt.includes("flat chest"), false);

const hairCase = smartComposePrompt("short hair, long hair", { preferred: ["long hair"] });
assert.match(hairCase.prompt, /long hair/i);
assert.equal(hairCase.prompt.includes("short hair"), false);

const clothingCase = smartComposePrompt("fully clothed, completely nude, open clothes", { preferred: ["completely nude"] });
assert.match(clothingCase.prompt, /completely nude/i);
assert.equal(clothingCase.prompt.includes("fully clothed"), false);

console.log("smart compose prompt tests passed");

console.log("sample:", reverseCowgirlCase.prompt);
console.log("user:", userPrompt.prompt);
console.log("removed:", reverseCowgirlCase.removed.map((item) => item.token).join(" | "));
console.log("notes:", reverseCowgirlCase.notes.join(" | "));


const blockStanding = getTagRelationHint("standing", ["reverse cowgirl position", "cock in pussy"]);
assert.ok(blockStanding, "standing against reverse cowgirl should block");
assert.equal(blockStanding?.severity, "block");

const boostRear = getTagRelationHint("rear view", ["reverse cowgirl position"]);
assert.ok(boostRear, "rear view should boost reverse cowgirl");
assert.equal(boostRear?.severity, "boost");

const boostLookBack = getTagRelationHint("looking back over shoulder", ["ahegao", "rear view"]);
assert.ok(boostLookBack, "looking back should boost rear+ahegao");
assert.equal(boostLookBack?.severity, "boost");

const blockSoft = getTagRelationHint("soft focus", ["sharp focus"]);
assert.equal(blockSoft?.severity, "block");

const blockIllustration = getTagRelationHint("illustration", ["photorealistic"]);
assert.equal(blockIllustration?.severity, "block");

assert.equal(isQualityPrefixTag({ en: "masterpiece", orderWeight: 10 }), true);
assert.equal(isQualitySuffixTag({ en: "beautiful lighting", orderWeight: 70 }), true);
assert.equal(isQualityPrefixTag({ en: "beautiful lighting", orderWeight: 70 }), false);

// alias compatibility
assert.equal(getTagConflictHint("solo", ["reverse cowgirl", "cock in pussy"])?.severity, "block");

console.log("relation hint tests passed");


// scene templates are atomic multi-tag strings; exclusive poses must block, not boost
const cowgirlTemplate =
    "1girl, 1boy, hetero, no futanari, man under her, penis belongs to man, cowgirl position, girl on top squatting facing viewer, low angle from below, full body male pov, thick penis deeply inserted into vagina, pussy stretched around cock, vagina focus, balls deep, cum dripping from pussy, ahegao, flushed cheeks";
const reverseTemplate =
    "1girl, 1boy, hetero, no futanari, man under her, penis belongs to man, reverse cowgirl position, girl on top facing away, ass towards camera, low angle from below, full body, thick penis deeply inserted into vagina";
const missionaryTemplate =
    "1girl, 1boy, hetero, no futanari, missionary position, girl lying on back facing viewer, legs spread wide, low angle from below, full body, thick penis deeply inserted into vagina";
const doggyTemplate =
    "1girl, 1boy, hetero, no futanari, doggystyle, girl on all fours from behind, rear view, ass focus, low angle, full body, thick penis deeply inserted into vagina";

const blockReverseTpl = getTagRelationHint(reverseTemplate, [cowgirlTemplate]);
assert.equal(blockReverseTpl?.severity, "block", "reverse scene template must conflict with cowgirl scene template");
const blockMissionaryTpl = getTagRelationHint(missionaryTemplate, [cowgirlTemplate]);
assert.equal(blockMissionaryTpl?.severity, "block", "missionary scene template must conflict with cowgirl scene template");
const blockDoggyTpl = getTagRelationHint(doggyTemplate, [cowgirlTemplate]);
assert.equal(blockDoggyTpl?.severity, "block", "doggy scene template must conflict with cowgirl scene template");
const blockReverseHot = getTagRelationHint("reverse cowgirl position", [cowgirlTemplate]);
assert.equal(blockReverseHot?.severity, "block", "reverse cowgirl hot tag must conflict with cowgirl scene template");
const boostVisible = getTagRelationHint("visible insertion", [cowgirlTemplate]);
assert.equal(boostVisible?.severity, "boost", "visible insertion should still boost a cowgirl template");
const blockFacial = getTagRelationHint("cum on face", ["creampie", "cum overflow from pussy"]);
assert.equal(blockFacial?.severity, "block", "facial should conflict with creampie family");
const blockMulti = getTagRelationHint("threesome", ["single male partner", "only one boy"]);
assert.equal(blockMulti?.severity, "block", "threesome should conflict with single partner");

const sceneCompose = smartComposePrompt([cowgirlTemplate, reverseTemplate], { preferred: [reverseTemplate, cowgirlTemplate] });
assert.equal(
    sceneCompose.tokens.some((token) => /cowgirl position/i.test(token) && !/reverse cowgirl/i.test(token)),
    false,
    "preferred reverse template should drop plain cowgirl template",
);
assert.equal(sceneCompose.tokens.some((token) => /reverse cowgirl/i.test(token)), true, "reverse template should remain");

console.log("scene template relation tests passed");


// composition cleanup: reverse rear should not keep male-pov + dual focus + creampie spam
const warpedPrompt = smartComposePrompt(
    "1girl, 1boy, reverse cowgirl position, girl on top facing away, full body, full body male pov, rear view, ass focus, ass towards camera, looking back over shoulder, ahegao, mind break, rolling eyes, vagina focus, POV creampie, creampie, creampie overflow, cum dripping from pussy, cum in pussy, cum overflow from pussy, visible insertion",
    { preferred: ["reverse cowgirl position", "rear view", "ass focus"], hasReferenceImages: true },
);
assert.equal(/\bfull body male pov\b/i.test(warpedPrompt.prompt), false, "drop male pov on reverse rear");
assert.equal(/pov creampie/i.test(warpedPrompt.prompt), false, "drop pov creampie on rear");
assert.equal(/\bvagina focus\b/i.test(warpedPrompt.prompt) && /\bass focus\b/i.test(warpedPrompt.prompt), false, "should not keep dual body focus");
assert.equal((warpedPrompt.prompt.match(/\b(creampie|cum (in|overflow|dripping))/gi) || []).length <= 2, true, "creampie synonyms trimmed");
assert.match(warpedPrompt.prompt, /stable pelvis|anatomically correct|natural spine twist/i, "anatomy stabilizers injected");
assert.equal(getTagRelationHint("full body male pov", ["reverse cowgirl position", "rear view", "ass towards camera"])?.severity, "block");

console.log("composition cleanup tests passed");


// rear reverse cowgirl full-body should not keep vagina focus + ahegao + look-back together
const anatomyPrompt = smartComposePrompt(
    "1girl, 1boy, reverse cowgirl position, girl on top facing away, full body, rear view, ass towards camera, low angle from below, looking back over shoulder, ahegao, mind break, rolling eyes, vagina focus, visible insertion, thick penis deeply inserted into vagina, thick penis deeply inserted into pussy, cock in pussy, explicit penetration, balls deep, pussy stretched around cock, creampie, cum overflow from pussy, creampie overflow",
    { preferred: ["reverse cowgirl position", "rear view", "looking back over shoulder"], hasReferenceImages: true },
);
assert.equal(/\bvagina focus\b/i.test(anatomyPrompt.prompt), false, "rear full-body reverse should drop vagina focus");
assert.match(anatomyPrompt.prompt, /\bahegao\b/i, "looking back + template ahegao should KEEP ahegao expression");
assert.match(anatomyPrompt.prompt, /tongue out|rolling eyes|open mouth/i, "ahegao should densify expression anchors");
assert.equal(/\bass focus\b/i.test(anatomyPrompt.prompt), true, "should inject ass focus for rear riding");
assert.equal((anatomyPrompt.prompt.match(/\b(visible insertion|explicit penetration|cock in pussy|thick penis deeply inserted|balls deep|pussy stretched)\b/gi) || []).length <= 3, true, "insertion synonyms trimmed");
assert.equal((anatomyPrompt.prompt.match(/\b(creampie|cum overflow|cum in|cum dripping)\b/gi) || []).length <= 2, true, "creampie synonyms trimmed");
console.log("reverse cowgirl anatomy cleanup tests passed");


// reverse cowgirl look-back: anti twin / single penis / partner synonym trim
const twinPrompt = smartComposePrompt(
    "highly detailed, male partner under her, man lying under her, straddling male partner, no futanari, no girl penis, penis belongs to the man under her, single male partner, change pose completely, do not keep original standing composition, replace standing pose with the requested sex position, her knees bent, keep character identity from reference, same face, same hair, same outfit, same outfit unless prompt changes clothing, weight on legs, best quality, masterpiece, only one boy, 1boy, 1girl, cute beautiful girl, girl on top facing away, hetero, blue eyes, full body, long brown hair with teal tips, white dress, reverse cowgirl position, girl sitting on top facing away, knees bent, balls deep, pussy stretched around cock, visible insertion, creampie, cum overflow from pussy, ass focus, ass towards camera, low angle from below, rear view, open mouth, soft lighting, two people only, anatomically correct, coherent limbs, correct female anatomy, detailed face, flushed cheeks, indoor, looking back over shoulder, natural spine twist, on the bed, stable pelvis",
    { preferred: ["reverse cowgirl position", "looking back over shoulder", "rear view"], hasReferenceImages: true },
);
assert.equal(/\bmale partner under her\b/i.test(twinPrompt.prompt) && /\bman lying under her\b/i.test(twinPrompt.prompt) && /\bsingle male partner\b/i.test(twinPrompt.prompt), false, "partner-position synonyms should be trimmed");
assert.equal(/\bher knees bent\b/i.test(twinPrompt.prompt) && /\bknees bent\b/i.test(twinPrompt.prompt), false, "knees bent synonyms should not both remain");
assert.match(twinPrompt.prompt, /single head|one head only|single torso/i, "look-back rear should inject single-head/torso guard");
assert.match(twinPrompt.prompt, /one penis only|single penis/i, "should inject single penis guard");
const instructionCount = (twinPrompt.prompt.match(/\b(same face|same hair|same outfit|same outfit unless prompt changes clothing|keep character identity from reference|change pose completely|do not keep original standing composition|replace standing pose with the requested sex position)\b/gi) || []).length;
assert.equal(instructionCount <= 5, true, `instruction noise should stay compact, got ${instructionCount}`);
console.log("anti-twin cleanup tests passed");


// scene template self-cleanup must not flood every unrelated tag as "覆盖"
const sceneTemplate = "reverse cowgirl position, girl on top facing away, ass towards camera, low angle from below, full body, thick penis deeply inserted into vagina, pussy stretched around cock, vagina focus, balls deep, cum overflow from pussy, creampie, ahegao, rolling eyes, mind break, 1girl, 1boy, hetero";
const qualityCover = getTagRelationHint("best quality", [sceneTemplate], "");
assert.notEqual(qualityCover?.severity, "warn", "best quality should not warn-cover just because template self-cleans");
const indoorCover = getTagRelationHint("indoor", [sceneTemplate], "");
assert.notEqual(indoorCover?.severity, "warn", "indoor should not warn-cover just because template self-cleans");
// exclusive pose should still block
const doggyBlock = getTagRelationHint("doggystyle", [sceneTemplate], "");
assert.equal(doggyBlock?.severity, "block", "other sex pose should still hard-block");
console.log("false cover flood tests passed");

// reverse cowgirl single-penis reinforcement
const singlePenisPrompt = smartComposePrompt(
    "1girl, 1boy, reverse cowgirl position, girl on top facing away, rear view, ass focus, visible insertion, balls deep, pussy stretched around cock, creampie, looking back over shoulder",
    { preferred: ["reverse cowgirl position"], hasReferenceImages: true },
);
assert.match(singlePenisPrompt.prompt, /one penis only|single penis|only one cock|single shaft/i, "single penis guards required");
assert.equal((singlePenisPrompt.prompt.match(/\b(one penis only|single penis|only one cock|single shaft|one male penis only)\b/gi) || []).length <= 1, true, "penis uniqueness terms <=1");
assert.equal((singlePenisPrompt.prompt.match(/\b(visible insertion|explicit penetration|cock in pussy|thick penis deeply inserted|balls deep|pussy stretched)\b/gi) || []).length <= 2, true, "insertion terms <=2 on reverse cowgirl");
console.log("single penis reinforcement tests passed");


// reverse cowgirl always injects single-body guards even without look-back
const noLookTwin = smartComposePrompt(
    "1girl, 1boy, reverse cowgirl position, girl on top facing away, rear view, ass focus, visible insertion, creampie overflow, explicit penetration, one penis only, single penis, only one cock, single shaft, one male penis only",
    { preferred: ["reverse cowgirl position", "rear view"], hasReferenceImages: true },
);
assert.match(noLookTwin.prompt, /single head|one head only|single torso|one upper body only/i, "single-body guards without look-back");
assert.equal((noLookTwin.prompt.match(/\b(one penis only|single penis|only one cock|single shaft|one male penis only)\b/gi) || []).length <= 1, true, "penis uniqueness terms <=1");
assert.equal((noLookTwin.prompt.match(/\b(creampie overflow|cum overflow|creampie|cum in|cum dripping)\b/gi) || []).length <= 1, true, "liquid terms <=1");
console.log("no-look twin guard tests passed");


// reverse cowgirl crotch dedupe: drop heavy insertion/liquid, inject single crotch
const crotchPrompt = smartComposePrompt(
    "1girl, 1boy, reverse cowgirl position, girl on top facing away, rear view, ass focus, visible insertion, creampie overflow, thick penis deeply inserted into pussy, pussy stretched around cock, balls deep, explicit penetration, one penis only, single penis",
    { preferred: ["reverse cowgirl position", "rear view", "ass focus"], hasReferenceImages: true },
);
assert.equal(/\bthick penis deeply inserted\b/i.test(crotchPrompt.prompt), false, "drop thick deep insertion");
assert.equal(/\bpussy stretched around cock\b/i.test(crotchPrompt.prompt), false, "drop stretched");
assert.equal(/\bballs deep\b/i.test(crotchPrompt.prompt), false, "drop balls deep");
assert.equal(/\bcreampie overflow\b/i.test(crotchPrompt.prompt), false, "drop creampie overflow by default");
assert.equal((crotchPrompt.prompt.match(/\b(visible insertion|penetration)\b/gi) || []).length <= 1, true, "at most one light insertion term");
assert.match(crotchPrompt.prompt, /single crotch|one vagina only|clean genital anatomy/i, "single crotch guards");
assert.equal((crotchPrompt.prompt.match(/\b(single crotch|one vagina only|clean genital anatomy)\b/gi) || []).length <= 1, true, "crotch uniqueness terms <=1");
console.log("crotch dedupe tests passed");


// reverse cowgirl must force male-visible hetero ownership, not futa-alone
const antiFuta = smartComposePrompt(
    "1girl, reverse cowgirl position, girl on top facing away, rear view, ass focus, visible insertion",
    { preferred: ["reverse cowgirl position"], hasReferenceImages: true },
);
assert.match(antiFuta.prompt, /\b1boy\b/i, "1boy required");
assert.match(antiFuta.prompt, /no futanari|no girl penis/i, "anti futa");
assert.match(antiFuta.prompt, /male torso under her|male body under her|his penis|male hands on her hips/i, "male body/penis ownership");
assert.match(antiFuta.prompt, /long brown hair with teal tips|brown hair with teal tips|same face/i, "identity lock");
assert.match(antiFuta.prompt, /hetero/i, "hetero");
console.log("anti-futa male visible tests passed");


// v12.6 densify: reverse cowgirl identity + male-visible should stay compact
const densifyPrompt = smartComposePrompt(
    "1girl, reverse cowgirl position, girl on top facing away, rear view, ass focus, visible insertion, ahegao, long brown hair with teal tips, blue eyes, white dress",
    { preferred: ["reverse cowgirl position", "rear view"], hasReferenceImages: true },
);
assert.match(densifyPrompt.prompt, /same face/i, "same face");
assert.match(densifyPrompt.prompt, /long brown hair with teal tips|brown hair with teal tips/i, "teal tip hair");
assert.match(densifyPrompt.prompt, /male torso under her/i, "male torso");
assert.match(densifyPrompt.prompt, /his penis|penis belongs to the man under her/i, "penis ownership");
assert.equal((densifyPrompt.prompt.match(/\b(looking back|looking over shoulder|looking back over shoulder)\b/gi) || []).length <= 1, true, "look-back synonyms <=1");
assert.equal((densifyPrompt.prompt.match(/\b(male body under her|male torso under her|male thighs under her|male hands on her hips|male partner partially visible under her|his legs spread under her)\b/gi) || []).length <= 3, true, "male-visible terms <=3");
assert.equal((densifyPrompt.prompt.match(/\b(one penis only|single penis|only one cock|single shaft|one male penis only)\b/gi) || []).length <= 1, true, "penis uniqueness <=1");
assert.equal(/\bsame face from reference\b/i.test(densifyPrompt.prompt), false, "drop same face from reference synonym");
console.log("v12.6 densify tests passed");
console.log("densify sample:", densifyPrompt.prompt);


// v12.7 anti-yellow + strip canvas reference noise
const noisePrompt = smartComposePrompt(
    "same face, 【文本1】, 图片1, reverse cowgirl position, girl on top facing away, rear view, ass focus, visible insertion, long brown hair with teal tips, blue eyes, white dress",
    { preferred: ["reverse cowgirl position"], hasReferenceImages: true },
);
assert.equal(/【文本1】|图片1|参考图片编号/.test(noisePrompt.prompt), false, "canvas reference markers must be stripped");
assert.match(noisePrompt.prompt, /natural skin tone|true color|no yellow tint/i, "anti-yellow guards");
assert.match(noisePrompt.prompt, /long brown hair with teal tips|teal hair tips/i, "teal tips keep");
assert.match(noisePrompt.prompt, /same face/i, "same face keep");
console.log("v12.7 anti-yellow tests passed");
console.log("v12.7 sample:", noisePrompt.prompt);


// v12.8 identity front + denser reverse cowgirl defaults
const identityFront = smartComposePrompt(
    "1girl, reverse cowgirl position, girl on top facing away, rear view, ass focus, visible insertion, ahegao, long brown hair with teal tips, blue eyes, white dress",
    { preferred: ["reverse cowgirl position", "rear view"], hasReferenceImages: true },
);
const front = identityFront.tokens.slice(0, 8).join(" | ");
assert.match(front, /same face/i, `identity should be near front, got: ${front}`);
assert.match(front, /same hair|long brown hair with teal tips|blue eyes/i, `hair/eyes near front, got: ${front}`);
assert.equal(identityFront.tokens.length <= 56, true, `token count should stay compact, got ${identityFront.tokens.length}`);
assert.equal(/\bweight on legs\b/i.test(identityFront.prompt), false, "weight on legs should not default-stack with knees bent");
assert.equal((identityFront.prompt.match(/\b(single head|one head only|single torso|one upper body only)\b/gi) || []).length <= 1, true, "single-body terms <=1");
assert.equal((identityFront.prompt.match(/\b(natural skin tone|true color|no yellow tint)\b/gi) || []).length <= 2, true, "anti-yellow <=2");
assert.equal(identityFront.tokens.findIndex((t) => /same face/i.test(t)) < identityFront.tokens.findIndex((t) => /reverse cowgirl/i.test(t)), true, "same face before reverse cowgirl");
console.log("v12.8 identity front tests passed");
console.log("v12.8 sample:", identityFront.prompt);
console.log("v12.8 count:", identityFront.tokens.length);


// v14: 具体发色/服装不再由组合器无证据硬塞；输入已有 white dress 时保留；generic densify 仍补 same/long hair/hem
const reverseCowgirlOutfitDensify = smartComposePrompt(
    "amazing quality, best quality, masterpiece, 1girl, 1boy, hetero, reverse cowgirl position, girl on top facing away, white dress, long brown hair with teal tips, blue eyes, same face, same hair, same outfit, creampie, no futanari",
    { hasReferenceImages: true },
);
assert.match(reverseCowgirlOutfitDensify.prompt, /white dress/i, "user/ref white dress evidence kept");
assert.match(reverseCowgirlOutfitDensify.prompt, /long brown hair with teal tips/i, "user/ref hair evidence kept");
assert.match(reverseCowgirlOutfitDensify.prompt, /same face|same hair|same outfit/i, "generic identity densify");
assert.match(reverseCowgirlOutfitDensify.prompt, /frilled hem|flared skirt|ruffled skirt hem/i, "generic hem densify when dress signal present");
assert.ok(
    reverseCowgirlOutfitDensify.notes.some((n) => /densify|身份\/服饰词已强制置顶|身份词已强制置顶|通用身份结构/.test(n)),
    "should note outfit densify or identity front",
);
assert.equal(/cream white dress/i.test(reverseCowgirlOutfitDensify.prompt), false, "no cream white without evidence");

const outfitChangeSkip = smartComposePrompt(
    "reverse cowgirl position, same face, change outfit, black lingerie, 1girl, 1boy",
    { hasReferenceImages: true },
);
assert.equal(outfitChangeSkip.prompt.includes("collar bow"), false, "explicit outfit change should not force white dress densify");
assert.equal(outfitChangeSkip.prompt.includes("white dress"), false, "outfit change should not inject white dress");
assert.match(outfitChangeSkip.prompt, /black lingerie/i, "new outfit kept");

const reverseCowgirlHairSkirtDensify = smartComposePrompt(
    "amazing quality, 1girl, 1boy, reverse cowgirl position, girl on top facing away, white dress, long brown hair with teal tips, same face, same hair, same outfit, creampie, no futanari",
    { hasReferenceImages: true },
);
// v16.1: 具体发色短语已含 long 时不再堆 very long hair / long hair
assert.match(
    reverseCowgirlHairSkirtDensify.prompt,
    /long brown hair with teal tips|very long hair|long hair/i,
    "hair length should be covered by concrete phrase or densify",
);
assert.match(reverseCowgirlHairSkirtDensify.prompt, /flared skirt|ruffled skirt hem|frilled hem/i, "should densify skirt hem structure");
assert.match(reverseCowgirlHairSkirtDensify.prompt, /long brown hair with teal tips/i, "hair color+length anchor from evidence");
assert.equal(
    (reverseCowgirlHairSkirtDensify.prompt.match(/brown hair/gi) || []).length <= 1,
    true,
    "should not stack multiple brown hair phrases",
);

// v14: 无具体发色时不硬塞茶发青梢
const genericIdentityOnly = smartComposePrompt(
    "1girl, 1boy, reverse cowgirl position, girl on top facing away, same face, same hair, same outfit, black dress",
    { hasReferenceImages: true },
);
assert.equal(/long brown hair with teal tips/i.test(genericIdentityOnly.prompt), false, "no teal tips without evidence");
assert.equal(/white dress/i.test(genericIdentityOnly.prompt), false, "no white dress override on black dress");
assert.match(genericIdentityOnly.prompt, /black dress/i, "black dress kept");
assert.match(genericIdentityOnly.prompt, /same face/i, "generic same face");



// v14 expression family: ahegao vs smile exclusive
const exprConflict = getTagConflictHint("gentle smile", ["ahegao", "reverse cowgirl position"]);
assert.ok(exprConflict && exprConflict.severity === "block", `smile should block against ahegao, got ${JSON.stringify(exprConflict)}`);

const ahegaoKeepCase = smartComposePrompt(
    "1girl, 1boy, reverse cowgirl position, girl on top facing away, rear view, ass focus, looking back over shoulder, ahegao, rolling eyes, mind break, white dress, same face",
    { hasReferenceImages: true },
);
assert.match(ahegaoKeepCase.prompt, /\bahegao\b/i, "user ahegao must survive compose");
assert.match(ahegaoKeepCase.prompt, /looking back over shoulder/i, "look-back stays with ahegao");
assert.match(ahegaoKeepCase.prompt, /tongue out|rolling eyes/i, "ahegao densify anchors");

console.log("v14 universal identity tests passed");

// v14.1 doggy / missionary shared anatomy
const doggyAnatomyCase = smartComposePrompt(
    "1girl, 1boy, doggystyle, from behind, same face, same hair, ahegao, creampie",
    { hasReferenceImages: true },
);
assert.match(doggyAnatomyCase.prompt, /on all fours|man behind her|doggystyle/i, "doggy structure");
assert.match(doggyAnatomyCase.prompt, /no futanari|one penis only|single head/i, "doggy anti-futa/single-head");
assert.match(doggyAnatomyCase.prompt, /looking back over shoulder/i, "doggy ahegao look-back");

const missionaryCase = smartComposePrompt(
    "1girl, 1boy, missionary, same face, creampie",
    { hasReferenceImages: true },
);
assert.match(missionaryCase.prompt, /missionary|man on top|boy on top|girl lying on back/i, "missionary structure");
assert.match(missionaryCase.prompt, /no futanari|one penis only|single head/i, "missionary stabilizers");
assert.equal(/ass towards camera/i.test(missionaryCase.prompt), false, "missionary should drop rear camera");

const statusOn = getPoseChangePipelineStatus(
    "reverse cowgirl position, ahegao, white dress, blue eyes, long brown hair with teal tips",
    { hasReferenceImages: true },
);
assert.equal(statusOn.poseChange, true, "status poseChange on");
assert.equal(statusOn.expressionFamily, "ahegao", "status expr ahegao");
assert.equal(statusOn.identityEvidence.outfit, true, "status outfit evidence");
const statusOff = getPoseChangePipelineStatus("1girl, standing, smile", { hasReferenceImages: false });
assert.equal(statusOff.poseChange, false, "status poseChange off without ref");
console.log("v14.1 doggy/missionary/status tests passed");


// --- v15.2 template / completeness / order ---
const incomplete = analyzeComposeCompleteness(
    "white dress, reverse cowgirl position, looking back over shoulder",
    { hasReferenceImages: true, identitySeed: "cute beautiful girl" },
);
assert.equal(incomplete.level, "critical", "missing identity anchors should be critical");
assert.ok(incomplete.missing.some((item) => item.id === "hair-color" || item.id === "same-lock"));

const ordered = composePromptFromBaseAndTags(
    "",
    [
        "reverse cowgirl position",
        "masterpiece",
        "blue eyes",
        "long brown hair with teal tips",
        "1girl",
        "1boy",
        "same face",
        "cock in pussy",
    ],
    true,
    { hasReferenceImages: true },
);
const o = ordered.prompt.toLowerCase();
const qi = o.indexOf("masterpiece");
const si = o.indexOf("1girl");
const hi = o.indexOf("long brown hair with teal tips");
const pi = o.indexOf("reverse cowgirl");
assert.ok(qi >= 0 && si >= 0 && hi >= 0 && pi >= 0, "ordered tokens present");
assert.ok(qi < pi && si < pi, "quality/subject should precede pose");
assert.ok(hi < pi, "concrete identity should precede pose");

const templates = extractSceneTemplates([
    {
        id: "r18",
        groups: [
            {
                tags: [
                    {
                        en: "1girl, 1boy, hetero, no futanari, reverse cowgirl position, girl on top facing away, ahegao",
                        zh: "后入骑乘内射溢出啊嘿颜·结构防futa",
                        kind: "template",
                        atomic: true,
                    },
                ],
            },
        ],
    },
]);
assert.equal(templates.length, 1);
const built = buildSelectionFromSceneTemplate(templates[0], [{ en: "blue eyes" }, { en: "masterpiece", kind: "prefix", orderWeight: 10 }], {
    hasReferenceImages: true,
});
assert.ok(built.some((tag) => /reverse cowgirl/i.test(tag.en)));
assert.ok(built.some((tag) => /blue eyes/i.test(tag.en)));
assert.ok(built.some((tag) => /change pose completely/i.test(tag.en)));
console.log("template/completeness tests passed");


// --- v15.3 identity pack ---
const pack = extractIdentityPack(
    "cute beautiful girl, long brown hair with teal tips, blue eyes, white dress, flared skirt, ruffled skirt hem, frilled hem, detailed face",
    { hasReferenceImages: true, includeLocks: true, includePoseChange: true },
);
assert.ok(pack.tags.some((t) => /long brown hair with teal tips/i.test(t)), "pack keeps teal tips");
assert.ok(pack.tags.some((t) => /blue eyes/i.test(t)), "pack keeps blue eyes");
assert.ok(pack.tags.some((t) => /same face/i.test(t)), "pack adds same face lock");
assert.ok(pack.tags.some((t) => /change pose completely/i.test(t)), "pack adds pose change for img2img");
assert.equal(pack.tags.some((t) => /reverse cowgirl|ahegao|penis/i.test(t)), false, "pack excludes sex pose terms");

const merged = mergeIdentityPackIntoSelection([{ en: "reverse cowgirl position" }], pack);
assert.ok(merged.some((t) => /reverse cowgirl/i.test(t.en)));
assert.ok(merged.some((t) => /blue eyes/i.test(t.en)));

const withTpl = buildSelectionFromSceneTemplate(
    {
        id: "rcg",
        zh: "后骑乘",
        en: "1girl, 1boy, reverse cowgirl position, ahegao",
        shortLabel: "后骑乘",
        atoms: ["1girl", "1boy", "reverse cowgirl position", "ahegao"],
        poseFamily: "reverse-cowgirl",
        kind: "template",
        atomic: true,
    },
    [],
    {
        hasReferenceImages: true,
        identitySeed: "long brown hair with teal tips, blue eyes, white dress",
    },
);
assert.ok(withTpl.some((t) => /teal tips|long brown hair/i.test(t.en)), "scene template merges identity seed");
assert.ok(withTpl.some((t) => /same face/i.test(t.en)));
assert.ok(withTpl.some((t) => /reverse cowgirl/i.test(t.en)));
console.log("identity pack tests passed");

// --- v15.6 template id uniqueness (shared prompt prefix must not collide) ---
const collisionTemplates = extractSceneTemplates([
    {
        id: "r18",
        groups: [
            {
                tags: [
                    {
                        en: "1girl, 1boy, hetero, no futanari, man under her, penis belongs to man, reverse cowgirl position, girl on top facing away, ahegao",
                        zh: "后入骑乘内射溢出啊嘿颜·结构防futa",
                        kind: "template",
                        atomic: true,
                    },
                    {
                        en: "1girl, 1boy, hetero, no futanari, man under her, penis belongs to man, cowgirl position, girl on top squatting facing viewer, ahegao",
                        zh: "女上位正面骑乘插入·结构防futa",
                        kind: "template",
                        atomic: true,
                    },
                    {
                        en: "1girl, 1boy, hetero, no futanari, doggystyle, girl on all fours from behind, ahegao",
                        zh: "狗爬式后入深插溢出·结构防futa",
                        kind: "template",
                        atomic: true,
                    },
                ],
            },
        ],
    },
]);
assert.equal(collisionTemplates.length, 3, "three templates extracted");
const ids = collisionTemplates.map((t) => t.id);
assert.equal(new Set(ids).size, 3, `template ids must be unique, got ${ids.join(" | ")}`);
assert.ok(ids.every((id) => !ids.filter((x) => x === id).length || true));
console.log("template id uniqueness tests passed");




// --- v15.7 completeness no fake auto-fill when identity seed is weak ---
{
    const weak = analyzeComposeCompleteness(
        "same face, same hair, same outfit, reverse cowgirl position, 1boy, 1girl, change pose completely",
        { hasReferenceImages: true, identitySeed: "cute beautiful girl, detailed face" },
    );
    const hair = weak.missing.find((item) => item.id === "hair-color");
    const eyes = weak.missing.find((item) => item.id === "eye-color");
    assert.ok(hair, "hair-color should still be critical when no concrete hair");
    assert.ok(eyes, "eye-color should still be critical when no concrete eyes");
    assert.equal(hair?.tags == null || hair.tags.length === 0, true, "hair one-click must not offer generic long hair");
    assert.equal(eyes?.tags == null || eyes.tags.length === 0, true, "eyes one-click must not offer detailed face fallback");
}
console.log("v15.7 completeness no-fake-autofill tests passed");


// --- v16.1 auto-collapse redundant identity / outfit locks ---
{
    const stacked = smartComposePrompt(
        [
            "same face",
            "same hair",
            "same outfit",
            "same clothing design",
            "match reference hair length and color",
            "match reference clothing design",
            "preserve outfit silhouette from reference",
            "long brown hair with teal tips",
            "brown hair with teal tips",
            "teal tips",
            "brown hair",
            "very long hair",
            "long hair",
            "blue eyes",
            "white dress",
            "skirt",
            "flared skirt",
            "ruffled skirt hem",
            "frilled hem",
            "penis belongs to man",
            "penis belongs to the man under her",
            "rear view",
            "three-quarter rear view",
            "reverse cowgirl position",
            "1girl",
            "1boy",
            "change pose completely",
            "do not keep original standing composition",
            "masterpiece",
            "best quality",
        ],
        { hasReferenceImages: true },
    );
    assert.match(stacked.prompt, /long brown hair with teal tips/i, "keep most specific hair");
    assert.equal((stacked.prompt.match(/brown hair/gi) || []).length <= 1, true, "brown hair should not flood");
    assert.equal(/match reference hair/i.test(stacked.prompt), false, "drop match reference hair when concrete hair exists");
    assert.equal(/match reference clothing design/i.test(stacked.prompt), false, "drop match clothing when concrete outfit");
    assert.equal(/preserve outfit silhouette/i.test(stacked.prompt), false, "drop preserve silhouette when concrete outfit");
    assert.equal(/same clothing design/i.test(stacked.prompt), false, "drop same clothing design when concrete outfit");
    assert.equal(/(^|,\s*)skirt(,|$)/i.test(stacked.prompt), false, "drop bare skirt when dress/hem present");
    assert.match(stacked.prompt, /penis belongs to the man under her/i);
    assert.equal(/penis belongs to man(?! under)/i.test(stacked.prompt), false, "drop shorter ownership synonym");
    assert.match(stacked.prompt, /three-quarter rear view/i);
    assert.equal(/(^|,\s*)rear view(,|$)/i.test(stacked.prompt), false, "drop generic rear view when three-quarter exists");
    assert.ok(stacked.notes.some((n) => /折叠|重复/.test(n)) || stacked.removed.length > 0, "should report collapses");
}
console.log("v16.1 auto-collapse redundant identity tests passed");


// --- v15.7 regression: normal reference generation must NOT trip pose-change / inject change pose ---
const normalStandingRef = smartComposePrompt(
    "1girl, solo, cute beautiful girl, dark black hair with cyan teal tips, blue-green eyes, plain white sundress, standing, front view, full body, simple background",
    { hasReferenceImages: true },
);
assert.equal(normalStandingRef.hasReferencePoseChange, false, "normal standing + reference must NOT be pose-change");
assert.equal(/change pose completely/i.test(normalStandingRef.prompt), false, "must not inject change pose on normal standing");
assert.equal(/do not keep original standing/i.test(normalStandingRef.prompt), false, "must not inject standing-negation on normal standing");
assert.equal(isTrueReferencePoseChange(normalStandingRef.prompt, true), false, "isTrueReferencePoseChange false for standing full body");

const packNoPose = extractIdentityPack(
    "cute beautiful girl, long brown hair with teal tips, blue eyes, white dress",
    { hasReferenceImages: true, includeLocks: true, includePoseChange: false },
);
assert.equal(packNoPose.tags.some((t) => /change pose completely/i.test(t)), false, "identity pack without includePoseChange must not inject change pose");
assert.ok(packNoPose.tags.some((t) => /same face/i.test(t)), "still keeps same face lock");

const packWithPose = extractIdentityPack(
    "cute beautiful girl, long brown hair with teal tips, blue eyes, white dress",
    { hasReferenceImages: true, includeLocks: true, includePoseChange: true },
);
assert.ok(packWithPose.tags.some((t) => /change pose completely/i.test(t)), "includePoseChange true still injects change pose");

const standingTplBuilt = buildSelectionFromSceneTemplate(
    {
        id: "stand-white-dress",
        zh: "白裙站立",
        en: "1girl, solo, standing, front view, full body, plain white sundress, looking at viewer",
        shortLabel: "白裙站立",
        atoms: ["1girl", "solo", "standing", "front view", "full body", "plain white sundress", "looking at viewer"],
        poseFamily: "none",
        kind: "template",
        atomic: true,
    },
    [{ en: "blue eyes" }],
    { hasReferenceImages: true, identitySeed: "cute beautiful girl, black hair with teal tips, blue eyes, white dress" },
);
assert.ok(standingTplBuilt.some((tag) => /same face/i.test(tag.en)), "standing template keeps same face with reference");
assert.equal(standingTplBuilt.some((tag) => /change pose completely/i.test(tag.en)), false, "standing outfit template + reference must not inject change pose");
console.log("v15.8 standing template no-false-pose-change tests passed");
