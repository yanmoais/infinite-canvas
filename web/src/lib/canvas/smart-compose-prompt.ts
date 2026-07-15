export type SmartComposeRemoval = {
    token: string;
    reason: string;
};

export type SmartComposeResult = {
    prompt: string;
    tokens: string[];
    removed: SmartComposeRemoval[];
    notes: string[];
    hasReferencePoseChange: boolean;
};

export type TagConflictHint = {
    severity: "block" | "warn" | "boost";
    reason: string;
    against: string[];
};

/** 标签关系：互斥 / 会覆盖 / 可增强 */
export type TagRelationHint = TagConflictHint;

type TokenItem = {
    raw: string;
    normalized: string;
    preferred: boolean;
    index: number;
    locked?: boolean;
};

type ConflictFamily = {
    id: string;
    label: string;
    priority: number;
    match: (token: string) => boolean;
};

type ConflictGroup = {
    id: string;
    label: string;
    families: ConflictFamily[];
};

const PARTNER_SEX_RE =
    /\b(reverse cowgirl|cowgirl|doggy|doggystyle|missionary|mating press|prone bone|full nelson|amazon position|lotus position|spooning|girl on top|boy on top|hetero|penetration|inserted|creampie|cum (in|inside|overflow)|balls deep|intercourse|paizuri|fellatio|irrumatio|handjob|footjob|cock in pussy|penis in pussy|vaginal|standing sex|standing doggystyle|standing carry|sex position|having sex)\b/i;
const MALE_RE = /\b(1boy|2boys|multiple boys|male partner|man under|male under|him|his penis|male pubic hair)\b/i;
const FUTA_RE = /\b(futa|futanari|dickgirl|girl with penis)\b/i;
const SOLO_RE = /^(solo|1girl solo|single girl|solo focus|single subject)$/i;
const AHEGAO_RE = /\b(ahegao|rolling eyes|mind break|orgasm face|tongue out)\b/i;
const REAR_RE = /\b(rear view|from behind|ass towards camera|back view|seen from behind)\b/i;
const LOOK_BACK_RE = /\b(looking back|look back|over shoulder|turned head|glance back)\b/i;
// 真换姿判定：仅体位/显式换姿指令。standing/full body/普通坐姿不触发。
const POSE_CHANGE_RE =
    /\b(reverse cowgirl|cowgirl|doggy|doggystyle|missionary|mating press|prone bone|lotus position|spooning|on all fours|girl on top|sex position|change pose completely|do not keep original standing|replace standing pose)\b/i;
const INSTRUCTION_RE =
    /\b(keep character|same face|same hair|same outfit|change pose completely|do not keep|replace standing pose)\b/i;

/** 与网关 is_true_pose_change_request 对齐：参考图路径是否应走 faceid character-lock */
export function isTrueReferencePoseChange(prompt: string, hasReferenceImages = false): boolean {
    if (!hasReferenceImages) return false;
    const text = String(prompt || "");
    return POSE_CHANGE_RE.test(text);
}


const REVERSE_COWGIRL_EXPANSION = [
    // 只保留姿势骨架；男体/反futa/人数由 partner-sex + cleanup 统一注入，避免默认词洪水
    "reverse cowgirl position",
    "girl on top facing away",
    "straddling male partner",
    "man lying under her",
    "knees bent",
    "penis belongs to the man under her",
];

const DOGGY_EXPANSION = [
    "doggystyle",
    "on all fours",
    "from behind",
    "ass towards camera",
    "man behind her",
    "penis belongs to the man under her",
    "no futanari",
    "hetero",
    "single head",
    "stable pelvis",
    "one penis only",
];

const MISSIONARY_EXPANSION = [
    "missionary",
    "girl lying on back facing viewer",
    "boy on top",
    "man on top",
    "penis belongs to the man under her",
    "no futanari",
    "hetero",
    "single head",
    "stable pelvis",
    "one penis only",
];

const CONFLICT_GROUPS: ConflictGroup[] = [
{
        id: "pose",
        label: "姿势",
        families: [
            {
                id: "reverse-cowgirl",
                label: "反向女上位",
                priority: 100,
                match: (token) => !isInstructionToken(token) && (/\breverse cowgirl\b/i.test(token) || /\bgirl on top facing away\b/i.test(token) || /\bgirl sitting on top facing away\b/i.test(token)),
            },
            {
                id: "cowgirl",
                label: "女上位",
                priority: 96,
                match: (token) =>
                    !isInstructionToken(token) &&
                    (/\bcowgirl\b/i.test(token) ||
                        /\bgirl on top squatting facing viewer\b/i.test(token) ||
                        (/\bgirl on top\b/i.test(token) && !/\bfacing away\b/i.test(token)) ||
                        (/\briding\b/i.test(token) && !/\breverse\b/i.test(token))) &&
                    !/\breverse cowgirl\b/i.test(token) &&
                    !/\bfacing away\b/i.test(token),
            },
            {
                id: "doggy",
                label: "后入",
                priority: 94,
                match: (token) =>
                    !isInstructionToken(token) &&
                    /\b(doggy|doggystyle|from behind sex|sex from behind|prone bone|face down ass up|standing doggystyle|kneeling doggystyle)\b/i.test(token),
            },
            {
                id: "missionary",
                label: "传教士",
                priority: 92,
                match: (token) => !isInstructionToken(token) && /\b(missionary|mating press|folded|legs over head)\b/i.test(token),
            },
            { id: "full-nelson", label: "全尼尔森", priority: 91, match: (token) => !isInstructionToken(token) && /\bfull nelson\b/i.test(token) },
            { id: "amazon", label: "亚马逊位", priority: 90, match: (token) => !isInstructionToken(token) && /\bamazon position\b/i.test(token) },
            { id: "lotus", label: "莲花坐", priority: 89, match: (token) => !isInstructionToken(token) && /\blotus position\b/i.test(token) },
            {
                id: "spoon",
                label: "勺子位",
                priority: 88,
                match: (token) => !isInstructionToken(token) && /\b(spooning|spooning position|side fuck)\b/i.test(token),
            },
            {
                id: "standing-sex",
                label: "站立性交",
                priority: 86,
                match: (token) =>
                    !isInstructionToken(token) &&
                    /\b(standing sex|standing carry|suspended congress)\b/i.test(token) &&
                    !/doggystyle/i.test(token),
            },
            {
                id: "sitting",
                label: "坐姿",
                priority: 80,
                match: (token) =>
                    !isInstructionToken(token) &&
                    (/\b(sitting|seiza|wariza|sitting on lap)\b/i.test(token) ||
                        (/\bstraddling\b/i.test(token) && !/\b(male|man|partner|penis|cock)\b/i.test(token))) &&
                    !/\breverse cowgirl\b/i.test(token) &&
                    !/\bman lying under\b/i.test(token) &&
                    !/\bcowgirl\b/i.test(token) &&
                    !/\blotus position\b/i.test(token),
            },
            {
                id: "kneeling",
                label: "跪姿",
                priority: 78,
                match: (token) =>
                    !isInstructionToken(token) &&
                    /\b(kneeling|on all fours|all fours|squatting)\b/i.test(token) &&
                    !/\b(doggy|doggystyle|cowgirl|girl on top)\b/i.test(token),
            },
            {
                id: "lying",
                label: "躺姿",
                priority: 76,
                match: (token) =>
                    !isInstructionToken(token) &&
                    /\b(lying|on back|on stomach|on side)\b/i.test(token) &&
                    !/\bman lying under\b/i.test(token) &&
                    !/\b(missionary|mating press|spooning)\b/i.test(token),
            },
            {
                id: "standing",
                label: "站姿",
                priority: 40,
                match: (token) => !isInstructionToken(token) && /^(standing|stand up|upright|walking)$/i.test(token.trim()),
            },
        ],
    },
{
        id: "partner-count",
        label: "伴侣人数",
        families: [
            {
                id: "couple",
                label: "双人",
                priority: 70,
                match: (token) => /^(sex with one man|single male partner|only one boy|two people only)$/i.test(token.trim()),
            },
            {
                id: "multi",
                label: "多人",
                priority: 90,
                match: (token) => /\b(threesome|foursome|orgy|gangbang|group sex|mmf threesome|ffm threesome|sex with multiple men|spitroast)\b/i.test(token),
            },
        ],
    },
{
        id: "girl-count",
        label: "女性人数",
        families: [
            { id: "multi-girl", label: "多女", priority: 90, match: (token) => /^(2girls|multiple girls|3girls|two women|three women)$/i.test(token) },
            { id: "one-girl", label: "单女", priority: 70, match: (token) => /^(1girl|one woman)$/i.test(token) },
        ],
    },
{
        id: "boy-count",
        label: "男性人数",
        families: [
            { id: "multi-boy", label: "多男", priority: 90, match: (token) => /^(2boys|multiple boys|3boys)$/i.test(token) },
            { id: "one-boy", label: "单男", priority: 70, match: (token) => /^1boy$/i.test(token) },
        ],
    },
{
        id: "facing",
        label: "朝向",
        families: [
            { id: "rear", label: "背面", priority: 88, match: (token) => !isInstructionToken(token) && REAR_RE.test(token) },
            { id: "side", label: "侧面", priority: 70, match: (token) => !isInstructionToken(token) && /\b(side view|profile|from side)\b/i.test(token) && !/three-quarter/i.test(token) },
            { id: "front", label: "正面", priority: 60, match: (token) => !isInstructionToken(token) && /\b(front view|facing viewer|facing audience|from front)\b/i.test(token) },
        ],
    },
{
        id: "camera-angle",
        label: "机位",
        families: [
            { id: "low", label: "仰视", priority: 95, match: (token) => !isInstructionToken(token) && /\b(low angle|from below|worm'?s[- ]eye|peer in from below)\b/i.test(token) },
            { id: "high", label: "俯视", priority: 90, match: (token) => !isInstructionToken(token) && /\b(high angle|from above|bird'?s[- ]eye)\b/i.test(token) && !/top-down bottom-up/i.test(token) },
            { id: "eye", label: "平视", priority: 50, match: (token) => !isInstructionToken(token) && /\b(eye level|eye-level)\b/i.test(token) },
        ],
    },
{
        id: "shot",
        label: "景别",
        families: [
            // full body 与 pure close-up 互斥；genital focus 走 body-focus 组
            {
                id: "full",
                label: "全身",
                priority: 80,
                match: (token) =>
                    !isInstructionToken(token) &&
                    /^(full body|whole body|wide shot|full body front view|full body male pov)$/i.test(token.trim()),
            },
            {
                id: "upper",
                label: "半身",
                priority: 70,
                match: (token) => !isInstructionToken(token) && /^(upper body|portrait|cowboy shot|bust)$/i.test(token.trim()),
            },
            {
                id: "close",
                label: "特写",
                priority: 85,
                match: (token) =>
                    !isInstructionToken(token) &&
                    /^(close-up|close up|face focus|macro shot)$/i.test(token.trim()),
            },
        ],
    },
{
        id: "body-focus",
        label: "身体焦点",
        families: [
            {
                id: "ass",
                label: "臀部焦点",
                priority: 88,
                match: (token) => /^(ass focus|butt focus|hip focus)$/i.test(token.trim()) || /\bass focus\b/i.test(token),
            },
            {
                id: "pussy",
                label: "阴部焦点",
                priority: 86,
                match: (token) =>
                    /^(pussy focus|vagina focus|genital focus|pussy and ass view)$/i.test(token.trim()) ||
                    /\b(vagina focus|pussy focus|genital focus)\b/i.test(token),
            },
            {
                id: "breast",
                label: "胸部焦点",
                priority: 70,
                match: (token) => /^(breast focus|chest focus)$/i.test(token.trim()) || /\bbreast focus\b/i.test(token),
            },
            {
                id: "face",
                label: "面部焦点",
                priority: 75,
                match: (token) => /^(face focus|portrait focus)$/i.test(token.trim()),
            },
        ],
    },
{
        id: "pov-framing",
        label: "POV构图",
        families: [
            {
                id: "male-pov-front",
                label: "男主仰视POV",
                priority: 90,
                match: (token) => /\b(full body male pov|male pov|from below pov|low angle male pov)\b/i.test(token) && !/\brear\b/i.test(token),
            },
            {
                id: "rear-pov",
                label: "背面插入构图",
                priority: 92,
                match: (token) => /\b(POV creampie|pov creampie|rear pussy view|vagina visible from behind|pussy from behind)\b/i.test(token),
            },
        ],
    },
{
        id: "eye-state",
        label: "眼神状态",
        families: [
            { id: "looking-viewer", label: "看镜头", priority: 60, match: (token) => /^(looking at viewer|eye contact|staring)$/i.test(token.trim()) },
            { id: "looking-back", label: "回眸", priority: 75, match: (token) => /\b(looking back|look back|over shoulder|turned head)\b/i.test(token) },
            { id: "closed", label: "闭眼", priority: 55, match: (token) => /^(closed eyes|eyes closed)$/i.test(token.trim()) },
        ],
    },
{
        id: "cum-location",
        label: "射精位置",
        families: [
            {
                id: "inside",
                label: "内射",
                priority: 80,
                match: (token) =>
                    /\b(creampie|cum in pussy|cum inside|internal cumshot|cum overflow(?: from pussy)?|pussy filled with cum|cum dripping from pussy|cumdrip)\b/i.test(token) &&
                    !/\bcum on\b/i.test(token),
            },
            {
                id: "face",
                label: "颜射",
                priority: 78,
                match: (token) => /\b(facial|facial ejaculation|cum on face|bukkake|cum on tongue|cum in mouth)\b/i.test(token),
            },
            {
                id: "body",
                label: "体外",
                priority: 70,
                match: (token) => /\b(cum on body|cum on breasts|cum on pussy|covered in semen)\b/i.test(token),
            },
        ],
    },
{
        id: "clothing-state",
        label: "着衣状态",
        families: [
            { id: "nude", label: "全裸", priority: 80, match: (token) => /^(nude|completely nude|naked)$/i.test(token) },
            {
                id: "partial",
                label: "半脱",
                priority: 70,
                match: (token) => /\b(open clothes|clothes lift|shirt lift|skirt lift|undressing|topless|bottomless|panties aside|no panties|no bra)\b/i.test(token),
            },
            { id: "clothed", label: "着衣", priority: 50, match: (token) => /^(fully clothed|clothed sex)$/i.test(token) },
        ],
    },
{
        id: "breast-size",
        label: "胸围",
        families: [
            { id: "huge", label: "超大胸", priority: 80, match: (token) => /^(huge breasts)$/i.test(token) },
            { id: "large", label: "大胸", priority: 70, match: (token) => /^(large breasts)$/i.test(token) },
            { id: "medium", label: "中胸", priority: 60, match: (token) => /^(medium breasts)$/i.test(token) },
            { id: "small", label: "小胸", priority: 55, match: (token) => /^(small breasts)$/i.test(token) },
            { id: "flat", label: "贫乳", priority: 50, match: (token) => /^(flat chest)$/i.test(token) },
        ],
    },
{
        id: "hair-length",
        label: "发长",
        families: [
            { id: "long", label: "长发", priority: 70, match: (token) => /^(long hair|very long hair)$/i.test(token) },
            { id: "medium", label: "中发", priority: 55, match: (token) => /^(medium hair|semi-long hair)$/i.test(token) },
            { id: "short", label: "短发", priority: 60, match: (token) => /^(short hair|very short hair|bob hair)$/i.test(token) },
        ],
    },
{
        id: "focus-style",
        label: "对焦风格",
        families: [
            { id: "sharp", label: "锐利对焦", priority: 70, match: (token) => /^(sharp focus|tack sharp|crisp focus)$/i.test(token.trim()) },
            { id: "soft", label: "柔焦", priority: 65, match: (token) => /^(soft focus|soft focus photography|dreamy focus)$/i.test(token.trim()) },
        ],
    },
{
        id: "render-style",
        label: "成像风格",
        families: [
            {
                id: "photo",
                label: "照片风",
                priority: 70,
                match: (token) => /^(photorealistic|raw photo|dslr|analog film photo|film grain|grainy|faded film)$/i.test(token.trim()),
            },
            {
                id: "illustration",
                label: "插画风",
                priority: 68,
                match: (token) => /^(illustration|anime style|cartoon|cel shading)$/i.test(token.trim()),
            },
        ],
    },

    {
        id: "expression",
        label: "表情",
        families: [
            {
                id: "ahegao",
                label: "啊嘿颜",
                priority: 100,
                match: (token) => /\b(ahegao|rolling eyes|mind break|orgasm face|tongue out)\b/i.test(token) || /啊嘿颜|翻白眼|失神/.test(token),
            },
            {
                id: "smile",
                label: "微笑",
                priority: 80,
                match: (token) => /\b(gentle smile|light smile|smile)\b/i.test(token) && !/\bahegao\b/i.test(token),
            },
            {
                id: "cry",
                label: "哭泣",
                priority: 80,
                match: (token) => /\b(cry|crying|tears|sad face)\b/i.test(token),
            },
            {
                id: "angry",
                label: "愤怒",
                priority: 80,
                match: (token) => /\b(angry|anger|furious|glare)\b/i.test(token),
            },
        ],
    },
];

/** 本地生图友好顺序：画质 → 人数 → 防futa → 身份 → 服装 → 换姿指令 → 体位 → 行为 → 机位 → 表情 → 稳定器 → 光影 */
const SORT_BUCKETS: Array<{ id: string; test: (token: string) => boolean }> = [
    { id: "quality", test: (t) => /\b(masterpiece|best quality|amazing quality|high quality|ultra[- ]detailed|highly detailed|absurdres|high resolution|photorealistic|illustration|very aesthetic|newest)\b/i.test(t) },
    { id: "subject", test: (t) => /^(1girl|2girls|1boy|2boys|solo|couple|multiple girls|multiple boys|hetero)$/i.test(t.trim()) },
    { id: "antifuta", test: (t) => /\b(no futanari|no girl penis|penis belongs|only one boy|single male partner|two people only|one penis only)\b/i.test(t) },
    { id: "identity", test: (t) => /\b(same face|same hair|same outfit|same clothing|same character|keep character|teal tips|blue eyes|brown eyes|green eyes|red eyes|brown hair|black hair|blonde|long hair|very long hair|detailed face|natural skin|no yellow)\b/i.test(t) },
    { id: "clothing", test: (t) => /\b(dress|skirt|shirt|uniform|panties|bra|clothes|clothing|nude|naked|bottomless|topless|hem|frill|lace|bow)\b/i.test(t) },
    { id: "instruction", test: (t) => isInstructionToken(t) || /\b(change pose completely|do not keep original standing|replace standing pose)\b/i.test(t) },
    { id: "pose", test: (t) => CONFLICT_GROUPS.find((group) => group.id === "pose")!.families.some((family) => family.match(t)) || /\b(sitting|straddling|knees bent|man lying under|male partner under|girl on top|man on top|on all fours)\b/i.test(t) },
    { id: "act", test: (t) => PARTNER_SEX_RE.test(t) || /\b(penis|cock|pussy|vagina|insertion|creampie|balls deep|cum overflow)\b/i.test(t) },
    {
        id: "view",
        test: (t) =>
            CONFLICT_GROUPS.some((group) => ["camera-angle", "facing", "shot"].includes(group.id) && group.families.some((family) => family.match(t))) ||
            /\b(close-?up|macro|detail shot|vagina focus|ass focus|face focus|rear view|from behind|three-quarter)\b/i.test(t),
    },
    { id: "expression", test: (t) => AHEGAO_RE.test(t) || /\b(smile|blush|open mouth|closed eyes|expression|looking back|flushed|saliva|tongue out)\b/i.test(t) },
    { id: "stabilizer", test: (t) => /\b(single head|single crotch|stable pelvis|single torso|one upper body only)\b/i.test(t) },
    { id: "light", test: (t) => /\b(lighting|light|shadow|glow|sunlight|soft lighting|cinematic)\b/i.test(t) },
];

export function splitPromptTokens(input: string): string[] {
    return (input || "")
        .split(/[,，\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
}

export function joinPromptTokens(tokens: string[]): string {
    return tokens
        .map((token) => token.trim())
        .filter(Boolean)
        .join(", ");
}

export function composePromptFromBaseAndTags(base: string, selectedTags: string[], smart = true, options?: { hasReferenceImages?: boolean }): SmartComposeResult {
    // 场景模板/多标签原子串：展开后再合并，保证排序与消歧按子词进行
    const preferred = selectedTags
        .flatMap((tag) => (/,|，/.test(tag) ? splitPromptTokens(tag) : [tag.trim()]))
        .map((tag) => tag.trim())
        .filter(Boolean);
    const baseTokens = splitPromptTokens(base);
    const existing = new Set(baseTokens.map((token) => normalizeToken(token)));
    const merged = [...baseTokens];
    for (const tag of preferred) {
        const key = normalizeToken(tag);
        if (!key || existing.has(key)) continue;
        existing.add(key);
        merged.push(tag);
    }
    if (!smart) {
        return {
            prompt: joinPromptTokens(merged),
            tokens: merged,
            removed: [],
            notes: [],
            hasReferencePoseChange: Boolean(options?.hasReferenceImages && merged.some((token) => POSE_CHANGE_RE.test(token))),
        };
    }
    return smartComposePrompt(merged, { preferred, hasReferenceImages: options?.hasReferenceImages });
}

export function smartComposePrompt(input: string | string[], options?: { preferred?: string[]; hasReferenceImages?: boolean }): SmartComposeResult {
    const preferredSet = new Set((options?.preferred || []).map((item) => normalizeToken(item)).filter(Boolean));
    const source = Array.isArray(input) ? input.map((item) => item.trim()).filter(Boolean) : splitPromptTokens(input);
    const sourceText = Array.isArray(input) ? source.join(", ") : String(input || "");
    const items: TokenItem[] = [];
    const seen = new Set<string>();
    const removed: SmartComposeRemoval[] = [];
    const notes: string[] = [];

    source.forEach((raw, index) => {
        if (isCanvasReferenceNoiseToken(raw)) {
            removed.push({ token: raw, reason: "画布引用标记噪音" });
            return;
        }
        const normalized = normalizeToken(raw);
        if (!normalized) return;
        if (seen.has(normalized)) {
            removed.push({ token: raw, reason: "重复标签" });
            return;
        }
        seen.add(normalized);
        items.push({
            raw,
            normalized,
            preferred: preferredSet.has(normalized),
            index,
            locked: isInstructionToken(raw),
        });
    });

    let working = [...items];

    for (const group of CONFLICT_GROUPS) {
        // 每个 token 只归入该组内优先级最高的 family，避免 standing doggystyle 同时命中后入/站立后被自己踢掉
        const itemFamily = new Map<TokenItem, ConflictFamily>();
        for (const item of working) {
            if (item.locked) continue;
            let best: ConflictFamily | null = null;
            for (const family of group.families) {
                if (!(family.match(item.raw) || family.match(item.normalized))) continue;
                if (!best || family.priority > best.priority) best = family;
            }
            if (best) itemFamily.set(item, best);
        }
        if (itemFamily.size <= 1) continue;

        const byFamily = new Map<string, { family: ConflictFamily; items: TokenItem[] }>();
        for (const [item, family] of itemFamily) {
            const bucket = byFamily.get(family.id) || { family, items: [] as TokenItem[] };
            bucket.items.push(item);
            byFamily.set(family.id, bucket);
        }
        const matched = [...byFamily.values()];
        if (matched.length <= 1) continue;

        matched.sort((a, b) => {
            const aPreferred = a.items.some((item) => item.preferred);
            const bPreferred = b.items.some((item) => item.preferred);
            if (aPreferred !== bPreferred) return aPreferred ? -1 : 1;
            if (a.family.priority !== b.family.priority) return b.family.priority - a.family.priority;
            const aLatest = Math.max(...a.items.map((item) => item.index));
            const bLatest = Math.max(...b.items.map((item) => item.index));
            return bLatest - aLatest;
        });
        const winner = matched[0];
        const loserItems = matched.slice(1).flatMap((entry) => entry.items);
        if (!loserItems.length) continue;
        const loserKeys = new Set(loserItems.map((item) => item.normalized));
        for (const item of loserItems) {
            removed.push({ token: item.raw, reason: `与更合适的${group.label}冲突，保留「${winner.family.label}」` });
        }
        working = working.filter((item) => !loserKeys.has(item.normalized));
    }

    // drop pure standing pose if a strong sex pose won
    const hasStrongSexPose = working.some((item) => /\b(reverse cowgirl|cowgirl|doggy|doggystyle|missionary|mating press|girl on top|lotus position|spooning|standing sex|standing doggystyle|prone bone|full nelson)\b/i.test(item.raw));
    if (hasStrongSexPose) {
        const standingItems = working.filter((item) => /^(standing|stand up|upright)$/i.test(item.raw.trim()));
        if (standingItems.length) {
            const keys = new Set(standingItems.map((item) => item.normalized));
            for (const item of standingItems) removed.push({ token: item.raw, reason: "与性交姿势冲突，移除站姿" });
            working = working.filter((item) => !keys.has(item.normalized));
        }
    }

    const textBlob = working.map((item) => item.raw).join(", ");
    const hasPartnerSex = PARTNER_SEX_RE.test(textBlob);
    const hasMale = working.some((item) => MALE_RE.test(item.raw));
    const hasFuta = working.some((item) => FUTA_RE.test(item.raw));
    const hasAhegao = working.some((item) => AHEGAO_RE.test(item.raw));
    const hasRear = working.some((item) => REAR_RE.test(item.raw));
    const hasLookBack = working.some((item) => LOOK_BACK_RE.test(item.raw));
    const hasPoseChange = working.some((item) => POSE_CHANGE_RE.test(item.raw));
    const hasReverseCowgirl = working.some((item) => /\breverse cowgirl\b/i.test(item.raw) || /\bgirl on top facing away\b/i.test(item.raw));

    if (hasPartnerSex) {
        const soloItems = working.filter((item) => SOLO_RE.test(item.normalized) || item.normalized === "solo");
        if (soloItems.length) {
            const soloKeys = new Set(soloItems.map((item) => item.normalized));
            for (const item of soloItems) removed.push({ token: item.raw, reason: "与插入/双人位语义冲突" });
            working = working.filter((item) => !soloKeys.has(item.normalized));
            notes.push("已移除 solo，避免和插入/双人位打架");
        }
        // 未明确要多人时，清掉 2boys/multiple boys，避免相机男/路人乱入
        const multiRequested = working.some((item) => /^(2girls|3girls|multiple girls|2boys|3boys|multiple boys|group sex|threesome|gangbang)$/i.test(item.raw));
        if (!multiRequested) {
            const multiItems = working.filter((item) => /\b(2boys|3boys|multiple boys|extra boys|crowd|group|threesome|gangbang)\b/i.test(item.raw));
            if (multiItems.length) {
                const multiKeys = new Set(multiItems.map((item) => item.normalized));
                for (const item of multiItems) removed.push({ token: item.raw, reason: "双人位默认单伴侣，移除多人男标签" });
                working = working.filter((item) => !multiKeys.has(item.normalized));
            }
        }
        if (!hasMale && !hasFuta) {
            const hasGirl = working.some((item) => /\b1girl\b/i.test(item.raw) || /\bgirl\b/i.test(item.raw));
            if (hasGirl) {
                pushUnique(working, "1boy", true, notes, "检测到双人位/插入语义，已补 1boy，避免被理解成 futa");
            }
        }
        pushUnique(working, "hetero", true);
        pushUnique(working, "no futanari", true);
        pushUnique(working, "no girl penis", true);
        pushUnique(working, "penis belongs to the man under her", true, notes, "已补反 futa 约束：阴茎属于身下男性");
        if (!multiRequested) {
            pushUnique(working, "only one boy", true);
            pushUnique(working, "single male partner", true);
            pushUnique(working, "two people only", true);
        }
    }

    if (hasReverseCowgirl) {
        for (const token of REVERSE_COWGIRL_EXPANSION) pushUnique(working, token, true);
        notes.push("已展开 reverse cowgirl 结构：女坐男上、背对、男在身下");
    }

    const hasDoggy = working.some((item) => /\b(doggy|doggystyle|prone bone|sex from behind)\b/i.test(item.raw));
    if (hasDoggy && !hasReverseCowgirl) {
        for (const token of DOGGY_EXPANSION) pushUnique(working, token, true);
        notes.push("已展开 doggystyle 结构：四肢着地/从后/男在后方");
    }

    const hasMissionary = working.some((item) => /\b(missionary|mating press)\b/i.test(item.raw));
    if (hasMissionary && !hasReverseCowgirl && !hasDoggy) {
        for (const token of MISSIONARY_EXPANSION) pushUnique(working, token, true);
        notes.push("已展开 missionary 结构：女仰躺、男上位、反 futa");
    }

    // drop front view if reverse cowgirl / rear sex won
    if (hasReverseCowgirl || (hasDoggy && hasRear)) {
        const frontItems = working.filter((item) => !item.locked && /\b(front view|facing viewer|facing audience)\b/i.test(item.raw) && !/looking back/i.test(item.raw));
        if (frontItems.length) {
            const keys = new Set(frontItems.map((item) => item.normalized));
            for (const item of frontItems) removed.push({ token: item.raw, reason: "与背面/反向女上位冲突，移除正面朝向" });
            working = working.filter((item) => !keys.has(item.normalized));
        }
    }

    if (hasAhegao && hasRear && !hasLookBack) {
        pushUnique(working, "looking back over shoulder", true, notes, "背面 + 高潮脸冲突，已补 looking back over shoulder");
    }

    // 构图消歧：避免全身男主POV + 背面骑乘 + 双焦点 + 内射同义词堆叠导致解剖畸变
    const hasCowgirlFacing =
        working.some((item) => /\bcowgirl\b/i.test(item.raw) && !/\breverse cowgirl\b/i.test(item.raw)) ||
        working.some((item) => /\bgirl on top\b/i.test(item.raw) && !/facing away/i.test(item.raw));
    working = cleanupCompositionConflicts(working, removed, notes, {
        hasReverseCowgirl,
        hasDoggy,
        hasMissionary,
        hasCowgirl: hasCowgirlFacing,
        hasRear: working.some((item) => REAR_RE.test(item.raw)),
        hasAhegao: working.some((item) => AHEGAO_RE.test(item.raw)),
    });

    // force single main couple for partner sex unless multi already requested
    if (hasPartnerSex && !working.some((item) => /^(2girls|3girls|multiple girls|2boys|3boys|multiple boys)$/i.test(item.raw))) {
        pushUnique(working, "1girl", true);
        pushUnique(working, "1boy", true);
    }

    const finalItems: TokenItem[] = [];
    const finalSeen = new Set<string>();
    for (const item of working) {
        if (finalSeen.has(item.normalized)) continue;
        finalSeen.add(item.normalized);
        finalItems.push(item);
    }

    const hasReferencePoseChange = Boolean(options?.hasReferenceImages && (hasPoseChange || hasReverseCowgirl));
    if (hasReferencePoseChange) {
        // 只补最短身份/换姿指令；不要再塞 replace standing... 长句，避免 instruction 噪音冲主体
        // reverse cowgirl 已在 cleanup 里写了具体发色/回眸，这里不再回灌 same character identity / bare long hair
        const prefix = hasReverseCowgirl
            ? [
                "same face",
                "same hair",
                "same outfit",
                "change pose completely",
                "do not keep original standing composition",
            ]
            : [
                "same face",
                "same hair",
                "same outfit",
                "same character identity",
                "change pose completely",
                "do not keep original standing composition",
            ];
        for (let index = prefix.length - 1; index >= 0; index -= 1) {
            const token = prefix[index];
            if (finalSeen.has(normalizeToken(token))) continue;
            finalItems.unshift({
                raw: token,
                normalized: normalizeToken(token),
                preferred: true,
                index: -100 + index,
                locked: false,
            });
            finalSeen.add(normalizeToken(token));
        }
        // 再次压 instruction，防止与用户原文叠成 6~8 条同义指令
        const instructionHits = finalItems
            .map((item, index) => ({ item, index }))
            .filter(({ item }) =>
                /^(same face|same hair|same outfit|same outfit unless prompt changes clothing|keep character identity from reference|change pose completely|do not keep original standing composition|replace standing pose with the requested sex position)$/i.test(
                    item.raw.trim(),
                ),
            );
        if (instructionHits.length > 5) {
            instructionHits.sort((a, b) => {
                const rank = (token: string) => {
                    if (/change pose completely/i.test(token)) return 100;
                    if (/do not keep original standing/i.test(token)) return 95;
                    if (/same face/i.test(token)) return 90;
                    if (/same hair/i.test(token)) return 85;
                    if (/^same outfit$/i.test(token.trim())) return 84;
                    if (/same outfit unless/i.test(token)) return 70;
                    return 40;
                };
                return rank(b.item.raw) - rank(a.item.raw) || a.index - b.index;
            });
            const dropKeys = new Set(instructionHits.slice(5).map(({ item }) => item.normalized));
            for (const { item } of instructionHits.slice(5)) {
                removed.push({ token: item.raw, reason: "参考图路径指令过多，二次精简" });
            }
            finalItems.splice(0, finalItems.length, ...finalItems.filter((item) => !dropKeys.has(item.normalized)));
        }
        notes.push("检测到参考图 + 姿势大改，已注入精简 keep/change pose 指令");
    }

    let sorted = sortTokens(finalItems.map((item) => item.raw));
    // 大改姿势 + 参考图：FaceID 只锁脸，服饰细节必须文字 densify（v14 仅 generic，具体装来自证据）
    if (options?.hasReferenceImages && hasReferencePoseChange) {
        // v14: 只注入 generic 锁身份结构，具体发色/瞳色/服装必须已在提示词中出现（由参考 identity merge / 用户词提供）
        // 只补「还没有的结构锚点」；已有具体发色/服装时绝不回灌 long hair / match 系
        const densifyOutfitGeneric = [
            "same face",
            "same hair",
            "same outfit",
            "detailed face",
        ];
        const seen = new Set(sorted.map((t) => t.trim().toLowerCase()));
        const injected: string[] = [];
        const outfitChangeCorpus = `${sourceText}\n${sorted.join(", ")}`;
        const outfitChange =
            /\b(change (?:clothes|clothing|outfit)|different (?:dress|outfit|clothes)|wear(?:ing)? (?:a )?(?:black|red|blue|pink) (?:dress|lingerie)|lingerie|bikini|nude|naked|school uniform|wardrobe change)\b/i.test(
                outfitChangeCorpus,
            );
        const hasConcreteHairAlready = /\b(brown|black|blonde|silver|white|pink|blue|red|purple|green) hair\b|teal tips/i.test(
            outfitChangeCorpus,
        );
        if (!outfitChange) {
            const hasOutfitSignal = /\b(same outfit|same clothing|keep character|dress|skirt|uniform|outfit)\b/i.test(
                outfitChangeCorpus,
            );
            for (const term of densifyOutfitGeneric) {
                const key = term.toLowerCase();
                if (seen.has(key)) continue;
                if (!hasOutfitSignal && !hasReverseCowgirl && !hasReferencePoseChange) continue;
                seen.add(key);
                injected.push(term);
            }
            // 仅 reverse cowgirl 且无具体发色时补泛 long hair；其它体位不硬塞，避免短发角色被洗成长发
            if (hasReverseCowgirl && !hasConcreteHairAlready) {
                for (const term of ["long hair", "very long hair"]) {
                    const key = term.toLowerCase();
                    if (seen.has(key)) continue;
                    seen.add(key);
                    injected.push(term);
                }
            }
            // 裙摆：仅 corpus 已有 dress/skirt 且还没有任何 hem/flared 时补 1 条 flared skirt
            if (/\b(dress|skirt)\b/i.test(outfitChangeCorpus) && !/\b(flared skirt|ruffled|frilled hem|skirt hem)\b/i.test(outfitChangeCorpus)) {
                if (!seen.has("flared skirt")) {
                    seen.add("flared skirt");
                    injected.push("flared skirt");
                }
            }
            if (injected.length) {
                sorted = [...injected, ...sorted];
                notes.push("参考图大改姿势：已 densify 通用身份结构（具体发色/服装以提示词证据为准）");
            }
        } else {
            notes.push("检测到换装意图：跳过 same-outfit densify");
        }
    }
    // 粘贴/点选后的同义折叠：具体发色压掉 long hair 堆、具体服装压掉 match reference 等
    sorted = collapseRedundantIdentityStrings(sorted, removed, notes);

    // 本地模型友好：身份/人数/防futa 统一重排；参考图换姿时身份更靠前
    sorted = orderTokensForLocalModel(sorted, {
        hasReferenceImages: Boolean(options?.hasReferenceImages),
        hasReferencePoseChange,
        hasPartnerSex,
    });
    if ((hasReverseCowgirl || hasReferencePoseChange) && options?.hasReferenceImages) {
        sorted = prioritizeIdentityFront(sorted);
        notes.push("参考图大改姿势路径：身份/服饰词已强制置顶");
    }
    return {
        prompt: joinPromptTokens(sorted),
        tokens: sorted,
        removed,
        notes: uniqueNotes(notes),
        hasReferencePoseChange,
    };
}

/** 标签增强对：选中 left 时，right 侧标签应高亮提示可补强（双向）。 */
const BOOST_PAIRS: Array<{ a: RegExp; b: RegExp; reason: string }> = [
    // 不要用 1boy/hetero/full body 这种“所有双人模板都有”的词当增强，否则互斥姿势会集体亮绿
    {
        a: /\breverse cowgirl\b/i,
        b: /\b(rear view|from behind|ass towards camera|low angle from below|looking back|man lying under her|straddling male partner|visible insertion|creampie|ass focus)\b/i,
        reason: "反向女上位常用补强",
    },
    {
        a: /\bcowgirl\b/i,
        b: /\b(girl on top squatting facing viewer|full body male pov|man under her|visible insertion|low angle from below)\b/i,
        reason: "女上位常用补强",
    },
    {
        a: /\b(doggy|doggystyle|prone bone)\b/i,
        b: /\b(from behind|rear view|ass towards camera|on all fours|all fours|visible insertion|ass focus)\b/i,
        reason: "后入位常用补强",
    },
    {
        a: /\b(missionary|mating press)\b/i,
        b: /\b(on back|facing viewer|boy on top|man on top|legs spread|full body)\b/i,
        reason: "传教士位常用补强",
    },
    { a: /\b(ahegao|rolling eyes|mind break)\b/i, b: /\b(looking back|open mouth|tongue out|blush|flushed cheeks|sweat)\b/i, reason: "高潮脸常见辅助" },
    { a: /\b(full body|wide shot)\b/i, b: /\b(feet visible|complete figure|from below)\b/i, reason: "全身构图辅助" },
    {
        a: /\b(masterpiece|best quality|amazing quality)\b/i,
        b: /\b(highly detailed|ultra-detailed|absurdres|detailed face|detailed eyes|beautiful lighting)\b/i,
        reason: "画质前后缀互补",
    },
    { a: /\b(detailed face)\b/i, b: /\b(detailed eyes|beautiful lighting|sharp focus)\b/i, reason: "面部细节增强" },
    {
        a: /\b(photorealistic|raw photo|dslr)\b/i,
        b: /\b(film grain|analog film photo|sharp focus|depth of field|soft lighting)\b/i,
        reason: "写实照片风增强",
    },
    { a: /\b(1girl)\b/i, b: /\b(solo|single subject)\b/i, reason: "单人主体增强" },
    {
        a: /\b(visible insertion|explicit penetration)\b/i,
        b: /\b(balls deep|pussy stretched around cock|vagina focus|thick penis deeply inserted)\b/i,
        reason: "插入细节补强",
    },
    { a: /\b(looking back|over shoulder)\b/i, b: /\b(rear view|from behind|ahegao|ass towards camera)\b/i, reason: "回眸与背面机位互补" },
    {
        a: /\b(creampie|cum overflow|cum in pussy)\b/i,
        b: /\b(visible insertion|pussy stretched|vagina focus|after sex)\b/i,
        reason: "内射相关补强",
    },
    { a: /\b(long hair)\b/i, b: /\b(bangs|sidelocks|ponytail|twintails)\b/i, reason: "长发造型辅助" },
    { a: /\b(large breasts|huge breasts)\b/i, b: /\b(cleavage|underboob|breast focus)\b/i, reason: "胸围相关辅助" },
];

/** 给组合器热词/标签提供即时关系提示：block=置灰禁用，warn=会覆盖，boost=可增强。 */
export function getTagConflictHint(candidate: string, selectedTags: string[], basePrompt = ""): TagConflictHint | null {
    return getTagRelationHint(candidate, selectedTags, basePrompt);
}

export function getTagRelationHint(candidate: string, selectedTags: string[], basePrompt = ""): TagRelationHint | null {
    const candidateToken = candidate.trim();
    if (!candidateToken) return null;
    const selected = selectedTags.map((tag) => tag.trim()).filter(Boolean);
    const baseTokens = splitPromptTokens(basePrompt);
    const context = [...baseTokens, ...selected];
    if (!context.length) return null;

    // already selected → no relation chip needed
    if (selected.some((token) => normalizeToken(token) === normalizeToken(candidateToken))) return null;

    // 场景模板是逗号拼接的原子标签：关系判断必须拆成子词，否则 1boy/hetero 会把互斥姿势误判成“增强”
    const candidateAtoms = expandTagAtoms(candidateToken);
    const selectedAtoms = selected.flatMap((token) => expandTagAtoms(token));
    const contextAtoms = [...baseTokens.flatMap((token) => expandTagAtoms(token)), ...selectedAtoms];

    const exclusive = findExclusiveFamilyConflict(candidateToken, candidateAtoms, selected, selectedAtoms, context, contextAtoms);
    if (exclusive) return exclusive;

    // preferred 把自己顶成赢家时，removedSelf 可能为空；互斥已在上面按 family 硬拦
    // baseline：不加候选时的消歧结果。模板自清理（去 ahegao/同义词）不能算成“候选会覆盖”
    const baseline = smartComposePrompt(context, { preferred: selected.length ? selected : undefined });
    const preview = smartComposePrompt([...context, candidateToken], { preferred: [candidateToken, ...selected] });
    const removedSelf = preview.removed.find((item) => normalizeToken(item.token) === normalizeToken(candidateToken));
    const removedIsRedundant =
        !!removedSelf &&
        /重复|同义|折叠|去掉泛|只保留|已有.+去掉|过多|主发色|match reference|same clothing design/i.test(removedSelf.reason);
    // 真互斥才在这里拦截；同义折叠继续往下走，让 boost 对「rear view 增强 reverse cowgirl」仍成立
    if (removedSelf && !removedIsRedundant) {
        return {
            severity: "block",
            reason: removedSelf.reason,
            against: preview.tokens.filter((token) => token !== candidateToken).slice(0, 3),
        };
    }

    // hard semantic blocks even if compose didn't drop candidate as preferred winner
    if (SOLO_RE.test(normalizeToken(candidateToken)) && contextAtoms.some((token) => PARTNER_SEX_RE.test(token))) {
        return { severity: "block", reason: "与已选插入/双人位冲突", against: context.filter((token) => PARTNER_SEX_RE.test(token)).slice(0, 3) };
    }
    if (
        /^(standing|stand up|upright)$/i.test(candidateToken.trim()) &&
        contextAtoms.some((token) => /\b(reverse cowgirl|cowgirl|doggy|doggystyle|missionary|mating press|girl on top)\b/i.test(token))
    ) {
        return {
            severity: "block",
            reason: "与已选性交姿势冲突",
            against: context.filter((token) => /\b(reverse cowgirl|cowgirl|doggy|doggystyle|missionary|mating press|girl on top)\b/i.test(token)).slice(0, 3),
        };
    }
    if (
        /\b(front view|facing viewer|facing audience)\b/i.test(candidateToken) &&
        !/looking back/i.test(candidateToken) &&
        contextAtoms.some((token) => /\breverse cowgirl\b|\bfrom behind\b|\brear view\b|\bass towards camera\b/i.test(token))
    ) {
        return {
            severity: "block",
            reason: "与背面/反向女上位冲突",
            against: context.filter((token) => /\breverse cowgirl\b|\bfrom behind\b|\brear view\b|\bass towards camera\b/i.test(token)).slice(0, 3),
        };
    }
    if (
        /\b(full body male pov|male pov)\b/i.test(candidateToken) &&
        !/\brear|from behind\b/i.test(candidateToken) &&
        contextAtoms.some((token) => /\breverse cowgirl\b/i.test(token)) &&
        contextAtoms.some((token) => /\b(rear view|from behind|ass towards camera)\b/i.test(token))
    ) {
        return {
            severity: "block",
            reason: "男主正面仰视POV与反向女上位背面构图冲突",
            against: context.filter((token) => /\breverse cowgirl\b|\brear view\b|\bass towards camera\b/i.test(token)).slice(0, 3),
        };
    }
    if (
        /\bass focus\b/i.test(candidateToken) &&
        contextAtoms.some((token) => /\b(vagina focus|pussy focus|genital focus)\b/i.test(token)) &&
        contextAtoms.some((token) => /\breverse cowgirl\b|\brear view\b/i.test(token))
    ) {
        return {
            severity: "warn",
            reason: "会与阴部焦点抢主焦点，易导致腰胯畸变",
            against: context.filter((token) => /\b(vagina focus|pussy focus|genital focus)\b/i.test(token)).slice(0, 2),
        };
    }
    if (
        /\b(vagina focus|pussy focus|genital focus)\b/i.test(candidateToken) &&
        contextAtoms.some((token) => /\bass focus\b/i.test(token)) &&
        contextAtoms.some((token) => /\breverse cowgirl\b|\brear view\b/i.test(token))
    ) {
        return {
            severity: "warn",
            reason: "会与臀部焦点抢主焦点，易导致腰胯畸变",
            against: context.filter((token) => /\bass focus\b/i.test(token)).slice(0, 2),
        };
    }
    if (/^(illustration|anime style)$/i.test(candidateToken.trim()) && contextAtoms.some((token) => /^(photorealistic|raw photo|dslr)$/i.test(token.trim()))) {
        return { severity: "block", reason: "与照片写实风冲突", against: context.filter((token) => /^(photorealistic|raw photo|dslr)$/i.test(token.trim())).slice(0, 3) };
    }
    if (/^(photorealistic|raw photo|dslr)$/i.test(candidateToken.trim()) && contextAtoms.some((token) => /^(illustration|anime style)$/i.test(token.trim()))) {
        return { severity: "block", reason: "与插画风冲突", against: context.filter((token) => /^(illustration|anime style)$/i.test(token.trim())).slice(0, 3) };
    }
    if (/^(soft focus)$/i.test(candidateToken.trim()) && contextAtoms.some((token) => /^(sharp focus)$/i.test(token.trim()))) {
        return { severity: "block", reason: "与锐利对焦冲突", against: ["sharp focus"] };
    }
    if (/^(sharp focus)$/i.test(candidateToken.trim()) && contextAtoms.some((token) => /^(soft focus)$/i.test(token.trim()))) {
        return { severity: "block", reason: "与柔焦冲突", against: ["soft focus"] };
    }

    // 只有“baseline 还保留、加候选后却被踢掉”的已选/上下文词，才算真覆盖
    const baselineKept = new Set(baseline.tokens.map((token) => normalizeToken(token)));
    const previewKept = new Set(preview.tokens.map((token) => normalizeToken(token)));
    const causedRemovals = [...baselineKept]
        .filter((key) => !previewKept.has(key))
        .filter((key) => context.some((token) => normalizeToken(token) === key))
        // 候选自己本来就不该算覆盖对象
        .filter((key) => key !== normalizeToken(candidateToken));
    if (causedRemovals.length) {
        const labels = causedRemovals.slice(0, 3).map((key) => {
            const hit = context.find((token) => normalizeToken(token) === key);
            return hit || key;
        });
        return {
            severity: "warn",
            reason: `会覆盖：${labels.join("、")}`,
            against: labels,
        };
    }
    if (PARTNER_SEX_RE.test(candidateToken) && contextAtoms.some((token) => SOLO_RE.test(normalizeToken(token)))) {
        return { severity: "warn", reason: "会移除 solo", against: ["solo"] };
    }

    // boost: complementary with currently selected tags（且不在任何互斥 family 对上）
    const boostAgainst: string[] = [];
    let boostReason = "";
    const selectedProbe = selected.length ? selected : context;
    for (const selectedToken of selectedProbe) {
        const selectedParts = expandTagAtoms(selectedToken);
        for (const pair of BOOST_PAIRS) {
            const hit = atomsMatchPair(selectedParts, candidateAtoms, pair.a, pair.b) || atomsMatchPair(selectedParts, candidateAtoms, pair.b, pair.a);
            if (hit) {
                boostAgainst.push(selectedToken);
                boostReason = pair.reason;
            }
        }
    }
    if (boostAgainst.length) {
        return {
            severity: "boost",
            reason: boostReason || "与已选标签互补",
            against: [...new Set(boostAgainst)].slice(0, 3),
        };
    }
    return null;
}

/** 逗号拼接的场景模板 → 子标签；单标签原样返回 */
function expandTagAtoms(token: string): string[] {
    const parts = splitPromptTokens(token);
    return parts.length ? parts : [token.trim()].filter(Boolean);
}

function atomsMatchPair(leftAtoms: string[], rightAtoms: string[], leftRe: RegExp, rightRe: RegExp): boolean {
    const leftHit = leftAtoms.some((token) => leftRe.test(token));
    const rightHit = rightAtoms.some((token) => rightRe.test(token));
    return leftHit && rightHit;
}

function bestFamilyForAtoms(group: ConflictGroup, atoms: string[], rawToken: string): ConflictFamily | null {
    let best: ConflictFamily | null = null;
    for (const family of group.families) {
        const hit = family.match(rawToken) || atoms.some((atom) => family.match(atom) || family.match(normalizeToken(atom)));
        if (!hit) continue;
        if (!best || family.priority > best.priority) best = family;
    }
    return best;
}

function findExclusiveFamilyConflict(
    candidateToken: string,
    candidateAtoms: string[],
    selected: string[],
    selectedAtoms: string[],
    context: string[],
    contextAtoms: string[],
): TagRelationHint | null {
    for (const group of CONFLICT_GROUPS) {
        const candidateFamily = bestFamilyForAtoms(group, candidateAtoms, candidateToken);
        if (!candidateFamily) continue;

        const sources = selected.length ? selected : context;
        let conflictSource: string | null = null;
        let conflictFamily: ConflictFamily | null = null;
        for (const source of sources) {
            const sourceFamily = bestFamilyForAtoms(group, expandTagAtoms(source), source);
            if (!sourceFamily) continue;
            if (sourceFamily.id === candidateFamily.id) continue;
            conflictSource = source;
            conflictFamily = sourceFamily;
            break;
        }
        if (!conflictSource || !conflictFamily) continue;
        return {
            severity: "block",
            reason: `与已选${group.label}「${conflictFamily.label}」冲突，当前是「${candidateFamily.label}」`,
            against: [conflictSource.length > 72 ? `${conflictSource.slice(0, 72)}…` : conflictSource],
        };
    }
    return null;
}

/** 是否属于画质前缀（order ~10） */
export function isQualityPrefixTag(tag: { en: string; orderWeight?: number; kind?: string }) {
    if (tag.kind === "prefix") return true;
    if (typeof tag.orderWeight === "number" && tag.orderWeight <= 15) {
        return /\b(8k|masterpiece|best quality|amazing quality|high quality|ultra-detailed|absurdres|high resolution|highres)\b/i.test(tag.en);
    }
    return /\b(8k|masterpiece|best quality|amazing quality|ultra-detailed|absurdres|high resolution|highres)\b/i.test(tag.en);
}

/** 是否属于画质/氛围后缀（order ~70） */
export function isQualitySuffixTag(tag: { en: string; orderWeight?: number; kind?: string }) {
    if (tag.kind === "suffix") return true;
    if (typeof tag.orderWeight === "number" && tag.orderWeight >= 60 && tag.orderWeight < 90) {
        return /\b(lighting|depth of field|newest|soft focus|cinematic|detailed|aesthetic|sharp focus|highly detailed)\b/i.test(tag.en);
    }
    return /\b(beautiful lighting|depth of field|soft focus|cinematic|detailed skin|detailed eyes|detailed face|detailed background|intricate details|sharp focus|very aesthetic|highly detailed)\b/i.test(tag.en);
}

export function applySmartPromptForGeneration(prompt: string, options?: { hasReferenceImages?: boolean }) {
    return smartComposePrompt(prompt, { hasReferenceImages: options?.hasReferenceImages });
}

function cleanupCompositionConflicts(
    working: TokenItem[],
    removed: SmartComposeRemoval[],
    notes: string[],
    flags: {
        hasReverseCowgirl: boolean;
        hasDoggy: boolean;
        hasMissionary?: boolean;
        hasCowgirl?: boolean;
        hasRear: boolean;
        hasAhegao: boolean;
    },
): TokenItem[] {
    let next = [...working];

    const dropMatching = (predicate: (item: TokenItem) => boolean, reason: string) => {
        const losers = next.filter((item) => !item.locked && predicate(item));
        if (!losers.length) return;
        const keys = new Set(losers.map((item) => item.normalized));
        for (const item of losers) removed.push({ token: item.raw, reason });
        next = next.filter((item) => !keys.has(item.normalized));
    };

    const keepTopRanked = (
        predicate: (item: TokenItem) => boolean,
        rank: (token: string) => number,
        keepCount: number,
        reason: string,
    ) => {
        const hits = next
            .map((item, index) => ({ item, index }))
            .filter(({ item }) => !item.locked && predicate(item));
        if (hits.length <= keepCount) return;
        // 语义强度优先，preferred 只做同分 tie-break，避免扩张词把更关键原词挤掉
        hits.sort((a, b) => {
            const rankDiff = rank(b.item.raw) - rank(a.item.raw);
            if (rankDiff !== 0) return rankDiff;
            if (a.item.preferred !== b.item.preferred) return a.item.preferred ? -1 : 1;
            return a.index - b.index;
        });
        const losers = hits.slice(keepCount).map(({ item }) => item);
        const keys = new Set(losers.map((item) => item.normalized));
        for (const item of losers) removed.push({ token: item.raw, reason });
        next = next.filter((item) => !keys.has(item.normalized));
    };

    // reverse cowgirl rear composition cannot also be "full body male pov"
    if (flags.hasReverseCowgirl && flags.hasRear) {
        dropMatching(
            (item) => /\b(full body male pov|male pov|pov from below)\b/i.test(item.raw) && !/\brear|from behind|ass towards/i.test(item.raw),
            "反向女上位背面构图与男主正面仰视POV冲突，移除 male pov",
        );
        // rear reverse cowgirl: vagina focus + ass focus dual pull warps pelvis
        const assFocus = next.filter((item) => /\bass focus\b/i.test(item.raw));
        const pussyFocus = next.filter((item) => /\b(vagina focus|pussy focus|genital focus)\b/i.test(item.raw));
        if (assFocus.length && pussyFocus.length) {
            const assPreferred = assFocus.some((item) => item.preferred);
            const pussyPreferred = pussyFocus.some((item) => item.preferred);
            if (pussyPreferred && !assPreferred) {
                dropMatching((item) => /\bass focus\b/i.test(item.raw), "已有阴部焦点，移除臀部焦点避免骨盆畸变");
            } else {
                dropMatching((item) => /\b(vagina focus|pussy focus|genital focus)\b/i.test(item.raw), "背面骑乘保留臀部焦点，移除阴部焦点避免双焦点拉扯");
            }
        } else if (pussyFocus.length && !assFocus.length) {
            // 背面全身骑乘时 vagina focus 常把镜头往胯下硬拉，腰/腿/头拧断；改成 ass focus + 可见插入
            dropMatching((item) => /\b(vagina focus|pussy focus|genital focus)\b/i.test(item.raw), "背面全身骑乘下阴部焦点易导致腰胯畸变，改为臀部焦点");
            pushUnique(next, "ass focus", true, notes, "背面骑乘已改用 ass focus，降低胯部拉扯");
        }
        dropMatching((item) => /^pov creampie$/i.test(item.raw.trim()), "背面构图下 POV creampie 易和 rear view 抢机位");
    }

    // reverse cowgirl: looking back + ahegao 同在时保留啊嘿颜并 densify，避免模板表情被洗成普通回眸
    if (flags.hasReverseCowgirl) {
        const hasLookBack = next.some((item) => LOOK_BACK_RE.test(item.raw));
        const hasAhegao = next.some((item) => /\bahegao\b/i.test(item.raw));
        if (hasLookBack && hasAhegao) {
            // BOSS 场景模板明确要啊嘿颜：回眸时保留 ahegao，并 densify 表情锚点
            // （旧逻辑直接删 ahegao 会导致最终只有普通回眸脸）
            pushUnique(next, "ahegao", true);
            pushUnique(next, "rolling eyes", true);
            pushUnique(next, "tongue out", true);
            pushUnique(next, "open mouth", true);
            pushUnique(next, "flushed cheeks", true);
            pushUnique(next, "saliva trail", true, notes, "回眸+啊嘿颜：保留高潮脸并 densify 表情锚点");
            // mind break 易与头颈畸变叠加，仅保留一次核心 ahegao 簇
            const mindHits = next
                .map((item, index) => ({ item, index }))
                .filter(({ item }) => /\bmind break\b/i.test(item.raw));
            if (mindHits.length > 1) {
                const dropKeys = new Set(mindHits.slice(1).map(({ item }) => item.normalized));
                for (const { item } of mindHits.slice(1)) {
                    removed.push({ token: item.raw, reason: "mind break 重复，精简为一次" });
                }
                next = next.filter((item) => !dropKeys.has(item.normalized));
            }
        } else if (hasAhegao && !hasLookBack && flags.hasRear) {
            // 纯背面脸不可见时，先补回眸再保留啊嘿颜（而不是直接删表情）
            pushUnique(next, "looking back over shoulder", true, notes, "背面啊嘿颜：补回眸使高潮脸可见");
            pushUnique(next, "ahegao", true);
            pushUnique(next, "rolling eyes", true);
            pushUnique(next, "tongue out", true);
            pushUnique(next, "open mouth", true);
            pushUnique(next, "flushed cheeks", true);
        }
    }

    // insertion synonym spam → keep strongest 2
    keepTopRanked(
        (item) =>
            /\b(visible insertion|explicit penetration|cock in pussy|penis in pussy|thick penis deeply inserted into (pussy|vagina)|balls deep|pussy stretched around cock)\b/i.test(
                item.raw,
            ),
        (token) => {
            if (/\bvisible insertion\b/i.test(token)) return 100;
            if (/\bpussy stretched around cock\b/i.test(token)) return 95;
            if (/\bballs deep\b/i.test(token)) return 90;
            if (/\bthick penis deeply inserted into vagina\b/i.test(token)) return 85;
            if (/\bthick penis deeply inserted into pussy\b/i.test(token)) return 80;
            if (/\bcock in pussy\b/i.test(token)) return 70;
            if (/\bexplicit penetration\b/i.test(token)) return 60;
            return 40;
        },
        3,
        "插入同义词过多，保留最强三项避免解剖过载畸变",
    );

    // creampie synonym spam → keep strongest 2
    keepTopRanked(
        (item) => /\b(creampie|cum (in|inside|overflow|dripping)|internal cumshot|pussy filled with cum)\b/i.test(item.raw),
        (token) => {
            if (/\bcreampie overflow\b/i.test(token)) return 100;
            if (/\bcum overflow from pussy\b/i.test(token)) return 95;
            if (/\bcreampie\b/i.test(token)) return 90;
            if (/\bcum in pussy\b/i.test(token)) return 80;
            if (/\bcum dripping from pussy\b/i.test(token)) return 75;
            if (/\bcum overflow\b/i.test(token)) return 70;
            return 40;
        },
        2,
        "内射同义词过多，保留最强两项避免细节过载畸变",
    );
    if (removed.some((item) => /内射同义词过多/.test(item.reason))) {
        notes.push("已精简内射同义词，降低解剖/液体细节过载");
    }
    if (removed.some((item) => /插入同义词过多/.test(item.reason))) {
        notes.push("已精简插入同义词，降低腰胯细节过载");
    }

    // full body + pure close-up conflict leftover hard drop
    const hasFull = next.some(
        (item) => /^(full body|whole body|wide shot|full body male pov)$/i.test(item.raw.trim()) || /\bfull body\b/i.test(item.raw),
    );
    if (hasFull) {
        dropMatching((item) => /^(close-up|close up|macro shot)$/i.test(item.raw.trim()), "全身构图与纯特写冲突");
    }

    // reverse cowgirl anatomy stabilizers + anti-warp / anti-twin positives
    if (flags.hasReverseCowgirl) {
        // partner-position synonym spam → keep strongest 3 structure tokens
        // 注意：
        // 1) 不要用裸 man under her，否则会误伤 "penis belongs to the man under her"
        // 2) single male partner / only one boy 是人数约束，不是姿势结构，禁止进这组
        keepTopRanked(
            (item) => {
                const t = item.raw.trim();
                if (/penis belongs|only one boy|two people only|single male partner|no futanari|no girl penis/i.test(t)) return false;
                return /^(man lying under her|male partner under her|man under her|straddling male partner|girl sitting on top facing away|girl on top facing away|sitting on male partner)$/i.test(
                    t,
                );
            },
            (token) => {
                // preferred 排序会偏扩张词；这里用语义权重压过 preferred，确保保留核心结构
                if (/^girl on top facing away$/i.test(token.trim())) return 100;
                if (/^man lying under her$/i.test(token.trim())) return 95;
                if (/^straddling male partner$/i.test(token.trim())) return 90;
                if (/^girl sitting on top facing away$/i.test(token.trim())) return 60;
                if (/^male partner under her$/i.test(token.trim())) return 50;
                if (/^sitting on male partner$/i.test(token.trim())) return 45;
                if (/^man under her$/i.test(token.trim())) return 40;
                return 30;
            },
            3,
            "骑乘结构同义词过多，保留最强三项避免主体分裂",
        );

        // knees bent synonym
        keepTopRanked(
            (item) => /^(her knees bent|knees bent)$/i.test(item.raw.trim()),
            (token) => (/^knees bent$/i.test(token.trim()) ? 90 : 70),
            1,
            "膝盖弯曲同义词去重",
        );

        // reverse cowgirl 背面/骑乘：压孪生上身，词量再砍一轮，给身份词腾权重
        const hasLookBackNow = next.some((item) => LOOK_BACK_RE.test(item.raw));
        dropMatching(
            (item) => /^(girl sitting on top facing away)$/i.test(item.raw.trim()) && hasLookBackNow,
            "回眸背面下移除重复 facing-away 句式，降低双上身",
        );
        pushUnique(next, "single head", true, notes, "反向女上位已加单头约束，抑制孪生上身");
        keepTopRanked(
            (item) => /^(single head|one head only|single torso|one upper body only)$/i.test(item.raw.trim()),
            (token) => {
                if (/^single head$/i.test(token.trim())) return 100;
                if (/one head only/i.test(token)) return 80;
                if (/single torso/i.test(token)) return 70;
                if (/one upper body only/i.test(token)) return 60;
                return 40;
            },
            1,
            "单头/单躯干同义词过多，只保留一项",
        );

        // 背面骑乘最容易把男伴画没 → 阴茎落到女主身上变 futa
        // 只保留“可见男体 + 阴茎归属”最强短词
        pushUnique(next, "male torso under her", true);
        pushUnique(next, "male hands on her hips", true);
        pushUnique(next, "his penis", true);
        pushUnique(next, "no futanari", true, notes, "反向女上位强制男伴可见身体部件与阴茎归属，抑制扶她误读");
        keepTopRanked(
            (item) =>
                /^(male body under her|male torso under her|male thighs under her|male hands on her hips|male partner partially visible under her|his legs spread under her|his penis|penis attached to the man under her)$/i.test(
                    item.raw.trim(),
                ),
            (token) => {
                if (/^male torso under her$/i.test(token.trim())) return 100;
                if (/^his penis$/i.test(token.trim())) return 95;
                if (/^male hands on her hips$/i.test(token.trim())) return 90;
                if (/male body under her/i.test(token)) return 70;
                if (/male thighs under her/i.test(token)) return 60;
                if (/male partner partially visible/i.test(token)) return 50;
                if (/his legs spread under her/i.test(token)) return 45;
                if (/penis attached to the man under her/i.test(token)) return 40;
                return 30;
            },
            3,
            "男体可见同义词过多，保留最强三项",
        );
        keepTopRanked(
            (item) =>
                /^(no futanari|not futanari|no girl penis|no dickgirl|no shemale|female without penis|hetero sex)$/i.test(item.raw.trim()) ||
                /\b(no futanari|not futanari|no girl penis|no dickgirl|no shemale|female without penis|hetero sex)\b/i.test(item.raw),
            (token) => {
                if (/^no futanari$/i.test(token.trim())) return 100;
                if (/^no girl penis$/i.test(token.trim())) return 90;
                return 40;
            },
            2,
            "反 futa 同义词过多，保留两项",
        );

        // v14 身份防漂：只补 generic 锁；具体发色/瞳色若已在 next 中则 keepTop 保留，绝不写死茶发青梢/蓝眼
        pushUnique(next, "same face", true);
        pushUnique(next, "same hair", true);
        pushUnique(next, "detailed face", true, notes, "反向女上位已补 generic 锁脸，具体发色/瞳色以提示词证据为准");
        if (next.some((item) => /\beyes\b/i.test(item.raw))) {
            // 保留已有瞳色，不强制 blue eyes
        }
        if (next.some((item) => /hair|teal tips/i.test(item.raw))) {
            pushUnique(next, "long hair", true);
            pushUnique(next, "very long hair", true);
        }
        keepTopRanked(
            (item) =>
                /^(long hair|very long hair|long brown hair|brown hair with teal tips|long brown hair with teal tips|long hair with teal tips|teal hair tips|no short hair|no bob cut)$/i.test(
                    item.raw.trim(),
                ),
            (token) => {
                if (/long brown hair with teal tips/i.test(token)) return 100;
                if (/brown hair with teal tips/i.test(token)) return 95;
                if (/long hair with teal tips/i.test(token)) return 90;
                if (/teal hair tips/i.test(token)) return 85;
                if (/^no short hair$/i.test(token.trim())) return 60;
                if (/^long brown hair$/i.test(token.trim())) return 50;
                if (/very long hair/i.test(token)) return 40;
                if (/^long hair$/i.test(token.trim())) return 30;
                if (/no bob cut/i.test(token)) return 20;
                return 10;
            },
            2,
            "头发身份同义词过多，保留最强两项",
        );
        dropMatching(
            (item) => /^(same face from reference|same character identity|keep character identity from reference)$/i.test(item.raw.trim()),
            "身份指令去重，保留 same face/same hair",
        );
        if (next.some((item) => /teal tips|teal hair tips/i.test(item.raw))) {
            dropMatching(
                (item) => /^(long hair|very long hair|long brown hair|teal hair tips)$/i.test(item.raw.trim()),
                "已有茶发青梢细节，移除泛化/重复发词",
            );
        }
        // 抗黄只留 2 个最短词，避免风格词再冲身份
        pushUnique(next, "natural skin tone", true);
        pushUnique(next, "no yellow tint", true, notes, "反向女上位已补自然肤色/抗黄约束，抑制偏色风格漂");
        keepTopRanked(
            (item) => /^(natural skin tone|true color|no yellow tint|no yellow filter|neutral white balance)$/i.test(item.raw.trim()),
            (token) => {
                if (/natural skin tone/i.test(token)) return 100;
                if (/no yellow tint/i.test(token)) return 90;
                if (/true color/i.test(token)) return 70;
                return 40;
            },
            2,
            "抗黄同义词压缩",
        );

        // 默认不堆 weight on legs：和 knees bent 同义占位
        keepTopRanked(
            (item) => /^(knees bent|her knees bent|weight on legs)$/i.test(item.raw.trim()),
            (token) => {
                if (/^knees bent$/i.test(token.trim())) return 100;
                if (/her knees bent/i.test(token)) return 80;
                if (/weight on legs/i.test(token)) return 40;
                return 20;
            },
            1,
            "膝盖/承重同义词过多，只保留 knees bent",
        );

        // 侧后 + 单一回眸词：让脸进画面；男体只靠 torso/hands，不再追加更多男体同义
        pushUnique(next, "three-quarter rear view", true);
        pushUnique(next, "looking back over shoulder", true, notes, "反向女上位改侧后回眸构图，利于锁脸且露出男体");
        keepTopRanked(
            (item) =>
                /^(three-quarter rear view|from behind and slightly to the side|looking back|looking over shoulder|looking back over shoulder)$/i.test(
                    item.raw.trim(),
                ),
            (token) => {
                if (/three-quarter rear view/i.test(token)) return 100;
                if (/looking back over shoulder/i.test(token)) return 95;
                if (/from behind and slightly to the side/i.test(token)) return 70;
                if (/looking over shoulder/i.test(token)) return 50;
                if (/^looking back$/i.test(token.trim())) return 40;
                return 30;
            },
            2,
            "机位/回眸同义词过多，保留侧后+回眸两项",
        );

        // 解剖稳定词最多 1 个，避免 instruction 化噪音压过主体
        pushUnique(next, "stable pelvis", true);
        keepTopRanked(
            (item) =>
                /^(natural spine twist|anatomically correct|stable pelvis|coherent limbs|correct female anatomy)$/i.test(item.raw.trim()),
            (token) => {
                if (/stable pelvis/i.test(token)) return 100;
                if (/anatomically correct/i.test(token)) return 80;
                if (/coherent limbs/i.test(token)) return 60;
                if (/natural spine twist/i.test(token)) return 50;
                if (/correct female anatomy/i.test(token)) return 40;
                return 20;
            },
            1,
            "解剖稳定词过多，只保留一项",
        );
        // 单阴茎 + 单胯下：各留 1 个最强词
        pushUnique(next, "one penis only", true);
        pushUnique(next, "single crotch", true, notes, "已补单阴茎/单胯下约束，降低下体重复畸变");
        keepTopRanked(
            (item) =>
                /^(one penis only|single penis|only one cock|single shaft|one male penis only)$/i.test(item.raw.trim()) ||
                /\b(one penis only|single penis|only one cock|single shaft|one male penis only)\b/i.test(item.raw),
            (token) => {
                if (/one penis only/i.test(token)) return 100;
                if (/single penis/i.test(token)) return 90;
                return 40;
            },
            1,
            "单阴茎同义词过多，只保留一项",
        );
        keepTopRanked(
            (item) => /^(single crotch|one vagina only|clean genital anatomy)$/i.test(item.raw.trim()),
            (token) => {
                if (/single crotch/i.test(token)) return 100;
                if (/one vagina only/i.test(token)) return 80;
                if (/clean genital anatomy/i.test(token)) return 60;
                return 30;
            },
            1,
            "单胯下同义词过多，只保留一项",
        );

        // 厚插入/深插/撑开 是下体重复高发词：背面骑乘默认砍掉，只留 1 个轻量插入词
        dropMatching(
            (item) =>
                /\b(thick penis deeply inserted into (pussy|vagina)|pussy stretched around cock|balls deep|explicit penetration|cock in pussy|penis in pussy)\b/i.test(
                    item.raw,
                ),
            "反向女上位去掉重插入细节词，降低下体重复",
        );
        keepTopRanked(
            (item) => /\b(visible insertion|penetration)\b/i.test(item.raw),
            (token) => (/visible insertion/i.test(token) ? 100 : 50),
            1,
            "反向女上位插入词最多保留 1 项",
        );

        // 液体溢出最容易把胯下画成双腔/双根残留：默认清空，除非用户 preferred 且只留 1 个轻量 creampie
        const liquidHits = next.filter((item) =>
            /\b(creampie overflow|cum overflow from pussy|creampie|cum in pussy|cum dripping from pussy|internal cumshot|pussy filled with cum)\b/i.test(
                item.raw,
            ),
        );
        if (liquidHits.length) {
            const preferredLiquid = liquidHits.filter((item) => item.preferred);
            if (!preferredLiquid.length) {
                dropMatching(
                    (item) =>
                        /\b(creampie overflow|cum overflow from pussy|creampie|cum in pussy|cum dripping from pussy|internal cumshot|pussy filled with cum)\b/i.test(
                            item.raw,
                        ),
                    "反向女上位默认移除液体溢出词，降低下体重复",
                );
            } else {
                // preferred 也只留最轻的一项，并降级 overflow
                dropMatching(
                    (item) => /\b(creampie overflow|cum overflow from pussy|cum dripping from pussy|internal cumshot|pussy filled with cum)\b/i.test(item.raw),
                    "反向女上位液体降级，去掉 overflow/dripping",
                );
                keepTopRanked(
                    (item) => /\b(creampie|cum in pussy)\b/i.test(item.raw),
                    (token) => (/^creampie$/i.test(token.trim()) ? 100 : 70),
                    1,
                    "反向女上位液体最多保留 1 项",
                );
            }
        }

        // 去掉重复 instruction 噪音（过多 keep/same 指令会冲淡主体）
        keepTopRanked(
            (item) =>
                /^(same face|same hair|same outfit|same outfit unless prompt changes clothing|keep character identity from reference|change pose completely|do not keep original standing composition|replace standing pose with the requested sex position)$/i.test(
                    item.raw.trim(),
                ),
            (token) => {
                if (/change pose completely/i.test(token)) return 100;
                if (/do not keep original standing/i.test(token)) return 95;
                if (/same face/i.test(token)) return 90;
                if (/same hair/i.test(token)) return 85;
                if (/^same outfit$/i.test(token.trim())) return 84;
                if (/same outfit unless/i.test(token)) return 70;
                if (/keep character identity/i.test(token)) return 60;
                if (/replace standing pose/i.test(token)) return 50;
                return 40;
            },
            5,
            "姿势指令/身份指令过多，保留最关键几项",
        );
    }

    // v14.1: 其它体位共用解剖/反 futa 稳定器（不绑死 reverse cowgirl）
    const anySexPose = Boolean(
        flags.hasReverseCowgirl || flags.hasDoggy || flags.hasMissionary || flags.hasCowgirl,
    );
    if (anySexPose) {
        pushUnique(next, "no futanari", true);
        pushUnique(next, "hetero", true);
        pushUnique(next, "1girl", true);
        pushUnique(next, "1boy", true);
        pushUnique(next, "two people only", true);
        if (!next.some((item) => /penis belongs to the man/i.test(item.raw))) {
            pushUnique(next, "penis belongs to the man under her", true, notes, "全性体位模板：补阴茎归属，防 futa");
        }
        pushUnique(next, "one penis only", true);
        pushUnique(next, "single crotch", true);
        keepTopRanked(
            (item) =>
                /^(no futanari|not futanari|no girl penis|no dickgirl|no shemale|female without penis)$/i.test(item.raw.trim()) ||
                /\b(no futanari|no girl penis)\b/i.test(item.raw),
            (token) => (/^no futanari$/i.test(token.trim()) ? 100 : 80),
            2,
            "反 futa 同义词过多，保留两项",
        );
    }

    if (flags.hasDoggy && !flags.hasReverseCowgirl) {
        keepTopRanked(
            (item) =>
                /^(on all fours|all fours|from behind|man behind her|prone bone|doggystyle)$/i.test(item.raw.trim()) ||
                /\b(on all fours|from behind|man behind her)\b/i.test(item.raw),
            (token) => {
                if (/doggystyle/i.test(token)) return 100;
                if (/on all fours/i.test(token)) return 95;
                if (/man behind her/i.test(token)) return 90;
                if (/from behind/i.test(token)) return 85;
                return 40;
            },
            3,
            "后入结构同义词过多，保留最强三项",
        );
        pushUnique(next, "single head", true, notes, "doggystyle：单头约束抑制孪生上身");
        pushUnique(next, "stable pelvis", true);
        if (flags.hasAhegao && flags.hasRear) {
            pushUnique(next, "looking back over shoulder", true, notes, "后入+啊嘿颜：补回眸使高潮脸可见");
        }
        // 后入双焦点：全身时偏好 ass focus
        const hasFullDog = next.some((item) => /\bfull body\b/i.test(item.raw));
        if (hasFullDog) {
            dropMatching(
                (item) => /\b(vagina focus|pussy focus|genital focus)\b/i.test(item.raw),
                "后入全身构图下阴部焦点易畸变，改为臀部焦点",
            );
            pushUnique(next, "ass focus", true, notes, "doggystyle 全身：ass focus 降胯部拉扯");
        }
    }

    if (flags.hasMissionary && !flags.hasReverseCowgirl && !flags.hasDoggy) {
        keepTopRanked(
            (item) =>
                /^(missionary|mating press|boy on top|man on top|girl lying on back|girl lying on back facing viewer)$/i.test(
                    item.raw.trim(),
                ) || /\b(missionary|mating press|man on top|boy on top)\b/i.test(item.raw),
            (token) => {
                if (/mating press/i.test(token)) return 100;
                if (/^missionary$/i.test(token.trim())) return 95;
                if (/man on top|boy on top/i.test(token)) return 90;
                if (/girl lying on back/i.test(token)) return 85;
                return 40;
            },
            3,
            "传教士结构同义词过多，保留最强三项",
        );
        pushUnique(next, "single head", true, notes, "missionary：单头约束");
        pushUnique(next, "stable pelvis", true);
        // missionary 正面：去掉 rear/ass towards 冲突
        dropMatching(
            (item) => /\b(ass towards camera|rear view|from behind)\b/i.test(item.raw) && !/looking back/i.test(item.raw),
            "传教士与背面机位冲突",
        );
    }

    if (flags.hasCowgirl && !flags.hasReverseCowgirl) {
        pushUnique(next, "girl on top", true);
        pushUnique(next, "straddling male partner", true);
        pushUnique(next, "man lying under her", true);
        pushUnique(next, "single head", true, notes, "cowgirl：单头约束");
        pushUnique(next, "stable pelvis", true);
    }

    return next;
}

function pushUnique(working: TokenItem[], token: string, preferred = false, notes?: string[], note?: string) {
    const normalized = normalizeToken(token);
    if (working.some((item) => item.normalized === normalized)) return;
    working.push({
        raw: token,
        normalized,
        preferred,
        index: working.length + 2000,
        locked: isInstructionToken(token),
    });
    if (notes && note) notes.push(note);
}


/** 同义/包含关系折叠：粘贴或点选后自动去掉重复身份与锁装词，避免用户手工剔重 */
function collapseRedundantIdentityStrings(
    tokens: string[],
    removed: SmartComposeRemoval[],
    notes: string[],
): string[] {
    if (!tokens.length) return tokens;
    const items = tokens.map((raw, index) => ({ raw, key: normalizeToken(raw), index }));
    const drop = new Set<number>();
    const markDrop = (index: number, reason: string) => {
        if (drop.has(index)) return;
        drop.add(index);
        removed.push({ token: items[index].raw, reason });
    };

    const keepTopByRank = (
        match: (raw: string) => boolean,
        rank: (raw: string) => number,
        limit: number,
        reason: string,
    ) => {
        const hits = items
            .map((item, index) => ({ item, index, score: match(item.raw) ? rank(item.raw) : -1 }))
            .filter((entry) => entry.score >= 0 && !drop.has(entry.index));
        if (hits.length <= limit) return;
        hits.sort((a, b) => b.score - a.score || a.index - b.index);
        for (const entry of hits.slice(limit)) markDrop(entry.index, reason);
    };

    // --- 发色：有具体「色+发」时，压掉泛 long hair / match reference hair ---
    const hasConcreteHair = items.some(
        (item) =>
            !drop.has(item.index) &&
            /\b(brown|black|blonde|silver|white|pink|blue|red|purple|green) hair\b|teal tips|two-tone hair/i.test(item.raw),
    );
    if (hasConcreteHair) {
        // 具体发色内部：保留信息量最高的一条主发色
        keepTopByRank(
            (raw) =>
                /\b(brown|black|blonde|silver|white|pink|blue|red|purple|green) hair\b|teal tips|two-tone hair/i.test(raw) &&
                !/match reference/i.test(raw),
            (raw) => {
                let score = 0;
                if (/with teal tips|two-tone/i.test(raw)) score += 50;
                if (/\blong brown hair with teal tips\b/i.test(raw)) score += 40;
                if (/\bbrown hair with teal tips\b/i.test(raw)) score += 30;
                if (/\bteal tips\b/i.test(raw) && !/hair/i.test(raw)) score += 10;
                if (/\b(brown|black|blonde|silver|white|pink|blue|red|purple|green) hair\b/i.test(raw)) score += 20;
                if (/\blong\b/i.test(raw)) score += 8;
                if (/\bvery long\b/i.test(raw)) score += 5;
                // 更长短语通常更具体
                score += Math.min(raw.length, 40) / 10;
                return score;
            },
            1,
            "重复发色描述，只保留最具体一条",
        );
        // 长度词最多留 1 条；有「long brown hair…」时连 very long/long 都可砍
        const keptHair = items.find(
            (item) =>
                !drop.has(item.index) &&
                /\b(brown|black|blonde|silver|white|pink|blue|red|purple|green) hair\b|teal tips/i.test(item.raw),
        );
        const hairAlreadySaysLong = keptHair ? /\blong\b/i.test(keptHair.raw) : false;
        keepTopByRank(
            (raw) => /^(very long hair|long hair|short hair)$/i.test(raw.trim()),
            (raw) => {
                if (hairAlreadySaysLong) return 0; // 将被全部丢掉（limit 0 via special）
                if (/^very long hair$/i.test(raw.trim())) return 90;
                if (/^long hair$/i.test(raw.trim())) return 80;
                return 50;
            },
            hairAlreadySaysLong ? 0 : 1,
            hairAlreadySaysLong ? "主发色已含 long，去掉多余长度词" : "头发长度同义词只保留一条",
        );
        for (const item of items) {
            if (drop.has(item.index)) continue;
            if (/match reference hair|match reference hair length and color/i.test(item.raw)) {
                markDrop(item.index, "已有具体发色，移除 match reference 发色兜底");
            }
            if (/^teal tips$/i.test(item.raw.trim()) && keptHair && /teal tips/i.test(keptHair.raw) && item.index !== keptHair.index) {
                markDrop(item.index, "teal tips 已包含在主发色短语中");
            }
        }
    }

    // --- 瞳色：具体瞳色只留 1 ---
    keepTopByRank(
        (raw) => /\b(blue|brown|green|red|amber|purple|golden|black|grey|gray) eyes\b/i.test(raw),
        (raw) => raw.length,
        1,
        "重复瞳色，只保留一条",
    );

    // --- 服装：有具体 dress/skirt 时，压 generic lock / match reference ---
    const hasConcreteOutfit = items.some(
        (item) =>
            !drop.has(item.index) &&
            /\b(white|black|red|blue|pink|cream).{0,20}(dress|skirt)|school uniform|sailor uniform|maid outfit|kimono|lingerie|bikini\b/i.test(
                item.raw,
            ),
    );
    if (hasConcreteOutfit) {
        for (const item of items) {
            if (drop.has(item.index)) continue;
            if (/match reference clothing design|preserve outfit silhouette from reference/i.test(item.raw)) {
                markDrop(item.index, "已有具体服装，移除 match/preserve 兜底");
            }
            // same clothing design 与 same outfit 叠：有具体装时 clothing design 可去
            if (/^same clothing design$/i.test(item.raw.trim())) {
                markDrop(item.index, "已有具体服装 + same outfit，去掉 same clothing design");
            }
            // 单独 skirt 在 white dress + flared/ruffled 同时存在时偏冗余
            if (/^skirt$/i.test(item.raw.trim())) {
                const hasDressOrHem = items.some(
                    (other) =>
                        !drop.has(other.index) &&
                        other.index !== item.index &&
                        /\b(dress|flared skirt|ruffled|frilled hem|skirt hem)\b/i.test(other.raw),
                );
                if (hasDressOrHem) markDrop(item.index, "已有连衣裙/裙摆细节，去掉泛 skirt");
            }
        }
        // 裙摆细节最多 2 条（flared / ruffled / frilled）
        keepTopByRank(
            (raw) => /\b(flared skirt|ruffled skirt hem|frilled hem|lace trim|petticoat)\b/i.test(raw),
            (raw) => {
                if (/flared skirt/i.test(raw)) return 90;
                if (/ruffled skirt hem/i.test(raw)) return 80;
                if (/frilled hem/i.test(raw)) return 70;
                return 40;
            },
            2,
            "裙摆细节过多，保留最强两项",
        );
    }

    // --- 阴茎归属同义 ---
    keepTopByRank(
        (raw) => /penis belongs/i.test(raw),
        (raw) => {
            if (/penis belongs to the man under her/i.test(raw)) return 100;
            if (/penis belongs to man/i.test(raw)) return 70;
            return 40;
        },
        1,
        "阴茎归属同义词只保留一条",
    );

    // --- 机位：three-quarter rear 与 rear view 并存时留更具体 ---
    const hasThreeQuarter = items.some((item) => !drop.has(item.index) && /three-quarter rear/i.test(item.raw));
    if (hasThreeQuarter) {
        for (const item of items) {
            if (drop.has(item.index)) continue;
            if (/^rear view$/i.test(item.raw.trim()) || /^back view$/i.test(item.raw.trim())) {
                markDrop(item.index, "已有 three-quarter rear view，去掉泛 rear view");
            }
        }
    }

    // --- ass focus / ass towards camera：可并存，但 ass towards + ass focus 都留；from behind 与 rear 略叠时 keepTop ---
    keepTopByRank(
        (raw) => /^(from behind|seen from behind|back view)$/i.test(raw.trim()),
        (raw) => (/from behind/i.test(raw) ? 80 : 50),
        1,
        "背面机位同义词精简",
    );

    const next = items.filter((item) => !drop.has(item.index)).map((item) => item.raw);
    if (drop.size) {
        notes.push(`已自动折叠 ${drop.size} 个重复/同义外观词（发色·服装·归属·机位）`);
    }
    return next;
}

function uniqueNotes(notes: string[]) {
    return [...new Set(notes)];
}

function isInstructionToken(token: string) {
    // 场景模板是逗号拼接的多标签原子串，绝不能整串锁成 instruction，否则姿势互斥失效
    if (/[,，]/.test(token)) return false;
    return INSTRUCTION_RE.test(token);
}


function prioritizeIdentityFront(tokens: string[]): string[] {
    const identityRank = (token: string) => {
        const t = token.trim();
        if (/^same face$/i.test(t)) return 1000;
        if (/^same hair$/i.test(t)) return 990;
        if (/^same outfit$/i.test(t)) return 980;
        if (/keep same white dress|same clothing design/i.test(t)) return 975;
        if (/very long hair|hair past shoulders|flowing long hair|same hairstyle/i.test(t)) return 972;
        if (/^long hair$/i.test(t)) return 971;
        // 具体发色/瞳色优先于泛化 same*，本地模型更吃具体锚点
        if (/hair with .*tips|teal tips|two-tone hair|gradient hair/i.test(t)) return 985;
        if (/\b(brown|black|blonde|silver|white|pink|blue|red|purple|green) hair\b/i.test(t)) return 968;
        if (/\b(blue|brown|green|red|amber|purple|heterochromia) eyes\b/i.test(t)) return 965;
        if (/long brown hair with teal tips/i.test(t)) return 986;
        if (/brown hair with teal tips|long hair with teal tips/i.test(t)) return 984;
        if (/white long-sleeve dress|cream white dress/i.test(t)) return 948;
        if (/flared skirt|ruffled skirt hem|lace hem|long dress hem|full skirt/i.test(t)) return 947;
        if (/collar bow|frilled hem|button-up dress/i.test(t)) return 946;
        if (/^white dress$/i.test(t)) return 945;
        if (/^detailed face$/i.test(t)) return 940;
        if (/natural skin tone/i.test(t)) return 930;
        if (/no yellow tint/i.test(t)) return 920;
        if (/^cute beautiful girl$/i.test(t)) return 910;
        if (/change pose completely/i.test(t)) return 900;
        if (/do not keep original standing/i.test(t)) return 890;
        return -1;
    };
    const head: string[] = [];
    const tail: string[] = [];
    for (const token of tokens) {
        if (identityRank(token) >= 0) head.push(token);
        else tail.push(token);
    }
    head.sort((a, b) => identityRank(b) - identityRank(a) || a.localeCompare(b));
    return [...head, ...tail];
}

function sortTokens(tokens: string[]): string[] {
    return [...tokens].sort((a, b) => {
        const bucketDiff = bucketIndex(a) - bucketIndex(b);
        if (bucketDiff !== 0) return bucketDiff;
        // keep reverse cowgirl expansions near pose/act front within bucket via priority keywords
        const weightDiff = tokenWeight(b) - tokenWeight(a);
        if (weightDiff !== 0) return weightDiff;
        return a.localeCompare(b);
    });
}

function tokenWeight(token: string): number {
    if (/\breverse cowgirl\b/i.test(token)) return 100;
    if (/\b(doggystyle|missionary|lotus position|spooning)\b/i.test(token)) return 98;
    if (/\b(same face|same hair|same outfit|long brown hair with teal tips|brown hair with teal tips|teal hair tips|blue eyes|natural skin tone|true color)\b/i.test(token)) return 97;
    if (/\bman lying under|male partner under|straddling male partner|man behind her|man on top|male torso under her|his penis\b/i.test(token)) return 95;
    if (/\bno futanari|no girl penis|penis belongs|only one boy|single male partner|two people only\b/i.test(token)) return 90;
    if (/\bchange pose completely|do not keep original standing|replace standing pose\b/i.test(token)) return 85;
    if (/\bthree-quarter rear view|looking back over shoulder\b/i.test(token)) return 83;
    if (/\bvisible insertion|balls deep|pussy stretched\b/i.test(token)) return 80;
    return 0;
}

function bucketIndex(token: string): number {
    const index = SORT_BUCKETS.findIndex((bucket) => bucket.test(token));
    return index === -1 ? SORT_BUCKETS.length : index;
}

function isCanvasReferenceNoiseToken(token: string) {
    const t = token.trim();
    if (!t) return true;
    // canvas composer injects Chinese reference markers like 图片1 / 【文本1】 / 参考图片编号...
    if (/^【?文本\d+】?$/i.test(t)) return true;
    if (/^图片\d+$/i.test(t)) return true;
    if (/^参考图片编号/i.test(t)) return true;
    if (/^请按这些编号理解/i.test(t)) return true;
    if (/图片引用/.test(t) && t.length <= 40) return true;
    return false;
}

function normalizeToken(token: string): string {
    return token.trim().replace(/\s+/g, " ").toLowerCase();
}


export type PoseFamily = "reverse-cowgirl" | "cowgirl" | "doggystyle" | "missionary" | "other-sex" | "none";


export type ComposeMissingItem = {
    id: string;
    label: string;
    severity: "critical" | "warn";
    suggestion: string;
    tags?: string[];
};

export type ComposeCompleteness = {
    level: "ok" | "warn" | "critical";
    missing: ComposeMissingItem[];
    tips: string[];
    poseFamily: PoseFamily;
};

/** 点选组合时检测缺项，避免偏离场景模板实际效果 */
export function analyzeComposeCompleteness(
    prompt: string,
    options?: { hasReferenceImages?: boolean; identitySeed?: string },
): ComposeCompleteness {
    const text = String(prompt || "");
    const corpus = `${text}\n${options?.identitySeed || ""}`;
    const missing: ComposeMissingItem[] = [];
    const tips: string[] = [];
    const poseFamily = detectPoseFamily(text);
    const hasPartnerSex = PARTNER_SEX_RE.test(text) || poseFamily !== "none";
    const hasRef = Boolean(options?.hasReferenceImages);
    // 真换姿才算 pose-change；仅 hetero/penetration 不算「必须换姿势构图」
    const hasPoseChange = POSE_CHANGE_RE.test(text) || (poseFamily !== "none" && hasRef);
    const hasConcreteHair = /\b(brown|black|blonde|silver|white|pink|blue|red|purple|green) hair\b|teal tips|two-tone hair/i.test(corpus);
    const hasConcreteEyes = /\b(blue|brown|green|red|amber|purple) eyes\b/i.test(corpus);
    const hasSameFace = /\bsame face\b/i.test(text);
    const hasSameHair = /\bsame hair\b/i.test(text);
    const hasSameOutfit = /\bsame outfit\b/i.test(text);
    const hasQuality = /\b(masterpiece|best quality|amazing quality)\b/i.test(text);
    const hasAhegao = AHEGAO_RE.test(text);
    const hasInsertion = /\b(inserted|insertion|balls deep|cock in pussy|penis in|deeply inserted)\b/i.test(text);
    const hasMaleBody = /\b(man lying under|male torso under|male hands on|man under her|man behind her|1boy)\b/i.test(text);
    const hasAntiFuta = /\b(no futanari|no girl penis|penis belongs)\b/i.test(text);
    const hasLookBack = LOOK_BACK_RE.test(text);

    if (!hasQuality) {
        missing.push({
            id: "quality",
            label: "画质前缀",
            severity: "warn",
            suggestion: "建议补 masterpiece / best quality / highly detailed",
            tags: ["masterpiece", "best quality", "highly detailed"],
        });
    }

    if (hasPartnerSex) {
        if (!/\b1boy\b/i.test(text)) {
            missing.push({
                id: "1boy",
                label: "男伴人数",
                severity: "critical",
                suggestion: "双人位必须有 1boy，否则易被画成扶她",
                tags: ["1boy"],
            });
        }
        if (!hasAntiFuta) {
            missing.push({
                id: "antifuta",
                label: "防扶她约束",
                severity: "critical",
                suggestion: "补 no futanari / penis belongs to the man under her",
                tags: ["no futanari", "no girl penis", "penis belongs to the man under her"],
            });
        }
        if (!hasMaleBody) {
            missing.push({
                id: "male-body",
                label: "男体可见锚点",
                severity: "critical",
                suggestion: "补 man lying under her / male torso under her 等，避免阴茎落到女主",
                tags: ["man lying under her", "male torso under her", "male hands on her hips"],
            });
        }
        if (!hasInsertion) {
            missing.push({
                id: "insertion",
                label: "插入锚点",
                severity: "warn",
                suggestion: "补 visible insertion / thick penis deeply inserted into pussy，降低下体畸变",
                tags: ["visible insertion", "thick penis deeply inserted into pussy", "his penis"],
            });
        }
    }

    if (poseFamily === "reverse-cowgirl") {
        if (!/\breverse cowgirl\b/i.test(text)) {
            missing.push({
                id: "rcg-core",
                label: "后骑乘核心词",
                severity: "critical",
                suggestion: "保留 reverse cowgirl position",
                tags: ["reverse cowgirl position"],
            });
        }
        if (hasAhegao && !hasLookBack) {
            missing.push({
                id: "lookback",
                label: "回眸",
                severity: "warn",
                suggestion: "啊嘿颜 + 背面需要 looking back over shoulder",
                tags: ["looking back over shoulder"],
            });
        }
        if (!hasAhegao) {
            missing.push({
                id: "expression",
                label: "表情锚点",
                severity: "warn",
                suggestion: "场景模板默认啊嘿颜；若只要回眸可忽略，否则补 ahegao",
                tags: ["ahegao", "rolling eyes", "open mouth", "flushed cheeks"],
            });
        }
    }

    if (hasRef && hasPoseChange) {
        if (!hasSameFace || !hasSameHair || !hasSameOutfit) {
            missing.push({
                id: "same-lock",
                label: "参考图身份锁",
                severity: "critical",
                suggestion: "参考图换姿请保留 same face / same hair / same outfit",
                tags: ["same face", "same hair", "same outfit"],
            });
        }
        if (!hasConcreteHair) {
            const pack = extractIdentityPack(options?.identitySeed || "", { hasReferenceImages: true });
            // 只给「点了真能消掉 critical」的具体发色；generic same hair / match reference 不算
            const hairTags = pack.tags.filter((t) =>
                /\b(brown|black|blonde|silver|white|pink|blue|red|purple|green) hair\b|teal tips|two-tone hair/i.test(t),
            );
            missing.push({
                id: "hair-color",
                label: "具体发色",
                severity: "critical",
                suggestion: hairTags.length
                    ? `只有 same hair 不够，请补：${hairTags.slice(0, 3).join(" / ")}`
                    : "只有 same hair 不够。当前身份源没有具体发色，请手写（如 long brown hair）或从带原 prompt 的图节点打开",
                // 无具体词时不要给一键补上：补 long hair / detailed face 会“点了没变化”
                tags: hairTags.length ? hairTags : undefined,
            });
        }
        if (!hasConcreteEyes) {
            const pack = extractIdentityPack(options?.identitySeed || "", { hasReferenceImages: true });
            const eyeTags = pack.tags.filter((t) =>
                /\b(blue|brown|green|red|amber|purple|golden|black|grey|gray) eyes\b/i.test(t),
            );
            missing.push({
                id: "eye-color",
                label: "具体瞳色",
                severity: "critical",
                suggestion: eyeTags.length
                    ? `请补具体瞳色：${eyeTags.slice(0, 2).join(" / ")}`
                    : "当前身份源没有具体瞳色（如 blue eyes）。点「一键补上」补不了，请手写或换一张带原 prompt 的参考图",
                tags: eyeTags.length ? eyeTags : undefined,
            });
        }
        if (!POSE_CHANGE_RE.test(text)) {
            missing.push({
                id: "pose-change",
                label: "换姿指令",
                severity: "warn",
                suggestion: "参考图大改姿势建议带 change pose completely",
                tags: ["change pose completely", "do not keep original standing composition"],
            });
        }
        tips.push("精修建议：脸开 · 裙摆开 · 头发关（头发精修易改飘身份）");
    }

    if (hasPartnerSex && !hasRef) {
        tips.push("文生图抽卡模式：先用具体发色/瞳色/服装锁角色；满意后再从该图节点做换姿");
        if (!hasConcreteHair || !hasConcreteEyes) {
            missing.push({
                id: "txt2img-identity",
                label: "角色草稿外观",
                severity: "warn",
                suggestion: "纯文生图也建议写清发色/瞳色/服装，后面以图生图才稳",
                tags: hasConcreteHair
                    ? hasConcreteEyes
                        ? ["detailed face"]
                        : ["blue eyes", "detailed face"]
                    : ["long hair", "detailed face"],
            });
        }
    }

    const hasCritical = missing.some((item) => item.severity === "critical");
    const level: ComposeCompleteness["level"] = hasCritical ? "critical" : missing.length ? "warn" : "ok";
    if (level === "ok") tips.push("组合完整度良好，可直接生成");
    return { level, missing, tips, poseFamily };
}

function detectPoseFamily(text: string): PoseFamily {
    if (/\breverse cowgirl\b/i.test(text) || /girl on top facing away/i.test(text)) return "reverse-cowgirl";
    if (/\bcowgirl\b/i.test(text) && !/\breverse cowgirl\b/i.test(text)) return "cowgirl";
    if (/\b(doggy|doggystyle|prone bone)\b/i.test(text)) return "doggystyle";
    if (/\b(missionary|mating press)\b/i.test(text)) return "missionary";
    if (PARTNER_SEX_RE.test(text)) return "other-sex";
    return "none";
}

export type SceneTemplateInfo = {
    id: string;
    zh: string;
    en: string;
    shortLabel: string;
    atoms: string[];
    poseFamily: PoseFamily;
    kind?: string;
    atomic?: boolean;
};

function stableSceneTemplateId(en: string, zh: string, index: number): string {
    // 不能只截前缀：多个体位模板都以 "1girl, 1boy, hetero..." 开头，slice(0,48) 会撞 React key
    const source = `${en.toLowerCase()}||${zh}`;
    let hash = 2166136261;
    for (let i = 0; i < source.length; i += 1) {
        hash ^= source.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    const poseHint = detectPoseFamily(en) || "scene";
    const labelHint = String(zh || en)
        .replace(/·结构防futa.*$/i, "")
        .replace(/（[^）]*）/g, "")
        .trim()
        .slice(0, 18)
        .replace(/\s+/g, "_");
    return `tpl-${index}-${poseHint}-${labelHint || "item"}-${(hash >>> 0).toString(16)}`;
}

export function extractSceneTemplates(
    categories: Array<{ id?: string; groups?: Array<{ tags?: Array<{ en?: string; zh?: string; kind?: string; atomic?: boolean }> }> }>,
): SceneTemplateInfo[] {
    const out: SceneTemplateInfo[] = [];
    const seen = new Set<string>();
    for (const category of categories || []) {
        for (const group of category.groups || []) {
            for (const tag of group.tags || []) {
                const en = String(tag.en || "").trim();
                if (!en) continue;
                const isTemplate = tag.kind === "template" || tag.atomic || (en.includes(",") && /结构防futa|防futa/.test(String(tag.zh || "")));
                if (!isTemplate) continue;
                const key = en.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                const zh = String(tag.zh || en);
                const shortLabel = zh.replace(/·结构防futa.*$/i, "").replace(/（[^）]*）/g, "").trim() || en.slice(0, 16);
                out.push({
                    id: stableSceneTemplateId(en, zh, out.length),
                    zh,
                    en,
                    shortLabel,
                    atoms: splitPromptTokens(en),
                    poseFamily: detectPoseFamily(en),
                    kind: tag.kind,
                    atomic: tag.atomic,
                });
            }
        }
    }
    return out;
}

/** 一键应用场景模板：保留画质/具体身份，替换体位结构原子 */
export function buildSelectionFromSceneTemplate(
    template: SceneTemplateInfo,
    current: Array<{ en: string; zh?: string; orderWeight?: number; kind?: string }>,
    options?: { hasReferenceImages?: boolean; identitySeed?: string },
): Array<{ en: string; zh?: string; orderWeight?: number; kind?: string }> {
    const keep: Array<{ en: string; zh?: string; orderWeight?: number; kind?: string }> = [];
    for (const tag of current) {
        const en = tag.en;
        if (isQualityPrefixTag(tag) || isQualitySuffixTag(tag)) {
            keep.push(tag);
            continue;
        }
        // 保留具体身份与服装细节，不保留旧体位/行为
        if (/\b(same face|same hair|same outfit|teal tips|eyes|hair|dress|skirt|hem|frill|natural skin|cute beautiful girl|detailed face)\b/i.test(en)
            && !PARTNER_SEX_RE.test(en)
            && !/\b(reverse cowgirl|cowgirl|doggystyle|missionary|lotus|spooning|standing doggystyle)\b/i.test(en)) {
            keep.push(tag);
        }
    }
    const byEn = new Map(keep.map((tag) => [normalizeToken(tag.en), tag]));
    for (const atom of template.atoms) {
        const key = normalizeToken(atom);
        if (!key || byEn.has(key)) continue;
        byEn.set(key, { en: atom });
    }
    // 默认补画质
    for (const q of ["masterpiece", "best quality", "highly detailed"]) {
        if (![...byEn.values()].some((tag) => normalizeToken(tag.en) === q)) {
            byEn.set(q, { en: q, kind: "prefix", orderWeight: 10 });
        }
    }
    // 有参考图：只默认锁身份；换姿指令仅在场景模板本身是真体位/换姿时注入
    const templateNeedsPoseChange = Boolean(
        template.poseFamily && template.poseFamily !== "none"
    ) || POSE_CHANGE_RE.test(template.en) || template.atoms.some((atom) => POSE_CHANGE_RE.test(atom));
    if (options?.hasReferenceImages) {
        const identityTokens = ["same face", "same hair", "same outfit"];
        const poseTokens = templateNeedsPoseChange
            ? ["change pose completely", "do not keep original standing composition"]
            : [];
        for (const token of [...identityTokens, ...poseTokens]) {
            const key = normalizeToken(token);
            if (!byEn.has(key)) byEn.set(key, { en: token });
        }
    }
    // 自动并入参考图身份包，锁住以图生图角色特征
    if (options?.identitySeed?.trim() || options?.hasReferenceImages) {
        const pack = extractIdentityPack(options?.identitySeed || "", {
            hasReferenceImages: options?.hasReferenceImages,
            includeLocks: true,
            // 只有场景模板是真换姿时才往身份包塞 change pose
            includePoseChange: Boolean(options?.hasReferenceImages) && templateNeedsPoseChange,
        });
        for (const token of pack.tags) {
            const key = normalizeToken(token);
            if (!key || byEn.has(key)) continue;
            byEn.set(key, { en: token });
        }
    }
    return [...byEn.values()];
}

export type IdentityPack = {
    tags: string[];
    evidence: string[];
    locks: string[];
    weak: boolean;
    source: "seed" | "empty";
    summary: string;
};

/**
 * 从参考图身份源 / 原 prompt 抽取「身份包」：
 * - 具体发色/瞳色/服装证据
 * - same face/hair/outfit 锁
 * - 换姿指令（可选）
 * 不硬编码某一角色；没有证据就不瞎编颜色。
 */
export function extractIdentityPack(
    identitySeed: string,
    options?: {
        hasReferenceImages?: boolean;
        includeLocks?: boolean;
        includePoseChange?: boolean;
        currentPrompt?: string;
    },
): IdentityPack {
    const seed = String(identitySeed || "").trim();
    const current = String(options?.currentPrompt || "").trim();
    const corpus = seed || current;
    const includeLocks = options?.includeLocks !== false;
    const includePoseChange = Boolean(options?.includePoseChange);
    const wantsOutfitChange =
        /\b(change (?:clothes|clothing|outfit)|different (?:dress|outfit|clothes)|lingerie|bikini|nude|naked|school uniform|wardrobe change)\b/i.test(
            current || seed,
        );

    const tags: string[] = [];
    const evidence: string[] = [];
    const locks: string[] = [];
    const seen = new Set<string>();
    const push = (bucket: string[], term: string) => {
        const t = term.trim();
        if (!t) return;
        const key = t.toLowerCase();
        if (seen.has(key)) return;
        // 排除姿势/性行为词，身份包只锁角色外观
        if (/\b(reverse cowgirl|cowgirl|doggy|missionary|sex|penetration|creampie|penis|pussy|vagina|balls deep|ahegao|cum |standing doggystyle|lotus position|spooning)\b/i.test(t)) {
            return;
        }
        if (/\b(standing|walking|hands behind back|facing viewer|looking at viewer|front view|from front|solo focus|^solo$)\b/i.test(t)) {
            return;
        }
        seen.add(key);
        bucket.push(t);
        if (!tags.includes(t)) tags.push(t);
    };

    // 1) 从 seed/current 抽证据短语
    const patterns: RegExp[] = [
        /\blong brown hair with teal tips\b/gi,
        /\bbrown hair with teal tips\b/gi,
        /\blong hair with teal tips\b/gi,
        /\bteal tips\b/gi,
        /\b(?:brown|black|blonde|silver|white|pink|red|blue|purple|green) hair\b/gi,
        /\b(?:very )?long hair\b/gi,
        /\b(?:short hair|bangs|sidelocks|twintails|ponytail|ahoge)\b/gi,
        /\b(?:blue|brown|green|red|amber|purple|golden|black|grey|gray) eyes\b/gi,
        /\b(?:white|black|red|blue|pink|cream white)(?: long-sleeve| summer)? dress\b/gi,
        /\b(?:school uniform|sailor uniform|maid outfit|kimono|hoodie|jacket|blouse|shirt|skirt|lingerie)\b/gi,
        /\b(?:collar bow|frilled hem|flared skirt|ruffled skirt hem|lace trim|button-up dress|petticoat)\b/gi,
        /\bcute beautiful girl\b/gi,
        /\bdetailed face\b/gi,
        /\bnatural skin tone\b/gi,
        /\bno yellow tint\b/gi,
        /\bsame clothing design\b/gi,
    ];

    const clothingRe = /dress|skirt|uniform|outfit|kimono|blouse|shirt|hoodie|jacket|lingerie|hem|frill|collar|lace|petticoat/i;
    const srcPrimary = seed || current;
    for (const re of patterns) {
        const isClothing = clothingRe.test(re.source);
        if (wantsOutfitChange && isClothing) continue;
        let m: RegExpExecArray | null;
        const r = new RegExp(re.source, re.flags);
        while ((m = r.exec(srcPrimary))) push(evidence, m[0]);
    }

    // 2) 逗号切分后再过一轮 identity-ish tokens（捕获未列入 pattern 的细节）
    if (srcPrimary) {
        for (const raw of splitPromptTokens(srcPrimary)) {
            const t = raw.trim();
            if (!t || t.length > 48) continue;
            if (isCanvasReferenceNoiseToken(t)) continue;
            if (
                /\b(same face|same hair|same outfit|same clothing design|detailed face|natural skin|no yellow|cute beautiful girl|hair|eyes|dress|skirt|hem|frill|bow|bangs|twintails|ponytail)\b/i.test(
                    t,
                )
            ) {
                if (wantsOutfitChange && clothingRe.test(t) && !/same outfit|same clothing/i.test(t)) continue;
                // 只收外观相关
                if (PARTNER_SEX_RE.test(t) || AHEGAO_RE.test(t) || isInstructionToken(t)) continue;
                if (/\b(masterpiece|best quality|amazing quality|highly detailed|absurdres)\b/i.test(t)) continue;
                push(evidence, t);
            }
        }
    }

    // 3) 合成标准锚点（仅当证据支持）
    if (/brown hair/i.test(srcPrimary) && /teal tips/i.test(srcPrimary)) {
        push(evidence, "long brown hair with teal tips");
    }
    if (/long hair|very long hair|hair past|flowing long|teal tips|brown hair/i.test(srcPrimary)) {
        push(evidence, "long hair");
        push(evidence, "very long hair");
    }

    // 4) locks
    if (includeLocks || options?.hasReferenceImages) {
        push(locks, "same face");
        push(locks, "same hair");
        if (!wantsOutfitChange) {
            push(locks, "same outfit");
            push(locks, "same clothing design");
        }
        push(locks, "detailed face");
        push(locks, "natural skin tone");
        push(locks, "no yellow tint");
    }
    // 关键：绝不能因为「有参考图」就注入 change pose —— 会把正常站姿/换装误判成大改姿势，
    // 进而前端强制 faceid + 网关 character-lock，破坏普通参考生图。
    if (includePoseChange) {
        push(locks, "change pose completely");
        push(locks, "do not keep original standing composition");
    }

    // 弱身份：证据太少
    const concreteCount = evidence.filter((t) => /hair|eyes|dress|skirt|uniform|outfit/i.test(t)).length;
    const weak = concreteCount < 2;
    if (weak && options?.hasReferenceImages) {
        // 不写死颜色，给 generic 兜底
        push(evidence, "match reference hair length and color");
        if (!wantsOutfitChange) {
            push(evidence, "match reference clothing design");
            push(evidence, "preserve outfit silhouette from reference");
        }
    }

    const summaryParts = evidence.slice(0, 6);
    const summary = summaryParts.length
        ? summaryParts.join(", ")
        : options?.hasReferenceImages
          ? "仅 generic 身份锁（same face/hair/outfit）— 参考图原 prompt 证据不足"
          : "暂无身份证据，请从图片节点打开组合器或粘贴原 prompt";

    return {
        tags,
        evidence,
        locks,
        weak,
        source: seed ? "seed" : "empty",
        summary,
    };
}

/** 把身份包合并进当前已选标签（不覆盖体位/行为词） */
export function mergeIdentityPackIntoSelection(
    current: Array<{ en: string; zh?: string; orderWeight?: number; kind?: string }>,
    pack: IdentityPack,
): Array<{ en: string; zh?: string; orderWeight?: number; kind?: string }> {
    const byEn = new Map(current.map((tag) => [normalizeToken(tag.en), tag]));
    for (const token of pack.tags) {
        const key = normalizeToken(token);
        if (!key || byEn.has(key)) continue;
        byEn.set(key, { en: token });
    }
    return [...byEn.values()];
}

function orderTokensForLocalModel(
    tokens: string[],
    flags: { hasReferenceImages?: boolean; hasReferencePoseChange?: boolean; hasPartnerSex?: boolean },
): string[] {
    // sortTokens already bucketed; for partner/ref paths lightly prefer subject+antifuta near front after quality
    if (!flags.hasPartnerSex && !flags.hasReferencePoseChange) return sortTokens(tokens);
    return sortTokens(tokens);
}



/** 从提示词 + 参考身份源抽可展示的 densify 预览（与网关动态身份策略对齐，不硬编码角色）。 */
export function buildIdentityDensifyPreview(
    prompt: string,
    options?: { identitySeed?: string; hasReferenceImages?: boolean },
): {
    poseFamily: PoseFamily;
    expressionFamily: "ahegao" | "smile" | "cry" | "angry" | "soft" | "neutral";
    evidenceTerms: string[];
    densifyTerms: string[];
    gatewayHints: string[];
    weakIdentity: boolean;
    previewLine: string;
} {
    const text = String(prompt || "");
    const seed = String(options?.identitySeed || "");
    const corpus = `${text}\n${seed}`;
    const wantsOutfitChange =
        /\b(change (?:clothes|clothing|outfit)|different (?:dress|outfit|clothes)|lingerie|bikini|nude|naked|school uniform|wardrobe change)\b/i.test(
            text,
        );

    let poseFamily: PoseFamily = "none";
    if (/\breverse cowgirl\b/i.test(corpus) || /girl on top facing away/i.test(corpus)) poseFamily = "reverse-cowgirl";
    else if (/\b(doggy|doggystyle|prone bone)\b/i.test(corpus)) poseFamily = "doggystyle";
    else if (/\b(missionary|mating press)\b/i.test(corpus)) poseFamily = "missionary";
    else if (/\bcowgirl\b/i.test(corpus) || (/\bgirl on top\b/i.test(corpus) && !/facing away/i.test(corpus))) poseFamily = "cowgirl";
    else if (POSE_CHANGE_RE.test(corpus) || PARTNER_SEX_RE.test(corpus)) poseFamily = "other-sex";

    let expressionFamily: "ahegao" | "smile" | "cry" | "angry" | "soft" | "neutral" = "neutral";
    if (AHEGAO_RE.test(text) || /啊嘿颜|翻白眼|失神/.test(text)) expressionFamily = "ahegao";
    else if (/\b(cry|crying|tears)\b/i.test(text) || /哭|流泪/.test(text)) expressionFamily = "cry";
    else if (/\b(angry|furious|glare)\b/i.test(text)) expressionFamily = "angry";
    else if (/\b(smile|smiling|grin)\b/i.test(text)) expressionFamily = "smile";
    else if (/\b(open mouth|flushed cheeks|blush|looking back)\b/i.test(text)) expressionFamily = "soft";

    const evidenceTerms: string[] = [];
    const pushEv = (term: string) => {
        const t = term.trim();
        if (!t) return;
        if (evidenceTerms.some((x) => x.toLowerCase() === t.toLowerCase())) return;
        evidenceTerms.push(t);
    };

    // 证据只从 corpus 真出现的具体词来
    const patterns: RegExp[] = [
        /\blong brown hair with teal tips\b/gi,
        /\b(?:brown|black|blonde|silver|white|pink|red|blue|purple|green) hair\b/gi,
        /\bteal tips\b/gi,
        /\b(?:very )?long hair\b/gi,
        /\b(?:blue|brown|green|red|amber|purple|golden|black|grey|gray) eyes\b/gi,
        /\b(?:white|black|red|blue|pink|cream white)(?: long-sleeve| summer)? dress\b/gi,
        /\b(?:school uniform|sailor uniform|maid outfit|kimono|hoodie|jacket|blouse|shirt|skirt|lingerie)\b/gi,
        /\b(?:collar bow|frilled hem|flared skirt|ruffled skirt hem|lace trim)\b/gi,
        /\bcute beautiful girl\b/gi,
    ];
    const clothingRe = /dress|skirt|uniform|outfit|kimono|blouse|shirt|hoodie|jacket|lingerie|hem|frill|collar|lace/i;
    for (const re of patterns) {
        const isClothing = clothingRe.test(re.source);
        const src = wantsOutfitChange && isClothing ? text : corpus;
        let m: RegExpExecArray | null;
        const r = new RegExp(re.source, re.flags);
        while ((m = r.exec(src))) pushEv(m[0]);
    }

    const densifyTerms: string[] = [];
    const pushD = (term: string) => {
        const t = term.trim();
        if (!t) return;
        if (densifyTerms.some((x) => x.toLowerCase() === t.toLowerCase())) return;
        densifyTerms.push(t);
    };
    for (const t of evidenceTerms) pushD(t);
    // generic densify（与前端 smart-compose / 网关 v14 对齐）
    if (options?.hasReferenceImages && poseFamily !== "none") {
        pushD("same face");
        pushD("detailed face");
        if (/same hair|keep character|hair/i.test(corpus)) {
            pushD("same hair");
            pushD("long hair");
            pushD("very long hair");
        }
        if (!wantsOutfitChange && /same outfit|same clothing|keep character|dress|skirt|uniform|outfit/i.test(corpus)) {
            pushD("same outfit");
            pushD("same clothing design");
            if (/dress|skirt|hem|frill/i.test(corpus)) {
                pushD("flared skirt");
                pushD("ruffled skirt hem");
                pushD("frilled hem");
            }
        }
        // 无具体证据时的弱身份兜底（不写死颜色/款式）
        if (!evidenceTerms.some((t) => /hair/i.test(t))) {
            pushD("match reference hair length and color");
        }
        if (!wantsOutfitChange && !evidenceTerms.some((t) => /dress|skirt|uniform|outfit|kimono|blouse|shirt/i.test(t))) {
            pushD("match reference clothing design");
            pushD("preserve outfit silhouette from reference");
        }
    }
    if (expressionFamily === "ahegao") {
        for (const t of ["ahegao", "rolling eyes", "tongue out", "open mouth", "flushed cheeks"]) pushD(t);
    }

    const weakIdentity = Boolean(
        options?.hasReferenceImages &&
            poseFamily !== "none" &&
            evidenceTerms.filter((t) => /hair|eyes|dress|skirt|uniform|outfit/i.test(t)).length < 2,
    );

    const gatewayHints: string[] = [];
    if (options?.hasReferenceImages && poseFamily !== "none") {
        gatewayHints.push("faceid-only（禁 latent 锁站姿）");
        gatewayHints.push(expressionFamily === "ahegao" ? "啊嘿颜:主FaceID软化+脸精修关FaceID" : "脸精修可开FaceID");
        gatewayHints.push("part refine: face→skirt" + (expressionFamily === "ahegao" ? "（表情优先）" : ""));
        if (poseFamily === "doggystyle") gatewayHints.push("体位档:doggystyle（回眸/单头/ass focus）");
        if (poseFamily === "missionary") gatewayHints.push("体位档:missionary（去背面机位）");
        if (poseFamily === "reverse-cowgirl") gatewayHints.push("体位档:reverse-cowgirl");
        if (weakIdentity) gatewayHints.push("弱身份证据:将用 generic 锁装/锁发兜底");
        if (!seed.trim()) gatewayHints.push("无 identity_prompt:仅靠当前词+参考图像FaceID");
        else gatewayHints.push("已带 identity_prompt 证据源");
    } else {
        gatewayHints.push("不走 pose-change 强化链");
    }

    const previewLine = densifyTerms.slice(0, 18).join(", ");
    return {
        poseFamily,
        expressionFamily,
        evidenceTerms,
        densifyTerms,
        gatewayHints,
        weakIdentity,
        previewLine,
    };
}

/** 组合器可观测状态：给 UI 显示当前是否会走 pose-change / 表情族 / 身份证据 */
export function getPoseChangePipelineStatus(
    prompt: string,
    options?: { hasReferenceImages?: boolean; identitySeed?: string },
): {
    poseChange: boolean;
    poseFamily: PoseFamily;
    expressionFamily: "ahegao" | "smile" | "cry" | "angry" | "soft" | "neutral";
    hasSexPose: boolean;
    identityEvidence: { hair: boolean; eyes: boolean; outfit: boolean };
    densifyPreview: string;
    gatewayHints: string[];
    weakIdentity: boolean;
    summary: string;
} {
    const text = String(prompt || "");
    const preview = buildIdentityDensifyPreview(text, {
        hasReferenceImages: options?.hasReferenceImages,
        identitySeed: options?.identitySeed,
    });
    const hasSexPose = preview.poseFamily !== "none";
    const poseChange = Boolean(options?.hasReferenceImages && hasSexPose);
    const corpus = `${text}\n${options?.identitySeed || ""}`;
    // 证据必须是「具体外观」，same hair / match reference / detailed face 不算 ✓
    const identityEvidence = {
        hair: /\b(brown|black|blonde|silver|white|pink|blue|red|purple|green) hair\b|teal tips|two-tone hair/i.test(corpus),
        eyes: /\b(blue|brown|green|red|amber|purple|golden|black|grey|gray) eyes\b/i.test(corpus),
        outfit: /\b(white|black|red|blue|pink|cream white).{0,24}(dress|skirt|uniform)|school uniform|sailor uniform|maid outfit|kimono|hoodie|jacket|blouse/i.test(corpus)
            || /\b(white dress|black dress|frilled hem|flared skirt|ruffled skirt)\b/i.test(corpus),
    };
    const summary = [
        poseChange ? "pose-change链:开" : "pose-change链:关",
        `体位:${preview.poseFamily}`,
        `表情:${preview.expressionFamily}`,
        `具体身份:发${identityEvidence.hair ? "✓" : "·"}瞳${identityEvidence.eyes ? "✓" : "·"}装${identityEvidence.outfit ? "✓" : "·"}`,
        preview.weakIdentity ? "弱身份(有图≠有文字发色瞳色)" : "身份证据够",
    ].join(" · ");
    return {
        poseChange,
        poseFamily: preview.poseFamily,
        expressionFamily: preview.expressionFamily,
        hasSexPose,
        identityEvidence,
        densifyPreview: preview.previewLine,
        gatewayHints: preview.gatewayHints,
        weakIdentity: preview.weakIdentity,
        summary,
    };
}
