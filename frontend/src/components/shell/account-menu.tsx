import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores';
import { authApi } from '@/services/api';
import { Button } from '@/components/ui/button';

interface AccountMenuProps {
    open: boolean;
    onClose: () => void;
}

export function AccountMenu({ open, onClose }: AccountMenuProps) {
    const { t } = useTranslation();
    const user = useAuthStore(s => s.user);
    const setUser = useAuthStore(s => s.setUser);
    const [username, setUsername] = useState(user?.username || '');
    const [displayName, setDisplayName] = useState(user?.display_name || '');
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');
    const [msgType, setMsgType] = useState<'success' | 'error'>('success');

    const showMsg = (text: string, type: 'success' | 'error' = 'success') => {
        setMsg(text);
        setMsgType(type);
        setTimeout(() => setMsg(''), 3000);
    };

    const handleSaveProfile = async () => {
        setSaving(true);
        try {
            const body: Record<string, string> = {};
            if (username !== user?.username) body.username = username;
            if (displayName !== user?.display_name) body.display_name = displayName;
            if (Object.keys(body).length === 0) {
                showMsg(t('account.noChanges'), 'error');
                setSaving(false);
                return;
            }
            const updated = await authApi.updateMe(body);
            setUser(updated);
            showMsg(t('account.profileUpdated'));
        } catch (e: any) {
            showMsg(e.message || 'Failed', 'error');
        }
        setSaving(false);
    };

    const handleChangePassword = async () => {
        if (!oldPassword || !newPassword) { showMsg(t('account.fillAllFields'), 'error'); return; }
        if (newPassword.length < 6) { showMsg(t('account.minChars'), 'error'); return; }
        if (newPassword !== confirmPassword) { showMsg(t('account.passwordMismatch'), 'error'); return; }
        setSaving(true);
        try {
            await authApi.changePassword({ current_password: oldPassword, new_password: newPassword });
            showMsg(t('account.passwordChanged'));
            setOldPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } catch (e: any) {
            showMsg(e.message || 'Failed', 'error');
        }
        setSaving(false);
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50" onClick={onClose}>
            <div
                className="rounded-xl border border-edge-subtle bg-surface-primary w-[420px] max-h-[90vh] overflow-auto p-6 shadow-lg"
                onClick={e => e.stopPropagation()}
                role="dialog"
                aria-label={t('account.title')}
            >
                <div className="flex items-center justify-between mb-5">
                    <h3 className="m-0">{t('account.title')}</h3>
                    <Button variant="ghost" size="sm" onClick={onClose} aria-label={t('common.close', 'Close')}>
                        &times;
                    </Button>
                </div>
                {msg && (
                    <div className={`rounded-md px-3 py-2 text-xs mb-4 ${msgType === 'success' ? 'bg-success-subtle text-success' : 'bg-error-subtle text-error'}`}>
                        {msg}
                    </div>
                )}
                {/* Profile */}
                <h4 className="m-0 mb-3 text-[13px] text-content-secondary">{t('account.profile')}</h4>
                <div className="flex flex-col gap-2.5 mb-5">
                    <div>
                        <label htmlFor="account-username" className="block text-xs font-medium mb-1 text-content-secondary">{t('account.username')}</label>
                        <input id="account-username" className="form-input w-full text-[13px]" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" spellCheck={false} />
                    </div>
                    <div>
                        <label htmlFor="account-display-name" className="block text-xs font-medium mb-1 text-content-secondary">{t('account.displayName')}</label>
                        <input id="account-display-name" className="form-input w-full text-[13px]" value={displayName} onChange={e => setDisplayName(e.target.value)} autoComplete="name" />
                    </div>
                    <div className="flex justify-end">
                        <Button size="sm" onClick={handleSaveProfile} disabled={saving}>
                            {saving ? '...' : t('common.save')}
                        </Button>
                    </div>
                </div>
                <div className="border-t border-edge-subtle mb-5" />
                {/* Password */}
                <h4 className="m-0 mb-3 text-[13px] text-content-secondary">{t('account.changePassword')}</h4>
                <div className="flex flex-col gap-2.5">
                    <div>
                        <label htmlFor="account-current-password" className="block text-xs font-medium mb-1 text-content-secondary">{t('account.currentPassword')}</label>
                        <input id="account-current-password" className="form-input w-full text-[13px]" type="password" value={oldPassword} onChange={e => setOldPassword(e.target.value)} autoComplete="current-password" />
                    </div>
                    <div>
                        <label htmlFor="account-new-password" className="block text-xs font-medium mb-1 text-content-secondary">{t('account.newPassword')}</label>
                        <input id="account-new-password" className="form-input w-full text-[13px]" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder={t('account.newPasswordPlaceholder')} autoComplete="new-password" />
                    </div>
                    <div>
                        <label htmlFor="account-confirm-password" className="block text-xs font-medium mb-1 text-content-secondary">{t('account.confirmPassword')}</label>
                        <input id="account-confirm-password" className="form-input w-full text-[13px]" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" />
                    </div>
                    <div className="flex justify-end">
                        <Button size="sm" onClick={handleChangePassword} disabled={saving}>
                            {saving ? '...' : t('account.changePassword')}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
