import { MonitorIcon, MoonIcon, SunIcon } from "@animateicons/react/lucide";
import { useEffect, useState } from "react";
import { useIconAnimation } from "@/components/animated-icon";
import { Button } from "@/components/ui/button";

type ThemeMode = "light" | "dark" | "auto";

function getInitialMode(): ThemeMode {
	if (typeof window === "undefined") {
		return "dark";
	}

	const stored = window.localStorage.getItem("theme");
	if (stored === "light" || stored === "dark" || stored === "auto") {
		return stored;
	}

	return "dark";
}

function applyThemeMode(mode: ThemeMode) {
	const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
	const resolved = mode === "auto" ? (prefersDark ? "dark" : "light") : mode;

	document.documentElement.classList.remove("light", "dark");
	document.documentElement.classList.add(resolved);

	if (mode === "auto") {
		document.documentElement.removeAttribute("data-theme");
	} else {
		document.documentElement.setAttribute("data-theme", mode);
	}

	document.documentElement.style.colorScheme = resolved;
}

export default function ThemeToggle() {
	const [mode, setMode] = useState<ThemeMode>("dark");
	const { ref, triggerProps } = useIconAnimation<HTMLButtonElement>();

	useEffect(() => {
		const initialMode = getInitialMode();
		setMode(initialMode);
		applyThemeMode(initialMode);
	}, []);

	useEffect(() => {
		if (mode !== "auto") {
			return;
		}

		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const onChange = () => applyThemeMode("auto");

		media.addEventListener("change", onChange);
		return () => {
			media.removeEventListener("change", onChange);
		};
	}, [mode]);

	function toggleMode() {
		const nextMode: ThemeMode =
			mode === "light" ? "dark" : mode === "dark" ? "auto" : "light";
		setMode(nextMode);
		applyThemeMode(nextMode);
		window.localStorage.setItem("theme", nextMode);
	}

	const label =
		mode === "auto"
			? "Theme: system. Switch to light."
			: mode === "light"
				? "Theme: light. Switch to dark."
				: "Theme: dark. Switch to system.";
	const Icon =
		mode === "auto" ? MonitorIcon : mode === "dark" ? MoonIcon : SunIcon;

	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-sm"
			onClick={() => {
				toggleMode();
				ref.current?.startAnimation();
			}}
			aria-label={label}
			title={label}
			className="text-bjork-text-soft hover:text-bjork-text"
			{...triggerProps}
		>
			<Icon ref={ref} size={16} aria-hidden="true" />
		</Button>
	);
}
