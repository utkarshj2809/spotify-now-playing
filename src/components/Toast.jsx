import { useState, useCallback, useRef } from 'react';
import './Toast.css';

/**
 * useToast — returns a { showToast } helper and a <ToastContainer /> component.
 *
 * Usage:
 *   const { showToast, ToastContainer } = useToast();
 *   showToast('Liked ❤️');
 *   return <> ... <ToastContainer /> </>;
 */
export function useToast() {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const showToast = useCallback((message, durationMs = 2500) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, durationMs);
  }, []);

  // ToastContainer is a stable component that only re-renders when toasts change.
  // It is defined inside the hook to co-locate it with its state.
  const ToastContainer = useCallback(() => (
    <div className="toast-container" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.message}
        </div>
      ))}
    </div>
  ), [toasts]);

  return { showToast, ToastContainer };
}

