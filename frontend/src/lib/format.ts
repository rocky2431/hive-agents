/**
 * Shared formatting utilities used across multiple pages.
 */

/** Format token count as human-readable string (e.g., "1.2K", "3.5M", "1.0B"). */
export function formatTokens(n: number | null | undefined): string {
    if (n == null || n === 0) return '0';
    if (n < 1000) return String(n);
    if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + 'K';
    if (n < 1_000_000_000) return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + 'M';
    return (n / 1_000_000_000).toFixed(1) + 'B';
}
