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

const SITE_URL = "https://pushstack.dev";
const SITE_TITLE = "PushStack - Code Hosting, Reimagined";
const SITE_DESCRIPTION =
	"A modern code hosting platform with full Git support, issue tracking, pull requests, and cloud-native storage.";
const OG_IMAGE = `${SITE_URL}/og-image.png`;

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
				title: SITE_TITLE,
			},
			{
				name: "description",
				content: SITE_DESCRIPTION,
			},
			{
				name: "theme-color",
				content: "#0b7a70",
			},
			{
				property: "og:type",
				content: "website",
			},
			{
				property: "og:title",
				content: SITE_TITLE,
			},
			{
				property: "og:description",
				content: SITE_DESCRIPTION,
			},
			{
				property: "og:url",
				content: SITE_URL,
			},
			{
				property: "og:image",
				content: OG_IMAGE,
			},
			{
				property: "og:image:width",
				content: "1200",
			},
			{
				property: "og:image:height",
				content: "630",
			},
			{
				property: "og:site_name",
				content: "PushStack",
			},
			{
				name: "twitter:card",
				content: "summary_large_image",
			},
			{
				name: "twitter:title",
				content: SITE_TITLE,
			},
			{
				name: "twitter:description",
				content: SITE_DESCRIPTION,
			},
			{
				name: "twitter:image",
				content: OG_IMAGE,
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
			{
				rel: "icon",
				type: "image/svg+xml",
				href: "/favicon.svg",
			},
			{
				rel: "icon",
				type: "image/x-icon",
				href: "/favicon.ico",
			},
			{
				rel: "apple-touch-icon",
				sizes: "180x180",
				href: "/apple-touch-icon.png",
			},
			{
				rel: "manifest",
				href: "/manifest.json",
			},
			{
				rel: "canonical",
				href: SITE_URL,
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
