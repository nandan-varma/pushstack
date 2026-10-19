import { useEffect, useId, useState } from "react";
import { Section } from "@/components/Section";
import { Switch } from "@/components/ui/switch";
import { isPerfLogEnabled, setPerfLogEnabled } from "@/lib/perf-log";

export function DeveloperSection() {
	const id = useId();
	// Read after mount: the value lives in this browser's localStorage, which
	// the server render can't see.
	const [enabled, setEnabled] = useState(false);
	useEffect(() => setEnabled(isPerfLogEnabled()), []);

	const isDev = import.meta.env.DEV;

	return (
		<Section title="Developer" description="Diagnostics for this browser only.">
			<div className="flex items-start justify-between gap-4">
				<label htmlFor={id} className="space-y-0.5">
					<span className="block text-sm font-medium text-foreground">
						Performance logs in the browser console
					</span>
					<span className="block text-xs text-muted-foreground">
						{isDev
							? "Always on in development."
							: "Timing for page loaders and data requests. Off by default."}
					</span>
				</label>
				<Switch
					id={id}
					checked={enabled}
					disabled={isDev}
					onCheckedChange={(checked) => {
						setPerfLogEnabled(checked);
						setEnabled(checked);
					}}
				/>
			</div>
		</Section>
	);
}
