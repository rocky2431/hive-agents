import { Component, ErrorInfo, ReactNode } from 'react';
import i18n from '../i18n';

interface Props {
    children?: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo);
    }

    public render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }
            return (
                <div className="mx-auto mt-10 max-w-xl rounded-lg bg-surface-secondary p-5 text-content-primary shadow-md">
                    <h2 className="mb-4 flex items-center gap-2 text-error">
                        <span className="text-2xl" aria-hidden="true">⚠️</span> {i18n.t('errorBoundary.title')}
                    </h2>
                    <p className="mb-4 text-content-secondary">
                        {i18n.t('errorBoundary.description')}
                    </p>
                    <details className="mb-5 whitespace-pre-wrap rounded border border-edge-default bg-surface-primary p-3 text-sm text-error">
                        <summary className="mb-2 cursor-pointer font-bold">{i18n.t('errorBoundary.errorDetails')}</summary>
                        {this.state.error && this.state.error.toString()}
                    </details>
                    <button
                        className="btn btn-primary"
                        onClick={() => window.location.reload()}
                    >
                        {i18n.t('errorBoundary.refreshPage')}
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
