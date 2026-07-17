import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import BetterAuthHeader from "../integrations/better-auth/header-user.tsx";
import ThemeToggle from "./ThemeToggle";
import { Button } from "./ui/button";

function SearchBox({
	className,
	onSubmitted,
	inputRef,
}: {
	className?: string;
	onSubmitted?: () => void;
	inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
	const navigate = useNavigate();
	const [value, setValue] = useState("");

	return (
		<form
			className={className}
			onSubmit={(event) => {
				event.preventDefault();
				const q = value.trim();
				if (!q) return;
				navigate({ to: "/search", search: { q, type: undefined } });
				setValue("");
				inputRef?.current?.blur();
				onSubmitted?.();
			}}
		>
			<input
				ref={inputRef}
				type="search"
				value={value}
				onChange={(e) => setValue(e.target.value)}
				placeholder="Search…  ( / )"
				aria-label="Search repositories and users"
				className="h-8 w-full rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 text-sm text-[var(--sea-ink)] outline-none transition placeholder:text-[var(--sea-ink-soft)] focus:border-[var(--lagoon-deep)]"
			/>
		</form>
	);
}

export default function Header() {
	const [menuOpen, setMenuOpen] = useState(false);
	const searchInputRef = useRef<HTMLInputElement | null>(null);

	// "/" focuses the header search from anywhere that isn't already a
	// text-entry field — same affordance as GitHub.
	useEffect(() => {
		const handler = (event: KeyboardEvent) => {
			if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey)
				return;
			const target = event.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.isContentEditable)
			)
				return;
			event.preventDefault();
			searchInputRef.current?.focus();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, []);

	const navLinks = [
		{ to: "/", label: "Home" },
		{ to: "/dashboard", label: "Dashboard" },
		{ to: "/repositories", label: "Repositories" },
	] as const;

	return (
		<header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--header-bg)] backdrop-blur-lg">
			<div className="page-wrap flex h-14 items-center gap-5 px-4">
				<Link
					to="/"
					className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1.5 text-sm font-semibold text-[var(--sea-ink)] no-underline shadow-sm transition hover:shadow-md"
					aria-label="Home"
				>
					<span className="h-2 w-2 rounded-full bg-[linear-gradient(90deg,#56c6be,#7ed3bf)]" />
					PushStack
				</Link>

				<nav
					className="hidden items-center gap-5 text-sm font-semibold sm:flex"
					aria-label="Main navigation"
				>
					{navLinks.map(({ to, label }) => (
						<Link
							key={to}
							to={to}
							className="nav-link"
							activeProps={{ className: "nav-link is-active" }}
						>
							{label}
						</Link>
					))}
				</nav>

				<div className="flex flex-1 justify-end">
					<SearchBox
						className="hidden w-full max-w-xs sm:block"
						inputRef={searchInputRef}
					/>
				</div>

				<div className="flex items-center gap-2">
					<BetterAuthHeader />
					<ThemeToggle />
					<Button
						variant="outline"
						size="icon"
						className="h-8 w-8 sm:hidden"
						onClick={() => setMenuOpen(!menuOpen)}
						aria-label={menuOpen ? "Close menu" : "Open menu"}
						aria-expanded={menuOpen}
					>
						{menuOpen ? (
							<svg
								aria-hidden="true"
								className="h-5 w-5"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M6 18L18 6M6 6l12 12"
								/>
							</svg>
						) : (
							<svg
								aria-hidden="true"
								className="h-5 w-5"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M4 6h16M4 12h16M4 18h16"
								/>
							</svg>
						)}
					</Button>
				</div>
			</div>

			{/* Mobile nav */}
			{menuOpen && (
				<nav
					className="border-t border-[var(--line)] bg-[var(--header-bg)] px-4 py-3 sm:hidden"
					aria-label="Mobile navigation"
				>
					<div className="flex flex-col gap-2">
						<SearchBox onSubmitted={() => setMenuOpen(false)} />
						{navLinks.map(({ to, label }) => (
							<Link
								key={to}
								to={to}
								className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--sea-ink-soft)] transition hover:bg-[var(--surface-strong)] hover:text-[var(--sea-ink)]"
								activeProps={{
									className:
										"rounded-lg px-3 py-2 text-sm font-medium text-[var(--lagoon-deep)] bg-[var(--surface-strong)]",
								}}
								onClick={() => setMenuOpen(false)}
							>
								{label}
							</Link>
						))}
					</div>
				</nav>
			)}
		</header>
	);
}
