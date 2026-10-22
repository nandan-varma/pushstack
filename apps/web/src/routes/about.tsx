import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/about")({
	component: About,
});

function About() {
	return (
		<div className="page-wrap py-6 sm:py-8">
			<section className="island-shell rounded-[20px] p-5 sm:p-6">
				<p className="island-kicker mb-2">About</p>
				<h1 className="mb-3 max-w-3xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
					Modern code hosting, simplified.
				</h1>
				<p className="m-0 max-w-3xl text-base leading-7 text-muted-foreground">
					PushStack is a modern code repository platform that makes it easy to
					manage your code, collaborate with your team, and ship with
					confidence. Built with modern web technologies for speed and
					reliability.
				</p>
			</section>
		</div>
	);
}
