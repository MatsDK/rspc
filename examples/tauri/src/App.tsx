import { createClient } from "@rspc/client";
import { tauriExecute } from "@rspc/tauri";

import { Procedures } from "../../bindings";

import "./App.css";

const client = createClient<Procedures>(tauriExecute);

function App() {
	client.sendMsg.mutate("bruh").then(console.log);

	const subscription = client.basicSubscription.subscribe(null, {
		onData: (d) => {
			console.log("subscription", d);
		},
	});

	return (
		<main class="container">
			<h1>Welcome to Tauri + Solid</h1>
			<button onClick={() => subscription.unsubscribe()}>Unsubscribe</button>
		</main>
	);
}

export default App;
