import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeMemoryFacts } from './memoryInsights.ts';

test('normalizeMemoryFacts keeps only valid facts, sorts latest first, and derives labels', () => {
    const facts = normalizeMemoryFacts([
        { topic: 'Preference', content: '  Prefers async updates.  ', timestamp: '2026-03-24T08:00:00Z' },
        { entity: 'Client', fact: 'ACME launch is in April' },
        { content: '   ' },
        'Plain text fact',
        { memory_key: 'project_status', content: 'Redesign is in review', timestamp: '2026-03-25T09:30:00Z' },
    ]);

    assert.deepEqual(facts, [
        {
            id: 'project_status-2026-03-25T09:30:00Z-0',
            label: 'project_status',
            content: 'Redesign is in review',
            timestamp: '2026-03-25T09:30:00Z',
        },
        {
            id: 'Preference-2026-03-24T08:00:00Z-1',
            label: 'Preference',
            content: 'Prefers async updates.',
            timestamp: '2026-03-24T08:00:00Z',
        },
        {
            id: 'Client-none-2',
            label: 'Client',
            content: 'ACME launch is in April',
            timestamp: null,
        },
        {
            id: 'Fact-none-3',
            label: 'Fact',
            content: 'Plain text fact',
            timestamp: null,
        },
    ]);
});

test('normalizeMemoryFacts enforces the display limit after ordering', () => {
    const facts = normalizeMemoryFacts([
        { content: 'one', timestamp: '2026-03-21T00:00:00Z' },
        { content: 'two', timestamp: '2026-03-22T00:00:00Z' },
        { content: 'three', timestamp: '2026-03-23T00:00:00Z' },
    ], 2);

    assert.deepEqual(
        facts.map((fact) => fact.content),
        ['three', 'two'],
    );
});
