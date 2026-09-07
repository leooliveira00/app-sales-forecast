import React, { useCallback, useEffect, useState } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';
import { cn } from './Common';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

export const useToast = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  }, []);

  const removeToast = useCallback(
    (id: string) => setToasts(prev => prev.filter(t => t.id !== id)),
    []
  );

  return { toasts, showToast, removeToast };
};

export const ToastContainer: React.FC<{ toasts: Toast[]; removeToast: (id: string) => void }> = ({ toasts, removeToast }) => {
  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 pointer-events-none">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={cn(
            "flex items-center gap-3 p-4 rounded-xl shadow-lg border w-80 pointer-events-auto animate-in slide-in-from-right-full duration-300",
            toast.type === 'success' && "bg-emerald-50 border-emerald-200 text-emerald-800",
            toast.type === 'error' && "bg-red-50 border-red-200 text-red-800",
            toast.type === 'warning' && "bg-amber-50 border-amber-200 text-amber-800",
            toast.type === 'info' && "bg-sky-50 border-sky-200 text-sky-800"
          )}
        >
          <div className="flex-shrink-0">
            {toast.type === 'success' && <CheckCircle className="w-5 h-5" />}
            {toast.type === 'error' && <AlertCircle className="w-5 h-5" />}
            {toast.type === 'warning' && <AlertCircle className="w-5 h-5" />}
            {toast.type === 'info' && <Info className="w-5 h-5" />}
          </div>
          <p className="text-sm font-medium flex-grow">{toast.message}</p>
          <button onClick={() => removeToast(toast.id)} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};
