import { createClient, fetchExecute, sseExecute } from "@rspc/client";
import {
  createRSPCOptionsProxy,
  inferOutput,
  useSubscription,
} from "@rspc/react-query";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useMutation,
} from "@tanstack/react-query";
import React from "react";

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

function Example() {
  type Version = inferOutput<typeof rspc.version>;
  const version = useQuery(rspc.version.queryOptions());
  const validate = useQuery(
    rspc.validator.queryOptions({ mail: "example@example.com" }),
  );

  const mutation = useMutation(
    rspc.sendMsg.mutationOptions({
      onSettled() {
        fetchQueryClient.invalidateQueries({
          queryKey: rspc.version.queryKey(),
        });
      },
    }),
  );

  const subscription = useSubscription(
    rspc.basicSubscription.subscriptionOptions(null, {
      enabled: true,
      onData(value) {
        console.log("Data received", value);
      },
      onError(err) {
        console.error(err.type, err.error);
      },
    }),
  );

  return (
    <div>
      <h1>React</h1>
      {version.isLoading ? <p>Loading</p> : <p>{version.data}</p>}
      <p>validated {JSON.stringify(validate.data)}</p>
      <p>subscription {JSON.stringify(subscription.data)}</p>
      {subscription.error ? <p>Error {subscription.error.type}</p> : null}
      <p>status {subscription.status}</p>
      <button onClick={() => mutation.mutate("Message")}>
        Trigger mutation
      </button>
    </div>
  );
}

// StrictMode double-invokes effects, so this is also the check that subscription
// teardown works - without it every mount would leak an SSE connection.
export default function App() {
  return (
    <React.StrictMode>
      <QueryClientProvider client={fetchQueryClient}>
        <Example />
      </QueryClientProvider>
    </React.StrictMode>
  );
}
