import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authSessionQueryOptions } from "@/lib/query-options";

export function GuestSignupBanner({ repoLabel }: { repoLabel: string }) {
	const { data: session, isPending } = useQuery(authSessionQueryOptions());
	const [dismissed, setDismissed] = useState(false);
	if (isPending || session?.user || dismissed) return null;

	return (
		<div className="mb-6 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center">
			<span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
				<Sparkles className="size-4" />
			</span>
			<p className="flex-1 text-sm text-muted-foreground">
				<span className="font-medium text-foreground">
					You're exploring {repoLabel} on PushStack.
				</span>{" "}
				Like what you see? Host your own repositories with issues and pull
				requests, free.
			</p>
			<div className="flex shrink-0 items-center gap-2">
				<Button size="sm" asChild>
					<Link to="/auth/register">
						Create account <ArrowRight className="size-3.5" />
					</Link>
				</Button>
				<Button size="sm" variant="ghost" asChild>
					<Link to="/auth/login">Sign in</Link>
				</Button>
				<Button
					size="icon"
					variant="ghost"
					className="size-8"
					aria-label="Dismiss"
					onClick={() => setDismissed(true)}
				>
					<X className="size-4" />
				</Button>
			</div>
		</div>
	);
}
