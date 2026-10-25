/**
 * The device flow's state machine: create a code, poll it, approve or deny it.
 * Every transition is one conditional UPDATE, so two racing requests cannot
 * both win: a code's token is issued by whichever poll flips `consumedAt`.
 * (The Neon HTTP driver has no transactions, so a token insert that fails
 * after the code is consumed burns the code; the user runs the login again.)
 */
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "#/db";
import { deviceCodes, tokens } from "#/db/app-schema";
import { bytesToBase64Url, randomBytes, sha256Hex } from "#/lib/bytes";
import {
	canonicalUserCode,
	DEVICE_CODE_LIFETIME_SECONDS,
	DEVICE_POLL_INTERVAL_SECONDS,
	type DeviceFlowError,
	newDeviceCode,
	newUserCode,
	SLOW_DOWN_STEP_SECONDS,
} from "#/lib/device-flow";
import { TOKEN_PREFIX, type TokenScope } from "#/lib/token-scopes";
import { hitRateLimit, identityFor } from "./rate-limit";

/** The name a token issued by the device flow carries in the settings list. */
const DEVICE_TOKEN_NAME = "Device login";
const MAX_USER_CODE_ATTEMPTS = 5;

/**
 * Every user code typed on the approval page is an attempt to guess one: count
 * it against the signed-in user and the client IP, and refuse once either
 * bucket is spent. Both buckets are checked, so neither a single account nor
 * one address can be used to brute-force codes.
 */
export async function meterUserCodeAttempt(
	request: Request,
	userId: string,
): Promise<void> {
	const rates = await Promise.all([
		hitRateLimit("device-user-code", identityFor(request, userId)),
		hitRateLimit("device-user-code", identityFor(request, null)),
	]);
	const exceeded = rates.find((rate) => rate?.exceeded);
	if (exceeded) {
		const seconds = Math.max(1, exceeded.reset - Math.floor(Date.now() / 1000));
		throw new Error(`Too many code attempts. Try again in ${seconds} seconds.`);
	}
}

export interface DeviceCodeGrant {
	deviceCode: string;
	userCode: string;
	expiresIn: number;
	interval: number;
}

export type PollOutcome =
	| { ok: true; accessToken: string; scopes: TokenScope[] }
	| { ok: false; error: DeviceFlowError; interval?: number };

export async function createDeviceCode(input: {
	clientId: string;
	scopes: TokenScope[];
}): Promise<DeviceCodeGrant> {
	const now = new Date();
	// Expired codes can never be approved or polled to a token: drop them so
	// unauthenticated requests cannot grow this table without bound.
	await db.delete(deviceCodes).where(lt(deviceCodes.expiresAt, now));

	const expiresAt = new Date(
		now.getTime() + DEVICE_CODE_LIFETIME_SECONDS * 1000,
	);
	for (let attempt = 0; attempt < MAX_USER_CODE_ATTEMPTS; attempt++) {
		const deviceCode = newDeviceCode();
		const userCode = newUserCode();
		const [inserted] = await db
			.insert(deviceCodes)
			.values({
				deviceCodeHash: await sha256Hex(deviceCode),
				userCode,
				clientId: input.clientId,
				scopes: [...new Set(input.scopes)],
				status: "pending",
				interval: DEVICE_POLL_INTERVAL_SECONDS,
				expiresAt,
			})
			.onConflictDoNothing()
			.returning({ id: deviceCodes.id });
		if (inserted) {
			return {
				deviceCode,
				userCode,
				expiresIn: DEVICE_CODE_LIFETIME_SECONDS,
				interval: DEVICE_POLL_INTERVAL_SECONDS,
			};
		}
	}
	throw new Error("Could not allocate a device user code");
}

/**
 * One poll from the client. Checks run in GitHub's order: an unknown or
 * already-used device code, a different client, expiry, then the polling
 * rate, and only then the approval state.
 */
export async function pollDeviceCode(input: {
	clientId: string;
	deviceCode: string;
}): Promise<PollOutcome> {
	const row = await db.query.deviceCodes.findFirst({
		where: { deviceCodeHash: await sha256Hex(input.deviceCode) },
	});
	if (!row || row.consumedAt) {
		return { ok: false, error: "incorrect_device_code" };
	}
	if (row.clientId !== input.clientId) {
		return { ok: false, error: "incorrect_client_credentials" };
	}
	const now = new Date();
	if (row.expiresAt <= now) return { ok: false, error: "expired_token" };

	// The polling gate is one conditional write. A poll is admitted only if the
	// previous one is at least `interval` seconds old, and the check and the
	// stamp are the same statement, so two racing polls cannot both pass it.
	const [admitted] = await db
		.update(deviceCodes)
		.set({ lastPolledAt: sql`now()` })
		.where(
			and(
				eq(deviceCodes.id, row.id),
				or(
					isNull(deviceCodes.lastPolledAt),
					sql`${deviceCodes.lastPolledAt} <= now() - make_interval(secs => ${deviceCodes.interval})`,
				),
			),
		)
		.returning({ id: deviceCodes.id });
	if (!admitted) {
		// Too soon: each such poll adds a step. The increment is computed in SQL
		// from the stored interval, so concurrent slow-downs all count.
		const [slowed] = await db
			.update(deviceCodes)
			.set({
				interval: sql`${deviceCodes.interval} + ${SLOW_DOWN_STEP_SECONDS}`,
				lastPolledAt: sql`now()`,
			})
			.where(eq(deviceCodes.id, row.id))
			.returning({ interval: deviceCodes.interval });
		if (!slowed) return { ok: false, error: "incorrect_device_code" };
		return { ok: false, error: "slow_down", interval: slowed.interval };
	}

	if (row.status === "denied") return { ok: false, error: "access_denied" };
	if (row.status === "pending") {
		return { ok: false, error: "authorization_pending" };
	}

	const [consumed] = await db
		.update(deviceCodes)
		.set({ consumedAt: now })
		.where(
			and(
				eq(deviceCodes.id, row.id),
				eq(deviceCodes.status, "approved"),
				isNull(deviceCodes.consumedAt),
			),
		)
		.returning({ userId: deviceCodes.userId });
	if (!consumed?.userId) return { ok: false, error: "incorrect_device_code" };

	const accessToken = `${TOKEN_PREFIX}${bytesToBase64Url(randomBytes(30))}`;
	await db.insert(tokens).values({
		userId: consumed.userId,
		name: DEVICE_TOKEN_NAME,
		tokenHash: await sha256Hex(accessToken),
		scopes: row.scopes,
		expiresAt: null,
	});
	return { ok: true, accessToken, scopes: row.scopes };
}

/** What the approval page shows for a user code that can still be decided. */
export async function findPendingDeviceCode(userCode: string): Promise<{
	userCode: string;
	clientId: string;
	scopes: TokenScope[];
} | null> {
	const canonical = canonicalUserCode(userCode);
	if (!canonical) return null;
	const row = await db.query.deviceCodes.findFirst({
		where: { userCode: canonical },
	});
	if (row?.status !== "pending" || row.expiresAt <= new Date()) {
		return null;
	}
	return { userCode: row.userCode, clientId: row.clientId, scopes: row.scopes };
}

/**
 * Approve or deny a pending code for `userId`. False when the code is unknown,
 * already decided or expired, so a stale page cannot change the outcome.
 */
export async function decideDeviceCode(input: {
	userCode: string;
	userId: string;
	approve: boolean;
}): Promise<boolean> {
	const canonical = canonicalUserCode(input.userCode);
	if (!canonical) return false;
	const decided = await db
		.update(deviceCodes)
		.set({
			status: input.approve ? "approved" : "denied",
			userId: input.userId,
		})
		.where(
			and(
				eq(deviceCodes.userCode, canonical),
				eq(deviceCodes.status, "pending"),
				gt(deviceCodes.expiresAt, new Date()),
			),
		)
		.returning({ id: deviceCodes.id });
	return decided.length > 0;
}
