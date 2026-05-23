import { SageHRError } from "@hr-automotion/sagehr-client";

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

/** Render a successful tool result as pretty JSON. */
export function jsonResult(payload: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

/** Catch SageHR errors and convert to a structured error tool result. */
export async function withErrorHandling<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<ToolResult> {
  try {
    const result = await fn();
    return jsonResult(result);
  } catch (err: unknown) {
    if (err instanceof SageHRError) {
      const sageErr = err;
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: sageErr.name,
                message: sageErr.message,
                status: sageErr.status,
                endpoint: sageErr.endpoint,
                tool: label,
                // SageHR's response body usually explains *why* on 4xx
                // (e.g. {"errors":{"from":["is required"]}} for 422).
                // Truncate huge bodies to keep tool output reasonable.
                sagehr_response: truncateForLog(sageErr.body),
              },
              null,
              2,
            ),
          },
        ],
      };
    }
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: "UnexpectedError",
              message: err instanceof Error ? err.message : String(err),
              tool: label,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}

function truncateForLog(body: unknown, maxChars = 2000): unknown {
  if (body == null) return null;
  if (typeof body === "string") {
    return body.length > maxChars ? `${body.slice(0, maxChars)}…[truncated]` : body;
  }
  try {
    const serialised = JSON.stringify(body);
    if (serialised.length <= maxChars) return body;
    return `${serialised.slice(0, maxChars)}…[truncated]`;
  } catch {
    return String(body).slice(0, maxChars);
  }
}
