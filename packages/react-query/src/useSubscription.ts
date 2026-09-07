import { useEffect, useRef, useState } from "react";
import type { RspcSubscriptionOptions } from "./createOptionsProxy";

export type SubscriptionStatus = "idle" | "pending" | "success" | "error";

export type SubscriptionResult<TOut, TError> = {
	data: TOut | undefined;
	error: TError | undefined;
	status: SubscriptionStatus;
};

export function useSubscription<TOut, TError>(
	options: RspcSubscriptionOptions<TOut, TError>,
): SubscriptionResult<TOut, TError> {
	const [state, setState] = useState<SubscriptionResult<TOut, TError>>({
		data: undefined,
		error: undefined,
		status: "idle",
	});

	// Callers pass inline callbacks, so `options` is a new object every render.
	// Reading them through a ref keeps the effect keyed on `enabled` alone.
	const latest = useRef(options);
	latest.current = options;

	useEffect(() => {
		if (!options.enabled) return;

		const sub = latest.current.subscribe({
			onStarted() {
				latest.current.onStarted?.();
				setState({ data: undefined, error: undefined, status: "pending" });
			},
			onData(value) {
				latest.current.onData?.(value);
				setState({ data: value, error: undefined, status: "pending" });
			},
			onComplete() {
				latest.current.onComplete?.();
				setState((s) => ({ ...s, status: "success" }));
			},
			onError(error) {
				latest.current.onError?.(error);
				setState((s) => ({ ...s, error, status: "error" }));
			},
		});

		return () => sub.unsubscribe();
	}, [options.enabled]);

	return state;
}
