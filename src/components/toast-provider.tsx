import { X } from "lucide-react";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useState,
} from "react";
import { Button } from "@/components/ui/button";

type ToastType = "success" | "error" | "info";

interface Toast {
	id: string;
	message: string;
	type: ToastType;
}

interface ToastContextType {
	toasts: Toast[];
	toast: (message: string, type?: ToastType) => void;
	dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

let toastId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
	const [toasts, setToasts] = useState<Toast[]>([]);

	const dismiss = useCallback((id: string) => {
		setToasts((prev) => prev.filter((t) => t.id !== id));
	}, []);

	const toast = useCallback(
		(message: string, type: ToastType = "info") => {
			const id = `toast-${++toastId}`;
			setToasts((prev) => [...prev, { id, message, type }]);
			setTimeout(() => dismiss(id), 4000);
		},
		[dismiss],
	);

	return (
		<ToastContext.Provider value={{ toasts, toast, dismiss }}>
			{children}
			<section
				className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
				aria-live="polite"
				aria-label="Notifications"
			>
				{toasts.map((t) => (
					<div
						key={t.id}
						className={`pointer-events-auto flex max-w-sm items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur-md transition-all duration-300 ${
							t.type === "success"
								? "border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-200"
								: t.type === "error"
									? "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200"
									: "border-[var(--line)] bg-[var(--surface-strong)] text-[var(--sea-ink)]"
						}`}
						role="alert"
					>
						<span className="flex-1">{t.message}</span>
						<Button
							variant="ghost"
							size="icon-xs"
							onClick={() => dismiss(t.id)}
							className="shrink-0 opacity-60 hover:bg-transparent hover:opacity-100"
							aria-label="Dismiss"
						>
							<X aria-hidden="true" />
						</Button>
					</div>
				))}
			</section>
		</ToastContext.Provider>
	);
}

export function useToast(): ToastContextType {
	const ctx = useContext(ToastContext);
	if (!ctx) {
		throw new Error("useToast must be used within a ToastProvider");
	}
	return ctx;
}
