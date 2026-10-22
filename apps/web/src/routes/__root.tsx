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
import { type ReactNode, useEffect } from "react";
import { ErrorPanel } from "../components/ErrorPanel";
import Footer from "../components/Footer";
import Header from "../components/Header";
import { RouteLoadingBar } from "../components/RouteLoadingBar";
import { ToastProvider } from "../components/toast-provider";
import { Button } from "../components/ui/button";
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import TanStackQueryProvider from "../integrations/tanstack-query/root-provider";
import { SITE_DESCRIPTION, SITE_TITLE, SITE_URL } from "../lib/site";
import { THEME_INIT_SCRIPT } from "../lib/theme";
import appCss from "../styles.css?url";

interface MyRouterContext {
	queryClient: QueryClient;
}

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
				content: "#111111",
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
		],
	}),
	component: RootComponent,
	errorComponent: RootErrorComponent,
});

function RootErrorComponent({ error, reset }: ErrorComponentProps) {
	// Middleware in src/start.ts covers thrown server-function/request errors,
	// but not exceptions raised during route rendering (SSR or client) — this
	// boundary is the only place those are otherwise seen.
	useEffect(() => {
		if (import.meta.env.VITE_SENTRY_DSN) {
			void import("@sentry/tanstackstart-react").then((Sentry) =>
				Sentry.captureException(error),
			);
		}
	}, [error]);

	return (
		<RootDocument>
			<div className="page-wrap py-12 text-center">
				<ErrorPanel
					title="Something went wrong"
					description="An unexpected error interrupted this page."
					detail={error instanceof Error ? error.message : undefined}
					actions={<Button onClick={reset}>Try again</Button>}
				/>
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
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: THEME_INIT_SCRIPT is a build-time constant from lib/theme.ts (no user input), and the Content-Security-Policy allows this exact script by hash — see server/csp.ts */}
				<script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
				<HeadContent />
			</head>
			<body className="flex min-h-screen flex-col font-sans antialiased [overflow-wrap:anywhere] selection:bg-primary/20">
				<a
					href="#main-content"
					className="sr-only z-[60] rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
				>
					Skip to content
				</a>
				<RouteLoadingBar />
				<TanStackQueryProvider>
					<ToastProvider>
						<Header />
						<main id="main-content" className="flex min-w-0 flex-1 flex-col">
							{children}
						</main>
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
