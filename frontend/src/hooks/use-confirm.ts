import { useCallback, useRef, useState } from 'react';

export interface ConfirmOptions {
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
}

interface ConfirmState extends ConfirmOptions {
    open: boolean;
}

/**
 * Imperative confirm dialog hook.
 * Returns { confirm, ConfirmDialogProps }.
 *
 * Usage:
 *   const { confirm, dialogProps } = useConfirm();
 *   <AlertDialog {...dialogProps} />
 *
 *   const ok = await confirm({ title: 'Delete?', destructive: true });
 *   if (ok) { ... }
 */
export function useConfirm() {
    const [state, setState] = useState<ConfirmState>({
        open: false,
        title: '',
    });
    const resolveRef = useRef<((value: boolean) => void) | null>(null);

    const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
        setState({ ...options, open: true });
        return new Promise<boolean>((resolve) => {
            resolveRef.current = resolve;
        });
    }, []);

    const onConfirm = useCallback(() => {
        setState((s) => ({ ...s, open: false }));
        resolveRef.current?.(true);
        resolveRef.current = null;
    }, []);

    const onCancel = useCallback(() => {
        setState((s) => ({ ...s, open: false }));
        resolveRef.current?.(false);
        resolveRef.current = null;
    }, []);

    return {
        confirm,
        dialogProps: {
            open: state.open,
            title: state.title,
            description: state.description,
            confirmLabel: state.confirmLabel,
            cancelLabel: state.cancelLabel,
            destructive: state.destructive,
            onConfirm,
            onCancel,
        },
    };
}
