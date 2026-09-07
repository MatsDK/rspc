import { observable } from "./observable";
import type { ExecuteData, ExecuteArgs, ExecuteFn } from "./types";

interface SSEExecuteArgs {
	url: string;
	eventSourceInitDict?: EventSourceInit;
	makeEventSource?: (
		url: string,
		eventSourceInitDict?: EventSourceInit,
	) => EventSource;
	/// Called each time the transport drops and the browser retries. The subscription
	/// restarts from scratch on reconnect - the server has no resume support.
	onReconnecting?: () => void;
}

export function sseExecute(
	sseArgs: SSEExecuteArgs,
	args: ExecuteArgs,
): ReturnType<ExecuteFn> {
	let fullUrl = `${sseArgs.url}/${args.path}`;
	if (args.input !== undefined) {
		const encodedInput = encodeURIComponent(JSON.stringify(args.input));
		fullUrl += `?input=${encodedInput}`;
	}

	const sse = sseArgs.makeEventSource
		? sseArgs.makeEventSource(fullUrl, sseArgs.eventSourceInitDict)
		: new EventSource(fullUrl, sseArgs.eventSourceInitDict);

	return observable<ExecuteData, any>((o) => {
		sse.onopen = () => {
			o.next({ type: "started" });
		};
		sse.onmessage = (e) => {
			if (e.data === "stopped") {
				sse.close();
				o.complete();
				return;
			}

			const value:
				| { item: any }
				| {
						error: { code: number; message: string; data: any };
				  } = JSON.parse(e.data);

			if ("item" in value) {
				o.next({ type: "data", value: value.item });
			} else if ("error" in value) {
				o.error(value.error.data);
				sse.close();
			}
		};
		sse.onerror = (e) => {
			// `CONNECTING` means the browser is already retrying, so this is a blip, not a
			// failure. Erroring here would end the observable and leave that retry running
			// against the ~6-per-origin cap with nobody reading it.
			if (sse.readyState === EventSource.CONNECTING) {
				sseArgs.onReconnecting?.();
				return;
			}

			sse.close();
			o.error(e);
		};

		return () => sse.close();
	});
}
