import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { Brand } from "@/components/shell/AppShell";
import { getSession } from "@/lib/auth-session";

export const Route = createFileRoute("/auth")({
	component: AuthLayout,
	beforeLoad: async () => {
		const session = await getSession();
		if (session?.user) {
			throw redirect({ to: "/dashboard" });
		}
	},
});

const points = [
	"Git over HTTPS with personal access tokens",
	"Issues, pull requests and reviews in a split-view inbox",
	"GitHub's REST API shapes, so your scripts keep working",
];

/**
 * Sign-in, sign-up and recovery: the form alone on the left, and on wide
 * screens a quiet panel saying what you're signing into.
 */
function AuthLayout() {
	return (
		<div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
			<div className="flex flex-col px-6 py-6 sm:px-10">
				<Brand />
				<div className="flex flex-1 items-center justify-center py-10">
					<Outlet />
				</div>
			</div>
			<aside className="relative hidden overflow-hidden border-l border-bjork-border-muted bg-bjork-panel lg:flex lg:flex-col lg:justify-center lg:px-16">
				<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_70%_20%,var(--bjork-accent-soft),transparent)]" />
				<div className="relative max-w-md">
					<h2 className="text-3xl font-semibold tracking-[-0.035em] text-bjork-text">
						A forge that speaks GitHub.
					</h2>
					<ul className="mt-6 space-y-3">
						{points.map((point) => (
							<li
								key={point}
								className="flex items-start gap-3 text-[15px] leading-6 text-bjork-text-muted"
							>
								<Check
									aria-hidden="true"
									className="mt-1 size-4 shrink-0 text-success"
								/>
								{point}
							</li>
						))}
					</ul>
					<pre className="mt-8 overflow-x-auto rounded-[14px] border border-bjork-border bg-bjork-field-inset px-4 py-3 font-mono text-[12.5px] leading-6 text-bjork-text-strong shadow-(--bjork-shadow-inset)">
						<span className="text-bjork-text-soft">$</span> git push pushstack
						main{"\n"}
						<span className="text-success">✓</span> main → main
					</pre>
				</div>
			</aside>
		</div>
	);
}
