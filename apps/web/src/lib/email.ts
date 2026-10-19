import { Resend } from "resend";

const FROM = process.env.RESEND_EMAIL_FROM ?? "pushstack@nandanvarma.com";

/**
 * Sends a transactional email through Resend. Without `RESEND_API_KEY`
 * outside production (local dev, `pnpm dev:local`) the email is printed to
 * the server log instead, so sign-up verification and password-reset links
 * still work; production refuses rather than silently dropping mail.
 */
export async function sendEmail({
	to,
	subject,
	html,
}: {
	to: string;
	subject: string;
	html: string;
}) {
	if (!process.env.RESEND_API_KEY) {
		if (process.env.NODE_ENV === "production") {
			throw new Error("RESEND_API_KEY is not set — cannot send email");
		}
		const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) =>
			m[1].replaceAll("&amp;", "&"),
		);
		console.info(
			`[email] to=${to} subject=${JSON.stringify(subject)}\n${links.map((l) => `  ${l}`).join("\n")}`,
		);
		return;
	}
	const resend = new Resend(process.env.RESEND_API_KEY);
	const { error } = await resend.emails.send({ from: FROM, to, subject, html });
	if (error) throw new Error(`Failed to send email: ${error.message}`);
}
