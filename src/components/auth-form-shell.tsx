import type { ReactNode } from "react";

export function AuthFormShell({
	title,
	subtitle,
	children,
	footer,
	showBranding = false,
}: {
	title: string;
	subtitle?: string;
	children: ReactNode;
	footer?: ReactNode;
	showBranding?: boolean;
}) {
	return (
		<div className="island-shell w-full max-w-md rounded-2xl px-8 py-10">
			<div className="mb-8 text-center">
				{showBranding && (
					<div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[linear-gradient(135deg,var(--lagoon),var(--palm))]">
						<span className="text-sm font-bold text-white">P</span>
					</div>
				)}
				<h1 className="display-title text-2xl font-bold text-[var(--sea-ink)]">
					{title}
				</h1>
				{subtitle && (
					<p className="mt-1.5 text-sm text-[var(--sea-ink-soft)]">
						{subtitle}
					</p>
				)}
			</div>
			{children}
			{footer && (
				<p className="mt-6 text-center text-sm text-[var(--sea-ink-soft)]">
					{footer}
				</p>
			)}
		</div>
	);
}
