/** Shared treatment for route links and state filters; each keeps its native semantics. */
export const segmentedItemClassName =
	"inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-2 rounded-[13px] px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&.active]:bg-accent [&.active]:text-foreground [&.active]:shadow-[var(--bjork-shadow-soft)] aria-pressed:bg-accent aria-pressed:text-foreground aria-pressed:shadow-[var(--bjork-shadow-soft)]";

export const segmentedRailClassName =
	"island-shell flex max-w-full items-center gap-1 overflow-x-auto rounded-[16px] p-0.5";
