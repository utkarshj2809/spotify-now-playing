import { useState, useCallback, useRef } from 'react';
import './Toast.css';

// ToastList is a helper component co-located with its hook.
// eslint-disable-next-line react-refresh/only-export-components
function ToastList({ toasts }) {
  return (
    <div className="toast-container" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.message}
        </div>
      ))}
    </div>
  );
}

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

  // Return a stable wrapper that passes toasts to the stable ToastList component.
  const ToastContainer = useCallback(() => <ToastList toasts={toasts} />, [toasts]);

  return { showToast, ToastContainer };
}

