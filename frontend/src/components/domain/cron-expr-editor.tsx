import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

interface CronExprEditorProps {
    value: string;
    onChange: (expr: string) => void;
    showPreview?: boolean;
}

const PRESETS = [
    { label: 'Every minute', expr: '* * * * *' },
    { label: 'Every 5 min', expr: '*/5 * * * *' },
    { label: 'Every hour', expr: '0 * * * *' },
    { label: 'Daily 9am', expr: '0 9 * * *' },
    { label: 'Weekdays 9am', expr: '0 9 * * 1-5' },
    { label: 'Weekly Mon', expr: '0 9 * * 1' },
] as const;

function describeCron(expr: string): string {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return 'Invalid cron expression';
    const [min, hour, dom, , dow] = parts;
    if (expr === '* * * * *') return 'Every minute';
    if (min.startsWith('*/')) return `Every ${min.slice(2)} minutes`;
    if (hour === '*' && min === '0') return 'Every hour';
    if (dom === '*' && dow === '*') return `Daily at ${hour}:${min.padStart(2, '0')}`;
    if (dom === '*' && dow === '1-5') return `Weekdays at ${hour}:${min.padStart(2, '0')}`;
    if (dom === '*' && dow !== '*') return `Weekly (days: ${dow}) at ${hour}:${min.padStart(2, '0')}`;
    return expr;
}

export function CronExprEditor({ value, onChange, showPreview = true }: CronExprEditorProps) {
    const { t } = useTranslation();
    const [custom, setCustom] = useState(false);

    const isPreset = PRESETS.some((p) => p.expr === value);

    return (
        <div className="grid gap-3">
            <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                    <Button
                        key={p.expr}
                        variant={value === p.expr ? 'default' : 'secondary'}
                        size="sm"
                        onClick={() => { onChange(p.expr); setCustom(false); }}
                    >
                        {p.label}
                    </Button>
                ))}
                <Button
                    variant={custom || !isPreset ? 'default' : 'secondary'}
                    size="sm"
                    onClick={() => setCustom(true)}
                >
                    {t('common.custom', 'Custom')}
                </Button>
            </div>

            {(custom || !isPreset) && (
                <div className="grid gap-1.5">
                    <Label htmlFor="cron-input" className="text-xs">{t('agent.schedule.cronExpr', 'Cron expression')}</Label>
                    <Input
                        id="cron-input"
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder="0 9 * * 1-5"
                        spellCheck={false}
                        autoComplete="off"
                        className="font-mono text-xs"
                    />
                </div>
            )}

            {showPreview && value && (
                <div className="text-xs text-content-tertiary">
                    {describeCron(value)}
                </div>
            )}
        </div>
    );
}
