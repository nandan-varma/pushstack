import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
	return {
		nav: { title: "PushStack Docs", url: "/docs" },
		githubUrl: "https://github.com/nandan-varma/pushstack",
	};
}
