import { type Readable, readable } from "svelte/store";
import type { RspcSubscriptionOptions } from "./createOptionsProxy";

export type SubscriptionStatus = "idle" | "pending" | "success" | "error";

export type SubscriptionResult<TOut, TError> = {
	data: TOut | undefined;
	error: TError | undefined;
	status: SubscriptionStatus;
};

function idle<TOut, TError>(): SubscriptionResult<TOut, TError> {
	return { data: undefined, error: undefined, status: "idle" };
}

export function useSubscription<TOut, TError>(
	options: RspcSubscriptionOptions<TOut, TError>,
): Readable<SubscriptionResult<TOut, TError>> {
	return readable(idle<TOut, TError>(), (set) => {
		if (!options.enabled) return;

		let state = idle<TOut, TError>();
		const update = (next: Partial<SubscriptionResult<TOut, TError>>) => {
			state = { ...state, ...next };
			set(state);
		};

		const sub = options.subscribe({
			onStarted() {
				options.onStarted?.();
				update({ data: undefined, error: undefined, status: "pending" });
			},
			onData(value) {
				options.onData?.(value);
				update({ data: value, error: undefined, status: "pending" });
			},
			onComplete() {
				options.onComplete?.();
				update({ status: "success" });
			},
			onError(error) {
				options.onError?.(error);
				update({ error, status: "error" });
			},
		});

		// Svelte calls this when the last subscriber goes away, so teardown is automatic
		// on component destroy - no onDestroy needed at the call site.
		return () => sub.unsubscribe();
	});
}
