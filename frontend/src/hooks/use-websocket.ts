import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseWebSocketOptions {
    url: string;
    onMessage: (data: unknown) => void;
    onOpen?: () => void;
    onClose?: () => void;
    onError?: (event: Event) => void;
    enabled?: boolean;
    reconnect?: boolean;
    maxRetries?: number;
}

interface UseWebSocketReturn {
    send: (data: string | object) => void;
    close: () => void;
    readyState: number;
    isConnected: boolean;
}

const WS_OPEN = 1;
const WS_CLOSED = 3;

/**
 * WebSocket hook with auto-reconnect and exponential backoff.
 * Extracted from Chat.tsx for reuse across agent chat, gateway, etc.
 */
export function useWebSocket({
    url,
    onMessage,
    onOpen,
    onClose,
    onError,
    enabled = true,
    reconnect = true,
    maxRetries = 10,
}: UseWebSocketOptions): UseWebSocketReturn {
    const wsRef = useRef<WebSocket | null>(null);
    const retriesRef = useRef(0);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const [readyState, setReadyState] = useState<number>(WS_CLOSED);

    // Stable refs for callbacks to avoid reconnection loops
    const onMessageRef = useRef(onMessage);
    onMessageRef.current = onMessage;
    const onOpenRef = useRef(onOpen);
    onOpenRef.current = onOpen;
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;

    const connect = useCallback(() => {
        if (!enabled || !url) return;

        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
            retriesRef.current = 0;
            setReadyState(ws.readyState);
            onOpenRef.current?.();
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                onMessageRef.current(data);
            } catch {
                onMessageRef.current(event.data);
            }
        };

        ws.onclose = () => {
            setReadyState(WS_CLOSED);
            onCloseRef.current?.();

            if (reconnect && retriesRef.current < maxRetries) {
                const delay = Math.min(1000 * 2 ** retriesRef.current, 30_000);
                retriesRef.current += 1;
                reconnectTimerRef.current = setTimeout(connect, delay);
            }
        };

        ws.onerror = (event) => {
            onErrorRef.current?.(event);
        };
    }, [url, enabled, reconnect, maxRetries]);

    useEffect(() => {
        connect();
        return () => {
            clearTimeout(reconnectTimerRef.current);
            wsRef.current?.close();
        };
    }, [connect]);

    const send = useCallback((data: string | object) => {
        if (wsRef.current?.readyState === WS_OPEN) {
            wsRef.current.send(typeof data === 'string' ? data : JSON.stringify(data));
        }
    }, []);

    const close = useCallback(() => {
        clearTimeout(reconnectTimerRef.current);
        wsRef.current?.close();
    }, []);

    return {
        send,
        close,
        readyState,
        isConnected: readyState === WS_OPEN,
    };
}
