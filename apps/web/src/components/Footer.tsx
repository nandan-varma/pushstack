import { Link } from "@tanstack/react-router";

export default function Footer() {
	const year = new Date().getFullYear();

	return (
		<footer className="border-t border-border bg-background py-8 text-muted-foreground sm:py-9">
			<div className="page-wrap flex flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
				<p className="m-0 text-sm">
					PushStack{" "}
					<span className="mx-2 text-border" aria-hidden="true">
						/
					</span>{" "}
					A focused home for your code.{" "}
					<span className="ml-2">&copy; {year}</span>
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
