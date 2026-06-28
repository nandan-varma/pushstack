import { Link } from "@tanstack/react-router";
import BetterAuthHeader from "../integrations/better-auth/header-user.tsx";
import ThemeToggle from "./ThemeToggle";

export default function Header() {
	return (
		<header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--header-bg)] backdrop-blur-lg">
			<div className="page-wrap flex h-14 items-center gap-5 px-4">
				<Link
					to="/"
					className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1.5 text-sm font-semibold text-[var(--sea-ink)] no-underline shadow-sm transition hover:shadow-md"
				>
					<span className="h-2 w-2 rounded-full bg-[linear-gradient(90deg,#56c6be,#7ed3bf)]" />
					PushStack
				</Link>

				<nav className="hidden items-center gap-5 text-sm font-semibold sm:flex">
					<Link
						to="/"
						className="nav-link"
						activeProps={{ className: "nav-link is-active" }}
					>
						Home
					</Link>
					<Link
						to="/dashboard"
						className="nav-link"
						activeProps={{ className: "nav-link is-active" }}
					>
						Dashboard
					</Link>
					<Link
						to="/repositories"
						className="nav-link"
						activeProps={{ className: "nav-link is-active" }}
					>
						Repositories
					</Link>
				</nav>

				<div className="flex-1" />

				<div className="flex items-center gap-2">
					<BetterAuthHeader />
					<ThemeToggle />
				</div>
			</div>
		</header>
	);
}
