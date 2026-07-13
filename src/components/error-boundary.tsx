import { AlertTriangle } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
	children: ReactNode;
	fallback?: ReactNode;
}

interface ErrorBoundaryState {
	hasError: boolean;
	error: Error | null;
}

export class ErrorBoundary extends Component<
	ErrorBoundaryProps,
	ErrorBoundaryState
> {
	constructor(props: ErrorBoundaryProps) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo) {
		console.error("ErrorBoundary caught:", error, errorInfo);
	}

	render() {
		if (this.state.hasError) {
			if (this.props.fallback) {
				return this.props.fallback;
			}

			return (
				<div className="page-wrap px-4 py-20 text-center">
					<div className="island-shell mx-auto max-w-md rounded-xl p-8">
						<AlertTriangle className="mx-auto mb-4 size-10 text-[var(--lagoon-deep)]" />

						<h1 className="mb-2 text-lg font-semibold text-[var(--sea-ink)]">
							Something went wrong
						</h1>
						<p className="mb-6 text-sm text-[var(--sea-ink-soft)]">
							{this.state.error?.message || "An unexpected error occurred"}
						</p>
						<button
							type="button"
							onClick={() => {
								this.setState({ hasError: false, error: null });
								window.location.reload();
							}}
							className="inline-flex h-9 items-center rounded-lg bg-[var(--lagoon-deep)] px-4 text-sm font-medium text-white transition hover:opacity-90"
						>
							Try again
						</button>
					</div>
				</div>
			);
		}

		return this.props.children;
	}
}
