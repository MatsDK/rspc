import { createClient, fetchExecute, sseExecute } from "@rspc/client";
import { createRSPCOptionsProxy, useSubscription } from "@rspc/react-query";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useMutation,
} from "@tanstack/react-query";
import React, { useState } from "react";

// Export from Rust. Run `cargo run -p example-axum` to start server and export it!
import type { Procedures } from "../../../bindings";

const fetchQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});
const url = "http://localhost:4000/rspc";
const client = createClient<Procedures>((args) => {
  if (args.type === "subscription") return sseExecute({ url }, args);
  else return fetchExecute({ url, batch: true, stream: true }, args);
});

const rspc = createRSPCOptionsProxy<Procedures>(client);

function Queries() {
  // `version` sleeps for a second server-side, so the loading state is real.
  const version = useQuery(rspc.version.queryOptions());
  const cached = useQuery(rspc.cached.queryOptions());

  return (
    <section>
      <h2>Queries</h2>
      <p>version: {version.isLoading ? "loading" : version.data}</p>
      <p>cached: {cached.isLoading ? "loading" : cached.data}</p>
      <button onClick={() => version.refetch()}>Refetch version</button>
    </section>
  );
}

function Mutation() {
  const [message, setMessage] = useState("Hello from React");
  const sendMsg = useMutation(
    rspc.sendMsg.mutationOptions({
      onSettled() {
        // The server logs the message; invalidating shows the round trip landed.
        fetchQueryClient.invalidateQueries({
          queryKey: rspc.version.queryKey(),
        });
      },
    }),
  );

  return (
    <section>
      <h2>Mutation</h2>
      <input value={message} onChange={(e) => setMessage(e.target.value)} />
      <button
        onClick={() => sendMsg.mutate(message)}
        disabled={sendMsg.isPending}
      >
        {sendMsg.isPending ? "Sending" : "Send"}
      </button>
      <p>status: {sendMsg.status}</p>
      {/* sendMsg echoes the input straight back, so this is the server's reply. */}
      <p>echoed: {sendMsg.data ?? "nothing yet"}</p>
    </section>
  );
}

// `basicSubscription` yields 1, 2, 3 and then completes, so both the accumulating
// values and the pending -> success transition are visible. Toggling `enabled` off
// unsubscribes, which is what proves teardown works.
function Subscription() {
  const [enabled, setEnabled] = useState(false);
  const [received, setReceived] = useState<number[]>([]);

  const subscription = useSubscription(
    rspc.basicSubscription.subscriptionOptions(null, {
      enabled,
      onData(value) {
        setReceived((prev) => [...prev, value]);
      },
      onError(err) {
        console.error(err.type, err.error);
      },
    }),
  );

  return (
    <section>
      <h2>Subscription</h2>
      <button
        onClick={() => {
          setReceived([]);
          setEnabled((on) => !on);
        }}
      >
        {enabled ? "Unsubscribe" : "Subscribe"}
      </button>
      <p>status: {subscription.status}</p>
      <p>received: {received.join(", ") || "nothing yet"}</p>
      {subscription.error ? <p>error: {subscription.error.type}</p> : null}
    </section>
  );
}

// The server rejects a malformed address, so this is a typed error arriving on the
// client rather than a generic failure.
function TypedError() {
  const [mail, setMail] = useState("example@example.com");
  const validate = useQuery(rspc.validator.queryOptions({ mail }));

  return (
    <section>
      <h2>Typed errors</h2>
      <input value={mail} onChange={(e) => setMail(e.target.value)} />
      <p>
        {validate.isLoading
          ? "validating"
          : validate.error
            ? `error (${validate.error.type}): ${JSON.stringify(validate.error.error)}`
            : "valid"}
      </p>
    </section>
  );
}

// StrictMode double-invokes effects, so this is also the check that subscription
// teardown works - without it every mount would leak an SSE connection.
export default function App() {
  return (
    <React.StrictMode>
      <QueryClientProvider client={fetchQueryClient}>
        <div>
          <h1>React</h1>
          <Queries />
          <Mutation />
          <Subscription />
          <TypedError />
        </div>
      </QueryClientProvider>
    </React.StrictMode>
  );
}
