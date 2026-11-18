import { createFileRoute, Outlet } from "@tanstack/react-router";

/** The discussions list and its thread are two pages under one path. */
export const Route = createFileRoute("/$owner/$name/discussions")({
	component: Outlet,
});
