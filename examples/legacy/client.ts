// The rspc 0.3 client, talking JSON-RPC to a 0.3-syntax router mounted on the v2 core.
// Run `cargo run -p example-legacy` first to start the server and write bindings.ts.
import {
	createClient,
	FetchTransport,
	WebsocketTransport,
} from "@rspc/client/legacy";
import { ProceduresLegacy } from "./bindings.ts";

const client = createClient<ProceduresLegacy>({
	transport: new FetchTransport("http://[::]:4000/rspc"),
});

client.query(["version"]).then((v) => console.log("version", v));
client.query(["echo", "hello"]).then((v) => console.log("echo", v));
client.mutation(["sendMsg", "message"]).then((v) => console.log("sendMsg", v));

// Subscriptions need the websocket transport; the fetch one cannot carry them.
const ws = createClient<ProceduresLegacy>({
	transport: new WebsocketTransport("ws://[::]:4000/rspc/ws"),
});

ws.addSubscription(["pings", null], {
	onData: (value) => console.log("ping", value),
});
