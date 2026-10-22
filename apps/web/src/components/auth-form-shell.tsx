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
		<div className="w-full max-w-sm">
			<div className="island-shell w-full rounded-[24px] px-6 py-8">
				<div className="mb-6 text-center">
					{showBranding && (
						<div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
							<span className="text-sm font-bold text-primary-foreground">
								P
							</span>
						</div>
					)}
					<h1 className="text-2xl font-semibold tracking-tight text-foreground">
						{title}
					</h1>
					{subtitle && (
						<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
							{subtitle}
						</p>
					)}
				</div>
				{children}
			</div>
			{footer && (
				<p className="mt-4 text-center text-sm text-muted-foreground">
					{footer}
				</p>
			)}
		</div>
	);
}
