import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';

/**
 * Warn before navigating away from unsaved form changes.
 * Uses both `beforeunload` (browser tab close) and React Router blocker (in-app navigation).
 *
 * @param isDirty - Whether the form has unsaved changes
 * @param message - Warning message for in-app navigation prompt
 */
export function useUnsavedChanges(isDirty: boolean, message = 'You have unsaved changes. Discard?') {
    // Browser tab close / reload
    useEffect(() => {
        if (!isDirty) return;
        const handler = (e: BeforeUnloadEvent) => {
            e.preventDefault();
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [isDirty]);

    // React Router in-app navigation
    useBlocker(({ currentLocation, nextLocation }) => {
        if (!isDirty) return false;
        if (currentLocation.pathname === nextLocation.pathname) return false;
        return !window.confirm(message);
    });
}
