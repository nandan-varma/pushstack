import {
	BellIcon,
	CompassIcon,
	FolderOpenIcon,
	LayoutDashboardIcon,
	PlusIcon,
} from "@animateicons/react/lucide";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { GitBranch, Search } from "lucide-react";
import {
	type ComponentType,
	type RefObject,
	useEffect,
	useRef,
	useState,
} from "react";
import ThemeToggle from "@/components/ThemeToggle";
import {
	authSessionQueryOptions,
	unreadNotificationCountQueryOptions,
} from "@/lib/query-options";
import { RepoNav } from "./RepoNav";
import { SidebarGroup, SidebarLink } from "./SidebarLink";

/**
 * The account menu pulls in the auth client and menu primitives; anonymous
 * SSR pages shouldn't pay for them, so it loads after hydration.
 */
function AccountSlot() {
	const [AccountMenu, setAccountMenu] = useState<ComponentType | null>(null);
	useEffect(() => {
		let mounted = true;
		void import("../../integrations/better-auth/header-user.tsx").then(
			({ default: component }) => {
				if (mounted) setAccountMenu(() => component);
			},
		);
		return () => {
			mounted = false;
		};
	}, []);
	return AccountMenu ? <AccountMenu /> : <div className="h-11" />;
}

function SidebarSearch({
	inputRef,
	onSubmitted,
}: {
	inputRef: RefObject<HTMLInputElement | null>;
	onSubmitted?: () => void;
}) {
	const navigate = useNavigate();
	const [value, setValue] = useState("");
	return (
		<form
			role="search"
			className="relative"
			onSubmit={(event) => {
				event.preventDefault();
				const q = value.trim();
				if (!q) return;
				navigate({ to: "/search", search: { q, type: undefined } });
				setValue("");
				inputRef.current?.blur();
				onSubmitted?.();
			}}
		>
			<Search
				aria-hidden="true"
				className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-bjork-text-soft"
			/>
			<input
				ref={inputRef}
				type="search"
				value={value}
				onChange={(e) => setValue(e.target.value)}
				placeholder="Search"
				aria-label="Search repositories and users"
				className="h-9 w-full rounded-[11px] border border-bjork-border bg-bjork-field-inset pr-9 pl-9 text-sm text-bjork-text shadow-(--bjork-shadow-inset) outline-none placeholder:text-bjork-text-soft focus:border-bjork-border-strong"
			/>
			<kbd className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded-[5px] [@media(hover:hover)]:block border border-bjork-border px-1.5 font-mono text-[10px] text-bjork-text-soft">
				/
			</kbd>
		</form>
	);
}

/** Global navigation, the open repository's navigation, and the account. */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
	const { owner, name } = useParams({ strict: false });
	const { data: session } = useQuery(authSessionQueryOptions());
	const signedIn = Boolean(session?.user);
	const { data: unread = 0 } = useQuery({
		...unreadNotificationCountQueryOptions(),
		enabled: signedIn,
	});
	const searchRef = useRef<HTMLInputElement | null>(null);

	// "/" focuses search from anywhere that isn't already a text field.
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
			searchRef.current?.focus();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, []);

	return (
		<nav
			aria-label="Main"
			// Any link click inside closes the mobile drawer.
			onClickCapture={(event) => {
				if ((event.target as HTMLElement).closest("a")) onNavigate?.();
			}}
			className="flex h-full flex-col gap-5 overflow-y-auto px-3 pt-4 pb-3"
		>
			<div className="flex items-center justify-between px-1">
				<Link
					to={signedIn ? "/dashboard" : "/"}
					className="inline-flex items-center gap-2 text-[15px] font-semibold tracking-[-0.02em] text-bjork-text"
				>
					<span className="flex size-7 items-center justify-center rounded-[9px] bg-bjork-accent-fill text-white shadow-(--bjork-shadow-soft)">
						<GitBranch aria-hidden="true" className="size-4" />
					</span>
					PushStack
				</Link>
				<ThemeToggle />
			</div>

			<SidebarSearch inputRef={searchRef} onSubmitted={onNavigate} />

			<SidebarGroup>
				{signedIn ? (
					<>
						<SidebarLink
							to="/dashboard"
							icon={LayoutDashboardIcon}
							label="Dashboard"
						/>
						<SidebarLink
							to="/repositories"
							icon={FolderOpenIcon}
							label="Repositories"
							activeOptions={{ exact: true }}
						/>
						<SidebarLink
							to="/notifications"
							icon={BellIcon}
							label="Notifications"
							count={unread}
						/>
						<SidebarLink
							to="/repositories/new"
							icon={PlusIcon}
							label="New repository"
						/>
					</>
				) : (
					<SidebarLink
						to="/search"
						search={{ q: undefined, type: undefined }}
						icon={CompassIcon}
						label="Explore"
					/>
				)}
			</SidebarGroup>

			{owner && name && (
				<div className="border-t border-bjork-border-muted pt-4">
					<RepoNav owner={owner} name={name} />
				</div>
			)}

			<div className="mt-auto space-y-2 border-t border-bjork-border-muted pt-3">
				<AccountSlot />
				<div className="flex items-center gap-3 px-2 text-[11px] text-bjork-text-soft">
					<Link to="/about" className="hover:text-bjork-text">
						About
					</Link>
					<span aria-hidden="true">·</span>
					<a
						href="https://docs.git.nandan.fyi"
						className="hover:text-bjork-text"
					>
						Docs
					</a>
				</div>
			</div>
		</nav>
	);
}
