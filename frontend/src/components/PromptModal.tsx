import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface PromptModalProps {
    open: boolean;
    title: string;
    placeholder?: string;
    onConfirm: (value: string) => void;
    onCancel: () => void;
}

export default function PromptModal({ open, title, placeholder, onConfirm, onCancel }: PromptModalProps) {
    const { t } = useTranslation();
    const [value, setValue] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open) {
            setValue('');
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [open]);

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>
                <Input
                    ref={inputRef}
                    value={value}
                    onChange={e => setValue(e.target.value)}
                    placeholder={placeholder || ''}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && value.trim()) onConfirm(value.trim());
                    }}
                />
                <DialogFooter>
                    <Button variant="secondary" onClick={onCancel}>{t('common.cancel')}</Button>
                    <Button onClick={() => { if (value.trim()) onConfirm(value.trim()); }}
                        disabled={!value.trim()}>{t('common.confirm')}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
