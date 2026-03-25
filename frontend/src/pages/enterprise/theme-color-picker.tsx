import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { saveAccentColor, getSavedAccentColor, resetAccentColor, PRESET_COLORS } from '../../utils/theme';

export default function ThemeColorPicker() {
    const { t } = useTranslation();
    const [currentColor, setCurrentColor] = useState(getSavedAccentColor() || '');
    const [customHex, setCustomHex] = useState('');

    const apply = (hex: string) => {
        setCurrentColor(hex);
        saveAccentColor(hex);
    };

    const handleReset = () => {
        setCurrentColor('');
        setCustomHex('');
        resetAccentColor();
    };

    const handleCustom = () => {
        const hex = customHex.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
            apply(hex);
        }
    };

    return (
        <div className="card mt-4 mb-4">
            <h4 className="mb-3">{t('enterprise.config.themeColor')}</h4>
            <div className="flex gap-2 flex-wrap mb-3">
                {PRESET_COLORS.map(c => (
                    <div
                        key={c.hex}
                        onClick={() => apply(c.hex)}
                        title={c.name}
                        className="w-8 h-8 rounded-lg cursor-pointer transition-all duration-[120ms]"
                        style={{
                            background: c.hex,
                            border: currentColor === c.hex ? '2px solid var(--text-primary)' : '2px solid transparent',
                            outline: currentColor === c.hex ? '2px solid var(--bg-primary)' : 'none',
                        }}
                    />
                ))}
            </div>
            <div className="flex gap-2 items-center">
                <input
                    className="input w-[120px] text-[13px] font-mono"
                    value={customHex}
                    onChange={e => setCustomHex(e.target.value)}
                    placeholder="#hex"
                    onKeyDown={e => e.key === 'Enter' && handleCustom()}
                />
                <button className="btn btn-secondary text-xs" onClick={handleCustom}>Apply</button>
                {currentColor && (
                    <button className="btn btn-ghost text-xs text-content-tertiary" onClick={handleReset}>Reset</button>
                )}
                {currentColor && (
                    <div className="w-5 h-5 rounded border border-edge-default" style={{ background: currentColor }} />
                )}
            </div>
        </div>
    );
}
