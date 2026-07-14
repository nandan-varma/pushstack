import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

// The router commits the URL (history.pushState) before route loaders
// resolve, so without this the address bar updates instantly while the page
// itself appears frozen until data arrives. Delay showing the bar briefly so
// fast (cached) navigations don't flash it.
const SHOW_DELAY_MS = 120;

export function RouteLoadingBar() {
	const isPending = useRouterState({
		select: (state) => state.status === "pending",
	});
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		if (!isPending) {
			setVisible(false);
			return;
		}
		const timer = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
		return () => clearTimeout(timer);
	}, [isPending]);

	if (!visible) return null;

	return (
		<div
			className="route-loading-bar fixed inset-x-0 top-0 z-[60]"
			role="status"
			aria-label="Loading"
		>
			<div className="route-loading-bar__fill" />
		</div>
	);
}
