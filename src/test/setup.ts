import "@testing-library/jest-dom/vitest";

// @ts-expect-error - This is required for React Testing Library
global.IS_REACT_ACT_ENVIRONMENT = true;
process.env.BETTER_AUTH_SECRET ??=
	"test-better-auth-secret-with-32-plus-characters";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

// Mock window.matchMedia
Object.defineProperty(window, "matchMedia", {
	writable: true,
	value: (query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: () => {}, // deprecated
		removeListener: () => {}, // deprecated
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => {},
	}),
});

class MockIntersectionObserver implements IntersectionObserver {
	readonly root = null;
	readonly rootMargin = "";
	readonly scrollMargin = "";
	readonly thresholds = [];

	disconnect() {}
	observe() {}
	unobserve() {}
	takeRecords() {
		return [];
	}
}

global.IntersectionObserver = MockIntersectionObserver;
