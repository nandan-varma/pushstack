import { useId } from "react";
import type { PreviewKind } from "@/lib/language-detection";

/** Renders media from `src` (the raw endpoint, or an object URL for text media). */
export function BinaryPreview({
	src,
	previewKind,
	fileName,
}: {
	src: string | null;
	previewKind: PreviewKind;
	fileName: string;
}) {
	const fontFamilyId = useId().replace(/[^a-zA-Z0-9]/g, "");

	if (!src) return null;

	switch (previewKind) {
		case "image":
			return (
				<div className="flex justify-center bg-muted rounded-md p-4">
					<img
						src={src}
						alt={fileName}
						className="max-w-full max-h-[75vh] object-contain"
					/>
				</div>
			);
		case "pdf":
			return (
				<embed
					src={src}
					type="application/pdf"
					className="w-full rounded-md border border-border"
					style={{ height: "80vh" }}
				/>
			);
		case "audio":
			return (
				<div className="p-4">
					{/* biome-ignore lint/a11y/useMediaCaption: repo file, no caption track available */}
					<audio controls src={src} className="w-full" />
				</div>
			);
		case "video":
			return (
				<div className="flex justify-center bg-muted rounded-md p-4">
					{/* biome-ignore lint/a11y/useMediaCaption: repo file, no caption track available */}
					<video controls src={src} className="max-w-full max-h-[75vh]" />
				</div>
			);
		case "font":
			return (
				<div className="p-4">
					<style>{`@font-face { font-family: "preview-${fontFamilyId}"; src: url(${src}); }`}</style>
					<div
						style={{ fontFamily: `preview-${fontFamilyId}` }}
						className="space-y-2 text-foreground"
					>
						<p className="text-2xl">
							The quick brown fox jumps over the lazy dog
						</p>
						<p className="text-lg">ABCDEFGHIJKLMNOPQRSTUVWXYZ</p>
						<p className="text-lg">abcdefghijklmnopqrstuvwxyz</p>
						<p className="text-lg">0123456789</p>
					</div>
				</div>
			);
		default:
			return null;
	}
}
