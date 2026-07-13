import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
		<Card className="p-6">
			<h3 className="text-lg font-semibold text-[var(--sea-ink)] mb-4">
				Add a Comment
			</h3>
			<div className="space-y-4">
				<Textarea
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder="Write your comment here... (Markdown supported)"
					rows={6}
				/>
				<div className="flex justify-end">
					<Button
						onClick={onSubmit}
						disabled={!value.trim() || isPending || disabled}
					>
						{isPending ? "Posting..." : "Post Comment"}
					</Button>
				</div>
			</div>
		</Card>
	);
}
