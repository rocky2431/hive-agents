import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { PermissionUserPicker } from '@/pages/agent-detail/permission-user-picker';

interface PermissionScope {
    scope_type: 'company' | 'user' | 'department';
    scope_ids: string[];
    access_level: 'use' | 'manage';
}

interface PermissionEditorProps {
    value: PermissionScope;
    onChange: (scope: PermissionScope) => void;
    tenantId?: string;
}

export function PermissionEditor({ value, onChange, tenantId }: PermissionEditorProps) {
    const { t } = useTranslation();

    return (
        <div className="grid gap-4">
            <div className="grid gap-2">
                <Label className="text-sm font-medium">{t('agent.settings.perm.scope', 'Visibility scope')}</Label>
                <RadioGroup
                    value={value.scope_type}
                    onValueChange={(v) => onChange({ ...value, scope_type: v as PermissionScope['scope_type'], scope_ids: v === 'company' ? [] : value.scope_ids })}
                >
                    <div className="flex items-center gap-2">
                        <RadioGroupItem value="company" id="scope-company" />
                        <Label htmlFor="scope-company" className="font-normal">
                            {t('agent.settings.perm.company', 'Company-wide')}
                        </Label>
                    </div>
                    <div className="flex items-center gap-2">
                        <RadioGroupItem value="user" id="scope-user" />
                        <Label htmlFor="scope-user" className="font-normal">
                            {t('agent.settings.perm.specificUsers', 'Specific users')}
                        </Label>
                    </div>
                </RadioGroup>
            </div>

            {value.scope_type === 'user' && (
                <PermissionUserPicker
                    tenantId={tenantId}
                    selectedPermissionUserIds={value.scope_ids}
                    onToggle={(userId: string) => {
                        const ids = value.scope_ids.includes(userId)
                            ? value.scope_ids.filter((id) => id !== userId)
                            : [...value.scope_ids, userId];
                        onChange({ ...value, scope_ids: ids });
                    }}
                    disabled={false}
                />
            )}

            <div className="grid gap-2">
                <Label className="text-sm font-medium">{t('agent.settings.perm.accessLevel', 'Access level')}</Label>
                <RadioGroup
                    value={value.access_level}
                    onValueChange={(v) => onChange({ ...value, access_level: v as 'use' | 'manage' })}
                >
                    <div className="flex items-center gap-2">
                        <RadioGroupItem value="use" id="access-use" />
                        <Label htmlFor="access-use" className="font-normal">
                            {t('agent.settings.perm.use', 'Use only')} — {t('agent.settings.perm.useDesc', 'chat, browse skills')}
                        </Label>
                    </div>
                    <div className="flex items-center gap-2">
                        <RadioGroupItem value="manage" id="access-manage" />
                        <Label htmlFor="access-manage" className="font-normal">
                            {t('agent.settings.perm.manage', 'Manage')} — {t('agent.settings.perm.manageDesc', 'settings, schedules, triggers')}
                        </Label>
                    </div>
                </RadioGroup>
            </div>
        </div>
    );
}
