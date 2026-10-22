import { Link, useNavigate } from "@tanstack/react-router";
import { GitBranch, Menu, Search, X } from "lucide-react";
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
			className={`relative ${className ?? ""}`}
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
			<Search
				aria-hidden="true"
				className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground"
			/>
			<input
				ref={inputRef}
				type="search"
				value={value}
				onChange={(e) => setValue(e.target.value)}
				placeholder="Search repositories…"
				aria-label="Search repositories and users"
				className="h-10 w-full rounded-[13px] border border-border bg-card pl-9 pr-3 shadow-[var(--bjork-shadow-inset)] text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary"
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
		<header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-xl">
			<div className="page-wrap flex h-[72px] items-center gap-6">
				<Link
					to="/"
					className="inline-flex shrink-0 items-center gap-2.5 text-base font-semibold tracking-tight text-foreground no-underline"
					aria-label="Home"
				>
					<span className="flex size-9 items-center justify-center rounded-[13px] border border-primary/20 bg-primary/10 text-primary shadow-[var(--bjork-shadow-soft)]">
						<GitBranch aria-hidden="true" className="size-5" />
					</span>
					PushStack
				</Link>

				<nav
					className="hidden items-center gap-5 text-sm font-semibold md:flex"
					aria-label="Main navigation"
				>
					{navLinks.map(({ to, label }) => (
						<Link
							key={to}
							to={to}
							className="nav-link"
							activeOptions={{ exact: to === "/" }}
							activeProps={{ className: "nav-link is-active" }}
						>
							{label}
						</Link>
					))}
				</nav>

				<div className="flex flex-1 justify-end">
					<SearchBox
						className="hidden w-full max-w-xs md:block"
						inputRef={searchInputRef}
					/>
				</div>

				<div className="flex items-center gap-2">
					<AccountControl />
					<ThemeToggle />
					<Button
						variant="outline"
						size="icon"
						className="h-8 w-8 md:hidden"
						onClick={() => setMenuOpen(!menuOpen)}
						aria-label={menuOpen ? "Close menu" : "Open menu"}
						aria-expanded={menuOpen}
					>
						{menuOpen ? (
							<X aria-hidden="true" className="h-5 w-5" />
						) : (
							<Menu aria-hidden="true" className="h-5 w-5" />
						)}
					</Button>
				</div>
			</div>

			{menuOpen && (
				<nav
					className="border-t border-border bg-background px-4 py-3 md:hidden"
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
