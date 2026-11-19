import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const createUserProjectField = vi.hoisted(() => vi.fn());
const updateUserProjectField = vi.hoisted(() => vi.fn());
vi.mock("@/server/projects", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	createUserProjectField,
	updateUserProjectField,
}));
vi.mock("@/components/toast-provider", () => ({
	useToast: () => ({ toast: vi.fn() }),
}));

const { ProjectFieldEditor } = await import("../project/ProjectFieldEditor");

const fields = [
	{
		id: 1,
		name: "Status",
		dataType: "SINGLE_SELECT" as const,
		options: [
			{ id: "9", name: "Todo", color: "GRAY" },
			{ id: "10", name: "Done", color: "GREEN" },
		],
	},
	{ id: 2, name: "Notes", dataType: "TEXT" as const, options: [] },
];

function renderEditor() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<ProjectFieldEditor login="alice" number={3} fields={fields} />
		</QueryClientProvider>,
	);
}

afterEach(() => vi.clearAllMocks());

describe("ProjectFieldEditor", () => {
	it("creates a select field with its options", async () => {
		const user = userEvent.setup();
		renderEditor();
		await user.type(screen.getByLabelText("Field name"), "Priority");
		await user.click(screen.getByLabelText("Type"));
		await user.click(
			await screen.findByRole("option", { name: "Single select" }),
		);
		await user.type(screen.getByLabelText("Options"), "High");
		await user.keyboard("{Enter}");
		await user.click(screen.getByRole("button", { name: "Add field" }));
		expect(createUserProjectField.mock.calls[0]?.[0]).toEqual({
			data: {
				login: "alice",
				number: 3,
				name: "Priority",
				dataType: "SINGLE_SELECT",
				options: [{ name: "High" }],
			},
		});
	});

	it("keeps Add field disabled until a select field has a name and an option", async () => {
		const user = userEvent.setup();
		renderEditor();
		const submit = screen.getByRole("button", { name: "Add field" });
		expect(submit).toBeDisabled();
		await user.type(screen.getByLabelText("Field name"), "Points");
		await user.click(screen.getByLabelText("Type"));
		await user.click(await screen.findByRole("option", { name: "Number" }));
		expect(submit).not.toBeDisabled();
	});

	it("renames a field", async () => {
		const user = userEvent.setup();
		renderEditor();
		await user.click(screen.getByRole("button", { name: "Status" }));
		await user.clear(screen.getByLabelText("Rename Status"));
		await user.type(screen.getByLabelText("Rename Status"), "Stage");
		await user.click(screen.getByRole("button", { name: "Save" }));
		expect(updateUserProjectField.mock.calls[0]?.[0]).toEqual({
			data: {
				login: "alice",
				number: 3,
				fieldId: 1,
				name: "Stage",
			},
		});
	});

	it("appends an option while keeping the existing ones by id", async () => {
		const user = userEvent.setup();
		renderEditor();
		await user.type(
			screen.getByLabelText("Add an option to Status"),
			"Blocked",
		);
		await user.click(
			screen.getByRole("button", { name: "Add option to Status" }),
		);
		expect(updateUserProjectField.mock.calls[0]?.[0]).toEqual({
			data: {
				login: "alice",
				number: 3,
				fieldId: 1,
				options: [
					{ id: "9", name: "Todo" },
					{ id: "10", name: "Done" },
					{ name: "Blocked" },
				],
			},
		});
	});

	it("shows no option controls for a plain field", () => {
		renderEditor();
		expect(
			screen.queryByLabelText("Add an option to Notes"),
		).not.toBeInTheDocument();
	});
});
