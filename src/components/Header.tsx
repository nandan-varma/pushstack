import { Link, useNavigate } from "@tanstack/react-router";
import { type ComponentType, useEffect, useRef, useState } from "react";
import ThemeToggle from "./ThemeToggle";
import { Button } from "./ui/button";

/**
 * The account control contains the full authenticated dropdown implementation.
 * It is useful after interaction, but it must not make every anonymous Git
 * page initialize its menu primitives and auth client during SSR. Render the
 * stable sign-in affordance first, then replace it after hydration.
 */
function AccountControl() {
	const [AccountMenu, setAccountMenu] = useState<ComponentType | null>(null);

	useEffect(() => {
		let mounted = true;
		void import("../integrations/better-auth/header-user.tsx").then(
			({ default: component }) => {
				if (mounted) setAccountMenu(() => component);
			},
		);
		return () => {
			mounted = false;
		};
	}, []);

	return AccountMenu ? (
		<AccountMenu />
	) : (
		<Link
			to="/auth/login"
			className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground no-underline transition hover:border-primary"
		>
			Sign in
		</Link>
	);
}

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
				className="h-8 w-full rounded-full border border-border bg-muted px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary"
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
		<header className="sticky top-0 z-50 border-b border-border bg-background">
			<div className="page-wrap flex h-14 items-center gap-5 px-4">
				<Link
					to="/"
					className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-muted px-3 py-1.5 text-sm font-semibold text-foreground no-underline shadow-sm transition hover:shadow-md"
					aria-label="Home"
				>
					<span className="h-2 w-2 rounded-full bg-primary" />
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
					<AccountControl />
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
					className="border-t border-border bg-background px-4 py-3 sm:hidden"
					aria-label="Mobile navigation"
				>
					<div className="flex flex-col gap-2">
						<SearchBox onSubmitted={() => setMenuOpen(false)} />
						{navLinks.map(({ to, label }) => (
							<Link
								key={to}
								to={to}
								className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-card hover:text-foreground"
								activeProps={{
									className:
										"rounded-lg px-3 py-2 text-sm font-medium text-primary bg-card",
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
