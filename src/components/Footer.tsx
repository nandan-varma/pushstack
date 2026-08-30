import { Link } from "@tanstack/react-router";

export default function Footer() {
	const year = new Date().getFullYear();

	return (
		<footer className="border-t border-border bg-muted/30 px-4 py-8 text-muted-foreground sm:py-10">
			<div className="page-wrap flex flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
				<p className="m-0 text-sm">
					&copy; {year} PushStack. All rights reserved.
				</p>
				<nav className="flex items-center gap-4 text-sm" aria-label="Footer">
					<Link to="/about" className="hover:text-foreground">
						About
					</Link>
				</nav>
			</div>
		</footer>
	);
}
