export type MemoryInsightFact = {
    id: string;
    label: string;
    content: string;
    timestamp: string | null;
};

type RawMemoryFact = string | {
    content?: unknown;
    fact?: unknown;
    timestamp?: unknown;
    memory_key?: unknown;
    key?: unknown;
    topic?: unknown;
    subject?: unknown;
    entity?: unknown;
};

const LABEL_KEYS = ['memory_key', 'key', 'topic', 'subject', 'entity'] as const;

const toTrimmedString = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
};

const getFactContent = (fact: RawMemoryFact): string | null => {
    if (typeof fact === 'string') return toTrimmedString(fact);
    return toTrimmedString(fact.content) ?? toTrimmedString(fact.fact);
};

const getFactLabel = (fact: RawMemoryFact): string => {
    if (typeof fact === 'string') return 'Fact';
    for (const key of LABEL_KEYS) {
        const value = toTrimmedString(fact[key]);
        if (value) return value;
    }
    return 'Fact';
};

const getFactTimestamp = (fact: RawMemoryFact): string | null => {
    if (typeof fact === 'string') return null;
    const timestamp = toTrimmedString(fact.timestamp);
    if (!timestamp) return null;
    return Number.isNaN(Date.parse(timestamp)) ? null : timestamp;
};

export function normalizeMemoryFacts(rawFacts: unknown, limit = 8): MemoryInsightFact[] {
    if (!Array.isArray(rawFacts) || limit <= 0) return [];

    const normalized = rawFacts.flatMap((fact, index) => {
        const content = getFactContent(fact as RawMemoryFact);
        if (!content) return [];
        return [{
            index,
            label: getFactLabel(fact as RawMemoryFact),
            content,
            timestamp: getFactTimestamp(fact as RawMemoryFact),
        }];
    });

    normalized.sort((left, right) => {
        if (left.timestamp && right.timestamp) {
            return Date.parse(right.timestamp) - Date.parse(left.timestamp) || left.index - right.index;
        }
        if (left.timestamp) return -1;
        if (right.timestamp) return 1;
        return left.index - right.index;
    });

    return normalized.slice(0, limit).map((fact, index) => ({
        id: `${fact.label}-${fact.timestamp ?? 'none'}-${index}`,
        label: fact.label,
        content: fact.content,
        timestamp: fact.timestamp,
    }));
}
