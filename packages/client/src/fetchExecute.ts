import { observable } from "./observable";
import type { ExecuteArgs, ExecuteFn } from "./types";

type BatchLoader = {
	data: [string, any][];
	callbacks: ((v: [number, any]) => void)[];
};

type BatchLoaders = {
	query: null | BatchLoader;
	mutation: null | BatchLoader;
};

// Keyed by url, so two clients pointing at different backends never share a batch.
const batchLoadersByUrl = new Map<string, BatchLoaders>();

function loadersFor(url: string): BatchLoaders {
	let loaders = batchLoadersByUrl.get(url);
	if (!loaders) {
		loaders = { query: null, mutation: null };
		batchLoadersByUrl.set(url, loaders);
	}
	return loaders;
}

// - batch: false, stream: false
// no batching or streaming. execution happens individually and no data is streamed.
//
// - batch: true, stream: false
// executions are batched by their type, returned data is same as above.
//
// - batch: false, stream: true
// execution happens individually, but the request asks for SSE so a procedure returning
// `rspc::Stream` yields every value rather than just the first. They are buffered and
// delivered as one array.
//
// - batch: true, stream: true
// executions are batched by their type, streaming behaviour is same as above,
// with results potentially returning out of order

/** Collects every `data:` frame of an SSE response, resolving once the server says stopped. */
async function collectSse(response: Response): Promise<unknown[]> {
	if (!response.body) throw new Error("response has no body");

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const items: unknown[] = [];
	let buffered = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffered += decoder.decode(value, { stream: true });
		const frames = buffered.split("\n\n");
		buffered = frames.pop() ?? "";

		for (const frame of frames) {
			const line = frame.split("\n").find((l) => l.startsWith("data: "));
			if (!line) continue;

			const data = line.slice("data: ".length);
			if (data === "stopped") return items;

			const parsed = JSON.parse(data);
			if ("item" in parsed) items.push(parsed.item);
			else if ("error" in parsed) throw parsed.error.data;
		}
	}

	return items;
}

export const fetchExecute = (
	config: { url: string; batch?: boolean; stream?: boolean },
	args: ExecuteArgs,
): ReturnType<ExecuteFn> => {
	if (args.type === "subscription")
		throw new Error("Subscriptions are not possible with the `fetch` executor");

	if (!config.batch) {
		const url = new URL(`${config.url}/${args.path}`);
		const abort = new AbortController();
		const accept = config.stream ? "text/event-stream" : "application/json";

		let promise;
		if (args.type === "query") {
			url.search = new URLSearchParams(
				args.input === undefined ? {} : { input: JSON.stringify(args.input) },
			).toString();

			promise = fetch(url.toString(), {
				method: "GET",
				// Queries with no input all hit the same URL every call (e.g.
				// `get_transactions`), which the browser's HTTP cache will otherwise
				// happily serve stale on repeat navigations - the backend never sends
				// Cache-Control either, so nothing stops it.
				cache: "no-store",
				headers: {
					Accept: accept,
				},
				signal: abort.signal,
			});
		} else {
			promise = fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: accept,
				},
				body: JSON.stringify(args.input),
				signal: abort.signal,
			});
		}

		return observable((subscriber) => {
			promise
				.then(async (r) => {
					if (r.status !== 200) {
						subscriber.error(await r.json().catch(() => r.statusText));
						return;
					}

					subscriber.next({
						type: "data",
						value: config.stream ? await collectSse(r) : await r.json(),
					});
					subscriber.complete();
				})
				.catch((e) => {
					subscriber.error(e.toString());
				});

			return () => abort.abort();
		});
	} else {
		const type = args.type;
		const batchLoaders = loadersFor(config.url);
		let batchLoader = batchLoaders[type];

		if (!batchLoader) {
			batchLoader = batchLoaders[type] = {
				data: [],
				callbacks: [],
			};

			const loader = batchLoader;
			const flush = async () => {
				batchLoaders[type] = null;

				const resp = await fetch(config.url, {
					method: "POST",
					body: JSON.stringify(loader.data),
					headers: {
						"Content-Type": "application/json",
						...(config.stream ? { "rspc-batch-mode": "stream" } : {}),
					},
				});

				if (!config.stream) {
					const items: [number, any][] = await resp.json();

					loader.callbacks.forEach((v, i) => {
						v(items[i]);
					});
				} else {
					if (!resp.body) throw new Error("response has no body");

					const reader = resp.body.getReader();
					const decoder = new TextDecoder();

					while (true) {
						const { done, value } = await reader.read();
						if (done) break;

						const line = decoder.decode(value);

						const regex = /(\d+):(\[.*\])\s*$/;
						const match = line.match(regex);
						if (!match) throw new Error("invalid stream content!");

						const index = Number.parseInt(match[1]);
						const [status, data] = JSON.parse(match[2]);

						loader.callbacks[index]?.([status, data]);
					}
				}
			};

			// Without this a throw in here is an unhandled rejection inside a timer, and
			// every queued caller waits forever.
			setTimeout(() => {
				flush().catch((err) => {
					const message = err instanceof Error ? err.message : String(err);
					for (const callback of loader.callbacks) callback([500, message]);
				});
			}, 1);
		}

		batchLoader.data.push([
			args.path,
			args.input === undefined ? null : args.input,
		]);

		const loader = batchLoader;
		return observable((observer) => {
			loader.callbacks.push(([status, data]) => {
				if (status === 200) {
					observer.next({ type: "data", value: data });
					observer.complete();
				} else {
					observer.error(data);
				}
			});
		});
	}
};
