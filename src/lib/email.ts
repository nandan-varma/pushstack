import { Resend } from "resend";

const FROM = process.env.RESEND_EMAIL_FROM ?? "pushstack@nandanvarma.com";

export async function sendEmail({
	to,
	subject,
	html,
}: {
	to: string;
	subject: string;
	html: string;
}) {
	const resend = new Resend(process.env.RESEND_API_KEY);
	const { error } = await resend.emails.send({ from: FROM, to, subject, html });
	if (error) throw new Error(`Failed to send email: ${error.message}`);
}
