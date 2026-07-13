import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	type ErrorComponentProps,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import type { ReactNode } from "react";
import Footer from "../components/Footer";
import Header from "../components/Header";
import { ToastProvider } from "../components/toast-provider";
import { Button } from "../components/ui/button";
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import TanStackQueryProvider from "../integrations/tanstack-query/root-provider";
import appCss from "../styles.css?url";

interface MyRouterContext {
	queryClient: QueryClient;
}

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`;

export const Route = createRootRouteWithContext<MyRouterContext>()({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "PushStack - Code Repository Platform",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
		],
	}),
	component: RootComponent,
	errorComponent: RootErrorComponent,
});

// Last-resort fallback so an unhandled error (e.g. a server function throwing
// a raw git error) renders a recoverable page instead of a blank/crashed app.
// Route-specific errorComponents (e.g. the repo layout) take precedence over this.
function RootErrorComponent({ error, reset }: ErrorComponentProps) {
	return (
		<RootDocument>
			<div className="page-wrap px-4 py-20 text-center">
				<div className="island-shell mx-auto max-w-md rounded-xl p-8">
					<h1 className="mb-2 text-lg font-semibold text-[var(--sea-ink)]">
						Something went wrong
					</h1>
					<p className="mb-6 text-sm text-[var(--sea-ink-soft)]">
						{error.message || "An unexpected error occurred."}
					</p>
					<Button
						onClick={reset}
						className="bg-[var(--lagoon-deep)] text-white opacity-100 hover:bg-[var(--lagoon-deep)] hover:opacity-90"
					>
						Try again
					</Button>
				</div>
			</div>
		</RootDocument>
	);
}

function RootComponent() {
	return (
		<RootDocument>
			<Outlet />
		</RootDocument>
	);
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: THEME_INIT_SCRIPT is a static constant (no user input) and must run synchronously pre-paint to avoid a flash of the wrong theme */}
				<script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
				<HeadContent />
			</head>
			<body className="flex min-h-screen flex-col font-sans antialiased [overflow-wrap:anywhere] selection:bg-[rgba(79,184,178,0.24)]">
				<TanStackQueryProvider>
					<ToastProvider>
						<Header />
						<div className="flex-1">{children}</div>
						<Footer />
					</ToastProvider>
					{import.meta.env.DEV && (
						<TanStackDevtools
							config={{
								position: "bottom-right",
							}}
							plugins={[
								{
									name: "Tanstack Router",
									render: <TanStackRouterDevtoolsPanel />,
								},
								TanStackQueryDevtools,
							]}
						/>
					)}
				</TanStackQueryProvider>
				<Scripts />
			</body>
		</html>
	);
}
