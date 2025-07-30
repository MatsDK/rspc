import { createClient, fetchExecute, sseExecute } from "@rspc/client/next";
import { createRSPCOptionsProxy } from "@rspc/react-query";
import {
	QueryClient,
	QueryClientProvider,
	useMutation,
	useQuery,
} from "@tanstack/react-query";
import React, { useState } from "react";

// Export from Rust. Run `cargo run -p example-axum` to start server and export it!
import type { Procedures } from "../../../bindings";

export const fetchQueryClient = new QueryClient({
	defaultOptions: {
		queries: {
			throwOnError: false,
			retry: false,
		},
	},
});

// Custom fetch parameters
// const fetchClient = createClient<Procedures>({
//   transport: new FetchTransport("http://localhost:4000/rspc", (input, init) =>
//     fetch(input, { ...init, credentials: "include" }) // Include Cookies for cross-origin requests
//   ),
// });

// const evtSource = new EventSource("http://[::]:4000/rspc/pings", {
//   // withCredentials: true,
// });
// console.log(evtSource);
// evtSource.addEventListener("message", (event) => {
//   console.log(event);
// });

// export const wsQueryClient = new QueryClient();
// const wsClient = createClient<Procedures>({
//   transport: new WebsocketTransport("ws://localhost:4000/rspc/ws"),
// });

const url = "http://localhost:4000/rspc";
const client = createClient<Procedures>((args) => {
	if (args.type === "subscription") return sseExecute({ url }, args);
	else return fetchExecute({ url, batch: true, stream: true }, args);
});

const rspc = createRSPCOptionsProxy<Procedures>(client);

function Example({ name }: { name: string }) {
	const [rerenderProp, setRendererProp] = useState(Date.now().toString());
	const { data: version } = useQuery(rspc.version.queryOptions());
	const { mutate, isPending } = useMutation(rspc.sendMsg.mutationOptions());
	const { error } = useQuery(rspc.validator.queryOptions({ mail: "test" }));
	// const { error } = useQuery(rspc.newstuffpanic.queryOptions())

	return (
		<div>
			<p>Using rspc version: {version}</p>
			<button onClick={() => mutate("Hello!")} disabled={isPending}>
				Send Msg!
			</button>
			<p>{error?.type} </p>
		</div>
		// <div
		//   style={{
		//     border: "black 1px solid",
		//   }}
		// >
		//   <h1>{name}</h1>
		//   <p>Echo response: {echo}</p>
		//   <ExampleSubscription rerenderProp={rerenderProp} />
		//   <button onClick={() => setRendererProp(Date.now().toString())}>
		//     Rerender subscription
		//   </button>
		// </div>
	);
}

// function ExampleSubscription({ rerenderProp }: { rerenderProp: string }) {
//   const [i, setI] = useState(0);
//   rspc.useSubscription(["pings"], {
//     onData(msg) {
//       setI((i) => i + 1);
//     },
//   });

//   return (
//     <p>
//       Pings received: {i} {rerenderProp}
//     </p>
//   );
// }

export default function App() {
	return (
		<React.StrictMode>
			<div
				style={{
					backgroundColor: "rgba(50, 205, 50, .5)",
				}}
			>
				<QueryClientProvider client={fetchQueryClient}>
					<h1>React</h1>
					<Example name="Fetch Transport" />
				</QueryClientProvider>
			</div>
		</React.StrictMode>
	);
}
// <QueryClientProvider client={fetchQueryClient}>
//   <rspc.Provider client={fetchClient} queryClient={fetchQueryClient}>
//     <Example name="Fetch Transport" />
//   </rspc.Provider>
// </QueryClientProvider>
// <rspc.Provider client={wsClient} queryClient={wsQueryClient}>
//   <QueryClientProvider client={wsQueryClient}>
//     <Example name="Websocket Transport" />
//   </QueryClientProvider>
// </rspc.Provider>
