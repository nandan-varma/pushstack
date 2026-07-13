import { AlertTriangle } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

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
						<Button
							onClick={() => {
								this.setState({ hasError: false, error: null });
								window.location.reload();
							}}
							className="bg-[var(--lagoon-deep)] text-white opacity-100 hover:bg-[var(--lagoon-deep)] hover:opacity-90"
						>
							Try again
						</Button>
					</div>
				</div>
			);
		}

		return this.props.children;
	}
}
