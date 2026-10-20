/** Black or white text, whichever reads better on `color` (hex, no `#`). */
export function labelTextColor(color: string): "#000000" | "#ffffff" {
	const r = Number.parseInt(color.slice(0, 2), 16);
	const g = Number.parseInt(color.slice(2, 4), 16);
	const b = Number.parseInt(color.slice(4, 6), 16);
	return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? "#000000" : "#ffffff";
}
