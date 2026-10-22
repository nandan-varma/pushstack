import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LoadingButton } from "@/components/ui/loading-button";
import { Textarea } from "@/components/ui/textarea";

export function CommentForm({
	value,
	onChange,
	onSubmit,
	isPending,
	disabled,
}: {
	value: string;
	onChange: (value: string) => void;
	onSubmit: () => void;
	isPending?: boolean;
	disabled?: boolean;
}) {
	return (
		<Card className="rounded-[20px] p-5 sm:p-6">
			<h3
				id="comment-form-heading"
				className="mb-4 text-base font-semibold tracking-tight text-foreground"
			>
				Add a Comment
			</h3>
			<div className="space-y-4">
				<Textarea
					aria-labelledby="comment-form-heading"
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder="Share your thoughts…"
					rows={6}
				/>
				<div className="flex flex-wrap items-center justify-between gap-3">
					<p className="text-xs text-muted-foreground">Markdown supported.</p>
					<LoadingButton
						onClick={onSubmit}
						disabled={!value.trim() || disabled}
						isLoading={isPending}
						loadingLabel="Posting…"
					>
						Post Comment
					</LoadingButton>
				</div>
			</div>
		</Card>
	);
}

export function SignInToComment() {
	return (
		<Card className="flex flex-wrap items-center justify-between gap-3 p-6">
			<p className="text-sm text-muted-foreground">
				Sign in to join this conversation.
			</p>
			<div className="flex gap-2">
				<Button size="sm" asChild>
					<Link to="/auth/register">Sign up</Link>
				</Button>
				<Button size="sm" variant="outline" asChild>
					<Link to="/auth/login">Sign in</Link>
				</Button>
			</div>
		</Card>
	);
}
