import { MenuIcon } from "@animateicons/react/lucide";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useRouterState } from "@tanstack/react-router";
import { GitBranch } from "lucide-react";
import { type ReactNode, useState } from "react";
import Footer from "@/components/Footer";
import { Button, buttonVariants } from "@/components/ui/button";
import { authSessionQueryOptions } from "@/lib/query-options";
import { Sidebar } from "./Sidebar";

/** Landing, about and sign-in pages are full-bleed; everything else is the app. */
function isMarketingPath(pathname: string) {
	return (
		pathname === "/" || pathname === "/about" || pathname.startsWith("/auth")
	);
}

/**
 * The application frame. On wide screens a sticky sidebar holds every way to
 * move around, so pages start at the top of the viewport with no header band.
 * On phones the same sidebar opens as a drawer from a slim top bar.
 */
export function AppShell({ children }: { children: ReactNode }) {
	// The URL changes before loaders finish. Use the committed matches so the
	// current page keeps its frame until the destination renders with its own.
	const pathname = useRouterState({
		select: (s) => s.matches[s.matches.length - 1]?.pathname ?? "/",
	});
	const [drawerOpen, setDrawerOpen] = useState(false);
	const { owner, name } = useParams({ strict: false });

	// Sign-in pages bring their own full-screen layout (routes/auth.tsx).
	if (pathname.startsWith("/auth")) {
		return (
			<main id="main-content" className="flex min-w-0 flex-1 flex-col">
				{children}
			</main>
		);
	}

	if (isMarketingPath(pathname)) {
		return (
			<>
				<MarketingBar />
				<main id="main-content" className="flex min-w-0 flex-1 flex-col">
					{children}
				</main>
				<Footer />
			</>
		);
	}

	return (
		<div className="flex min-h-screen flex-1 flex-col lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
			<aside className="sticky top-0 hidden h-screen border-r border-bjork-border-muted bg-bjork-panel lg:block">
				<Sidebar />
			</aside>

			<header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-bjork-border-muted bg-bjork-bg/90 px-4 backdrop-blur-xl lg:hidden">
				<DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
					<DialogPrimitive.Trigger
						render={
							<Button
								variant="ghost"
								size="icon"
								aria-label="Open navigation"
							/>
						}
					>
						<MenuIcon size={18} aria-hidden="true" />
					</DialogPrimitive.Trigger>
					<DialogPrimitive.Portal>
						<DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/50 transition-opacity duration-300 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
						<DialogPrimitive.Popup
							aria-label="Navigation"
							className="fixed inset-y-0 left-0 z-50 w-[min(300px,86vw)] border-r border-bjork-border bg-bjork-panel shadow-(--bjork-shadow-menu) transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] data-[ending-style]:-translate-x-full data-[starting-style]:-translate-x-full"
						>
							<Sidebar onNavigate={() => setDrawerOpen(false)} />
						</DialogPrimitive.Popup>
					</DialogPrimitive.Portal>
				</DialogPrimitive.Root>
				{owner && name ? (
					// Inside a repository the bar says which one: the sidebar
					// that would is folded away in the drawer.
					<Link
						to="/$owner/$name"
						params={{ owner, name }}
						className="min-w-0 truncate text-[15px] text-bjork-text-soft"
					>
						{owner} /{" "}
						<span className="font-semibold text-bjork-text">{name}</span>
					</Link>
				) : (
					<Brand />
				)}
			</header>

			<main id="main-content" className="app-main flex min-w-0 flex-col">
				{children}
			</main>
		</div>
	);
}

export function Brand() {
	return (
		<Link
			to="/"
			className="inline-flex items-center gap-2 text-[15px] font-semibold tracking-[-0.02em] text-bjork-text"
		>
			<span className="flex size-7 items-center justify-center rounded-[9px] bg-bjork-accent-fill text-white shadow-(--bjork-shadow-soft)">
				<GitBranch aria-hidden="true" className="size-4" />
			</span>
			PushStack
		</Link>
	);
}

/** The landing pages' top bar: brand, and the way in (or back to work). */
function MarketingBar() {
	const { data: session } = useQuery(authSessionQueryOptions());
	const signedIn = Boolean(session?.user);
	return (
		<header className="sticky top-0 z-40 border-b border-bjork-border-muted bg-bjork-bg/85 backdrop-blur-xl">
			<div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-6">
				<Brand />
				<nav aria-label="Main" className="flex items-center gap-1 text-sm">
					<Link
						to="/search"
						search={{ q: undefined, type: undefined }}
						className="hidden rounded-[10px] px-3 py-2 text-bjork-text-muted hover:text-bjork-text sm:inline-flex"
					>
						Explore
					</Link>
					<Link
						to="/about"
						className="hidden rounded-[10px] px-3 py-2 text-bjork-text-muted hover:text-bjork-text sm:inline-flex"
					>
						About
					</Link>
					{signedIn ? (
						<Link to="/dashboard" className={buttonVariants()}>
							Open dashboard
						</Link>
					) : (
						<>
							<Link
								to="/auth/login"
								className={buttonVariants({ variant: "ghost" })}
							>
								Sign in
							</Link>
							<Link to="/auth/register" className={buttonVariants()}>
								Get started
							</Link>
						</>
					)}
				</nav>
			</div>
		</header>
	);
}
