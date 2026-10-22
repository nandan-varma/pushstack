import type { FocusEvent, MouseEvent } from "react";
import { useRef } from "react";

/** The imperative handle every `@animateicons/react` icon exposes. */
interface IconAnimationHandle {
	startAnimation: () => void;
	stopAnimation: () => void;
}

interface TriggerHandlers<E extends Element> {
	onMouseEnter?: (event: MouseEvent<E>) => void;
	onMouseLeave?: (event: MouseEvent<E>) => void;
	onFocus?: (event: FocusEvent<E>) => void;
	onBlur?: (event: FocusEvent<E>) => void;
}

/**
 * Plays an animated icon while its whole control is hovered or focused, not
 * only the glyph. Pass the control's own handlers (a router `Link` preloads on
 * them) and spread the result on it; give `ref` to the icon. The icons honour
 * `prefers-reduced-motion` themselves.
 */
export function useIconAnimation<E extends Element = HTMLElement>(
	handlers: TriggerHandlers<E> = {},
) {
	const ref = useRef<IconAnimationHandle>(null);
	const triggerProps: Required<TriggerHandlers<E>> = {
		onMouseEnter: (event) => {
			ref.current?.startAnimation();
			handlers.onMouseEnter?.(event);
		},
		onMouseLeave: (event) => {
			ref.current?.stopAnimation();
			handlers.onMouseLeave?.(event);
		},
		onFocus: (event) => {
			ref.current?.startAnimation();
			handlers.onFocus?.(event);
		},
		onBlur: (event) => {
			ref.current?.stopAnimation();
			handlers.onBlur?.(event);
		},
	};
	return { ref, triggerProps };
}
