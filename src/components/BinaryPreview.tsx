import { useId } from "react";
import { useBinaryObjectUrl } from "@/lib/binary-preview";
import type { PreviewKind } from "@/lib/language-detection";

export function BinaryPreview({
	data,
	mimeType,
	previewKind,
	fileName,
}: {
	data: string;
	mimeType: string;
	previewKind: PreviewKind;
	fileName: string;
}) {
	const objectUrl = useBinaryObjectUrl(data, mimeType);
	const fontFamilyId = useId().replace(/[^a-zA-Z0-9]/g, "");

	if (!objectUrl) return null;

	switch (previewKind) {
		case "image":
			return (
				<div className="flex justify-center bg-[var(--chip-bg)] rounded-md p-4">
					<img
						src={objectUrl}
						alt={fileName}
						className="max-w-full max-h-[75vh] object-contain"
					/>
				</div>
			);
		case "pdf":
			return (
				<embed
					src={objectUrl}
					type="application/pdf"
					className="w-full rounded-md border border-[var(--line)]"
					style={{ height: "80vh" }}
				/>
			);
		case "audio":
			return (
				<div className="p-4">
					{/* biome-ignore lint/a11y/useMediaCaption: repo file, no caption track available */}
					<audio controls src={objectUrl} className="w-full" />
				</div>
			);
		case "video":
			return (
				<div className="flex justify-center bg-[var(--chip-bg)] rounded-md p-4">
					{/* biome-ignore lint/a11y/useMediaCaption: repo file, no caption track available */}
					<video controls src={objectUrl} className="max-w-full max-h-[75vh]" />
				</div>
			);
		case "font":
			return (
				<div className="p-4">
					<style>{`@font-face { font-family: "preview-${fontFamilyId}"; src: url(${objectUrl}); }`}</style>
					<div
						style={{ fontFamily: `preview-${fontFamilyId}` }}
						className="space-y-2 text-[var(--sea-ink)]"
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
