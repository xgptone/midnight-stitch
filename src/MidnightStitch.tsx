/**
 * Midnight Stitch — a dream-world action-survival game rendered on a <canvas>.
 *
 * Drop-in React component. No external assets, no runtime dependencies besides
 * React: sprites are baked procedurally and audio is synthesised with WebAudio.
 */

import { useEffect, useMemo, useRef } from "react"

// ============================================================================
// 1. TYPES & INTERFACES
// ============================================================================

export type GameStateId =
    | "BOOT"
    | "MENU"
    | "PLAYING"
    | "LEVEL_UP"
    | "PAUSED"
    | "BOSS_INTRO"
    | "GAME_OVER"
    | "VICTORY"

export type DifficultyMode = "Chill" | "Normal" | "Hard"
export type SeedMode = "Random" | "Daily"
export type LanguageCode = "EN" | "FA"
export type Rarity = "common" | "rare" | "epic"

export interface MidnightStitchProps {
    /** Optional URL of a custom player sprite. */
    playerImage?: string
    /** Optional URL of a custom plush-bunny sprite. */
    bunnyImage?: string
    /** Accent colour used by the HUD (any CSS colour string). */
    accentColor?: string
    /** Background colour behind the canvas (any CSS colour string). */
    backdropColor?: string
    difficulty?: DifficultyMode
    /** In-run clock offset in seconds (0–660); useful for testing late game. */
    startTime?: number
    /** Show the FPS counter and the last runtime error on the canvas. */
    showFPS?: boolean
    soundOn?: boolean
    /** "Daily" uses one shared seed per calendar day; "Random" a fresh one. */
    seedMode?: SeedMode
    language?: LanguageCode
}

/** Props after validation and defaulting; this is what the engine consumes. */
export type ResolvedProps = Required<
    Omit<MidnightStitchProps, "playerImage" | "bunnyImage">
> &
    Pick<MidnightStitchProps, "playerImage" | "bunnyImage">

export const DEFAULT_PROPS = {
    accentColor: "#FF6FA8",
    backdropColor: "#160D24",
    difficulty: "Normal",
    startTime: 0,
    showFPS: false,
    soundOn: true,
    seedMode: "Random",
    language: "EN",
} as const satisfies Omit<ResolvedProps, "playerImage" | "bunnyImage">

export type EnemyTypeId = "drifter" | "dasher" | "splitter" | "mini_splitter"

export interface EnemyDef {
    id: EnemyTypeId
    nameEN: string
    nameFA: string
    maxHp: number
    speed: number
    radius: number
    damage: number
    xpValue: number
    cost: number
    armor: number
    color: string
    outline: string
}

export type UpgradeId =
    | "weapon_heart_bolt"
    | "passive_move_speed"
    | "passive_max_hp"
    | "passive_magnet"
    | "passive_cooldown"
    | "passive_crit"

export interface UpgradeDef {
    id: UpgradeId
    kind: "weapon" | "passive"
    maxLevel: number
    rarity: Rarity
    weight: number
    tags: string[]
    iconType: "heart" | "boot" | "vitality" | "magnet" | "clock" | "crit"
    nameEN: string
    nameFA: string
    descEN: string[]
    descFA: string[]
}

export interface UIButtonRect {
    id: string
    x: number
    y: number
    w: number
    h: number
    payload?: number
}

// ============================================================================
// 2. DATA TABLES & BALANCE CONSTANTS
// ============================================================================

const PALETTE = {
    lavender: "#E9C8FF",
    purple: "#C46FFF",
    deepPurple: "#241734",
    darkNight: "#160D24",
    hotPink: "#FF6FA8",
    blonde: "#FFD27A",
    charcoal: "#3A3A44",
    plushBlack: "#25242B",
    ribbonRed: "#B3263A",
    skirtBlue: "#4A5FB0",
    gold: "#FFC83D",
    white: "#F5F3FF",
    outline: "#1B1224",
    dangerRed: "#FF3B6B",
    mint: "#6BFFB8",
} as const

// Font stack with Persian-capable fallbacks (Segoe UI / Tahoma / system fonts)
const FONT_STACK =
    '"Segoe UI", Tahoma, "Noto Sans Arabic", "Helvetica Neue", Arial, sans-serif'

function f(spec: string): string {
    return `${spec} ${FONT_STACK}`
}

const CONFIG = {
    FIXED_DT: 1 / 60,
    MAX_ACCUM_STEPS: 5,
    SPATIAL_CELL_SIZE: 64,
    MAX_ENEMIES: 300,
    MAX_PROJECTILES: 250,
    MAX_GEMS: 350,
    MAX_PARTICLES: 400,
    MAX_DMG_NUMBERS: 120,
    SURVIVAL_WIN_SECONDS: 720, // 12:00
    PLAYER_BASE_HP: 100,
    PLAYER_BASE_SPEED: 175,
    PLAYER_RADIUS: 18,
    PLAYER_IFRAMES: 0.45,
    BASE_MAGNET_RADIUS: 85,
    BASE_CRIT_CHANCE: 0.08,
    BASE_CRIT_MULT: 1.75,
    REROLLS_PER_RUN: 2,
    BANISHES_PER_RUN: 1,
} as const

// Held plush bunny (melee + guard) tuning
const BUNNY_SCALE = 0.62 // sprite scale while held in the girl's hands
const BUNNY_HOLD_X = 30 // resting hand distance from the girl (px)
const BUNNY_SWING_DUR = 0.34 // full swing: wind-up, strike, recovery
const BUNNY_MELEE_CD = 0.62 // seconds between swings
const BUNNY_TRIGGER_RANGE = 90 // enemy distance (from girl) that triggers a swing
const BUNNY_REACH = 30 // plush length used as the hit capsule (px)
const BUNNY_HIT_R = 12 // capsule thickness (px)
const BUNNY_MELEE_MULT = 1.3 // melee damage = heart bolt damage x this
const BUNNY_GUARD_COOLDOWN = 3.5 // block recharge (seconds)

const DIFFICULTY_TABLE: Record<
    DifficultyMode,
    { hpMult: number; dmgMult: number; spawnRateMult: number }
> = {
    Chill: { hpMult: 0.75, dmgMult: 0.7, spawnRateMult: 0.8 },
    Normal: { hpMult: 1.0, dmgMult: 1.0, spawnRateMult: 1.0 },
    Hard: { hpMult: 1.35, dmgMult: 1.3, spawnRateMult: 1.3 },
}

const ENEMY_TABLE: Record<EnemyTypeId, EnemyDef> = {
    drifter: {
        id: "drifter",
        nameEN: "Nightmare Scrap",
        nameFA: "تکه کابوس",
        maxHp: 26,
        speed: 74,
        radius: 15,
        damage: 10,
        xpValue: 3,
        cost: 1,
        armor: 0,
        color: "#433857",
        outline: "#191224",
    },
    dasher: {
        id: "dasher",
        nameEN: "Shear Hound",
        nameFA: "شکارچی قیچی",
        maxHp: 42,
        speed: 68,
        radius: 16,
        damage: 16,
        xpValue: 6,
        cost: 2,
        armor: 1,
        color: "#6E2546",
        outline: "#1F0A14",
    },
    splitter: {
        id: "splitter",
        nameEN: "Patchwork Blob",
        nameFA: "حباب چهل‌تکه",
        maxHp: 64,
        speed: 52,
        radius: 22,
        damage: 14,
        xpValue: 8,
        cost: 3,
        armor: 2,
        color: "#523B78",
        outline: "#1B112C",
    },
    mini_splitter: {
        id: "mini_splitter",
        nameEN: "Loose Threadling",
        nameFA: "نخ رهاشده",
        maxHp: 18,
        speed: 102,
        radius: 11,
        damage: 7,
        xpValue: 2,
        cost: 1,
        armor: 0,
        color: "#7C58B3",
        outline: "#1B112C",
    },
}

// Level 1..6 stats for Heart Bolt
const HEART_BOLT_LEVELS = [
    { damage: 18, cooldown: 0.72, count: 1, speed: 430, pierce: 1, size: 9 },
    { damage: 22, cooldown: 0.68, count: 2, speed: 450, pierce: 1, size: 9 },
    { damage: 28, cooldown: 0.62, count: 2, speed: 470, pierce: 2, size: 10 },
    { damage: 34, cooldown: 0.58, count: 3, speed: 490, pierce: 2, size: 10 },
    { damage: 42, cooldown: 0.52, count: 3, speed: 520, pierce: 3, size: 11 },
    { damage: 54, cooldown: 0.45, count: 4, speed: 550, pierce: 4, size: 12 },
] as const

const UPGRADE_TABLE: Record<UpgradeId, UpgradeDef> = {
    weapon_heart_bolt: {
        id: "weapon_heart_bolt",
        kind: "weapon",
        maxLevel: 6,
        rarity: "common",
        weight: 100,
        tags: ["heart", "projectile"],
        iconType: "heart",
        nameEN: "Heart Bolt",
        nameFA: "تیر قلبی",
        descEN: [
            "Bunny fires magic heart bolts at nearest foes (and whacks anything that gets close).",
            "Fires +1 Heart Bolt and increases bolt damage.",
            "Bolts pierce +1 enemy and fire faster.",
            "Fires 3 Heart Bolts in a spread with higher damage.",
            "Bolts pierce +1 extra enemy and deal heavy damage.",
            "MAX: Fires 4 rapid, high-pierce Crimson Heart Bolts!",
        ],
        descFA: [
            "خرگوش تیرهای قلبی به سمت نزدیک‌ترین دشمن شلیک می‌کند.",
            "+۱ تیر قلبی بیشتر و افزایش آسیب تیرها.",
            "عبور تیر از +۱ دشمن بیشتر و سرعت شلیک بالاتر.",
            "شلیک ۳ تیر قلبی همزمان با آسیب بیشتر.",
            "عبور از +۱ دشمن دیگر و افزایش شدید آسیب.",
            "حداکثر: شلیک ۴ تیر قلبی سریع و شکافنده!",
        ],
    },
    passive_move_speed: {
        id: "passive_move_speed",
        kind: "passive",
        maxLevel: 5,
        rarity: "common",
        weight: 85,
        tags: ["ribbon", "mobility"],
        iconType: "boot",
        nameEN: "Satin Ribbon Steps",
        nameFA: "گام‌های روبان ساتن",
        descEN: [
            "+10% Move Speed.",
            "+20% Move Speed.",
            "+30% Move Speed.",
            "+40% Move Speed.",
            "MAX: +50% Move Speed.",
        ],
        descFA: [
            "+۱۰٪ سرعت حرکت.",
            "+۲۰٪ سرعت حرکت.",
            "+۳۰٪ سرعت حرکت.",
            "+۴۰٪ سرعت حرکت.",
            "حداکثر: +۵۰٪ سرعت حرکت.",
        ],
    },
    passive_max_hp: {
        id: "passive_max_hp",
        kind: "passive",
        maxLevel: 5,
        rarity: "common",
        weight: 85,
        tags: ["heart", "vitality"],
        iconType: "vitality",
        nameEN: "Plush Stuffing",
        nameFA: "پنبه جادویی",
        descEN: [
            "+25 Max HP & heal 25 HP.",
            "+50 Max HP & heal 25 HP.",
            "+75 Max HP & heal 25 HP.",
            "+100 Max HP & heal 25 HP.",
            "MAX: +125 Max HP & heal 35 HP.",
        ],
        descFA: [
            "+۲۵ جان حداکثر و التیام ۲۵ جان.",
            "+۵۰ جان حداکثر و التیام ۲۵ جان.",
            "+۷۵ جان حداکثر و التیام ۲۵ جان.",
            "+۱۰۰ جان حداکثر و التیام ۲۵ جان.",
            "حداکثر: +۱۲۵ جان حداکثر و التیام ۳۵ جان.",
        ],
    },
    passive_magnet: {
        id: "passive_magnet",
        kind: "passive",
        maxLevel: 5,
        rarity: "common",
        weight: 80,
        tags: ["star", "utility"],
        iconType: "magnet",
        nameEN: "Golden Thimble Magnet",
        nameFA: "آهنربای انگشتانه طلایی",
        descEN: [
            "+30% Gem Pickup Range.",
            "+60% Gem Pickup Range.",
            "+90% Gem Pickup Range.",
            "+120% Gem Pickup Range.",
            "MAX: +160% Gem Pickup Range.",
        ],
        descFA: [
            "+۳۰٪ شعاع جذب جواهرات.",
            "+۶۰٪ شعاع جذب جواهرات.",
            "+۹۰٪ شعاع جذب جواهرات.",
            "+۱۲۰٪ شعاع جذب جواهرات.",
            "حداکثر: +۱۶۰٪ شعاع جذب جواهرات.",
        ],
    },
    passive_cooldown: {
        id: "passive_cooldown",
        kind: "passive",
        maxLevel: 5,
        rarity: "rare",
        weight: 60,
        tags: ["star", "haste"],
        iconType: "clock",
        nameEN: "Clockwork Bobbin",
        nameFA: "قرقره ساعتی",
        descEN: [
            "+8% Attack Speed.",
            "+16% Attack Speed.",
            "+24% Attack Speed.",
            "+32% Attack Speed.",
            "MAX: +40% Attack Speed.",
        ],
        descFA: [
            "+۸٪ سرعت حمله.",
            "+۱۶٪ سرعت حمله.",
            "+۲۴٪ سرعت حمله.",
            "+۳۲٪ سرعت حمله.",
            "حداکثر: +۴۰٪ سرعت حمله.",
        ],
    },
    passive_crit: {
        id: "passive_crit",
        kind: "passive",
        maxLevel: 5,
        rarity: "epic",
        weight: 45,
        tags: ["heart", "crit"],
        iconType: "crit",
        nameEN: "Silver Sewing Needle",
        nameFA: "سوزن نقره‌ای",
        descEN: [
            "+6% Crit Chance & +15% Crit Damage.",
            "+12% Crit Chance & +30% Crit Damage.",
            "+18% Crit Chance & +45% Crit Damage.",
            "+24% Crit Chance & +60% Crit Damage.",
            "MAX: +30% Crit Chance & +80% Crit Damage.",
        ],
        descFA: [
            "+۶٪ شانس ضربه حساس و +۱۵٪ آسیب حساس.",
            "+۱۲٪ شانس ضربه حساس و +۳۰٪ آسیب حساس.",
            "+۱۸٪ شانس ضربه حساس و +۴۵٪ آسیب حساس.",
            "+۲۴٪ شانس ضربه حساس و +۶۰٪ آسیب حساس.",
            "حداکثر: +۳۰٪ شانس ضربه حساس و +۸۰٪ آسیب حساس.",
        ],
    },
}

const UPGRADE_LIST: UpgradeDef[] = Object.values(UPGRADE_TABLE)

// Finite State Machine Transition Table
const VALID_STATE_TRANSITIONS: Record<GameStateId, GameStateId[]> = {
    BOOT: ["MENU", "PLAYING"],
    MENU: ["PLAYING"],
    PLAYING: [
        "LEVEL_UP",
        "PAUSED",
        "BOSS_INTRO",
        "GAME_OVER",
        "VICTORY",
        "MENU",
    ],
    LEVEL_UP: ["PLAYING", "GAME_OVER", "MENU"],
    PAUSED: ["PLAYING", "MENU"],
    BOSS_INTRO: ["PLAYING", "MENU"],
    GAME_OVER: ["PLAYING", "MENU"],
    VICTORY: ["PLAYING", "MENU"],
}

/**
 * Validates and defaults incoming props. Consumers may pass partial, untyped or
 * out-of-range values (plain JS, CMS bindings, query strings); an unknown
 * difficulty would otherwise make `DIFFICULTY_TABLE[difficulty]` undefined and
 * break the simulation on every frame.
 */
function resolveProps(p: MidnightStitchProps | undefined): ResolvedProps {
    const src: Record<string, unknown> = { ...p }
    const difficultyRaw = String(src.difficulty ?? "").toLowerCase()
    const difficulty: DifficultyMode =
        difficultyRaw === "chill"
            ? "Chill"
            : difficultyRaw === "hard"
              ? "Hard"
              : "Normal"
    const language: LanguageCode =
        String(src.language ?? "").toUpperCase() === "FA" ? "FA" : "EN"
    const seedMode: SeedMode =
        String(src.seedMode ?? "").toLowerCase() === "daily"
            ? "Daily"
            : "Random"
    const startTime = Number(src.startTime)
    return {
        playerImage:
            typeof src.playerImage === "string" ? src.playerImage : undefined,
        bunnyImage:
            typeof src.bunnyImage === "string" ? src.bunnyImage : undefined,
        accentColor:
            typeof src.accentColor === "string" && src.accentColor
                ? src.accentColor
                : DEFAULT_PROPS.accentColor,
        backdropColor:
            typeof src.backdropColor === "string" && src.backdropColor
                ? src.backdropColor
                : DEFAULT_PROPS.backdropColor,
        difficulty,
        startTime: Number.isFinite(startTime) ? startTime : 0,
        showFPS: !!src.showFPS,
        soundOn: src.soundOn === undefined ? true : !!src.soundOn,
        seedMode,
        language,
    }
}

const I18N = {
    EN: {
        title: "MIDNIGHT STITCH",
        subtitle: "Dream-World Action Survival",
        startBtn: "START DREAM",
        resumeBtn: "RESUME",
        restartBtn: "STITCH AGAIN",
        menuBtn: "MAIN MENU",
        levelUpTitle: "STITCH UPGRADE!",
        levelUpSub: "Choose a blessing for your plush companion",
        reroll: "Reroll",
        banish: "Banish",
        banishActive: "Tap a card to Banish",
        cancelBanish: "Cancel Banish",
        lvl: "LV",
        newBadge: "NEW!",
        maxBadge: "MAX",
        kills: "KILLS",
        seed: "SEED",
        paused: "DREAM PAUSED",
        gameOver: "UNRAVELED...",
        victory: "NIGHTMARE MENDED!",
        survivedFor: "Time Survived",
        enemiesMended: "Scraps Defeated",
        levelReached: "Level Reached",
        controlsHint: "WASD / Arrows / Drag to Move • Auto-Attack Active",
        rarity_common: "COMMON",
        rarity_rare: "RARE",
        rarity_epic: "EPIC",
    },
    FA: {
        title: "کوک نیمه‌شب",
        subtitle: "بقای رویایی در دنیای کابوس",
        startBtn: "شروع رویا",
        resumeBtn: "ادامه بازی",
        restartBtn: "تلاش دوباره",
        menuBtn: "منوی اصلی",
        levelUpTitle: "ارتقای جادویی!",
        levelUpSub: "یک قابلیت برای خود و عروسکت انتخاب کن",
        reroll: "تعویض",
        banish: "حذف کارت",
        banishActive: "کارت مورد نظر را حذف کن",
        cancelBanish: "لغو حذف",
        lvl: "سطح",
        newBadge: "جدید!",
        maxBadge: "حداکثر",
        kills: "شکار",
        seed: "بذر",
        paused: "توقف رویا",
        gameOver: "رویا شکافته شد...",
        victory: "کابوس دوخته شد!",
        survivedFor: "زمان بقا",
        enemiesMended: "کابوس‌های شکست‌خورده",
        levelReached: "سطح نهایی",
        controlsHint: "حرکت با WASD / کلیدهای جهت / لمس صفحه • حمله خودکار",
        rarity_common: "معمولی",
        rarity_rare: "کمیاب",
        rarity_epic: "حماسی",
    },
} as const

// ============================================================================
// 3. UTILS (MATH, SEEDED RNG, FORMATTERS)
// ============================================================================

function clamp(v: number, min: number, max: number): number {
    return v < min ? min : v > max ? max : v
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
}

function distSq(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1
    const dy = y2 - y1
    return dx * dx + dy * dy
}

function easeOutCubic(t: number): number {
    const k = 1 - clamp(t, 0, 1)
    return 1 - k * k * k
}

function easeInOut(t: number): number {
    const k = clamp(t, 0, 1)
    return k * k * (3 - 2 * k)
}

/** Wraps an angle difference into [-PI, PI]. */
function wrapPi(a: number): number {
    const twoPi = Math.PI * 2
    let r = (a + Math.PI) % twoPi
    if (r < 0) r += twoPi
    return r - Math.PI
}

/** Squared distance from point (px,py) to the segment (ax,ay)-(bx,by). */
function segDistSq(
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number
): number {
    const abx = bx - ax
    const aby = by - ay
    const l2 = abx * abx + aby * aby
    let t = l2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / l2 : 0
    t = clamp(t, 0, 1)
    return distSq(px, py, ax + abx * t, ay + aby * t)
}

function formatTime(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds))
    const m = Math.floor(total / 60)
    const s = total % 60
    const mm = m < 10 ? "0" + m : "" + m
    const ss = s < 10 ? "0" + s : "" + s
    return `${mm}:${ss}`
}

/**
 * Rounded-rect path helper (works in every browser, unlike ctx.roundRect which
 * is missing in older Safari / Chromium builds). Calls beginPath() itself.
 */
function roundRectPath(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
): void {
    const rr = Math.max(0, Math.min(r, w * 0.5, h * 0.5))
    ctx.beginPath()
    ctx.moveTo(x + rr, y)
    ctx.lineTo(x + w - rr, y)
    ctx.arcTo(x + w, y, x + w, y + rr, rr)
    ctx.lineTo(x + w, y + h - rr)
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr)
    ctx.lineTo(x + rr, y + h)
    ctx.arcTo(x, y + h, x, y + h - rr, rr)
    ctx.lineTo(x, y + rr)
    ctx.arcTo(x, y, x + rr, y, rr)
    ctx.closePath()
}

export class SeededRNG {
    private state: number

    constructor(seedNumber: number) {
        this.state = seedNumber >>> 0 || 123456789
    }

    public setSeed(seedNumber: number): void {
        this.state = seedNumber >>> 0 || 123456789
    }

    public next(): number {
        let t = (this.state += 0x6d2b79f5)
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }

    public range(min: number, max: number): number {
        return min + this.next() * (max - min)
    }

    public int(min: number, maxInclusive: number): number {
        return Math.floor(this.range(min, maxInclusive + 1))
    }

    public chance(prob: number): boolean {
        return this.next() < prob
    }
}

function computeDailySeed(): number {
    const now = new Date()
    const y = now.getUTCFullYear()
    const m = now.getUTCMonth() + 1
    const d = now.getUTCDate()
    return ((y * 10000 + m * 100 + d) ^ 0x5f3759df) >>> 0
}

// ============================================================================
// 4. EVENT BUS
// ============================================================================

export type GameEventMap = {
    onKill: { enemyType: EnemyTypeId; x: number; y: number }
    onLevelUp: { level: number }
    onDamage: { amount: number; x: number; y: number; isPlayer: boolean }
    onBossPhase: { phase: number }
}

type GameListener<K extends keyof GameEventMap> = (
    payload: GameEventMap[K]
) => void

export class EventBus {
    private listeners: { [K in keyof GameEventMap]?: GameListener<K>[] } = {}

    public on<K extends keyof GameEventMap>(
        event: K,
        cb: GameListener<K>
    ): void {
        const list = (this.listeners[event] ??= []) as GameListener<K>[]
        list.push(cb)
    }

    public emit<K extends keyof GameEventMap>(
        event: K,
        payload: GameEventMap[K]
    ): void {
        const list = this.listeners[event] as GameListener<K>[] | undefined
        if (!list) return
        for (let i = 0; i < list.length; i++) {
            list[i](payload)
        }
    }

    public clear(): void {
        this.listeners = {}
    }
}

// ============================================================================
// 5. PROCEDURAL WEBAUDIO ENGINE
// ============================================================================

export class SoundEngine {
    private ctx: AudioContext | null = null
    public muted: boolean = false

    public unlock(): void {
        if (this.muted) return
        if (!this.ctx && typeof window !== "undefined") {
            const AudioCtx =
                window.AudioContext ||
                (
                    window as unknown as {
                        webkitAudioContext: typeof AudioContext
                    }
                ).webkitAudioContext
            if (AudioCtx) {
                try {
                    this.ctx = new AudioCtx()
                } catch (err) {
                    this.ctx = null
                }
            }
        }
        if (this.ctx && this.ctx.state === "suspended") {
            this.ctx.resume().catch(() => {})
        }
    }

    public playShoot(): void {
        if (this.muted || !this.ctx || this.ctx.state !== "running") return
        const now = this.ctx.currentTime
        const osc = this.ctx.createOscillator()
        const gain = this.ctx.createGain()
        osc.type = "triangle"
        osc.frequency.setValueAtTime(580, now)
        osc.frequency.exponentialRampToValueAtTime(920, now + 0.05)
        osc.frequency.exponentialRampToValueAtTime(340, now + 0.11)
        gain.gain.setValueAtTime(0.08, now)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11)
        osc.connect(gain)
        gain.connect(this.ctx.destination)
        osc.start(now)
        osc.stop(now + 0.12)
    }

    public playHit(isCrit: boolean): void {
        if (this.muted || !this.ctx || this.ctx.state !== "running") return
        const now = this.ctx.currentTime
        const osc = this.ctx.createOscillator()
        const gain = this.ctx.createGain()
        osc.type = isCrit ? "sawtooth" : "square"
        osc.frequency.setValueAtTime(isCrit ? 320 : 210, now)
        osc.frequency.exponentialRampToValueAtTime(75, now + 0.07)
        gain.gain.setValueAtTime(isCrit ? 0.09 : 0.05, now)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07)
        osc.connect(gain)
        gain.connect(this.ctx.destination)
        osc.start(now)
        osc.stop(now + 0.08)
    }

    public playPickup(): void {
        if (this.muted || !this.ctx || this.ctx.state !== "running") return
        const now = this.ctx.currentTime
        const osc = this.ctx.createOscillator()
        const gain = this.ctx.createGain()
        osc.type = "sine"
        osc.frequency.setValueAtTime(740, now)
        osc.frequency.exponentialRampToValueAtTime(1180, now + 0.08)
        gain.gain.setValueAtTime(0.06, now)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09)
        osc.connect(gain)
        gain.connect(this.ctx.destination)
        osc.start(now)
        osc.stop(now + 0.09)
    }

    public playLevelUp(): void {
        if (this.muted || !this.ctx || this.ctx.state !== "running") return
        const notes = [523.25, 659.25, 783.99, 1046.5]
        for (let i = 0; i < notes.length; i++) {
            const now = this.ctx.currentTime + i * 0.07
            const osc = this.ctx.createOscillator()
            const gain = this.ctx.createGain()
            osc.type = "triangle"
            osc.frequency.setValueAtTime(notes[i], now)
            gain.gain.setValueAtTime(0.09, now)
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22)
            osc.connect(gain)
            gain.connect(this.ctx.destination)
            osc.start(now)
            osc.stop(now + 0.23)
        }
    }

    public playClick(): void {
        if (this.muted || !this.ctx || this.ctx.state !== "running") return
        const now = this.ctx.currentTime
        const osc = this.ctx.createOscillator()
        const gain = this.ctx.createGain()
        osc.type = "sine"
        osc.frequency.setValueAtTime(620, now)
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.04)
        gain.gain.setValueAtTime(0.07, now)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045)
        osc.connect(gain)
        gain.connect(this.ctx.destination)
        osc.start(now)
        osc.stop(now + 0.05)
    }

    public playPlayerHurt(): void {
        if (this.muted || !this.ctx || this.ctx.state !== "running") return
        const now = this.ctx.currentTime
        const osc = this.ctx.createOscillator()
        const gain = this.ctx.createGain()
        osc.type = "sawtooth"
        osc.frequency.setValueAtTime(160, now)
        osc.frequency.linearRampToValueAtTime(65, now + 0.18)
        gain.gain.setValueAtTime(0.11, now)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19)
        osc.connect(gain)
        gain.connect(this.ctx.destination)
        osc.start(now)
        osc.stop(now + 0.2)
    }

    public destroy(): void {
        if (this.ctx) {
            this.ctx.close().catch(() => {})
            this.ctx = null
        }
    }
}

// ============================================================================
// 6. INPUT SYSTEM (DESKTOP KEYBOARD/MOUSE + VIRTUAL TOUCH JOYSTICK)
// ============================================================================

export class InputManager {
    private keys: Set<string> = new Set()
    public moveX: number = 0
    public moveY: number = 0

    // Pointer / Virtual Joystick
    public pointerActive: boolean = false
    public pointerId: number = -1
    public joyOriginX: number = 0
    public joyOriginY: number = 0
    public joyCurrentX: number = 0
    public joyCurrentY: number = 0
    public joyRadius: number = 52

    public mouseX: number = 0
    public mouseY: number = 0
    public justClicked: boolean = false
    public clickX: number = 0
    public clickY: number = 0
    public pauseRequested: boolean = false

    /** True after the player clicked the game canvas; false once they click elsewhere on the page. */
    public engaged: boolean = false
    /** Set by the host loop: true only while the game is on screen and the tab is visible. */
    public listening: boolean = true
    /** Logical (CSS px) canvas size, used to map pointer coords when the canvas is scaled. */
    public logicalW: number = 960
    public logicalH: number = 540

    private canvas: HTMLCanvasElement | null = null
    private root: HTMLElement | null = null
    private onFirstGesture: () => void
    /** Called immediately on pointer-down with canvas-space coords (UI buttons). */
    public onPress: ((x: number, y: number) => void) | null = null

    constructor(onFirstGesture: () => void) {
        this.onFirstGesture = onFirstGesture
    }

    public attach(canvas: HTMLCanvasElement, root?: HTMLElement): void {
        this.canvas = canvas
        this.root = root || canvas
        window.addEventListener("keydown", this.handleKeyDown)
        window.addEventListener("keyup", this.handleKeyUp)
        window.addEventListener("blur", this.handleBlur)
        window.addEventListener("pointerdown", this.handleWindowPointerDown)
        this.root.addEventListener("pointerdown", this.handlePointerDown)
        window.addEventListener("pointermove", this.handlePointerMove)
        window.addEventListener("pointerup", this.handlePointerUp)
        window.addEventListener("pointercancel", this.handlePointerUp)
    }

    public detach(): void {
        window.removeEventListener("keydown", this.handleKeyDown)
        window.removeEventListener("keyup", this.handleKeyUp)
        window.removeEventListener("blur", this.handleBlur)
        window.removeEventListener("pointerdown", this.handleWindowPointerDown)
        if (this.root) {
            this.root.removeEventListener("pointerdown", this.handlePointerDown)
        }
        window.removeEventListener("pointermove", this.handlePointerMove)
        window.removeEventListener("pointerup", this.handlePointerUp)
        window.removeEventListener("pointercancel", this.handlePointerUp)
        this.canvas = null
        this.root = null
    }

    public releasePointer(): void {
        this.pointerActive = false
        this.pointerId = -1
    }

    private toCanvasCoords(
        clientX: number,
        clientY: number
    ): {
        x: number
        y: number
    } {
        if (!this.canvas) return { x: 0, y: 0 }
        const rect = this.canvas.getBoundingClientRect()
        const sx = rect.width > 0 ? this.logicalW / rect.width : 1
        const sy = rect.height > 0 ? this.logicalH / rect.height : 1
        return {
            x: (clientX - rect.left) * sx,
            y: (clientY - rect.top) * sy,
        }
    }

    private isEditableTarget(target: EventTarget | null): boolean {
        const el = target as HTMLElement | null
        if (!el || !el.tagName) return false
        if (el.isContentEditable) return true
        const tag = el.tagName
        return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
    }

    private handleKeyDown = (e: KeyboardEvent): void => {
        // Never hijack the keyboard unless the player is actually using the game.
        if (!this.engaged || !this.listening) return
        if (this.isEditableTarget(e.target)) return

        this.onFirstGesture()
        const code = e.code
        if (
            code === "ArrowUp" ||
            code === "ArrowDown" ||
            code === "ArrowLeft" ||
            code === "ArrowRight" ||
            code === "Space"
        ) {
            e.preventDefault()
        }
        if (code === "Escape" || code === "KeyP") {
            this.pauseRequested = true
        }
        this.keys.add(code)
    }

    private handleKeyUp = (e: KeyboardEvent): void => {
        this.keys.delete(e.code)
    }

    private handleBlur = (): void => {
        // Prevents "stuck" movement keys when the window loses focus.
        this.keys.clear()
        this.releasePointer()
    }

    private handleWindowPointerDown = (e: PointerEvent): void => {
        const t = e.target as Node | null
        if (!this.root || !t || !this.root.contains(t)) {
            this.engaged = false
            this.keys.clear()
        }
    }

    private handlePointerDown = (e: PointerEvent): void => {
        this.engaged = true
        this.onFirstGesture()
        const pos = this.toCanvasCoords(e.clientX, e.clientY)
        this.mouseX = pos.x
        this.mouseY = pos.y
        this.clickX = pos.x
        this.clickY = pos.y

        if (!this.pointerActive) {
            this.pointerActive = true
            this.pointerId = e.pointerId
            this.joyOriginX = pos.x
            this.joyOriginY = pos.y
            this.joyCurrentX = pos.x
            this.joyCurrentY = pos.y
        }

        // Handle UI buttons right away (do not wait for the next sim step).
        if (this.onPress) {
            try {
                this.onPress(pos.x, pos.y)
            } catch (err) {
                console.error("[MidnightStitch] click handler error:", err)
            }
        } else {
            this.justClicked = true
        }
    }

    private handlePointerMove = (e: PointerEvent): void => {
        if (!this.pointerActive || e.pointerId !== this.pointerId) {
            if (this.canvas) {
                const p = this.toCanvasCoords(e.clientX, e.clientY)
                this.mouseX = p.x
                this.mouseY = p.y
            }
            return
        }
        const pos = this.toCanvasCoords(e.clientX, e.clientY)
        this.mouseX = pos.x
        this.mouseY = pos.y
        this.joyCurrentX = pos.x
        this.joyCurrentY = pos.y
    }

    private handlePointerUp = (e: PointerEvent): void => {
        if (this.pointerActive && e.pointerId === this.pointerId) {
            this.releasePointer()
        }
    }

    public update(): void {
        let kx = 0
        let ky = 0
        if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) kx -= 1
        if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) kx += 1
        if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) ky -= 1
        if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) ky += 1

        if (kx !== 0 || ky !== 0) {
            const len = Math.hypot(kx, ky)
            this.moveX = kx / len
            this.moveY = ky / len
            return
        }

        if (this.pointerActive) {
            const dx = this.joyCurrentX - this.joyOriginX
            const dy = this.joyCurrentY - this.joyOriginY
            const dist = Math.hypot(dx, dy)
            if (dist > 6) {
                const clamped = Math.min(dist, this.joyRadius) / this.joyRadius
                this.moveX = (dx / dist) * clamped
                this.moveY = (dy / dist) * clamped
                return
            }
        }

        this.moveX = 0
        this.moveY = 0
    }

    public consumeClick(): boolean {
        if (this.justClicked) {
            this.justClicked = false
            return true
        }
        return false
    }
}

// ============================================================================
// 7. SPATIAL HASH GRID (64PX CELLS, ZERO HOT-LOOP ALLOCATION)
// ============================================================================

export class SpatialHashGrid {
    private readonly cellSize: number
    private readonly bucketCount: number = 4096 // Power of 2
    private readonly bucketMask: number = 4095
    private readonly bucketHead: Int32Array
    private readonly entityNext: Int32Array
    private readonly entityStamp: Int32Array
    private stamp: number = 0
    public readonly queryResults: Int32Array

    constructor(cellSize: number, maxEntities: number) {
        this.cellSize = cellSize
        this.bucketHead = new Int32Array(this.bucketCount)
        this.entityNext = new Int32Array(maxEntities)
        this.entityStamp = new Int32Array(maxEntities)
        this.queryResults = new Int32Array(maxEntities)
        this.clear()
    }

    public clear(): void {
        this.bucketHead.fill(-1)
    }

    private hashCell(cx: number, cy: number): number {
        const h = Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)
        return h & this.bucketMask
    }

    public insert(entityIndex: number, x: number, y: number): void {
        const cx = Math.floor(x / this.cellSize)
        const cy = Math.floor(y / this.cellSize)
        const b = this.hashCell(cx, cy)
        this.entityNext[entityIndex] = this.bucketHead[b]
        this.bucketHead[b] = entityIndex
    }

    /**
     * Populates `this.queryResults` with candidate entity indices in the bounding cell range
     * and returns the count of candidates written. Zero allocations.
     * Entities are de-duplicated (two cells can hash into the same bucket), so each
     * entity appears at most once per query. Callers must still do an exact distance test.
     */
    public queryBox(
        minX: number,
        minY: number,
        maxX: number,
        maxY: number
    ): number {
        const minCx = Math.floor(minX / this.cellSize)
        const minCy = Math.floor(minY / this.cellSize)
        const maxCx = Math.floor(maxX / this.cellSize)
        const maxCy = Math.floor(maxY / this.cellSize)

        this.stamp++
        if (this.stamp > 2147483000) {
            this.entityStamp.fill(0)
            this.stamp = 1
        }
        const stamp = this.stamp

        let count = 0
        const maxResults = this.queryResults.length

        for (let cy = minCy; cy <= maxCy; cy++) {
            for (let cx = minCx; cx <= maxCx; cx++) {
                const b = this.hashCell(cx, cy)
                let idx = this.bucketHead[b]
                while (idx !== -1) {
                    if (this.entityStamp[idx] !== stamp) {
                        this.entityStamp[idx] = stamp
                        if (count < maxResults) {
                            this.queryResults[count++] = idx
                        }
                    }
                    idx = this.entityNext[idx]
                }
            }
        }
        return count
    }
}

// ============================================================================
// 8. OBJECT POOLS & ENTITY STORES (ZERO ALLOCATION IN HOT LOOP)
// ============================================================================

export interface PlayerEntity {
    x: number
    y: number
    prevX: number
    prevY: number
    vx: number
    vy: number
    facing: number // 1 or -1
    hp: number
    maxHp: number
    speed: number
    iframeTimer: number
    hitFlashTimer: number
    walkPhase: number
    blinkTimer: number
    xp: number
    xpToNext: number
    level: number
    kills: number
    rerollsLeft: number
    banishesLeft: number
    // Orbiting bunny state
    bunnyAngle: number
    bunnyX: number
    bunnyY: number
    bunnyPrevX: number
    bunnyPrevY: number
    bunnyBobPhase: number
    // Held-bunny melee / guard state
    bunnySwingT: number
    bunnySwingSign: number
    bunnySwingBase: number
    bunnySwingPhi: number
    bunnyStrike: number
    bunnyCd: number
    bunnyGuardCd: number
    bunnyGuardFlash: number
    bunnyCounterPending: boolean
    bunnyCounterX: number
    bunnyCounterY: number
    // Weapon cooldowns
    heartBoltTimer: number
}

export interface EnemyEntity {
    active: boolean
    type: EnemyTypeId
    x: number
    y: number
    prevX: number
    prevY: number
    vx: number
    vy: number
    kbVx: number
    kbVy: number
    hp: number
    maxHp: number
    speed: number
    radius: number
    damage: number
    xpValue: number
    armor: number
    hitFlash: number
    animPhase: number
    // Dasher AI state
    aiState: number // 0 = chase, 1 = telegraph, 2 = dashing, 3 = cooldown
    aiTimer: number
    dashDirX: number
    dashDirY: number
}

export interface ProjectileEntity {
    active: boolean
    x: number
    y: number
    prevX: number
    prevY: number
    vx: number
    vy: number
    radius: number
    damage: number
    pierce: number
    life: number
    isCrit: boolean
    hitIds: Int32Array // enemies already hit by this projectile
    hitCount: number
    rotation: number
}

export interface GemEntity {
    active: boolean
    x: number
    y: number
    prevX: number
    prevY: number
    value: number
    tier: number // 0 = small pink, 1 = medium purple, 2 = gold heart
    magnetized: boolean
    bobPhase: number
}

export interface ParticleEntity {
    active: boolean
    x: number
    y: number
    prevX: number
    prevY: number
    vx: number
    vy: number
    size: number
    color: string
    alpha: number
    life: number
    maxLife: number
    kind: number // 0 = circle, 1 = sparkle star, 2 = heart, 3 = stitch line
}

export interface DamageNumberEntity {
    active: boolean
    x: number
    y: number
    vy: number
    value: number
    isCrit: boolean
    isHeal: boolean
    life: number
    maxLife: number
}

export class EntityStore {
    public readonly enemies: EnemyEntity[] = []
    public readonly projectiles: ProjectileEntity[] = []
    public readonly gems: GemEntity[] = []
    public readonly particles: ParticleEntity[] = []
    public readonly dmgNumbers: DamageNumberEntity[] = []

    public activeEnemyCount: number = 0
    public activeParticleCount: number = 0

    constructor() {
        for (let i = 0; i < CONFIG.MAX_ENEMIES; i++) {
            this.enemies.push({
                active: false,
                type: "drifter",
                x: 0,
                y: 0,
                prevX: 0,
                prevY: 0,
                vx: 0,
                vy: 0,
                kbVx: 0,
                kbVy: 0,
                hp: 10,
                maxHp: 10,
                speed: 50,
                radius: 14,
                damage: 5,
                xpValue: 1,
                armor: 0,
                hitFlash: 0,
                animPhase: 0,
                aiState: 0,
                aiTimer: 0,
                dashDirX: 0,
                dashDirY: 0,
            })
        }

        for (let i = 0; i < CONFIG.MAX_PROJECTILES; i++) {
            this.projectiles.push({
                active: false,
                x: 0,
                y: 0,
                prevX: 0,
                prevY: 0,
                vx: 0,
                vy: 0,
                radius: 8,
                damage: 10,
                pierce: 1,
                life: 0,
                isCrit: false,
                hitIds: new Int32Array(8),
                hitCount: 0,
                rotation: 0,
            })
        }

        for (let i = 0; i < CONFIG.MAX_GEMS; i++) {
            this.gems.push({
                active: false,
                x: 0,
                y: 0,
                prevX: 0,
                prevY: 0,
                value: 1,
                tier: 0,
                magnetized: false,
                bobPhase: 0,
            })
        }

        for (let i = 0; i < CONFIG.MAX_PARTICLES; i++) {
            this.particles.push({
                active: false,
                x: 0,
                y: 0,
                prevX: 0,
                prevY: 0,
                vx: 0,
                vy: 0,
                size: 4,
                color: PALETTE.hotPink,
                alpha: 1,
                life: 0,
                maxLife: 0.5,
                kind: 0,
            })
        }

        for (let i = 0; i < CONFIG.MAX_DMG_NUMBERS; i++) {
            this.dmgNumbers.push({
                active: false,
                x: 0,
                y: 0,
                vy: -40,
                value: 0,
                isCrit: false,
                isHeal: false,
                life: 0,
                maxLife: 0.65,
            })
        }
    }

    public resetAll(): void {
        for (let i = 0; i < this.enemies.length; i++)
            this.enemies[i].active = false
        for (let i = 0; i < this.projectiles.length; i++)
            this.projectiles[i].active = false
        for (let i = 0; i < this.gems.length; i++) this.gems[i].active = false
        for (let i = 0; i < this.particles.length; i++)
            this.particles[i].active = false
        for (let i = 0; i < this.dmgNumbers.length; i++)
            this.dmgNumbers[i].active = false
        this.activeEnemyCount = 0
        this.activeParticleCount = 0
    }
}

// ============================================================================
// 9. OFFSCREEN SPRITE PRE-RENDERER (ANIME CEL-SHADED ART, ZERO PER-FRAME BLUR)
// ============================================================================

export class SpriteCache {
    public girlIdleCanvas: HTMLCanvasElement
    public girlBlinkCanvas: HTMLCanvasElement
    public bunnyCanvas: HTMLCanvasElement
    public heartBoltCanvas: HTMLCanvasElement
    public enemyCanvases: Record<EnemyTypeId, HTMLCanvasElement>
    public enemyFlashCanvases: Record<EnemyTypeId, HTMLCanvasElement>
    public gemCanvases: HTMLCanvasElement[] = []
    public uiHeartFull: HTMLCanvasElement
    public uiHeartEmpty: HTMLCanvasElement

    public customPlayerImg: HTMLImageElement | null = null
    public customBunnyImg: HTMLImageElement | null = null
    private playerToken: number = 0
    private bunnyToken: number = 0

    constructor() {
        this.girlIdleCanvas = this.createOffscreen(96, 96)
        this.girlBlinkCanvas = this.createOffscreen(96, 96)
        this.bunnyCanvas = this.createOffscreen(72, 92)
        this.heartBoltCanvas = this.createOffscreen(40, 40)

        this.enemyCanvases = {
            drifter: this.createOffscreen(64, 64),
            dasher: this.createOffscreen(64, 64),
            splitter: this.createOffscreen(76, 76),
            mini_splitter: this.createOffscreen(48, 48),
        }
        this.enemyFlashCanvases = {
            drifter: this.createOffscreen(64, 64),
            dasher: this.createOffscreen(64, 64),
            splitter: this.createOffscreen(76, 76),
            mini_splitter: this.createOffscreen(48, 48),
        }

        this.gemCanvases = [
            this.createOffscreen(28, 28),
            this.createOffscreen(32, 32),
            this.createOffscreen(36, 36),
        ]

        this.uiHeartFull = this.createOffscreen(32, 32)
        this.uiHeartEmpty = this.createOffscreen(32, 32)

        this.bakeAll()
    }

    private createOffscreen(w: number, h: number): HTMLCanvasElement {
        const c = document.createElement("canvas")
        c.width = w
        c.height = h
        return c
    }

    private loadImage(
        url: string,
        isCurrent: () => boolean,
        assign: (img: HTMLImageElement | null) => void
    ): void {
        // No crossOrigin attribute on purpose: the image is only drawn, never read
        // back, and forcing CORS would break hosts that send no CORS headers.
        const img = new Image()
        img.onload = () => {
            if (isCurrent()) assign(img)
        }
        img.onerror = () => {
            if (isCurrent()) assign(null)
        }
        img.src = url
    }

    public setCustomImages(playerUrl?: string, bunnyUrl?: string): void {
        const pTok = ++this.playerToken
        if (playerUrl) {
            this.loadImage(
                playerUrl,
                () => pTok === this.playerToken,
                (img) => {
                    this.customPlayerImg = img
                }
            )
        } else {
            this.customPlayerImg = null
        }

        const bTok = ++this.bunnyToken
        if (bunnyUrl) {
            this.loadImage(
                bunnyUrl,
                () => bTok === this.bunnyToken,
                (img) => {
                    this.customBunnyImg = img
                }
            )
        } else {
            this.customBunnyImg = null
        }
    }

    private bakeAll(): void {
        this.bakeHeroine(this.girlIdleCanvas, false)
        this.bakeHeroine(this.girlBlinkCanvas, true)
        this.bakeBunny(this.bunnyCanvas)
        this.bakeHeartBolt(this.heartBoltCanvas)

        const types: EnemyTypeId[] = [
            "drifter",
            "dasher",
            "splitter",
            "mini_splitter",
        ]
        for (let i = 0; i < types.length; i++) {
            const t = types[i]
            this.bakeEnemy(this.enemyCanvases[t], t, false)
            this.bakeEnemy(this.enemyFlashCanvases[t], t, true)
        }

        this.bakeGem(this.gemCanvases[0], PALETTE.hotPink, 9)
        this.bakeGem(this.gemCanvases[1], PALETTE.purple, 11)
        this.bakeGem(this.gemCanvases[2], PALETTE.gold, 13)

        this.bakeUIHeart(this.uiHeartFull, true)
        this.bakeUIHeart(this.uiHeartEmpty, false)
    }

    /**
     * Draws our anime heroine matching the reference illustration:
     * - fluffy blonde bob fading to salmon-pink tips, big pink bow on the top-left
     * - long side-swept bangs: one thick lock hangs over the winking eye
     * - winking eye drawn as a ">" wedge (dark lash + red lower lid)
     * - wide almond blue eye with a thick dark-red lid and a red flick at the outer corner
     * - tiny nose hook, soft rosy cheeks and a small ":3" mouth
     * - charcoal blazer, white collar, red ribbon with a gold heart, pleated blue skirt
     * (The arms are drawn at runtime so she can hold and swing the bunny plush.)
     */
    private bakeHeroine(
        canvas: HTMLCanvasElement,
        bothEyesClosed: boolean
    ): void {
        const ctx = canvas.getContext("2d")
        if (!ctx) return
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.save()
        ctx.translate(48, 52)
        ctx.lineCap = "round"
        ctx.lineJoin = "round"

        const HAIR_LINE = "#9C5A3C"
        const FACE_LINE = "#3A1F2E"

        // Soft drop shadow
        ctx.fillStyle = "rgba(18, 8, 28, 0.42)"
        ctx.beginPath()
        ctx.ellipse(0, 32, 20, 7, 0, 0, Math.PI * 2)
        ctx.fill()

        // Back hair (blonde fading to pink tips, soft bob with outward flicks)
        const hairGrad = ctx.createLinearGradient(0, -34, 0, 16)
        hairGrad.addColorStop(0, "#FFD983")
        hairGrad.addColorStop(0.5, "#FFC98C")
        hairGrad.addColorStop(0.78, "#F7A090")
        hairGrad.addColorStop(1, "#EE7C8E")

        ctx.fillStyle = hairGrad
        ctx.strokeStyle = HAIR_LINE
        ctx.lineWidth = 2.2
        ctx.beginPath()
        ctx.moveTo(-21, -18)
        ctx.quadraticCurveTo(-27.5, -4, -24.5, 12)
        ctx.quadraticCurveTo(-18, 17.5, -12, 11)
        ctx.lineTo(-9, 6)
        ctx.lineTo(9, 6)
        ctx.lineTo(12, 11)
        ctx.quadraticCurveTo(18, 17.5, 24.5, 12)
        ctx.quadraticCurveTo(27.5, -4, 21, -18)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()

        // Back-hair strand lines
        ctx.strokeStyle = "rgba(156, 90, 60, 0.55)"
        ctx.lineWidth = 1.1
        ctx.beginPath()
        ctx.moveTo(-21, -2)
        ctx.quadraticCurveTo(-22.5, 5, -20.5, 12)
        ctx.moveTo(-16, 0)
        ctx.quadraticCurveTo(-17, 7, -15.5, 13)
        ctx.moveTo(21, -2)
        ctx.quadraticCurveTo(22.5, 5, 20.5, 12)
        ctx.moveTo(16, 0)
        ctx.quadraticCurveTo(17, 7, 15.5, 13)
        ctx.stroke()

        // Pleated Blue Skirt
        ctx.strokeStyle = PALETTE.outline
        ctx.lineWidth = 3
        ctx.fillStyle = PALETTE.skirtBlue
        ctx.beginPath()
        ctx.moveTo(-14, 14)
        ctx.lineTo(14, 14)
        ctx.lineTo(20, 29)
        ctx.lineTo(-20, 29)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()

        // Skirt pleats
        ctx.lineWidth = 1.8
        ctx.beginPath()
        ctx.moveTo(-7, 15)
        ctx.lineTo(-10, 28)
        ctx.moveTo(0, 15)
        ctx.lineTo(0, 28)
        ctx.moveTo(7, 15)
        ctx.lineTo(10, 28)
        ctx.stroke()

        // Dark School Blazer
        ctx.lineWidth = 3
        ctx.fillStyle = PALETTE.charcoal
        ctx.beginPath()
        ctx.moveTo(-15, -2)
        ctx.lineTo(15, -2)
        ctx.lineTo(17, 18)
        ctx.lineTo(-17, 18)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()

        // White Sailor/Shirt Collar
        ctx.fillStyle = PALETTE.white
        ctx.beginPath()
        ctx.moveTo(-9, -2)
        ctx.lineTo(0, 9)
        ctx.lineTo(9, -2)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()

        // Red Chest Ribbon + Gold Heart Charm
        ctx.fillStyle = PALETTE.ribbonRed
        ctx.beginPath()
        ctx.moveTo(0, 5)
        ctx.lineTo(-9, 1)
        ctx.lineTo(-7, 9)
        ctx.closePath()
        ctx.moveTo(0, 5)
        ctx.lineTo(9, 1)
        ctx.lineTo(7, 9)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()

        ctx.fillStyle = PALETTE.gold
        ctx.beginPath()
        ctx.arc(0, 5, 2.7, 0, Math.PI * 2)
        ctx.fill()

        // ---- FACE: wide cheeks and a softly pointed chin, like the artwork ----
        const faceGrad = ctx.createLinearGradient(0, -26, 0, 5)
        faceGrad.addColorStop(0, "#F9D5C4")
        faceGrad.addColorStop(0.35, "#FFE8DA")
        faceGrad.addColorStop(1, "#FFDCCB")
        ctx.fillStyle = faceGrad
        ctx.strokeStyle = "#B8604C"
        ctx.lineWidth = 1.8
        ctx.beginPath()
        ctx.moveTo(-16.5, -16)
        ctx.bezierCurveTo(-17, -4, -9.5, 2.5, 0, 5)
        ctx.bezierCurveTo(9.5, 2.5, 17, -4, 16.5, -16)
        ctx.bezierCurveTo(16, -28, -16, -28, -16.5, -16)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()

        // Rosy cheeks
        ctx.fillStyle = "rgba(255, 118, 150, 0.42)"
        ctx.beginPath()
        ctx.ellipse(-10.5, -4.8, 5.2, 2.8, 0, 0, Math.PI * 2)
        ctx.ellipse(10.5, -4.8, 5.2, 2.8, 0, 0, Math.PI * 2)
        ctx.fill()

        // Tiny nose hook
        ctx.strokeStyle = "#C27A68"
        ctx.lineWidth = 1.1
        ctx.beginPath()
        ctx.moveTo(1, -7.4)
        ctx.quadraticCurveTo(1.7, -5.9, 0.4, -5.4)
        ctx.stroke()

        // Small ":3" mouth
        ctx.strokeStyle = FACE_LINE
        ctx.lineWidth = 1.3
        ctx.beginPath()
        ctx.moveTo(-3.8, -3.1)
        ctx.quadraticCurveTo(-3.6, -0.9, -1.2, -1.3)
        ctx.moveTo(1.3, -1.2)
        ctx.quadraticCurveTo(2.6, -0.8, 3.8, -1.9)
        ctx.stroke()

        // Winking eye ">" wedge (viewer's left). side = 1 draws it as ">" , -1 mirrored.
        const drawWedge = (side: number): void => {
            ctx.strokeStyle = "#5E2A2A"
            ctx.lineWidth = 1.7
            ctx.beginPath()
            ctx.moveTo(14.8 * side, -15.4)
            ctx.quadraticCurveTo(9 * side, -13.4, 4.2 * side, -10.6)
            ctx.stroke()
            ctx.strokeStyle = "#C2303F"
            ctx.lineWidth = 1.5
            ctx.beginPath()
            ctx.moveTo(15.4 * side, -9.4)
            ctx.quadraticCurveTo(9.5 * side, -10.6, 4.2 * side, -10.6)
            ctx.stroke()
            ctx.fillStyle = "#5E2A2A"
            ctx.beginPath()
            ctx.moveTo(4.2 * side, -10.6)
            ctx.lineTo(7.2 * side, -12.8)
            ctx.lineTo(7.2 * side, -10)
            ctx.closePath()
            ctx.fill()
        }
        const drawOpenEye = (): void => {
            // Wide almond blue eye
            ctx.save()
            ctx.beginPath()
            ctx.moveTo(4.2, -10.4)
            ctx.quadraticCurveTo(8, -16, 14.6, -14)
            ctx.quadraticCurveTo(15, -8.2, 9.6, -6.8)
            ctx.quadraticCurveTo(5.6, -6.6, 4.2, -10.4)
            ctx.closePath()
            ctx.fillStyle = "#F4F8FF"
            ctx.fill()
            ctx.clip()

            const irisGrad = ctx.createLinearGradient(0, -14.5, 0, -6.7)
            irisGrad.addColorStop(0, "#3E63C9")
            irisGrad.addColorStop(0.55, "#6FA3F0")
            irisGrad.addColorStop(1, "#B9DDFF")
            ctx.fillStyle = irisGrad
            ctx.beginPath()
            ctx.ellipse(8.8, -10.6, 3.4, 3.9, 0, 0, Math.PI * 2)
            ctx.fill()

            ctx.fillStyle = "#2B2A6B"
            ctx.beginPath()
            ctx.ellipse(8.7, -10.7, 1.2, 1.8, 0, 0, Math.PI * 2)
            ctx.fill()

            ctx.fillStyle = "#FFFFFF"
            ctx.beginPath()
            ctx.arc(10.2, -12.2, 1.2, 0, Math.PI * 2)
            ctx.arc(7.2, -8.6, 0.65, 0, Math.PI * 2)
            ctx.fill()
            ctx.restore()

            // Thick dark-red upper lid
            ctx.strokeStyle = "#6A2630"
            ctx.lineWidth = 2.3
            ctx.beginPath()
            ctx.moveTo(4, -10.5)
            ctx.quadraticCurveTo(8, -16.3, 15, -14.2)
            ctx.stroke()

            // Red flick at the outer corner
            ctx.strokeStyle = "#D13040"
            ctx.lineWidth = 1.6
            ctx.beginPath()
            ctx.moveTo(11, -15.6)
            ctx.lineTo(16.6, -16)
            ctx.lineTo(14.6, -10.6)
            ctx.stroke()

            // Thin lower lid
            ctx.strokeStyle = "#7A3C48"
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(4.8, -9.8)
            ctx.quadraticCurveTo(9, -6.4, 14.6, -10.4)
            ctx.stroke()
        }

        if (bothEyesClosed) {
            drawWedge(-1)
            drawWedge(1)
        } else {
            drawOpenEye()
            ctx.save()
            ctx.scale(-1, 1)
            drawOpenEye()
            ctx.restore()
        }

        // ---- FRONT HAIR: fluffy bangs with one thick lock hanging over the winking eye ----
        const bangGrad = ctx.createLinearGradient(0, -34, 0, -6)
        bangGrad.addColorStop(0, "#FFDE98")
        bangGrad.addColorStop(0.6, "#FFCF8E")
        bangGrad.addColorStop(1, "#FFC083")
        ctx.fillStyle = bangGrad
        ctx.strokeStyle = HAIR_LINE
        ctx.lineWidth = 1.9
        ctx.beginPath()
        ctx.moveTo(-19.5, -12)
        ctx.quadraticCurveTo(-21.5, -27, -4, -33)
        ctx.quadraticCurveTo(14, -35, 19.5, -21)
        ctx.quadraticCurveTo(21, -16, 19, -12)
        ctx.quadraticCurveTo(17.5, -16, 14.5, -17.5)
        ctx.quadraticCurveTo(9, -19, 4, -17.5)
        ctx.quadraticCurveTo(1.2, -16, -1.6, -13.6)
        ctx.quadraticCurveTo(-5, -16.4, -8.6, -17.4)
        ctx.quadraticCurveTo(-13.5, -17.8, -16.3, -14.2)
        ctx.quadraticCurveTo(-18, -13, -19.5, -12)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()

        // Bang strand lines + highlight
        ctx.strokeStyle = "#E3A862"
        ctx.lineWidth = 1.1
        ctx.beginPath()
        ctx.moveTo(-3, -31)
        ctx.quadraticCurveTo(-8, -24, -5.5, -15.5)
        ctx.moveTo(5, -31.5)
        ctx.quadraticCurveTo(2, -24, 3, -16.5)
        ctx.moveTo(-12, -28)
        ctx.quadraticCurveTo(-16, -20, -15.5, -12.5)
        ctx.moveTo(11, -30)
        ctx.quadraticCurveTo(13, -24, 12.5, -18)
        ctx.stroke()
        ctx.strokeStyle = "#FFF3C8"
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.moveTo(-9, -29.5)
        ctx.quadraticCurveTo(-1, -31.5, 7, -29)
        ctx.stroke()

        // ---- Big pink hair bow (top-left) ----
        ctx.save()
        ctx.translate(-13, -27)
        ctx.rotate(-0.15)
        ctx.strokeStyle = "#8E2F6B"
        ctx.lineWidth = 1.6
        const wing = (ax: number, ay: number, w: number): void => {
            const len = Math.hypot(ax, ay)
            const nx = -ay / len
            const ny = ax / len
            ctx.fillStyle = "#EF77C2"
            ctx.beginPath()
            ctx.moveTo(0, 0)
            ctx.lineTo(ax + nx * w, ay + ny * w)
            ctx.lineTo(ax - nx * w, ay - ny * w)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
            ctx.fillStyle = "rgba(180, 40, 130, 0.35)"
            ctx.beginPath()
            ctx.moveTo(0, 0)
            ctx.lineTo(ax - nx * w, ay - ny * w)
            ctx.lineTo(ax, ay)
            ctx.closePath()
            ctx.fill()
        }
        wing(-4, -10.5, 5.2)
        wing(11, -3.5, 5.2)
        ctx.fillStyle = "#F58AC9"
        ctx.beginPath()
        ctx.arc(0, 0, 2.9, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.restore()

        ctx.restore()
    }

    /**
     * Soft light rim around everything drawn on a canvas, so dark sprites (the black
     * plush) stay readable on the dark night background. Baked once, never at runtime.
     */
    private addRim(canvas: HTMLCanvasElement, color: string, r: number): void {
        const ctx = canvas.getContext("2d")
        if (!ctx) return
        const tmp = this.createOffscreen(canvas.width, canvas.height)
        const t = tmp.getContext("2d")
        if (!t) return
        t.drawImage(canvas, 0, 0)
        t.globalCompositeOperation = "source-in"
        t.fillStyle = color
        t.fillRect(0, 0, tmp.width, tmp.height)
        ctx.save()
        ctx.globalCompositeOperation = "destination-over"
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2
            ctx.drawImage(tmp, Math.cos(a) * r, Math.sin(a) * r)
        }
        ctx.restore()
    }

    /**
     * Draws the stitched black bunny plush matching the reference art, sized to be held
     * in two hands. Origin of the drawing = the belly (the grip / pivot point):
     * charcoal body, white stitched face + belly patches, X-button eyes, one tall ear and
     * one drooping ear, dangling legs, red ribbon with a gold heart charm.
     */
    private bakeBunny(canvas: HTMLCanvasElement): void {
        const ctx = canvas.getContext("2d")
        if (!ctx) return
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.save()
        ctx.translate(36, 58)
        ctx.lineCap = "round"
        ctx.lineJoin = "round"

        const LINE = PALETTE.outline
        const BODY = PALETTE.plushBlack
        const SOFT = "#D8D4E6"
        const STITCH = "rgba(214, 210, 228, 0.8)"
        ctx.strokeStyle = LINE
        ctx.lineWidth = 2.4

        // Dangling legs
        ctx.fillStyle = BODY
        roundRectPath(ctx, -9.5, 9, 6.2, 16, 3)
        ctx.fill()
        ctx.stroke()
        roundRectPath(ctx, 3.5, 9, 6.2, 13.5, 3)
        ctx.fill()
        ctx.stroke()
        ctx.strokeStyle = STITCH
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let k = 0; k < 3; k++) {
            ctx.moveTo(-8.4, 13 + k * 3.6)
            ctx.lineTo(-5.8, 13 + k * 3.6)
            if (k < 2) {
                ctx.moveTo(4.6, 13 + k * 3.6)
                ctx.lineTo(7.2, 13 + k * 3.6)
            }
        }
        ctx.stroke()
        ctx.strokeStyle = LINE
        ctx.lineWidth = 2.4

        // Tall ear (standing, pale inner fabric)
        ctx.fillStyle = BODY
        ctx.beginPath()
        ctx.ellipse(-6, -38, 4.2, 12.5, -0.1, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = SOFT
        ctx.beginPath()
        ctx.ellipse(-5.5, -38, 2, 9.5, -0.1, 0, Math.PI * 2)
        ctx.fill()

        // Drooping ear
        ctx.fillStyle = BODY
        ctx.beginPath()
        ctx.ellipse(14.5, -17, 4.2, 11, -0.12, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = SOFT
        ctx.beginPath()
        ctx.ellipse(16.1, -17, 1.5, 8, -0.12, 0, Math.PI * 2)
        ctx.fill()

        // Stubby arms
        ctx.fillStyle = BODY
        ctx.beginPath()
        ctx.ellipse(-11.5, -1, 3.6, 6.5, 0.35, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.beginPath()
        ctx.ellipse(11.5, 0, 3.6, 6.5, -0.35, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()

        // Body + white stitched belly patch
        ctx.beginPath()
        ctx.ellipse(0, 2, 9.8, 12.5, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = PALETTE.white
        ctx.lineWidth = 1.8
        ctx.beginPath()
        ctx.ellipse(0, 3.5, 5.8, 8.2, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.setLineDash([2, 2])
        ctx.strokeStyle = "#9A96AA"
        ctx.lineWidth = 0.9
        ctx.beginPath()
        ctx.ellipse(0, 3.5, 4.6, 7, 0, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])

        // Head + white stitched face patch
        ctx.strokeStyle = LINE
        ctx.lineWidth = 2.4
        ctx.fillStyle = BODY
        roundRectPath(ctx, -12.5, -27, 25, 20, 8)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = "#F5F3FF"
        ctx.lineWidth = 1.6
        roundRectPath(ctx, -9.4, -24, 18.8, 13.5, 5)
        ctx.fill()
        ctx.stroke()
        ctx.setLineDash([1.6, 1.6])
        ctx.strokeStyle = "#A8A4B8"
        ctx.lineWidth = 0.8
        roundRectPath(ctx, -8, -22.7, 16, 11, 4)
        ctx.stroke()
        ctx.setLineDash([])

        // X-button eyes
        ctx.fillStyle = BODY
        ctx.beginPath()
        ctx.arc(-4.3, -18.6, 3.1, 0, Math.PI * 2)
        ctx.arc(4.3, -18.6, 3.1, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = PALETTE.white
        ctx.lineWidth = 1.1
        ctx.beginPath()
        ctx.moveTo(-5.7, -20)
        ctx.lineTo(-2.9, -17.2)
        ctx.moveTo(-2.9, -20)
        ctx.lineTo(-5.7, -17.2)
        ctx.moveTo(2.9, -20)
        ctx.lineTo(5.7, -17.2)
        ctx.moveTo(5.7, -20)
        ctx.lineTo(2.9, -17.2)
        ctx.stroke()

        // Zig-zag stitched mouth
        ctx.strokeStyle = LINE
        ctx.lineWidth = 1.1
        ctx.beginPath()
        ctx.moveTo(-2.8, -13.6)
        ctx.lineTo(-1.4, -12.4)
        ctx.lineTo(0, -13.6)
        ctx.lineTo(1.4, -12.4)
        ctx.lineTo(2.8, -13.6)
        ctx.stroke()

        // Red ribbon with tails + gold heart charm
        ctx.lineWidth = 1.8
        ctx.fillStyle = PALETTE.ribbonRed
        ctx.beginPath()
        ctx.moveTo(-1.5, -6)
        ctx.lineTo(-4.8, 2)
        ctx.lineTo(-2, 2.6)
        ctx.closePath()
        ctx.moveTo(1.5, -6)
        ctx.lineTo(4.8, 2)
        ctx.lineTo(2, 2.6)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(0, -7)
        ctx.lineTo(-8, -10.5)
        ctx.lineTo(-6.5, -4)
        ctx.closePath()
        ctx.moveTo(0, -7)
        ctx.lineTo(8, -10.5)
        ctx.lineTo(6.5, -4)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(0, -7, 2, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        this.drawHeartPath(ctx, 0, -2.8, 2.8)
        ctx.fillStyle = PALETTE.gold
        ctx.fill()
        ctx.stroke()

        ctx.restore()
        this.addRim(canvas, "rgba(233, 200, 255, 0.6)", 1.6)
    }

    private bakeHeartBolt(canvas: HTMLCanvasElement): void {
        const ctx = canvas.getContext("2d")
        if (!ctx) return
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.save()
        ctx.translate(20, 20)

        // Outer soft glow (baked once, zero runtime blur!)
        ctx.fillStyle = "rgba(255, 111, 168, 0.35)"
        ctx.beginPath()
        ctx.arc(0, 0, 16, 0, Math.PI * 2)
        ctx.fill()

        this.drawHeartPath(ctx, 0, 0, 11)
        ctx.fillStyle = PALETTE.hotPink
        ctx.strokeStyle = PALETTE.outline
        ctx.lineWidth = 2.6
        ctx.fill()
        ctx.stroke()

        // Inner highlight
        this.drawHeartPath(ctx, -2, -2, 4.5)
        ctx.fillStyle = PALETTE.white
        ctx.fill()

        ctx.restore()
    }

    private bakeEnemy(
        canvas: HTMLCanvasElement,
        type: EnemyTypeId,
        isFlash: boolean
    ): void {
        const ctx = canvas.getContext("2d")
        if (!ctx) return
        const def = ENEMY_TABLE[type]
        const w = canvas.width
        const h = canvas.height
        ctx.clearRect(0, 0, w, h)
        ctx.save()
        ctx.translate(w / 2, h / 2)
        ctx.lineJoin = "round"
        ctx.lineCap = "round"

        const r = def.radius
        // Shadow
        if (!isFlash) {
            ctx.fillStyle = "rgba(12, 6, 22, 0.38)"
            ctx.beginPath()
            ctx.ellipse(0, r + 4, r * 0.85, r * 0.35, 0, 0, Math.PI * 2)
            ctx.fill()
        }

        ctx.fillStyle = isFlash ? "#FFFFFF" : def.color
        ctx.strokeStyle = def.outline
        ctx.lineWidth = 3

        if (type === "drifter") {
            // Torn ghost-scrap shape
            ctx.beginPath()
            ctx.arc(0, -2, r, Math.PI, 0, false)
            ctx.lineTo(r, r * 0.8)
            ctx.lineTo(r * 0.45, r * 0.45)
            ctx.lineTo(0, r * 0.9)
            ctx.lineTo(-r * 0.45, r * 0.45)
            ctx.lineTo(-r, r * 0.8)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
        } else if (type === "dasher") {
            // Spiky scissor-hound fabric wedge
            ctx.beginPath()
            ctx.moveTo(0, -r * 1.15)
            ctx.lineTo(r * 1.1, r * 0.2)
            ctx.lineTo(r * 0.65, r * 0.95)
            ctx.lineTo(0, r * 0.55)
            ctx.lineTo(-r * 0.65, r * 0.95)
            ctx.lineTo(-r * 1.1, r * 0.2)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
        } else {
            // Patchwork blob (splitter & mini_splitter)
            ctx.beginPath()
            ctx.arc(0, 0, r, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()

            if (!isFlash) {
                // Cross-stitch seam line down the middle
                ctx.strokeStyle = PALETTE.lavender
                ctx.lineWidth = 1.8
                ctx.beginPath()
                ctx.moveTo(0, -r * 0.85)
                ctx.lineTo(0, r * 0.85)
                ctx.moveTo(-4, -r * 0.35)
                ctx.lineTo(4, -r * 0.35)
                ctx.moveTo(-4, r * 0.25)
                ctx.lineTo(4, r * 0.25)
                ctx.stroke()
            }
        }

        // Button / X eyes on non-flash sprite
        if (!isFlash) {
            ctx.fillStyle = PALETTE.gold
            const eyeOffset = r * 0.34
            ctx.beginPath()
            ctx.arc(-eyeOffset, -2, r * 0.2, 0, Math.PI * 2)
            ctx.arc(eyeOffset, -2, r * 0.2, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = def.outline
            ctx.lineWidth = 1.6
            ctx.stroke()
        }

        ctx.restore()
    }

    private bakeGem(
        canvas: HTMLCanvasElement,
        color: string,
        radius: number
    ): void {
        const ctx = canvas.getContext("2d")
        if (!ctx) return
        const cx = canvas.width / 2
        const cy = canvas.height / 2
        ctx.save()
        ctx.translate(cx, cy)

        // Glow
        ctx.fillStyle = "rgba(233, 200, 255, 0.28)"
        ctx.beginPath()
        ctx.arc(0, 0, radius + 4, 0, Math.PI * 2)
        ctx.fill()

        // Button / Diamond gem
        ctx.fillStyle = color
        ctx.strokeStyle = PALETTE.outline
        ctx.lineWidth = 2.4
        ctx.beginPath()
        ctx.moveTo(0, -radius)
        ctx.lineTo(radius, 0)
        ctx.lineTo(0, radius)
        ctx.lineTo(-radius, 0)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()

        // Shine
        ctx.fillStyle = PALETTE.white
        ctx.beginPath()
        ctx.arc(-radius * 0.25, -radius * 0.25, radius * 0.22, 0, Math.PI * 2)
        ctx.fill()

        ctx.restore()
    }

    private bakeUIHeart(canvas: HTMLCanvasElement, full: boolean): void {
        const ctx = canvas.getContext("2d")
        if (!ctx) return
        ctx.save()
        ctx.translate(16, 16)
        this.drawHeartPath(ctx, 0, 0, 11)
        ctx.fillStyle = full ? PALETTE.hotPink : "rgba(58, 58, 68, 0.65)"
        ctx.strokeStyle = PALETTE.outline
        ctx.lineWidth = 2.5
        ctx.fill()
        ctx.stroke()
        if (full) {
            ctx.fillStyle = PALETTE.white
            ctx.beginPath()
            ctx.arc(-3.5, -3.5, 2.2, 0, Math.PI * 2)
            ctx.fill()
        }
        ctx.restore()
    }

    /** Draws a heart centered on (x, y); `size` is the half-width. */
    public drawHeartPath(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        size: number
    ): void {
        const s = size
        ctx.beginPath()
        ctx.moveTo(x, y + s * 0.95)
        ctx.bezierCurveTo(
            x - s * 0.3,
            y + s * 0.65,
            x - s * 1.05,
            y + s * 0.15,
            x - s * 1.0,
            y - s * 0.35
        )
        ctx.bezierCurveTo(
            x - s * 0.95,
            y - s * 0.85,
            x - s * 0.2,
            y - s * 0.95,
            x,
            y - s * 0.4
        )
        ctx.bezierCurveTo(
            x + s * 0.2,
            y - s * 0.95,
            x + s * 0.95,
            y - s * 0.85,
            x + s * 1.0,
            y - s * 0.35
        )
        ctx.bezierCurveTo(
            x + s * 1.05,
            y + s * 0.15,
            x + s * 0.3,
            y + s * 0.65,
            x,
            y + s * 0.95
        )
        ctx.closePath()
    }
}

// ============================================================================
// 10. CORE GAME CLASS & SYSTEMS
// ============================================================================

export class MidnightStitchGame {
    public state: GameStateId = "MENU"
    public props: ResolvedProps
    /** Gameplay RNG (spawns, crits, level-up cards) — deterministic per seed. */
    public readonly rng: SeededRNG
    /** Cosmetic RNG (particles, jitter, blink) — never affects gameplay determinism. */
    public readonly fxRng: SeededRNG
    public readonly events: EventBus
    public readonly sound: SoundEngine
    public readonly input: InputManager
    public readonly grid: SpatialHashGrid
    public readonly store: EntityStore
    public readonly sprites: SpriteCache

    // Viewport & Camera
    public viewW: number = 960
    public viewH: number = 540
    public dpr: number = 1
    public camX: number = 0
    public camY: number = 0
    public prevCamX: number = 0
    public prevCamY: number = 0
    public shakeTimer: number = 0
    public shakeIntensity: number = 0
    public hitStopTimer: number = 0
    private bunnySwingId: number = 0
    private bunnyHitStamp: Int32Array = new Int32Array(CONFIG.MAX_ENEMIES)
    /** True when the last simulation step did not advance the world (pause, menu, hit-stop). */
    public frozen: boolean = false

    // Run Timing & Director
    public elapsedTime: number = 0
    public spawnTimer: number = 0
    public spawnBudget: number = 0
    public currentSeedNumber: number = 1

    // Player & Upgrades
    public player: PlayerEntity
    public upgradeLevels: Record<UpgradeId, number> = {
        weapon_heart_bolt: 1,
        passive_move_speed: 0,
        passive_max_hp: 0,
        passive_magnet: 0,
        passive_cooldown: 0,
        passive_crit: 0,
    }
    public banishedUpgrades: Set<UpgradeId> = new Set()
    public offeredCards: UpgradeId[] = []
    public cardFlipProgress: number = 0
    public banishModeActive: boolean = false
    public pendingLevelUps: number = 0

    // Interactive UI Button Hitboxes
    public uiButtons: UIButtonRect[] = []

    // Performance & Adaptive Quality Monitor
    public fps: number = 60
    private frameTimeAvg: number = 16.6
    private highFrameTimeDuration: number = 0
    private stableFrameTimeDuration: number = 0
    public lowQualityMode: boolean = false
    /** Last runtime error (shown on canvas when 'Show FPS' is enabled, to help debugging). */
    public lastError: string | null = null

    constructor(rawProps: MidnightStitchProps) {
        const props = resolveProps(rawProps)
        this.props = props
        this.currentSeedNumber =
            props.seedMode === "Daily"
                ? computeDailySeed()
                : Math.floor(Math.random() * 2147483647)
        this.rng = new SeededRNG(this.currentSeedNumber)
        this.fxRng = new SeededRNG((Date.now() ^ 0x9e3779b9) >>> 0)
        this.events = new EventBus()
        this.sound = new SoundEngine()
        this.sound.muted = !props.soundOn
        this.input = new InputManager(() => {
            this.sound.unlock()
        })
        this.input.onPress = (x, y) => {
            if (this.handleUIClick(x, y)) {
                // A button press must not also start a joystick drag.
                this.input.releasePointer()
            }
        }
        this.grid = new SpatialHashGrid(
            CONFIG.SPATIAL_CELL_SIZE,
            CONFIG.MAX_ENEMIES
        )
        this.store = new EntityStore()
        this.sprites = new SpriteCache()
        this.sprites.setCustomImages(props.playerImage, props.bunnyImage)

        this.player = this.createInitialPlayer()
        this.bindEvents()
    }

    private createInitialPlayer(): PlayerEntity {
        return {
            x: 0,
            y: 0,
            prevX: 0,
            prevY: 0,
            vx: 0,
            vy: 0,
            facing: 1,
            hp: CONFIG.PLAYER_BASE_HP,
            maxHp: CONFIG.PLAYER_BASE_HP,
            speed: CONFIG.PLAYER_BASE_SPEED,
            iframeTimer: 0,
            hitFlashTimer: 0,
            walkPhase: 0,
            blinkTimer: 2.5,
            xp: 0,
            xpToNext: 12,
            level: 1,
            kills: 0,
            rerollsLeft: CONFIG.REROLLS_PER_RUN,
            banishesLeft: CONFIG.BANISHES_PER_RUN,
            bunnyAngle: 0,
            bunnyX: BUNNY_HOLD_X,
            bunnyY: -7,
            bunnyPrevX: BUNNY_HOLD_X,
            bunnyPrevY: -7,
            bunnyBobPhase: 0,
            bunnySwingT: 0,
            bunnySwingSign: 1,
            bunnySwingBase: 0,
            bunnySwingPhi: 0,
            bunnyStrike: 0,
            bunnyCd: 0.4,
            bunnyGuardCd: 0,
            bunnyGuardFlash: 0,
            bunnyCounterPending: false,
            bunnyCounterX: 0,
            bunnyCounterY: 0,
            heartBoltTimer: 0.2,
        }
    }

    private bindEvents(): void {
        this.events.on("onKill", ({ x, y }) => {
            this.player.kills += 1
            this.spawnParticles(x, y, PALETTE.lavender, 7, 1)
        })
        this.events.on("onLevelUp", () => {
            this.sound.playLevelUp()
            if (this.state === "LEVEL_UP") {
                // Another level was gained while the upgrade drawer is open: queue it.
                this.pendingLevelUps += 1
            } else if (this.state === "PLAYING") {
                this.beginLevelUpChoice()
            }
        })
    }

    public updateProps(rawNextProps: MidnightStitchProps): void {
        const nextProps = resolveProps(rawNextProps)
        const prevImg = this.props.playerImage
        const prevBunny = this.props.bunnyImage
        this.props = nextProps
        this.sound.muted = !nextProps.soundOn
        if (
            prevImg !== nextProps.playerImage ||
            prevBunny !== nextProps.bunnyImage
        ) {
            this.sprites.setCustomImages(
                nextProps.playerImage,
                nextProps.bunnyImage
            )
        }
    }

    // ------------------------------------------------------------------------
    // FINITE STATE MACHINE
    // ------------------------------------------------------------------------
    public transitionTo(target: GameStateId): boolean {
        const allowed = VALID_STATE_TRANSITIONS[this.state]
        if (!allowed || !allowed.includes(target)) {
            return false
        }
        this.state = target
        return true
    }

    public startNewRun(): void {
        this.currentSeedNumber =
            this.props.seedMode === "Daily"
                ? computeDailySeed()
                : Math.floor(Math.random() * 2147483647)
        this.rng.setSeed(this.currentSeedNumber)
        this.store.resetAll()
        this.player = this.createInitialPlayer()
        this.upgradeLevels = {
            weapon_heart_bolt: 1,
            passive_move_speed: 0,
            passive_max_hp: 0,
            passive_magnet: 0,
            passive_cooldown: 0,
            passive_crit: 0,
        }
        this.banishedUpgrades.clear()
        this.offeredCards = []
        this.pendingLevelUps = 0
        this.banishModeActive = false
        this.cardFlipProgress = 0
        this.recalculatePlayerStats(false)

        this.elapsedTime = clamp(
            this.props.startTime || 0,
            0,
            CONFIG.SURVIVAL_WIN_SECONDS - 10
        )
        this.spawnTimer = 0.4
        this.spawnBudget = 4
        this.camX = 0
        this.camY = 0
        this.prevCamX = 0
        this.prevCamY = 0
        this.shakeTimer = 0
        this.shakeIntensity = 0
        this.hitStopTimer = 0
        this.frozen = false
        this.transitionTo("PLAYING")
    }

    // ------------------------------------------------------------------------
    // PROGRESSION & STAT SYSTEM
    // ------------------------------------------------------------------------
    public recalculatePlayerStats(healDelta: boolean): void {
        const spdLv = this.upgradeLevels.passive_move_speed
        const hpLv = this.upgradeLevels.passive_max_hp
        this.player.speed = CONFIG.PLAYER_BASE_SPEED * (1 + spdLv * 0.1)

        const newMaxHp = CONFIG.PLAYER_BASE_HP + hpLv * 25
        this.player.maxHp = newMaxHp
        if (healDelta) {
            const healAmt = hpLv === 5 ? 35 : 25
            this.player.hp = Math.min(
                this.player.maxHp,
                this.player.hp + healAmt
            )
            this.spawnDamageNumber(
                this.player.x,
                this.player.y - 24,
                healAmt,
                false,
                true
            )
        }
    }

    public getMagnetRadius(): number {
        const lv = this.upgradeLevels.passive_magnet
        const mult = lv === 5 ? 2.6 : 1 + lv * 0.3
        return CONFIG.BASE_MAGNET_RADIUS * mult
    }

    /** Cooldown multiplier: "+X% Attack Speed" means cooldown / (1 + X). */
    public getCooldownMultiplier(): number {
        const lv = this.upgradeLevels.passive_cooldown
        return 1 / (1 + lv * 0.08)
    }

    public getCritStats(): { chance: number; mult: number } {
        const lv = this.upgradeLevels.passive_crit
        return {
            chance: CONFIG.BASE_CRIT_CHANCE + lv * 0.06,
            mult: CONFIG.BASE_CRIT_MULT + (lv === 5 ? 0.8 : lv * 0.15),
        }
    }

    public rollLevelUpCards(): void {
        this.offeredCards = []
        const candidates: UpgradeDef[] = []
        for (let i = 0; i < UPGRADE_LIST.length; i++) {
            const u = UPGRADE_LIST[i]
            if (this.banishedUpgrades.has(u.id)) continue
            if (this.upgradeLevels[u.id] >= u.maxLevel) continue
            candidates.push(u)
        }

        const count = Math.min(3, candidates.length)
        for (let pick = 0; pick < count; pick++) {
            const idx = this.pickWeighted(candidates)
            this.offeredCards.push(candidates[idx].id)
            candidates.splice(idx, 1)
        }
    }

    private pickWeighted(candidates: UpgradeDef[]): number {
        let totalWeight = 0
        for (let i = 0; i < candidates.length; i++) {
            totalWeight += candidates[i].weight
        }
        let r = this.rng.range(0, totalWeight)
        for (let i = 0; i < candidates.length; i++) {
            r -= candidates[i].weight
            if (r <= 0) return i
        }
        return candidates.length - 1
    }

    /** After banishing a card, tries to fill the empty slot with a fresh upgrade. */
    private offerReplacementCard(): void {
        const candidates: UpgradeDef[] = []
        for (let i = 0; i < UPGRADE_LIST.length; i++) {
            const u = UPGRADE_LIST[i]
            if (this.banishedUpgrades.has(u.id)) continue
            if (this.upgradeLevels[u.id] >= u.maxLevel) continue
            if (this.offeredCards.indexOf(u.id) !== -1) continue
            candidates.push(u)
        }
        if (candidates.length === 0) return
        const idx = this.pickWeighted(candidates)
        this.offeredCards.push(candidates[idx].id)
    }

    /** Opens the upgrade drawer, or (if everything is maxed) grants a small heal and continues. */
    private beginLevelUpChoice(): void {
        this.rollLevelUpCards()
        if (this.offeredCards.length === 0) {
            // Nothing left to upgrade — avoid a soft-lock on an empty drawer.
            const p = this.player
            const heal = 20
            p.hp = Math.min(p.maxHp, p.hp + heal)
            this.spawnDamageNumber(p.x, p.y - 24, heal, false, true)
            return
        }
        this.cardFlipProgress = 0
        this.banishModeActive = false
        this.transitionTo("LEVEL_UP")
    }

    private finishLevelUpChoice(): void {
        while (this.pendingLevelUps > 0) {
            this.pendingLevelUps -= 1
            this.rollLevelUpCards()
            if (this.offeredCards.length > 0) {
                this.cardFlipProgress = 0
                this.banishModeActive = false
                return // stay in LEVEL_UP for the queued level
            }
        }
        this.pendingLevelUps = 0
        this.banishModeActive = false
        this.transitionTo("PLAYING")
    }

    public selectUpgradeCard(index: number): void {
        if (this.state !== "LEVEL_UP") return
        if (index < 0 || index >= this.offeredCards.length) return
        const id = this.offeredCards[index]
        const def = UPGRADE_TABLE[id]

        if (this.banishModeActive && this.player.banishesLeft > 0) {
            this.banishedUpgrades.add(id)
            this.player.banishesLeft -= 1
            this.banishModeActive = false
            this.offeredCards.splice(index, 1)
            this.offerReplacementCard()
            this.sound.playClick()
            if (this.offeredCards.length === 0) {
                this.finishLevelUpChoice()
            }
            return
        }

        const prevHpLv = this.upgradeLevels.passive_max_hp
        this.upgradeLevels[id] = Math.min(
            def.maxLevel,
            this.upgradeLevels[id] + 1
        )
        const healed = this.upgradeLevels.passive_max_hp > prevHpLv
        this.recalculatePlayerStats(healed)
        this.sound.playClick()
        this.spawnParticles(this.player.x, this.player.y, PALETTE.gold, 14, 1)
        this.finishLevelUpChoice()
    }

    // ------------------------------------------------------------------------
    // FIXED 60HZ SIMULATION STEP
    // ------------------------------------------------------------------------
    public step(dt: number): void {
        this.input.update()

        if (this.input.pauseRequested) {
            this.input.pauseRequested = false
            if (this.state === "PLAYING") {
                this.sound.playClick()
                this.transitionTo("PAUSED")
            } else if (this.state === "PAUSED") {
                this.sound.playClick()
                this.transitionTo("PLAYING")
            }
        }

        if (this.input.consumeClick()) {
            const handled = this.handleUIClick(
                this.input.clickX,
                this.input.clickY
            )
            if (handled) {
                // A button press must not also start a joystick drag.
                this.input.releasePointer()
            }
        }

        if (this.state === "LEVEL_UP") {
            this.frozen = true
            this.cardFlipProgress = Math.min(
                1,
                this.cardFlipProgress + dt * 4.5
            )
            return
        }

        if (this.state !== "PLAYING") {
            this.frozen = true
            return
        }

        // Hit-stop freeze frames (30-60ms impact feel)
        if (this.hitStopTimer > 0) {
            this.frozen = true
            this.hitStopTimer -= dt
            return
        }

        this.frozen = false
        this.elapsedTime += dt
        if (this.elapsedTime >= CONFIG.SURVIVAL_WIN_SECONDS) {
            this.sound.playLevelUp()
            this.transitionTo("VICTORY")
            return
        }

        this.updatePlayer(dt)
        this.updateCamera(dt)
        this.updateSpawnDirector(dt)
        this.updateEnemiesAndSpatialGrid(dt)
        this.updateBunnyMelee(dt)
        this.updateCombatAutoAttack(dt)
        this.updateProjectiles(dt)
        this.updateGems(dt)
        this.updateParticlesAndDamageNumbers(dt)
    }

    /** Returns true if the click hit a button. */
    private handleUIClick(x: number, y: number): boolean {
        const st = this.state
        for (let i = 0; i < this.uiButtons.length; i++) {
            const b = this.uiButtons[i]
            if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
                if (
                    b.id === "START_RUN" &&
                    (st === "MENU" || st === "GAME_OVER" || st === "VICTORY")
                ) {
                    this.sound.playClick()
                    this.startNewRun()
                    return true
                }
                if (b.id === "RESUME_RUN" && st === "PAUSED") {
                    this.sound.playClick()
                    this.transitionTo("PLAYING")
                    return true
                }
                if (
                    b.id === "TO_MENU" &&
                    (st === "PAUSED" || st === "GAME_OVER" || st === "VICTORY")
                ) {
                    this.sound.playClick()
                    this.transitionTo("MENU")
                    return true
                }
                if (b.id === "PAUSE_TOGGLE") {
                    if (st === "PLAYING") {
                        this.sound.playClick()
                        this.transitionTo("PAUSED")
                    } else if (st === "PAUSED") {
                        this.sound.playClick()
                        this.transitionTo("PLAYING")
                    }
                    return true
                }
                if (st === "LEVEL_UP") {
                    if (b.id === "CARD_SELECT" && b.payload !== undefined) {
                        // Ignore clicks while the cards are still flipping in
                        // (avoids accidental picks from the tap that levelled up).
                        if (this.cardFlipProgress >= 0.7) {
                            this.selectUpgradeCard(b.payload)
                        }
                        return true
                    }
                    if (b.id === "REROLL" && this.player.rerollsLeft > 0) {
                        this.player.rerollsLeft -= 1
                        this.banishModeActive = false
                        this.rollLevelUpCards()
                        this.cardFlipProgress = 0
                        this.sound.playClick()
                        return true
                    }
                    if (b.id === "BANISH" && this.player.banishesLeft > 0) {
                        this.banishModeActive = !this.banishModeActive
                        this.sound.playClick()
                        return true
                    }
                }
            }
        }
        return false
    }

    // ------------------------------------------------------------------------
    // PLAYER & ORBITING BUNNY MOVEMENT
    // ------------------------------------------------------------------------
    private updatePlayer(dt: number): void {
        const p = this.player
        p.prevX = p.x
        p.prevY = p.y
        p.bunnyPrevX = p.bunnyX
        p.bunnyPrevY = p.bunnyY

        p.vx = this.input.moveX * p.speed
        p.vy = this.input.moveY * p.speed
        p.x += p.vx * dt
        p.y += p.vy * dt

        if (Math.abs(p.vx) > 2) {
            p.facing = p.vx > 0 ? 1 : -1
        }

        const isMoving = Math.abs(p.vx) > 1 || Math.abs(p.vy) > 1
        if (isMoving) {
            p.walkPhase += dt * 11
        } else {
            p.walkPhase += dt * 3.5
        }

        p.blinkTimer -= dt
        if (p.blinkTimer <= -0.14) {
            p.blinkTimer = this.fxRng.range(2.4, 4.8)
        }

        if (p.iframeTimer > 0) p.iframeTimer -= dt
        if (p.hitFlashTimer > 0) p.hitFlashTimer -= dt

        // Plush bunny held in both hands: rests at the girl's side, swings at close enemies
        p.bunnyBobPhase += dt * 5.5
        const bobY = Math.sin(p.walkPhase) * 2.5
        const restX = p.x + p.facing * BUNNY_HOLD_X
        const restY = p.y - 7 + bobY + Math.sin(p.bunnyBobPhase) * 1.6
        const restRot = p.facing * 0.3 + Math.sin(p.bunnyBobPhase * 0.8) * 0.06

        if (p.bunnySwingT > 0) {
            p.bunnySwingT = Math.max(0, p.bunnySwingT - dt)
            const u = 1 - p.bunnySwingT / BUNNY_SWING_DUR
            const s = p.bunnySwingSign
            const windRot = p.bunnySwingBase - s * 1.25
            const endRot = p.bunnySwingBase + s * 1.15
            let rot: number
            let blend: number
            let ext: number
            if (u < 0.3) {
                // Wind-up: pull the plush back across the body
                const t = easeOutCubic(u / 0.3)
                rot = restRot + wrapPi(windRot - restRot) * t
                blend = t
                ext = 0
                p.bunnyStrike = 0
            } else if (u < 0.66) {
                // Strike: arms extend and the plush whips through the target
                const t = easeOutCubic((u - 0.3) / 0.36)
                rot = windRot + (endRot - windRot) * t
                blend = 1
                ext = t
                p.bunnyStrike = 1
            } else {
                // Recovery: back to the resting grip
                const t = easeInOut((u - 0.66) / 0.34)
                rot = endRot + wrapPi(restRot - endRot) * t
                blend = 1 - t
                ext = 1 - t
                p.bunnyStrike = 0
            }
            const reach = 14 + 24 * ext
            const sx = p.x + Math.cos(p.bunnySwingPhi) * reach
            const sy = p.y - 6 + Math.sin(p.bunnySwingPhi) * reach + bobY * 0.3
            p.bunnyX = lerp(restX, sx, blend)
            p.bunnyY = lerp(restY, sy, blend)
            p.bunnyAngle = rot
        } else {
            p.bunnyStrike = 0
            p.bunnyX = lerp(p.bunnyX, restX, 0.4)
            p.bunnyY = lerp(p.bunnyY, restY, 0.4)
            p.bunnyAngle += wrapPi(restRot - p.bunnyAngle) * 0.3
        }
    }

    private updateCamera(dt: number): void {
        this.prevCamX = this.camX
        this.prevCamY = this.camY
        this.camX = lerp(this.camX, this.player.x, 1 - Math.exp(-9 * dt))
        this.camY = lerp(this.camY, this.player.y, 1 - Math.exp(-9 * dt))

        if (this.shakeTimer > 0) {
            this.shakeTimer -= dt
            if (this.shakeTimer <= 0) {
                this.shakeTimer = 0
                this.shakeIntensity = 0
            }
        }
    }

    public addScreenShake(intensity: number, duration: number): void {
        this.shakeIntensity = Math.max(this.shakeIntensity, intensity)
        this.shakeTimer = Math.max(this.shakeTimer, duration)
    }

    // ------------------------------------------------------------------------
    // SPAWN DIRECTOR SYSTEM (BUDGET-BASED, OUTSIDE CAMERA RING)
    // ------------------------------------------------------------------------
    private updateSpawnDirector(dt: number): void {
        const diff = DIFFICULTY_TABLE[this.props.difficulty]
        const minutes = this.elapsedTime / 60

        // Pacing curve wave (calm, pressure, spike, relief)
        const waveCycle = Math.sin(this.elapsedTime * 0.08) * 0.3 + 1.0
        const budgetPerSec =
            (2.2 + minutes * 1.85 + this.player.level * 0.22) *
            waveCycle *
            diff.spawnRateMult

        this.spawnBudget = Math.min(35, this.spawnBudget + budgetPerSec * dt)
        this.spawnTimer -= dt

        if (this.spawnTimer > 0) return
        this.spawnTimer = 0.35

        let attempts = 0
        while (
            this.spawnBudget >= 1 &&
            this.store.activeEnemyCount < CONFIG.MAX_ENEMIES &&
            attempts < 8
        ) {
            attempts++
            let chosenType: EnemyTypeId = "drifter"
            const roll = this.rng.next()
            if (minutes > 0.35 && roll < 0.26 && this.spawnBudget >= 2) {
                chosenType = "dasher"
            } else if (
                minutes > 0.75 &&
                roll >= 0.26 &&
                roll < 0.45 &&
                this.spawnBudget >= 3
            ) {
                chosenType = "splitter"
            }

            const def = ENEMY_TABLE[chosenType]
            if (this.spawnBudget < def.cost) break

            const angle = this.rng.range(0, Math.PI * 2)
            const halfDiag =
                Math.hypot(this.viewW * 0.5, this.viewH * 0.5) +
                this.rng.range(45, 110)
            const sx = this.player.x + Math.cos(angle) * halfDiag
            const sy = this.player.y + Math.sin(angle) * halfDiag

            if (this.spawnEnemy(chosenType, sx, sy)) {
                this.spawnBudget -= def.cost
                this.store.activeEnemyCount += 1
            } else {
                break
            }
        }
    }

    public spawnEnemy(type: EnemyTypeId, x: number, y: number): boolean {
        const enemies = this.store.enemies
        const diff = DIFFICULTY_TABLE[this.props.difficulty]
        const timeScale = 1 + (this.elapsedTime / 60) * 0.28

        for (let i = 0; i < enemies.length; i++) {
            const e = enemies[i]
            if (!e.active) {
                const def = ENEMY_TABLE[type]
                e.active = true
                e.type = type
                e.x = x
                e.y = y
                e.prevX = x
                e.prevY = y
                e.vx = 0
                e.vy = 0
                e.kbVx = 0
                e.kbVy = 0
                e.maxHp = Math.round(def.maxHp * diff.hpMult * timeScale)
                e.hp = e.maxHp
                e.speed = def.speed
                e.radius = def.radius
                e.damage = Math.max(1, Math.round(def.damage * diff.dmgMult))
                e.xpValue = def.xpValue
                e.armor = def.armor
                e.hitFlash = 0
                e.animPhase = this.fxRng.range(0, Math.PI * 2)
                e.aiState = 0
                e.aiTimer = 0
                e.dashDirX = 0
                e.dashDirY = 0
                return true
            }
        }
        return false
    }

    // ------------------------------------------------------------------------
    // ENEMY AI, SPATIAL HASH INSERTION & SOFT SEPARATION
    // ------------------------------------------------------------------------
    private updateEnemiesAndSpatialGrid(dt: number): void {
        const enemies = this.store.enemies
        this.grid.clear()
        let activeCount = 0

        for (let i = 0; i < enemies.length; i++) {
            const e = enemies[i]
            if (!e.active) continue
            activeCount++
            this.grid.insert(i, e.x, e.y)
        }
        this.store.activeEnemyCount = activeCount

        const px = this.player.x
        const py = this.player.y
        const pRadius = CONFIG.PLAYER_RADIUS

        for (let i = 0; i < enemies.length; i++) {
            const e = enemies[i]
            if (!e.active) continue

            e.prevX = e.x
            e.prevY = e.y
            e.animPhase += dt * 7

            if (e.hitFlash > 0) e.hitFlash -= dt

            const dx = px - e.x
            const dy = py - e.y
            const dist = Math.hypot(dx, dy) || 0.001

            // Respawn far-away stragglers back onto the spawn ring
            if (dist > 1400) {
                const ang = this.rng.range(0, Math.PI * 2)
                const ring = Math.hypot(this.viewW * 0.5, this.viewH * 0.5) + 60
                e.x = px + Math.cos(ang) * ring
                e.y = py + Math.sin(ang) * ring
                e.prevX = e.x
                e.prevY = e.y
                continue
            }

            // AI by enemy type
            if (e.type === "dasher") {
                if (e.aiState === 0) {
                    // Chase until within telegraph range
                    e.vx = (dx / dist) * e.speed
                    e.vy = (dy / dist) * e.speed
                    if (dist < 220) {
                        e.aiState = 1 // Telegraphing red line
                        e.aiTimer = 0.65
                        e.dashDirX = dx / dist
                        e.dashDirY = dy / dist
                        e.vx = 0
                        e.vy = 0
                    }
                } else if (e.aiState === 1) {
                    // Stand still & telegraph
                    e.vx = 0
                    e.vy = 0
                    e.aiTimer -= dt
                    if (e.aiTimer <= 0) {
                        e.aiState = 2 // High-speed charge
                        e.aiTimer = 0.42
                    }
                } else if (e.aiState === 2) {
                    // Dashing
                    e.vx = e.dashDirX * (e.speed * 3.8)
                    e.vy = e.dashDirY * (e.speed * 3.8)
                    e.aiTimer -= dt
                    if (e.aiTimer <= 0) {
                        e.aiState = 3 // Recovery pause
                        e.aiTimer = 0.5
                    }
                } else {
                    e.vx = (dx / dist) * (e.speed * 0.35)
                    e.vy = (dy / dist) * (e.speed * 0.35)
                    e.aiTimer -= dt
                    if (e.aiTimer <= 0) {
                        e.aiState = 0
                    }
                }
            } else {
                // Drifter, Splitter, Mini-Splitter chase AI
                e.vx = (dx / dist) * e.speed
                e.vy = (dy / dist) * e.speed
            }

            // Soft separation via Spatial Hash Grid (Zero O(N^2))
            const candCount = this.grid.queryBox(
                e.x - e.radius * 2,
                e.y - e.radius * 2,
                e.x + e.radius * 2,
                e.y + e.radius * 2
            )
            let sepX = 0
            let sepY = 0
            for (let c = 0; c < candCount; c++) {
                const otherIdx = this.grid.queryResults[c]
                if (otherIdx === i) continue
                const other = enemies[otherIdx]
                if (!other.active) continue
                const odx = e.x - other.x
                const ody = e.y - other.y
                const minSep = e.radius + other.radius
                const d2 = odx * odx + ody * ody
                if (d2 > 0.0001 && d2 < minSep * minSep) {
                    const d = Math.sqrt(d2)
                    const push = (minSep - d) / minSep
                    sepX += (odx / d) * push * 55
                    sepY += (ody / d) * push * 55
                }
            }

            e.x += (e.vx + e.kbVx + sepX) * dt
            e.y += (e.vy + e.kbVy + sepY) * dt
            e.kbVx *= Math.exp(-10 * dt)
            e.kbVy *= Math.exp(-10 * dt)

            // Player vs Enemy contact damage
            const touchDist = e.radius + pRadius - 4
            if (distSq(e.x, e.y, px, py) < touchDist * touchDist) {
                if (this.player.iframeTimer <= 0) {
                    let dmgTaken = e.damage
                    if (this.player.bunnyGuardCd <= 0) {
                        // The plush bunny blocks half of the hit and counter-attacks
                        dmgTaken = Math.max(1, Math.round(e.damage * 0.5))
                        this.player.bunnyGuardCd = BUNNY_GUARD_COOLDOWN
                        this.player.bunnyGuardFlash = 0.45
                        this.player.bunnyCounterPending = true
                        this.player.bunnyCounterX = e.x
                        this.player.bunnyCounterY = e.y
                    }
                    this.player.hp = Math.max(0, this.player.hp - dmgTaken)
                    this.player.iframeTimer = CONFIG.PLAYER_IFRAMES
                    this.player.hitFlashTimer = 0.2
                    this.sound.playPlayerHurt()
                    this.addScreenShake(7, 0.2)
                    this.spawnDamageNumber(px, py - 20, dmgTaken, false, false)
                    this.spawnParticles(px, py, PALETTE.dangerRed, 10, 0)
                    this.events.emit("onDamage", {
                        amount: dmgTaken,
                        x: px,
                        y: py,
                        isPlayer: true,
                    })

                    if (this.player.hp <= 0) {
                        this.transitionTo("GAME_OVER")
                        return
                    }
                }
            }
        }
    }

    // ------------------------------------------------------------------------
    // COMBAT SYSTEM: HELD BUNNY MELEE SWING + GUARD
    // ------------------------------------------------------------------------
    private getBunnyMeleeDamage(): number {
        const lv = clamp(this.upgradeLevels.weapon_heart_bolt, 1, 6)
        return HEART_BOLT_LEVELS[lv - 1].damage * BUNNY_MELEE_MULT
    }

    private updateBunnyMelee(dt: number): void {
        const p = this.player
        if (p.bunnyCd > 0) p.bunnyCd -= dt
        if (p.bunnyGuardCd > 0) p.bunnyGuardCd -= dt
        if (p.bunnyGuardFlash > 0) p.bunnyGuardFlash -= dt
        const enemies = this.store.enemies

        // A blocked hit triggers an immediate counter swing + shockwave
        if (p.bunnyCounterPending) {
            p.bunnyCounterPending = false
            this.startBunnySwing(p.bunnyCounterX, p.bunnyCounterY)
            this.bunnyShockwave()
        }

        // Swing at the closest enemy that gets near the girl
        if (p.bunnySwingT <= 0 && p.bunnyCd <= 0) {
            const R = BUNNY_TRIGGER_RANGE
            const count = this.grid.queryBox(p.x - R, p.y - R, p.x + R, p.y + R)
            let best = -1
            let bestD2 = R * R
            for (let i = 0; i < count; i++) {
                const idx = this.grid.queryResults[i]
                const e = enemies[idx]
                if (!e.active) continue
                const d2 = distSq(p.x, p.y, e.x, e.y)
                if (d2 < bestD2) {
                    bestD2 = d2
                    best = idx
                }
            }
            if (best >= 0) {
                this.startBunnySwing(enemies[best].x, enemies[best].y)
            }
        }

        if (p.bunnySwingT > 0 && p.bunnyStrike > 0) {
            this.bunnyStrikeHits()
        }
    }

    private startBunnySwing(tx: number, ty: number): void {
        const p = this.player
        const phi = Math.atan2(ty - (p.y - 6), tx - p.x)
        p.bunnySwingPhi = phi
        p.bunnySwingBase = phi + Math.PI * 0.5
        p.bunnySwingSign = -p.bunnySwingSign
        p.bunnySwingT = BUNNY_SWING_DUR
        p.bunnyCd = BUNNY_MELEE_CD * this.getCooldownMultiplier()
        this.bunnySwingId++
        if (Math.abs(Math.cos(phi)) > 0.2) {
            p.facing = Math.cos(phi) > 0 ? 1 : -1
        }
        this.sound.playShoot()
    }

    /** Hit test the plush (a capsule from the grip to the ear tips) against nearby enemies. */
    private bunnyStrikeHits(): void {
        const p = this.player
        const enemies = this.store.enemies
        const ux = Math.sin(p.bunnyAngle)
        const uy = -Math.cos(p.bunnyAngle)
        const ax = p.bunnyX - ux * 5
        const ay = p.bunnyY - uy * 5
        const ex = p.bunnyX + ux * BUNNY_REACH
        const ey = p.bunnyY + uy * BUNNY_REACH
        const pad = BUNNY_HIT_R + 26
        const count = this.grid.queryBox(
            Math.min(ax, ex) - pad,
            Math.min(ay, ey) - pad,
            Math.max(ax, ex) + pad,
            Math.max(ay, ey) + pad
        )
        const base = this.getBunnyMeleeDamage()
        const crit = this.getCritStats()
        let landed = false
        for (let i = 0; i < count; i++) {
            const idx = this.grid.queryResults[i]
            if (this.bunnyHitStamp[idx] === this.bunnySwingId) continue
            const e = enemies[idx]
            if (!e.active) continue
            const r = BUNNY_HIT_R + e.radius
            if (segDistSq(e.x, e.y, ax, ay, ex, ey) > r * r) continue

            this.bunnyHitStamp[idx] = this.bunnySwingId
            const isCrit = this.rng.chance(crit.chance)
            const dmg = Math.round(base * (isCrit ? crit.mult : 1))
            const dx = e.x - p.x
            const dy = e.y - p.y
            this.damageEnemy(idx, dmg, isCrit, dx, dy)
            if (e.active) {
                // Whack! Stronger knockback than a heart bolt
                const len = Math.hypot(dx, dy) || 1
                e.kbVx = (dx / len) * 380
                e.kbVy = (dy / len) * 380
            }
            landed = true
        }
        if (landed) this.addScreenShake(3, 0.1)
    }

    /** Short-range burst when the bunny blocks a hit: knocks nearby enemies away. */
    private bunnyShockwave(): void {
        const p = this.player
        const enemies = this.store.enemies
        const R = 84
        const count = this.grid.queryBox(p.x - R, p.y - R, p.x + R, p.y + R)
        const dmg = Math.round(this.getBunnyMeleeDamage() * 0.6)
        for (let i = 0; i < count; i++) {
            const idx = this.grid.queryResults[i]
            const e = enemies[idx]
            if (!e.active) continue
            const rr = R + e.radius
            if (distSq(p.x, p.y, e.x, e.y) > rr * rr) continue
            const dx = e.x - p.x
            const dy = e.y - p.y
            this.damageEnemy(idx, dmg, false, dx, dy)
            if (e.active) {
                const len = Math.hypot(dx, dy) || 1
                e.kbVx = (dx / len) * 440
                e.kbVy = (dy / len) * 440
            }
        }
        this.spawnParticles(p.x, p.y, PALETTE.lavender, 14, 1)
        this.spawnParticles(p.x, p.y, PALETTE.hotPink, 10, 2)
        this.addScreenShake(5, 0.14)
    }

    // ------------------------------------------------------------------------
    // COMBAT SYSTEM: HEART BOLT AUTO-ATTACK
    // ------------------------------------------------------------------------
    private updateCombatAutoAttack(dt: number): void {
        const p = this.player
        p.heartBoltTimer -= dt
        if (p.heartBoltTimer > 0) return

        const lv = clamp(this.upgradeLevels.weapon_heart_bolt, 1, 6)
        const stats = HEART_BOLT_LEVELS[lv - 1]

        // Find nearest enemy using the spatial hash
        const bx = p.bunnyX + Math.sin(p.bunnyAngle) * 14
        const by = p.bunnyY - Math.cos(p.bunnyAngle) * 14
        let nearestIdx = -1
        let bestD2 = 520 * 520

        const candCount = this.grid.queryBox(
            bx - 520,
            by - 520,
            bx + 520,
            by + 520
        )
        const enemies = this.store.enemies
        for (let i = 0; i < candCount; i++) {
            const idx = this.grid.queryResults[i]
            const e = enemies[idx]
            if (!e.active) continue
            const d2 = distSq(bx, by, e.x, e.y)
            if (d2 < bestD2) {
                bestD2 = d2
                nearestIdx = idx
            }
        }

        if (nearestIdx === -1) {
            // No target in range: re-check shortly instead of wasting a full cooldown.
            p.heartBoltTimer = 0.1
            return
        }

        p.heartBoltTimer = stats.cooldown * this.getCooldownMultiplier()

        const target = enemies[nearestIdx]
        const baseAngle = Math.atan2(target.y - by, target.x - bx)
        const count = stats.count
        const spreadArc = 0.16
        const critInfo = this.getCritStats()

        this.sound.playShoot()

        for (let b = 0; b < count; b++) {
            const offset = count === 1 ? 0 : (b - (count - 1) * 0.5) * spreadArc
            const angle = baseAngle + offset
            const isCrit = this.rng.chance(critInfo.chance)
            const dmg = Math.round(
                stats.damage * (isCrit ? critInfo.mult : 1.0)
            )
            this.spawnProjectile(
                bx,
                by,
                Math.cos(angle) * stats.speed,
                Math.sin(angle) * stats.speed,
                stats.size,
                dmg,
                stats.pierce,
                isCrit
            )
        }
    }

    public spawnProjectile(
        x: number,
        y: number,
        vx: number,
        vy: number,
        radius: number,
        damage: number,
        pierce: number,
        isCrit: boolean
    ): void {
        const projs = this.store.projectiles
        for (let i = 0; i < projs.length; i++) {
            const pr = projs[i]
            if (!pr.active) {
                pr.active = true
                pr.x = x
                pr.y = y
                pr.prevX = x
                pr.prevY = y
                pr.vx = vx
                pr.vy = vy
                pr.radius = radius
                pr.damage = damage
                pr.pierce = pierce
                pr.life = 1.65
                pr.isCrit = isCrit
                pr.hitCount = 0
                pr.rotation = Math.atan2(vy, vx) + Math.PI * 0.5
                return
            }
        }
    }

    // ------------------------------------------------------------------------
    // PROJECTILE MOVEMENT & COLLISION VIA SPATIAL HASH
    // ------------------------------------------------------------------------
    private updateProjectiles(dt: number): void {
        const projs = this.store.projectiles
        const enemies = this.store.enemies

        for (let i = 0; i < projs.length; i++) {
            const pr = projs[i]
            if (!pr.active) continue

            pr.prevX = pr.x
            pr.prevY = pr.y
            pr.x += pr.vx * dt
            pr.y += pr.vy * dt
            pr.life -= dt

            if (pr.life <= 0) {
                pr.active = false
                continue
            }

            const candCount = this.grid.queryBox(
                pr.x - pr.radius - 28,
                pr.y - pr.radius - 28,
                pr.x + pr.radius + 28,
                pr.y + pr.radius + 28
            )

            for (let c = 0; c < candCount; c++) {
                const eIdx = this.grid.queryResults[c]
                const e = enemies[eIdx]
                if (!e.active) continue

                // A projectile may only damage each enemy once.
                let alreadyHit = false
                for (let h = 0; h < pr.hitCount; h++) {
                    if (pr.hitIds[h] === eIdx) {
                        alreadyHit = true
                        break
                    }
                }
                if (alreadyHit) continue

                const hitR = pr.radius + e.radius
                if (distSq(pr.x, pr.y, e.x, e.y) <= hitR * hitR) {
                    this.damageEnemy(eIdx, pr.damage, pr.isCrit, pr.vx, pr.vy)
                    if (pr.hitCount < pr.hitIds.length) {
                        pr.hitIds[pr.hitCount++] = eIdx
                    }
                    pr.pierce -= 1
                    if (pr.pierce <= 0) {
                        pr.active = false
                        break
                    }
                }
            }
        }
    }

    public damageEnemy(
        enemyIdx: number,
        rawDamage: number,
        isCrit: boolean,
        impVx: number,
        impVy: number
    ): void {
        const e = this.store.enemies[enemyIdx]
        if (!e.active) return

        const finalDmg = Math.max(1, rawDamage - e.armor)
        e.hp -= finalDmg
        e.hitFlash = 0.11

        const impLen = Math.hypot(impVx, impVy) || 1
        e.kbVx = (impVx / impLen) * 145
        e.kbVy = (impVy / impLen) * 145

        this.sound.playHit(isCrit)
        this.spawnDamageNumber(e.x, e.y - e.radius, finalDmg, isCrit, false)
        this.spawnParticles(
            e.x,
            e.y,
            isCrit ? PALETTE.gold : PALETTE.hotPink,
            isCrit ? 6 : 3,
            2
        )

        if (isCrit) {
            this.hitStopTimer = 0.032 // Crisp 32ms crit hit-stop
        }

        if (e.hp <= 0) {
            e.active = false
            this.spawnGem(e.x, e.y, e.xpValue)
            this.events.emit("onKill", {
                enemyType: e.type,
                x: e.x,
                y: e.y,
            })

            // Splitter spawns 2 Mini-Splitters on death
            if (e.type === "splitter") {
                this.spawnEnemy("mini_splitter", e.x - 14, e.y - 8)
                this.spawnEnemy("mini_splitter", e.x + 14, e.y + 8)
            }
        }
    }

    // ------------------------------------------------------------------------
    // XP GEMS & PICKUP SYSTEM
    // ------------------------------------------------------------------------
    public spawnGem(x: number, y: number, value: number): void {
        const gems = this.store.gems
        const tier = value >= 8 ? 2 : value >= 5 ? 1 : 0
        for (let i = 0; i < gems.length; i++) {
            const g = gems[i]
            if (!g.active) {
                g.active = true
                g.x = x
                g.y = y
                g.prevX = x
                g.prevY = y
                g.value = value
                g.tier = tier
                g.magnetized = false
                g.bobPhase = this.fxRng.range(0, Math.PI * 2)
                return
            }
        }
        // Gem pool is full: award the XP directly so progress is never lost.
        this.addPlayerXP(value)
    }

    private updateGems(dt: number): void {
        const gems = this.store.gems
        const px = this.player.x
        const py = this.player.y
        const magR = this.getMagnetRadius()
        const magR2 = magR * magR

        for (let i = 0; i < gems.length; i++) {
            const g = gems[i]
            if (!g.active) continue

            g.prevX = g.x
            g.prevY = g.y
            g.bobPhase += dt * 5

            const d2 = distSq(g.x, g.y, px, py)
            if (d2 <= magR2) {
                g.magnetized = true
            }

            if (g.magnetized) {
                const dist = Math.sqrt(d2) || 0.001
                const pullSpeed = 420
                g.x += ((px - g.x) / dist) * pullSpeed * dt
                g.y += ((py - g.y) / dist) * pullSpeed * dt

                if (dist < 20) {
                    g.active = false
                    this.sound.playPickup()
                    this.addPlayerXP(g.value)
                }
            }
        }
    }

    private addPlayerXP(amount: number): void {
        const p = this.player
        p.xp += amount
        while (p.xp >= p.xpToNext) {
            p.xp -= p.xpToNext
            p.level += 1
            p.xpToNext = Math.round(12 + p.level * 10 + Math.pow(p.level, 1.35))
            this.events.emit("onLevelUp", { level: p.level })
        }
    }

    // ------------------------------------------------------------------------
    // POOLED PARTICLES & DAMAGE NUMBERS
    // ------------------------------------------------------------------------
    public spawnParticles(
        x: number,
        y: number,
        color: string,
        count: number,
        kind: number
    ): void {
        const actualCount = this.lowQualityMode
            ? Math.max(1, Math.floor(count * 0.4))
            : count
        const parts = this.store.particles
        let spawned = 0

        for (let i = 0; i < parts.length && spawned < actualCount; i++) {
            const pt = parts[i]
            if (!pt.active) {
                const ang = this.fxRng.range(0, Math.PI * 2)
                const spd = this.fxRng.range(45, 165)
                pt.active = true
                pt.x = x
                pt.y = y
                pt.prevX = x
                pt.prevY = y
                pt.vx = Math.cos(ang) * spd
                pt.vy = Math.sin(ang) * spd
                pt.size = this.fxRng.range(3.5, 7)
                pt.color = color
                pt.alpha = 1
                pt.maxLife = this.fxRng.range(0.28, 0.55)
                pt.life = pt.maxLife
                pt.kind = kind
                spawned++
            }
        }
    }

    public spawnDamageNumber(
        x: number,
        y: number,
        value: number,
        isCrit: boolean,
        isHeal: boolean
    ): void {
        const nums = this.store.dmgNumbers
        for (let i = 0; i < nums.length; i++) {
            const dn = nums[i]
            if (!dn.active) {
                dn.active = true
                dn.x = x + this.fxRng.range(-10, 10)
                dn.y = y
                dn.vy = isCrit ? -68 : -48
                dn.value = value
                dn.isCrit = isCrit
                dn.isHeal = isHeal
                dn.maxLife = isCrit ? 0.78 : 0.58
                dn.life = dn.maxLife
                return
            }
        }
    }

    private updateParticlesAndDamageNumbers(dt: number): void {
        const parts = this.store.particles
        let activeCount = 0
        for (let i = 0; i < parts.length; i++) {
            const pt = parts[i]
            if (!pt.active) continue
            pt.prevX = pt.x
            pt.prevY = pt.y
            pt.x += pt.vx * dt
            pt.y += pt.vy * dt
            pt.vx *= 0.92
            pt.vy *= 0.92
            pt.life -= dt
            if (pt.life <= 0) {
                pt.active = false
            } else {
                pt.alpha = clamp(pt.life / pt.maxLife, 0, 1)
                activeCount++
            }
        }
        this.store.activeParticleCount = activeCount

        const nums = this.store.dmgNumbers
        for (let i = 0; i < nums.length; i++) {
            const dn = nums[i]
            if (!dn.active) continue
            dn.y += dn.vy * dt
            dn.vy *= 0.94
            dn.life -= dt
            if (dn.life <= 0) {
                dn.active = false
            }
        }
    }

    // ------------------------------------------------------------------------
    // ADAPTIVE PERFORMANCE MONITOR
    // ------------------------------------------------------------------------
    public recordFrameTime(ms: number): void {
        this.frameTimeAvg = this.frameTimeAvg * 0.92 + ms * 0.08
        this.fps = Math.round(1000 / Math.max(1, this.frameTimeAvg))
        const sec = ms / 1000
        if (this.frameTimeAvg > 20) {
            this.highFrameTimeDuration += sec
            this.stableFrameTimeDuration = 0
            if (this.highFrameTimeDuration >= 2.0) {
                this.lowQualityMode = true
            }
        } else if (this.frameTimeAvg < 17.5) {
            this.stableFrameTimeDuration += sec
            this.highFrameTimeDuration = 0
            if (this.stableFrameTimeDuration >= 2.5) {
                this.lowQualityMode = false
            }
        }
    }

    // ========================================================================
    // 11. RENDERER & ANIME HUD (INTERPOLATED, ZERO SHADOWBLUR IN HOT LOOP)
    // ========================================================================
    public render(ctx: CanvasRenderingContext2D, rawAlpha: number): void {
        const w = this.viewW
        const h = this.viewH
        this.uiButtons.length = 0

        // When the simulation is not advancing (pause / menu / hit-stop) draw the
        // exact current state, otherwise interpolation makes everything jitter.
        const alpha = this.frozen ? 1 : rawAlpha

        ctx.save()
        // Explicit text direction so Persian punctuation / numbers lay out correctly.
        ctx.direction = this.props.language === "FA" ? "rtl" : "ltr"

        // Interpolated Camera + Screen Shake
        let renderCamX = lerp(this.prevCamX, this.camX, alpha)
        let renderCamY = lerp(this.prevCamY, this.camY, alpha)
        if (this.shakeTimer > 0 && !this.frozen) {
            renderCamX += (Math.random() - 0.5) * this.shakeIntensity * 2
            renderCamY += (Math.random() - 0.5) * this.shakeIntensity * 2
        }

        // 1. Dream-World Parallax Backdrop
        this.renderDreamWorldBackdrop(ctx, w, h, renderCamX, renderCamY)

        // 2. World-Space Entities
        ctx.save()
        ctx.translate(w * 0.5 - renderCamX, h * 0.5 - renderCamY)

        const cullMinX = renderCamX - w * 0.5 - 80
        const cullMaxX = renderCamX + w * 0.5 + 80
        const cullMinY = renderCamY - h * 0.5 - 80
        const cullMaxY = renderCamY + h * 0.5 + 80

        this.renderGems(ctx, alpha, cullMinX, cullMinY, cullMaxX, cullMaxY)
        this.renderEnemies(ctx, alpha, cullMinX, cullMinY, cullMaxX, cullMaxY)
        this.renderPlayerAndBunny(ctx, alpha)
        this.renderProjectiles(
            ctx,
            alpha,
            cullMinX,
            cullMinY,
            cullMaxX,
            cullMaxY
        )
        this.renderParticles(ctx, alpha, cullMinX, cullMinY, cullMaxX, cullMaxY)
        this.renderDamageNumbers(ctx)

        ctx.restore()

        // 3. Soft Corner Vignette
        this.renderVignette(ctx, w, h)

        // 4. Screen-Space HUD & Menus
        if (
            this.state === "PLAYING" ||
            this.state === "LEVEL_UP" ||
            this.state === "PAUSED"
        ) {
            this.renderHUD(ctx, w)
        }

        if (this.state === "MENU") {
            this.renderMainMenu(ctx, w, h)
        } else if (this.state === "LEVEL_UP") {
            this.renderLevelUpModal(ctx, w, h)
        } else if (this.state === "PAUSED") {
            this.renderPauseOverlay(ctx, w, h)
        } else if (this.state === "GAME_OVER" || this.state === "VICTORY") {
            this.renderEndScreen(ctx, w, h, this.state === "VICTORY")
        }

        if (this.props.showFPS) {
            ctx.fillStyle = "rgba(22, 13, 36, 0.78)"
            ctx.fillRect(w - 94, h - 30, 86, 22)
            ctx.fillStyle = this.lowQualityMode ? PALETTE.gold : PALETTE.mint
            ctx.font = f("bold 12px")
            ctx.textAlign = "right"
            ctx.fillText(
                `${this.fps} FPS ${this.lowQualityMode ? "(LQ)" : ""}`,
                w - 14,
                h - 15
            )
        }

        if (this.props.showFPS && this.lastError) {
            ctx.save()
            ctx.fillStyle = "rgba(120, 0, 30, 0.88)"
            ctx.fillRect(8, h - 58, Math.max(60, w - 16), 24)
            ctx.fillStyle = "#fff"
            ctx.font = f("11px")
            ctx.textAlign = "left"
            ctx.fillText(
                "ERR " + this.lastError,
                14,
                h - 42,
                Math.max(40, w - 28)
            )
            ctx.restore()
        }

        ctx.restore()
    }

    private renderDreamWorldBackdrop(
        ctx: CanvasRenderingContext2D,
        w: number,
        h: number,
        camX: number,
        camY: number
    ): void {
        ctx.fillStyle = this.props.backdropColor || PALETTE.darkNight
        ctx.fillRect(0, 0, w, h)

        // Quilted Dream Grid / Stitch Lines
        const tile = 128
        const offX = ((-camX % tile) + tile) % tile
        const offY = ((-camY % tile) + tile) % tile

        ctx.strokeStyle = "rgba(196, 111, 255, 0.12)"
        ctx.lineWidth = 1.5
        ctx.beginPath()
        for (let x = offX; x < w; x += tile) {
            ctx.moveTo(x, 0)
            ctx.lineTo(x, h)
        }
        for (let y = offY; y < h; y += tile) {
            ctx.moveTo(0, y)
            ctx.lineTo(w, y)
        }
        ctx.stroke()

        // Parallax Star & Floating Heart Layer
        const starCount = this.lowQualityMode ? 18 : 36
        ctx.fillStyle = "rgba(233, 200, 255, 0.35)"
        for (let i = 0; i < starCount; i++) {
            const parallax = i % 2 === 0 ? 0.25 : 0.45
            const sx = (((i * 197 - camX * parallax) % w) + w) % w
            const sy = (((i * 313 - camY * parallax) % h) + h) % h
            const r = (i % 3) + 1.5
            ctx.beginPath()
            ctx.arc(sx, sy, r, 0, Math.PI * 2)
            ctx.fill()
        }
    }

    private renderGems(
        ctx: CanvasRenderingContext2D,
        alpha: number,
        minX: number,
        minY: number,
        maxX: number,
        maxY: number
    ): void {
        const gems = this.store.gems
        for (let i = 0; i < gems.length; i++) {
            const g = gems[i]
            if (!g.active) continue
            const gx = lerp(g.prevX, g.x, alpha)
            const gy = lerp(g.prevY, g.y, alpha) + Math.sin(g.bobPhase) * 2.5
            if (gx < minX || gx > maxX || gy < minY || gy > maxY) continue

            const sprite = this.sprites.gemCanvases[g.tier]
            ctx.drawImage(
                sprite,
                gx - sprite.width * 0.5,
                gy - sprite.height * 0.5
            )
        }
    }

    private renderEnemies(
        ctx: CanvasRenderingContext2D,
        alpha: number,
        minX: number,
        minY: number,
        maxX: number,
        maxY: number
    ): void {
        const enemies = this.store.enemies
        for (let i = 0; i < enemies.length; i++) {
            const e = enemies[i]
            if (!e.active) continue
            const ex = lerp(e.prevX, e.x, alpha)
            const ey = lerp(e.prevY, e.y, alpha)

            // Dasher red telegraph line
            if (e.type === "dasher" && e.aiState === 1) {
                ctx.save()
                ctx.strokeStyle = "rgba(255, 59, 107, 0.75)"
                ctx.lineWidth = 3
                ctx.setLineDash([8, 6])
                ctx.beginPath()
                ctx.moveTo(ex, ey)
                ctx.lineTo(ex + e.dashDirX * 210, ey + e.dashDirY * 210)
                ctx.stroke()
                ctx.restore()
            }

            if (ex < minX || ex > maxX || ey < minY || ey > maxY) continue

            const squash = 1 + Math.sin(e.animPhase) * 0.07
            const stretch = 1 - Math.sin(e.animPhase) * 0.07
            const sprite =
                e.hitFlash > 0
                    ? this.sprites.enemyFlashCanvases[e.type]
                    : this.sprites.enemyCanvases[e.type]

            ctx.save()
            ctx.translate(ex, ey)
            ctx.scale(squash, stretch)
            ctx.drawImage(sprite, -sprite.width * 0.5, -sprite.height * 0.5)
            ctx.restore()
        }
    }

    private renderPlayerAndBunny(
        ctx: CanvasRenderingContext2D,
        alpha: number
    ): void {
        const p = this.player
        const px = lerp(p.prevX, p.x, alpha)
        const py = lerp(p.prevY, p.y, alpha)
        const bx = lerp(p.bunnyPrevX, p.bunnyX, alpha)
        const by = lerp(p.bunnyPrevY, p.bunnyY, alpha)
        const now = performance.now()
        const bobOffset = Math.sin(p.walkPhase) * 2.5
        const flicker =
            p.iframeTimer > 0 && Math.floor(p.iframeTimer * 20) % 2 === 0

        // Guard ring: dashed ring = bunny is ready to block, burst ring = it just blocked
        ctx.save()
        if (p.bunnyGuardCd <= 0) {
            ctx.strokeStyle = "rgba(255, 190, 225, 0.30)"
            ctx.lineWidth = 2
            ctx.setLineDash([5, 6])
            ctx.lineDashOffset = -now * 0.015
            ctx.beginPath()
            ctx.arc(px, py - 2, 30, 0, Math.PI * 2)
            ctx.stroke()
        }
        if (p.bunnyGuardFlash > 0) {
            const k = 1 - p.bunnyGuardFlash / 0.45
            ctx.setLineDash([])
            ctx.strokeStyle = `rgba(233, 200, 255, ${(1 - k) * 0.9})`
            ctx.lineWidth = 3
            ctx.beginPath()
            ctx.arc(px, py - 2, 30 + k * 34, 0, Math.PI * 2)
            ctx.stroke()
        }
        ctx.restore()

        // Draw Heroine with idle bob & walk tilt
        ctx.save()
        const tilt =
            Math.abs(p.vx) > 1 || Math.abs(p.vy) > 1
                ? Math.sin(p.walkPhase) * 0.08
                : 0
        ctx.translate(px, py + bobOffset)
        ctx.rotate(tilt)
        ctx.scale(p.facing, 1)

        if (flicker) {
            ctx.globalAlpha = 0.55
        }

        if (this.sprites.customPlayerImg) {
            ctx.drawImage(this.sprites.customPlayerImg, -36, -42, 72, 72)
        } else {
            const girlSprite =
                p.blinkTimer < 0
                    ? this.sprites.girlBlinkCanvas
                    : this.sprites.girlIdleCanvas
            ctx.drawImage(
                girlSprite,
                -girlSprite.width * 0.5,
                -girlSprite.height * 0.5 - 6
            )
        }
        ctx.restore()

        // Bunny held in both hands (arms, plush, hands) + swing trail
        ctx.save()
        if (flicker) ctx.globalAlpha = 0.55
        if (p.bunnyStrike > 0) {
            const s = p.bunnySwingSign
            const tipAngle = p.bunnyAngle - Math.PI * 0.5
            ctx.strokeStyle = this.props.accentColor || PALETTE.hotPink
            ctx.globalAlpha = 0.45
            ctx.lineWidth = 6
            ctx.lineCap = "round"
            ctx.beginPath()
            ctx.arc(bx, by, 26, tipAngle - s * 1.0, tipAngle, s < 0)
            ctx.stroke()
            for (let k = 1; k <= 2; k++) {
                ctx.globalAlpha = 0.24 / k
                this.drawBunnySprite(ctx, bx, by, p.bunnyAngle - s * k * 0.32)
            }
            ctx.globalAlpha = flicker ? 0.55 : 1
        }
        this.drawBunnyRig(
            ctx,
            px,
            py + bobOffset - 1,
            p.facing,
            bx,
            by,
            p.bunnyAngle,
            !this.sprites.customPlayerImg
        )
        ctx.restore()
    }

    /** Draws the plush sprite pivoting on its belly (the grip point). */
    private drawBunnySprite(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        rot: number
    ): void {
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(rot)
        if (this.sprites.customBunnyImg) {
            ctx.drawImage(this.sprites.customBunnyImg, -24, -24, 48, 48)
        } else {
            ctx.scale(BUNNY_SCALE, BUNNY_SCALE)
            const c = this.sprites.bunnyCanvas
            ctx.drawImage(c, -36, -58)
        }
        ctx.restore()
    }

    /**
     * Both arms reach from the girl's shoulders to the plush, which is drawn between
     * the arms and the hands so it really looks held (no floating / orbiting).
     */
    private drawBunnyRig(
        ctx: CanvasRenderingContext2D,
        px: number,
        shoulderY: number,
        facing: number,
        bx: number,
        by: number,
        rot: number,
        withArms: boolean
    ): void {
        const S = BUNNY_SCALE
        const cs = Math.cos(rot)
        const sn = Math.sin(rot)
        // Grip points on the plush body (plush-local px, before scale)
        const h1x = bx + (-6 * cs - -1 * sn) * S
        const h1y = by + (-6 * sn + -1 * cs) * S
        const h2x = bx + (6 * cs - 4 * sn) * S
        const h2y = by + (6 * sn + 4 * cs) * S
        // Near shoulder (on the facing side) takes the hand that is further out
        const h1IsNear = facing * (h1x - h2x) > 0
        const nearHx = h1IsNear ? h1x : h2x
        const nearHy = h1IsNear ? h1y : h2y
        const farHx = h1IsNear ? h2x : h1x
        const farHy = h1IsNear ? h2y : h1y

        if (withArms) {
            const drawArm = (
                sx: number,
                sy: number,
                hx: number,
                hy: number
            ): void => {
                const mx = (sx + hx) * 0.5
                const my = (sy + hy) * 0.5 + 6
                ctx.lineCap = "round"
                ctx.strokeStyle = PALETTE.outline
                ctx.lineWidth = 7.4
                ctx.beginPath()
                ctx.moveTo(sx, sy)
                ctx.quadraticCurveTo(mx, my, hx, hy)
                ctx.stroke()
                ctx.strokeStyle = PALETTE.charcoal
                ctx.lineWidth = 4.6
                ctx.beginPath()
                ctx.moveTo(sx, sy)
                ctx.quadraticCurveTo(mx, my, hx, hy)
                ctx.stroke()
            }
            drawArm(px - facing * 12, shoulderY, farHx, farHy)
            drawArm(px + facing * 12, shoulderY, nearHx, nearHy)
        }

        this.drawBunnySprite(ctx, bx, by, rot)

        if (withArms) {
            ctx.fillStyle = "#FFE4D6"
            ctx.strokeStyle = PALETTE.outline
            ctx.lineWidth = 1.8
            ctx.beginPath()
            ctx.arc(farHx, farHy, 3.3, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
            ctx.beginPath()
            ctx.arc(nearHx, nearHy, 3.3, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
        }
    }

    private renderProjectiles(
        ctx: CanvasRenderingContext2D,
        alpha: number,
        minX: number,
        minY: number,
        maxX: number,
        maxY: number
    ): void {
        const projs = this.store.projectiles
        const sprite = this.sprites.heartBoltCanvas
        for (let i = 0; i < projs.length; i++) {
            const pr = projs[i]
            if (!pr.active) continue
            const x = lerp(pr.prevX, pr.x, alpha)
            const y = lerp(pr.prevY, pr.y, alpha)
            if (x < minX || x > maxX || y < minY || y > maxY) continue

            ctx.save()
            ctx.translate(x, y)
            ctx.rotate(pr.rotation)
            const scale = pr.radius / 9
            ctx.scale(scale, scale)
            ctx.drawImage(sprite, -sprite.width * 0.5, -sprite.height * 0.5)
            ctx.restore()
        }
    }

    private renderParticles(
        ctx: CanvasRenderingContext2D,
        alpha: number,
        minX: number,
        minY: number,
        maxX: number,
        maxY: number
    ): void {
        const parts = this.store.particles
        for (let i = 0; i < parts.length; i++) {
            const pt = parts[i]
            if (!pt.active) continue
            const x = lerp(pt.prevX, pt.x, alpha)
            const y = lerp(pt.prevY, pt.y, alpha)
            if (x < minX || x > maxX || y < minY || y > maxY) continue

            ctx.save()
            ctx.globalAlpha = pt.alpha
            ctx.fillStyle = pt.color
            if (pt.kind === 1) {
                // 4-point sparkle star
                const s = pt.size
                ctx.beginPath()
                ctx.moveTo(x, y - s * 1.4)
                ctx.lineTo(x + s * 0.4, y - s * 0.4)
                ctx.lineTo(x + s * 1.4, y)
                ctx.lineTo(x + s * 0.4, y + s * 0.4)
                ctx.lineTo(x, y + s * 1.4)
                ctx.lineTo(x - s * 0.4, y + s * 0.4)
                ctx.lineTo(x - s * 1.4, y)
                ctx.lineTo(x - s * 0.4, y - s * 0.4)
                ctx.closePath()
                ctx.fill()
            } else if (pt.kind === 2) {
                // Tiny heart
                this.sprites.drawHeartPath(
                    ctx,
                    x,
                    y - pt.size * 0.5,
                    pt.size * 0.9
                )
                ctx.fill()
            } else {
                ctx.beginPath()
                ctx.arc(x, y, pt.size, 0, Math.PI * 2)
                ctx.fill()
            }
            ctx.restore()
        }
    }

    private renderDamageNumbers(ctx: CanvasRenderingContext2D): void {
        const nums = this.store.dmgNumbers
        ctx.save()
        ctx.textAlign = "center"
        for (let i = 0; i < nums.length; i++) {
            const dn = nums[i]
            if (!dn.active) continue
            const alpha = clamp(dn.life / dn.maxLife, 0, 1)
            ctx.globalAlpha = alpha
            ctx.font = dn.isCrit ? f("900 18px") : f("bold 14px")
            ctx.strokeStyle = PALETTE.outline
            ctx.lineWidth = 3.5
            const text = dn.isHeal
                ? `+${dn.value}`
                : dn.isCrit
                  ? `${dn.value}!`
                  : `${dn.value}`
            ctx.strokeText(text, dn.x, dn.y)
            ctx.fillStyle = dn.isHeal
                ? PALETTE.mint
                : dn.isCrit
                  ? PALETTE.gold
                  : PALETTE.white
            ctx.fillText(text, dn.x, dn.y)
        }
        ctx.restore()
    }

    private renderVignette(
        ctx: CanvasRenderingContext2D,
        w: number,
        h: number
    ): void {
        ctx.fillStyle = "rgba(14, 7, 24, 0.22)"
        const border = 14
        ctx.fillRect(0, 0, w, border)
        ctx.fillRect(0, h - border, w, border)
        ctx.fillRect(0, border, border, h - border * 2)
        ctx.fillRect(w - border, border, border, h - border * 2)
    }

    // ------------------------------------------------------------------------
    // STACKED-CARD ANIME HUD & VIRTUAL JOYSTICK
    // ------------------------------------------------------------------------
    private renderHUD(ctx: CanvasRenderingContext2D, w: number): void {
        const t = I18N[this.props.language]
        const p = this.player
        const compact = w < 520

        // 1. Top Ribbon XP Bar
        const barX = 18
        const barY = 14
        const barW = w - 92
        const barH = 18
        const xpRatio = clamp(p.xp / Math.max(1, p.xpToNext), 0, 1)

        this.drawLayeredCard(
            ctx,
            barX,
            barY,
            barW,
            barH,
            6,
            PALETTE.deepPurple,
            PALETTE.lavender
        )

        if (xpRatio > 0) {
            ctx.save()
            ctx.fillStyle = this.props.accentColor || PALETTE.hotPink
            roundRectPath(
                ctx,
                barX + 2,
                barY + 2,
                Math.max(8, (barW - 4) * xpRatio),
                barH - 4,
                4
            )
            ctx.fill()
            ctx.restore()
        }

        ctx.fillStyle = PALETTE.white
        ctx.font = f("bold 11px")
        ctx.textAlign = "center"
        ctx.fillText(`${t.lvl} ${p.level}`, barX + barW * 0.5, barY + 13)

        // Pause Button (Top Right)
        const pauseBtnX = w - 62
        const pauseBtnY = 12
        this.drawLayeredCard(
            ctx,
            pauseBtnX,
            pauseBtnY,
            44,
            34,
            8,
            PALETTE.purple,
            PALETTE.lavender
        )
        ctx.fillStyle = PALETTE.white
        ctx.fillRect(pauseBtnX + 15, pauseBtnY + 10, 4, 14)
        ctx.fillRect(pauseBtnX + 25, pauseBtnY + 10, 4, 14)
        this.uiButtons.push({
            id: "PAUSE_TOGGLE",
            x: pauseBtnX,
            y: pauseBtnY,
            w: 44,
            h: 34,
        })

        // 2. HP Hearts & Numeric HP Pill (Top Left below XP bar)
        const heartStartX = 18
        const heartY = 40
        const totalHearts = 5
        const hpFraction = clamp(p.hp / Math.max(1, p.maxHp), 0, 1)
        const filledHearts = Math.ceil(hpFraction * totalHearts)

        for (let i = 0; i < totalHearts; i++) {
            const spr =
                i < filledHearts
                    ? this.sprites.uiHeartFull
                    : this.sprites.uiHeartEmpty
            ctx.drawImage(spr, heartStartX + i * 26, heartY, 26, 26)
        }

        ctx.fillStyle = PALETTE.white
        ctx.font = f("bold 13px")
        ctx.textAlign = "left"
        ctx.fillText(
            `${Math.ceil(p.hp)} / ${p.maxHp}`,
            heartStartX + totalHearts * 26 + 8,
            heartY + 18
        )

        // 3. Center Timer Card & Kill Counter (moves below the hearts on narrow screens)
        const timerW = 132
        const timerX = (w - timerW) * 0.5
        const timerY = compact ? 74 : 40
        this.drawLayeredCard(
            ctx,
            timerX,
            timerY,
            timerW,
            32,
            8,
            PALETTE.deepPurple,
            PALETTE.purple
        )
        ctx.fillStyle = PALETTE.gold
        ctx.font = f("900 16px")
        ctx.textAlign = "center"
        ctx.fillText(
            formatTime(this.elapsedTime),
            timerX + timerW * 0.5,
            timerY + 22
        )

        // Kills Badge
        ctx.fillStyle = PALETTE.lavender
        ctx.font = f("bold 12px")
        ctx.textAlign = "right"
        ctx.fillText(
            `${t.kills}: ${p.kills}`,
            w - 20,
            compact ? timerY + 22 : 64
        )

        // 4. Touch / Drag Virtual Joystick Indicator
        if (this.input.pointerActive && this.state === "PLAYING") {
            ctx.save()
            ctx.strokeStyle = "rgba(233, 200, 255, 0.45)"
            ctx.lineWidth = 2.5
            ctx.beginPath()
            ctx.arc(
                this.input.joyOriginX,
                this.input.joyOriginY,
                this.input.joyRadius,
                0,
                Math.PI * 2
            )
            ctx.stroke()

            const dx = this.input.joyCurrentX - this.input.joyOriginX
            const dy = this.input.joyCurrentY - this.input.joyOriginY
            const dist = Math.hypot(dx, dy)
            const clampedDist = Math.min(dist, this.input.joyRadius)
            const kx =
                this.input.joyOriginX +
                (dist > 0 ? (dx / dist) * clampedDist : 0)
            const ky =
                this.input.joyOriginY +
                (dist > 0 ? (dy / dist) * clampedDist : 0)

            ctx.fillStyle = "rgba(255, 111, 168, 0.75)"
            ctx.beginPath()
            ctx.arc(kx, ky, 18, 0, Math.PI * 2)
            ctx.fill()
            ctx.restore()
        }
    }

    // ------------------------------------------------------------------------
    // MAIN MENU OVERLAY
    // ------------------------------------------------------------------------
    private renderMainMenu(
        ctx: CanvasRenderingContext2D,
        w: number,
        h: number
    ): void {
        const t = I18N[this.props.language]
        ctx.fillStyle = "rgba(16, 8, 28, 0.65)"
        ctx.fillRect(0, 0, w, h)

        const cardW = Math.min(440, w - 32)
        const cardH = Math.min(340, h - 32)
        const cx = (w - cardW) * 0.5
        const cy = (h - cardH) * 0.5

        this.drawLayeredCard(
            ctx,
            cx,
            cy,
            cardW,
            cardH,
            18,
            PALETTE.deepPurple,
            PALETTE.lavender
        )

        // Heroine & Bunny Preview Bobbing on Menu
        const bob = Math.sin(performance.now() * 0.004) * 4
        ctx.drawImage(this.sprites.girlIdleCanvas, w * 0.5 - 74, cy + 20 + bob)
        this.drawBunnyRig(
            ctx,
            w * 0.5 - 26,
            cy + 73 + bob,
            1,
            w * 0.5 - 26 + BUNNY_HOLD_X,
            cy + 67 + bob * 0.6,
            0.3 + Math.sin(performance.now() * 0.004) * 0.06,
            true
        )

        ctx.fillStyle = PALETTE.white
        ctx.font = f("900 28px")
        ctx.textAlign = "center"
        ctx.fillText(t.title, w * 0.5, cy + 148)

        ctx.fillStyle = PALETTE.lavender
        ctx.font = f("bold 14px")
        ctx.fillText(t.subtitle, w * 0.5, cy + 172)

        ctx.fillStyle = PALETTE.gold
        ctx.font = f("bold 12px")
        ctx.fillText(
            `${this.props.difficulty} • ${t.seed}: ${this.currentSeedNumber}`,
            w * 0.5,
            cy + 198
        )

        // Start Button
        const btnW = 210
        const btnH = 48
        const btnX = (w - btnW) * 0.5
        const btnY = cy + cardH - 102
        this.drawLayeredCard(
            ctx,
            btnX,
            btnY,
            btnW,
            btnH,
            12,
            this.props.accentColor || PALETTE.hotPink,
            PALETTE.white
        )
        ctx.fillStyle = PALETTE.white
        ctx.font = f("900 17px")
        ctx.fillText(t.startBtn, w * 0.5, btnY + 30)

        this.uiButtons.push({
            id: "START_RUN",
            x: btnX,
            y: btnY,
            w: btnW,
            h: btnH,
        })

        ctx.fillStyle = "rgba(233, 200, 255, 0.78)"
        ctx.font = f("12px")
        ctx.fillText(t.controlsHint, w * 0.5, cy + cardH - 22, cardW - 16)
    }

    // ------------------------------------------------------------------------
    // LEVEL-UP 3-CARD DRAWER WITH CARD-FLIP, REROLL & BANISH
    // ------------------------------------------------------------------------
    private renderLevelUpModal(
        ctx: CanvasRenderingContext2D,
        w: number,
        h: number
    ): void {
        const t = I18N[this.props.language]
        const isFA = this.props.language === "FA"
        ctx.fillStyle = "rgba(14, 7, 26, 0.78)"
        ctx.fillRect(0, 0, w, h)

        ctx.fillStyle = PALETTE.gold
        ctx.font = f("900 24px")
        ctx.textAlign = "center"
        ctx.fillText(t.levelUpTitle, w * 0.5, 48)

        ctx.fillStyle = PALETTE.lavender
        ctx.font = f("bold 13px")
        ctx.fillText(
            this.banishModeActive ? t.banishActive : t.levelUpSub,
            w * 0.5,
            70,
            w - 24
        )

        const count = this.offeredCards.length
        const gap = 14
        const cardW = clamp(Math.floor((w - 24 - gap * 2) / 3), 84, 220)
        const cardH = Math.max(150, Math.min(265, h - 165))
        const totalW = count * cardW + Math.max(0, count - 1) * gap
        const startX = (w - totalW) * 0.5
        const cardY = 88
        const arrow = isFA ? "←" : "→"

        for (let i = 0; i < count; i++) {
            const id = this.offeredCards[i]
            const def = UPGRADE_TABLE[id]
            const curLv = this.upgradeLevels[id]
            const nextLv = curLv + 1

            const cx = startX + i * (cardW + gap)
            const flipScale = Math.max(
                0.05,
                Math.sin(this.cardFlipProgress * Math.PI * 0.5)
            )

            ctx.save()
            ctx.translate(cx + cardW * 0.5, cardY + cardH * 0.5)
            ctx.scale(flipScale, 1)
            ctx.translate(-(cx + cardW * 0.5), -(cardY + cardH * 0.5))

            const rarityColor =
                def.rarity === "epic"
                    ? PALETTE.gold
                    : def.rarity === "rare"
                      ? PALETTE.purple
                      : PALETTE.lavender

            this.drawLayeredCard(
                ctx,
                cx,
                cardY,
                cardW,
                cardH,
                14,
                this.banishModeActive ? "#3D1224" : PALETTE.deepPurple,
                rarityColor
            )

            // Rarity & Level Pill
            ctx.fillStyle = rarityColor
            ctx.font = f("900 10px")
            ctx.textAlign = "center"
            const rarityLabel =
                def.rarity === "epic"
                    ? t.rarity_epic
                    : def.rarity === "rare"
                      ? t.rarity_rare
                      : t.rarity_common
            ctx.fillText(rarityLabel, cx + cardW * 0.5, cardY + 20)

            // Icon Circle
            ctx.fillStyle = "rgba(196, 111, 255, 0.2)"
            ctx.beginPath()
            ctx.arc(cx + cardW * 0.5, cardY + 56, 22, 0, Math.PI * 2)
            ctx.fill()
            this.drawUpgradeIcon(
                ctx,
                def.iconType,
                cx + cardW * 0.5,
                cardY + 56
            )

            // Name
            const name = isFA ? def.nameFA : def.nameEN
            ctx.fillStyle = PALETTE.white
            ctx.font = f("bold 14px")
            ctx.fillText(name, cx + cardW * 0.5, cardY + 102, cardW - 12)

            // Level Indicator
            ctx.fillStyle = PALETTE.gold
            ctx.font = f("bold 11px")
            const lvBadge =
                curLv === 0
                    ? t.newBadge
                    : nextLv >= def.maxLevel
                      ? `${t.lvl} ${nextLv} (${t.maxBadge})`
                      : `${t.lvl} ${curLv} ${arrow} ${nextLv}`
            ctx.fillText(lvBadge, cx + cardW * 0.5, cardY + 120, cardW - 12)

            // Wrapped Description
            const descList = isFA ? def.descFA : def.descEN
            const descText = descList[Math.min(descList.length - 1, nextLv - 1)]
            ctx.fillStyle = PALETTE.lavender
            ctx.font = f("12px")
            this.drawWrappedText(
                ctx,
                descText,
                cx + cardW * 0.5,
                cardY + 148,
                cardW - 22,
                16
            )

            ctx.restore()

            this.uiButtons.push({
                id: "CARD_SELECT",
                x: cx,
                y: cardY,
                w: cardW,
                h: cardH,
                payload: i,
            })
        }

        // Reroll & Banish Buttons at Bottom
        const btnW = Math.min(148, Math.floor((w - 40) / 2))
        const btnH = 38
        const btnY = cardY + cardH + 18

        // Reroll
        const rerollX = w * 0.5 - btnW - 10
        const canReroll = this.player.rerollsLeft > 0
        this.drawLayeredCard(
            ctx,
            rerollX,
            btnY,
            btnW,
            btnH,
            10,
            canReroll ? PALETTE.purple : "#2E2738",
            PALETTE.lavender
        )
        ctx.fillStyle = canReroll ? PALETTE.white : "#887A99"
        ctx.font = f("bold 13px")
        ctx.textAlign = "center"
        ctx.fillText(
            `${t.reroll} (${this.player.rerollsLeft})`,
            rerollX + btnW * 0.5,
            btnY + 24,
            btnW - 10
        )
        if (canReroll) {
            this.uiButtons.push({
                id: "REROLL",
                x: rerollX,
                y: btnY,
                w: btnW,
                h: btnH,
            })
        }

        // Banish
        const banishX = w * 0.5 + 10
        const canBanish = this.player.banishesLeft > 0
        this.drawLayeredCard(
            ctx,
            banishX,
            btnY,
            btnW,
            btnH,
            10,
            this.banishModeActive
                ? PALETTE.dangerRed
                : canBanish
                  ? PALETTE.ribbonRed
                  : "#2E2738",
            PALETTE.lavender
        )
        ctx.fillStyle = canBanish ? PALETTE.white : "#887A99"
        ctx.fillText(
            this.banishModeActive
                ? t.cancelBanish
                : `${t.banish} (${this.player.banishesLeft})`,
            banishX + btnW * 0.5,
            btnY + 24,
            btnW - 10
        )
        if (canBanish) {
            this.uiButtons.push({
                id: "BANISH",
                x: banishX,
                y: btnY,
                w: btnW,
                h: btnH,
            })
        }
    }

    private drawUpgradeIcon(
        ctx: CanvasRenderingContext2D,
        iconType: UpgradeDef["iconType"],
        cx: number,
        cy: number
    ): void {
        ctx.save()
        ctx.translate(cx, cy)
        ctx.strokeStyle = PALETTE.outline
        ctx.lineWidth = 2.2
        ctx.lineJoin = "round"
        ctx.lineCap = "round"
        if (iconType === "heart" || iconType === "vitality") {
            this.sprites.drawHeartPath(ctx, 0, -2, 11)
            ctx.fillStyle =
                iconType === "vitality" ? PALETTE.mint : PALETTE.hotPink
            ctx.fill()
            ctx.stroke()
        } else if (iconType === "boot") {
            ctx.fillStyle = PALETTE.hotPink
            roundRectPath(ctx, -10, -4, 20, 8, 4)
            ctx.fill()
            ctx.stroke()
        } else if (iconType === "magnet") {
            ctx.strokeStyle = PALETTE.gold
            ctx.lineWidth = 4
            ctx.beginPath()
            ctx.arc(0, 0, 9, Math.PI, 0, false)
            ctx.stroke()
        } else if (iconType === "clock") {
            ctx.fillStyle = PALETTE.lavender
            ctx.beginPath()
            ctx.arc(0, 0, 11, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
            ctx.beginPath()
            ctx.moveTo(0, 0)
            ctx.lineTo(0, -6)
            ctx.moveTo(0, 0)
            ctx.lineTo(5, 2)
            ctx.stroke()
        } else if (iconType === "crit") {
            // 4-point sparkle (silver needle glint)
            ctx.fillStyle = PALETTE.gold
            ctx.beginPath()
            ctx.moveTo(0, -11)
            ctx.lineTo(3, -3)
            ctx.lineTo(11, 0)
            ctx.lineTo(3, 3)
            ctx.lineTo(0, 11)
            ctx.lineTo(-3, 3)
            ctx.lineTo(-11, 0)
            ctx.lineTo(-3, -3)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
        }
        ctx.restore()
    }

    // ------------------------------------------------------------------------
    // PAUSE & GAME OVER / VICTORY SCREENS
    // ------------------------------------------------------------------------
    private renderPauseOverlay(
        ctx: CanvasRenderingContext2D,
        w: number,
        h: number
    ): void {
        const t = I18N[this.props.language]
        ctx.fillStyle = "rgba(14, 7, 26, 0.72)"
        ctx.fillRect(0, 0, w, h)

        const cardW = 300
        const cardH = 210
        const cx = (w - cardW) * 0.5
        const cy = (h - cardH) * 0.5

        this.drawLayeredCard(
            ctx,
            cx,
            cy,
            cardW,
            cardH,
            16,
            PALETTE.deepPurple,
            PALETTE.lavender
        )

        ctx.fillStyle = PALETTE.white
        ctx.font = f("900 22px")
        ctx.textAlign = "center"
        ctx.fillText(t.paused, w * 0.5, cy + 44)

        const btnW = 190
        const btnH = 42
        const btnX = (w - btnW) * 0.5

        this.drawLayeredCard(
            ctx,
            btnX,
            cy + 74,
            btnW,
            btnH,
            10,
            this.props.accentColor || PALETTE.hotPink,
            PALETTE.white
        )
        ctx.fillStyle = PALETTE.white
        ctx.font = f("bold 15px")
        ctx.fillText(t.resumeBtn, w * 0.5, cy + 100)
        this.uiButtons.push({
            id: "RESUME_RUN",
            x: btnX,
            y: cy + 74,
            w: btnW,
            h: btnH,
        })

        this.drawLayeredCard(
            ctx,
            btnX,
            cy + 132,
            btnW,
            btnH,
            10,
            PALETTE.charcoal,
            PALETTE.lavender
        )
        ctx.fillStyle = PALETTE.lavender
        ctx.fillText(t.menuBtn, w * 0.5, cy + 158)
        this.uiButtons.push({
            id: "TO_MENU",
            x: btnX,
            y: cy + 132,
            w: btnW,
            h: btnH,
        })
    }

    private renderEndScreen(
        ctx: CanvasRenderingContext2D,
        w: number,
        h: number,
        isVictory: boolean
    ): void {
        const t = I18N[this.props.language]
        ctx.fillStyle = "rgba(12, 5, 22, 0.8)"
        ctx.fillRect(0, 0, w, h)

        const cardW = Math.min(360, w - 32)
        const cardH = 270
        const cx = (w - cardW) * 0.5
        const cy = (h - cardH) * 0.5

        this.drawLayeredCard(
            ctx,
            cx,
            cy,
            cardW,
            cardH,
            16,
            PALETTE.deepPurple,
            isVictory ? PALETTE.gold : PALETTE.dangerRed
        )

        ctx.fillStyle = isVictory ? PALETTE.gold : PALETTE.hotPink
        ctx.font = f("900 24px")
        ctx.textAlign = "center"
        ctx.fillText(
            isVictory ? t.victory : t.gameOver,
            w * 0.5,
            cy + 46,
            cardW - 20
        )

        ctx.fillStyle = PALETTE.white
        ctx.font = f("bold 14px")
        ctx.fillText(
            `${t.survivedFor}: ${formatTime(this.elapsedTime)}`,
            w * 0.5,
            cy + 88,
            cardW - 20
        )
        ctx.fillText(
            `${t.enemiesMended}: ${this.player.kills}`,
            w * 0.5,
            cy + 114,
            cardW - 20
        )
        ctx.fillText(
            `${t.levelReached}: ${this.player.level}`,
            w * 0.5,
            cy + 140,
            cardW - 20
        )

        const btnW = 200
        const btnH = 42
        const btnX = (w - btnW) * 0.5

        this.drawLayeredCard(
            ctx,
            btnX,
            cy + 164,
            btnW,
            btnH,
            10,
            this.props.accentColor || PALETTE.hotPink,
            PALETTE.white
        )
        ctx.fillStyle = PALETTE.white
        ctx.font = f("bold 15px")
        ctx.fillText(t.restartBtn, w * 0.5, cy + 190)
        this.uiButtons.push({
            id: "START_RUN",
            x: btnX,
            y: cy + 164,
            w: btnW,
            h: btnH,
        })

        this.drawLayeredCard(
            ctx,
            btnX,
            cy + 216,
            btnW,
            38,
            10,
            PALETTE.charcoal,
            PALETTE.lavender
        )
        ctx.fillStyle = PALETTE.lavender
        ctx.font = f("bold 13px")
        ctx.fillText(t.menuBtn, w * 0.5, cy + 240)
        this.uiButtons.push({
            id: "TO_MENU",
            x: btnX,
            y: cy + 216,
            w: btnW,
            h: 38,
        })
    }

    // ------------------------------------------------------------------------
    // UI DRAWING HELPERS (STACKED PAPER CARDS & WORD WRAP)
    // ------------------------------------------------------------------------
    private drawLayeredCard(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        w: number,
        h: number,
        radius: number,
        bgColor: string,
        borderColor: string
    ): void {
        ctx.save()
        // Offset paper card shadow
        ctx.fillStyle = PALETTE.outline
        roundRectPath(ctx, x + 3, y + 4, w, h, radius)
        ctx.fill()

        // Main card body
        ctx.fillStyle = bgColor
        ctx.strokeStyle = borderColor
        ctx.lineWidth = 2.4
        roundRectPath(ctx, x, y, w, h, radius)
        ctx.fill()
        ctx.stroke()
        ctx.restore()
    }

    private drawWrappedText(
        ctx: CanvasRenderingContext2D,
        text: string,
        cx: number,
        startY: number,
        maxWidth: number,
        lineHeight: number
    ): void {
        const words = text.split(" ")
        let line = ""
        let y = startY
        for (let n = 0; n < words.length; n++) {
            const testLine = line + words[n] + " "
            const metrics = ctx.measureText(testLine)
            if (metrics.width > maxWidth && n > 0) {
                ctx.fillText(line.trim(), cx, y)
                line = words[n] + " "
                y += lineHeight
            } else {
                line = testLine
            }
        }
        if (line.trim().length > 0) {
            ctx.fillText(line.trim(), cx, y)
        }
    }

    public destroy(): void {
        this.input.detach()
        this.sound.destroy()
        this.events.clear()
    }
}

// ============================================================================
// 11. REACT COMPONENT
// ============================================================================

export function MidnightStitch(rawProps: MidnightStitchProps) {
    const {
        playerImage,
        bunnyImage,
        accentColor,
        backdropColor,
        difficulty,
        startTime,
        showFPS,
        soundOn,
        seedMode,
        language,
    } = rawProps

    const props = useMemo(
        () =>
            resolveProps({
                playerImage,
                bunnyImage,
                accentColor,
                backdropColor,
                difficulty,
                startTime,
                showFPS,
                soundOn,
                seedMode,
                language,
            }),
        [
            playerImage,
            bunnyImage,
            accentColor,
            backdropColor,
            difficulty,
            startTime,
            showFPS,
            soundOn,
            seedMode,
            language,
        ]
    )

    const containerRef = useRef<HTMLDivElement | null>(null)
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const gameRef = useRef<MidnightStitchGame | null>(null)
    const initialPropsRef = useRef(props)

    // Push prop changes into the imperative game instance without re-mounting.
    useEffect(() => {
        gameRef.current?.updateProps(props)
    }, [props])

    useEffect(() => {
        const container = containerRef.current
        const canvas = canvasRef.current
        if (!container || !canvas) return

        const ctx = canvas.getContext("2d")
        if (!ctx) return

        const game = new MidnightStitchGame(initialPropsRef.current)
        gameRef.current = game

        const updateCanvasSize = () => {
            const rect = container.getBoundingClientRect()
            const w = Math.max(320, Math.floor(rect.width))
            const h = Math.max(240, Math.floor(rect.height))
            const dpr = Math.min(2, window.devicePixelRatio || 1)
            canvas.width = Math.floor(w * dpr)
            canvas.height = Math.floor(h * dpr)
            game.viewW = w
            game.viewH = h
            game.dpr = dpr
            game.input.logicalW = w
            game.input.logicalH = h
        }

        updateCanvasSize()

        game.input.attach(canvas, container)

        let rafId = 0
        let lastTime = performance.now()
        let accumulator = 0
        let isVisible = document.visibilityState !== "hidden"
        let inView = true
        let outOfViewFrames = 0

        const syncListening = () => {
            game.input.listening = isVisible && inView
        }
        syncListening()

        const resizeObserver = new ResizeObserver(() => {
            updateCanvasSize()
        })
        resizeObserver.observe(container)

        // Plain geometry check instead of IntersectionObserver: inside clipped
        // or transformed ancestors the observer can report "not visible" while
        // the canvas is on screen, which would stall the whole game loop.
        const checkInView = (): boolean => {
            const r = container.getBoundingClientRect()
            const vw = window.innerWidth || document.documentElement.clientWidth
            const vh =
                window.innerHeight || document.documentElement.clientHeight
            if (r.width <= 0 || r.height <= 0) return false
            return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw
        }

        const handleVisibilityChange = () => {
            isVisible = document.visibilityState === "visible"
            syncListening()
            if (!isVisible && game.state === "PLAYING") {
                game.transitionTo("PAUSED")
            }
        }
        document.addEventListener("visibilitychange", handleVisibilityChange)

        const reportError = (where: string, err: unknown) => {
            const msg =
                where +
                ": " +
                (err instanceof Error ? err.message : String(err))
            game.lastError = msg
            console.error("[MidnightStitch] " + msg, err)
        }

        const loop = (now: number) => {
            rafId = requestAnimationFrame(loop)

            const nowInView = checkInView()
            if (nowInView !== inView) {
                inView = nowInView
                syncListening()
            }
            if (!inView) {
                // Auto-pause only after the game has been out of view for a moment.
                outOfViewFrames++
                if (outOfViewFrames > 20 && game.state === "PLAYING") {
                    game.transitionTo("PAUSED")
                }
                lastTime = now
                return
            }
            outOfViewFrames = 0
            if (!isVisible) {
                lastTime = now
                return
            }

            const rawDelta = now - lastTime
            const frameDeltaMs = Number.isFinite(rawDelta) ? rawDelta : 16.7
            lastTime = now
            game.recordFrameTime(Math.max(0, frameDeltaMs))

            const deltaSec = Math.min(0.1, Math.max(0, frameDeltaMs / 1000))
            accumulator += deltaSec

            // Simulation: an error here must not stop drawing.
            try {
                let steps = 0
                while (
                    accumulator >= CONFIG.FIXED_DT &&
                    steps < CONFIG.MAX_ACCUM_STEPS
                ) {
                    game.step(CONFIG.FIXED_DT)
                    accumulator -= CONFIG.FIXED_DT
                    steps++
                }
                if (steps === CONFIG.MAX_ACCUM_STEPS) {
                    accumulator = 0
                }
            } catch (err) {
                accumulator = 0
                reportError("step", err)
            }

            const alpha = clamp(accumulator / CONFIG.FIXED_DT, 0, 1)
            try {
                ctx.setTransform(1, 0, 0, 1, 0, 0)
                ctx.save()
                ctx.scale(game.dpr, game.dpr)
                game.render(ctx, alpha)
                ctx.restore()
            } catch (err) {
                reportError("render", err)
                ctx.setTransform(1, 0, 0, 1, 0, 0)
            }
        }

        rafId = requestAnimationFrame(loop)

        return () => {
            cancelAnimationFrame(rafId)
            resizeObserver.disconnect()
            document.removeEventListener(
                "visibilitychange",
                handleVisibilityChange
            )
            game.destroy()
            gameRef.current = null
        }
    }, [])

    return (
        <div
            ref={containerRef}
            dir={props.language === "FA" ? "rtl" : "ltr"}
            style={{
                width: "100%",
                height: "100%",
                minWidth: 320,
                minHeight: 240,
                position: "relative",
                overflow: "hidden",
                backgroundColor: props.backdropColor || PALETTE.darkNight,
                userSelect: "none",
                WebkitUserSelect: "none",
                touchAction: "none",
            }}
        >
            <canvas
                ref={canvasRef}
                style={{
                    width: "100%",
                    height: "100%",
                    display: "block",
                    pointerEvents: "auto",
                }}
            />
        </div>
    )
}

export default MidnightStitch
