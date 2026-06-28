import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/about")({
	component: About,
});

function About() {
	return (
		<main className="page-wrap px-4 py-12">
			<section className="island-shell rounded-2xl p-6 sm:p-8">
				<p className="island-kicker mb-2">About</p>
				<h1 className="display-title mb-3 text-4xl font-bold text-[var(--sea-ink)] sm:text-5xl">
					Modern code hosting, simplified.
				</h1>
				<p className="m-0 max-w-3xl text-base leading-8 text-[var(--sea-ink-soft)]">
					PushStack is a modern code repository platform that makes it easy to
					manage your code, collaborate with your team, and ship with
					confidence. Built with modern web technologies for speed and
					reliability.
				</p>
			</section>
		</main>
	);
}
