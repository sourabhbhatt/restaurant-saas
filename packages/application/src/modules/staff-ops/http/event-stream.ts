import type {
  RealtimeChannel,
  RealtimeSubscriber,
} from "@ros/adapters/realtime/interfaces/realtime";

export const SSE_HEARTBEAT_MS = 25_000;

/**
 * Server-Sent Events response for one realtime channel. Each bus event is sent
 * as `event: <type>` with the JSON event as data; a comment heartbeat keeps
 * proxies from closing idle connections. The subscription is released when the
 * client disconnects (request aborted) or the stream is cancelled.
 */
export function eventStreamResponse(input: {
  bus: RealtimeSubscriber;
  channel: RealtimeChannel;
  signal: AbortSignal;
  requestId: string;
  heartbeatMs?: number;
}): Response {
  const encoder = new TextEncoder();
  let cleanup: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const unsubscribe = input.bus.subscribe(input.channel, (event) => {
        const type = event.type.replace(/[^\w.:-]/g, "") || "message";
        send(`event: ${type}\ndata: ${JSON.stringify(event)}\n\n`);
      });
      const heartbeat = setInterval(
        () => send(`: heartbeat ${Date.now()}\n\n`),
        input.heartbeatMs ?? SSE_HEARTBEAT_MS,
      );
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        input.signal.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          // already closed by the runtime
        }
      };
      if (input.signal.aborted) {
        cleanup();
        return;
      }
      input.signal.addEventListener("abort", cleanup, { once: true });
      // Reconnect delay hint for EventSource, then a ready event.
      send(`retry: 5000\n\n`);
      send(
        `event: ready\ndata: ${JSON.stringify({ channel: input.channel, at: new Date().toISOString() })}\n\n`,
      );
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-request-id": input.requestId,
    },
  });
}
