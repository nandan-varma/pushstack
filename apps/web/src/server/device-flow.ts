import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { MAX_DEVICE_USER_CODE_CHARS } from "#/lib/limits";
import {
	decideDeviceCode,
	findPendingDeviceCode,
	meterUserCodeAttempt,
} from "./device-flow-store";
import { getCurrentUser } from "./session";

/**
 * What the `/login/device` approval page needs: the user code's pending
 * request (client and scopes), or null. Needs a session, because a user code
 * is only meaningful to the person who was shown it.
 */
export const getDeviceAuthorization = createServerFn({ method: "GET" })
	.validator(z.object({ userCode: z.string().max(MAX_DEVICE_USER_CODE_CHARS) }))
	.handler(async ({ data }) => {
		const user = await getCurrentUser();
		await meterUserCodeAttempt(getRequest(), user.id);
		return findPendingDeviceCode(data.userCode);
	});

/** Approve or deny a pending device code as the signed-in user. */
export const decideDeviceAuthorization = createServerFn({ method: "POST" })
	.validator(
		z.object({
			userCode: z.string().max(MAX_DEVICE_USER_CODE_CHARS),
			approve: z.boolean(),
		}),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUser();
		await meterUserCodeAttempt(getRequest(), user.id);
		const decided = await decideDeviceCode({
			userCode: data.userCode,
			userId: user.id,
			approve: data.approve,
		});
		if (!decided) {
			throw new Error("This code is unknown, expired, or already decided");
		}
		return { approved: data.approve };
	});
