/**
 * Date/time formatting utilities using Intl APIs.
 * Per Web Interface Guidelines: use Intl.DateTimeFormat, not hardcoded formats.
 */

const shortDate = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

const fullDateTime = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const timeOnly = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});

const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

const numberFormat = new Intl.NumberFormat();

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Safely parse input to Date. Returns null for invalid values. */
function toDate(input: string | Date): Date | null {
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Format as short date: "Mar 25, 2026". Returns '-' for null/undefined/invalid. */
export function formatDate(input: string | Date | null | undefined): string {
  if (!input) return '-';
  const d = toDate(input);
  return d ? shortDate.format(d) : '-';
}

/** Format as full date + time: "Mar 25, 2026, 10:30 AM". Returns '-' for null/undefined/invalid. */
export function formatDateTime(input: string | Date | null | undefined): string {
  if (!input) return '-';
  const d = toDate(input);
  return d ? fullDateTime.format(d) : '-';
}

/** Format as time only: "10:30 AM". Returns '-' for null/undefined/invalid. */
export function formatTime(input: string | Date | null | undefined): string {
  if (!input) return '-';
  const d = toDate(input);
  return d ? timeOnly.format(d) : '-';
}

/**
 * Format as relative time: "2 hours ago", "just now", "3 days ago".
 * Future timestamps and dates >30 days old fall back to absolute short date format.
 * Returns '-' for null/undefined/invalid.
 */
export function formatRelative(input: string | Date | null | undefined): string {
  if (!input) return '-';
  const date = toDate(input);
  if (!date) return '-';
  const diff = Date.now() - date.getTime();

  // Future dates or very recent: fall back gracefully
  if (diff < 0) return shortDate.format(date);
  if (diff < MINUTE) return 'just now';

  if (diff < HOUR) return relativeTime.format(-Math.floor(diff / MINUTE), 'minute');
  if (diff < DAY) return relativeTime.format(-Math.floor(diff / HOUR), 'hour');
  if (diff < 30 * DAY) return relativeTime.format(-Math.floor(diff / DAY), 'day');

  return shortDate.format(date);
}

/** Format a number with locale-aware grouping: 1,234,567 */
export function formatNumber(n: number | null | undefined): string {
  if (n == null) return '0';
  return numberFormat.format(n);
}
