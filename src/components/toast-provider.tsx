import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useState,
} from "react";

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
			<div
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
						<button
							type="button"
							onClick={() => dismiss(t.id)}
							className="shrink-0 rounded p-0.5 opacity-60 transition hover:opacity-100"
							aria-label="Dismiss"
						>
							<svg
								aria-hidden="true"
								className="h-4 w-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M6 18L18 6M6 6l12 12"
								/>
							</svg>
						</button>
					</div>
				))}
			</div>
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
