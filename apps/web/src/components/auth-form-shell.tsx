import type { ReactNode } from "react";

export function AuthFormShell({
	title,
	subtitle,
	children,
	footer,
}: {
	title: string;
	subtitle?: string;
	children: ReactNode;
	footer?: ReactNode;
}) {
	return (
		<div className="w-full max-w-[380px]">
			<div className="mb-7">
				<h1 className="text-[28px] font-semibold tracking-[-0.03em] text-bjork-text">
					{title}
				</h1>
				{subtitle && (
					<p className="mt-2 text-sm leading-6 text-bjork-text-muted">
						{subtitle}
					</p>
				)}
			</div>
			{children}
			{footer && <p className="mt-6 text-sm text-bjork-text-muted">{footer}</p>}
		</div>
	);
}
